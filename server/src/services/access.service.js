const { Op } = require('sequelize');
const db = require('../../models');
const clientsService = require('./clients.service');
const onboardingService = require('./onboarding.service');
const referencesService = require('./references.service');
const scannerEventsService = require('./scanner-events.service');
const {
  resolveClientAccessContext,
} = require('./client-access-context.service');
const {
  getPhoneLookupDigits,
  normalizePhone,
  normalizedPhoneColumn,
} = require('../utils/phone');

const REPEAT_SCAN_WINDOW_MINUTES = 5;
const MAX_QR_LENGTH = 256;
const MAX_CLIENT_EVENT_ID_LENGTH = 128;

function appError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeQr(rawQr) {
  const qr = String(rawQr || '').replace(/[\s@\r\n]/g, '');
  if (!qr) {
    const error = new Error('QR пустой');
    error.statusCode = 400;
    error.code = 'QR_EMPTY';
    throw error;
  }
  if (qr.length > MAX_QR_LENGTH) {
    const error = new Error('QR слишком длинный');
    error.statusCode = 400;
    error.code = 'QR_TOO_LONG';
    throw error;
  }

  return qr;
}

function normalizeClientEventId(clientEventId) {
  const value = String(clientEventId || '').trim();
  if (!value) return null;
  return value.slice(0, MAX_CLIENT_EVENT_ID_LENGTH);
}

function serializeVisitUser(user) {
  const raw = user?.toJSON ? user.toJSON() : user;
  if (!raw) return null;

  return {
    id: raw.id,
    name: raw.name,
    phone: raw.phone,
    source: raw.source,
    telegramId: raw.telegramId,
    vkId: raw.vkId,
    webId: raw.webId,
  };
}

async function serializeVisitEvent(visitId, { isRepeated = false, clientEventId = null } = {}) {
  const visit = await db.Visit.findByPk(visitId, {
    include: [
      { model: db.User },
      {
        model: db.VisitCategory,
        as: 'categories',
        attributes: ['id', 'name'],
        through: { attributes: [] },
      },
    ],
  });

  if (!visit) return null;

  const categories = visit.categories || [];

  return {
    success: true,
    user: serializeVisitUser(visit.User),
    visitId: visit.id,
    isRepeated,
    clientEventId: clientEventId || visit.clientEventId || null,
    keyNumber: visit.keyNumber || '',
    keyIssued: Boolean(visit.keyNumber),
    category: visit.category || categories.map((category) => category.name).join(', '),
    categoryIds: categories.map((category) => category.id),
  };
}

async function searchUsers(query, tenant = null) {
  const normalizedQuery = String(query || '').trim();
  if (normalizedQuery.length < 2) return [];
  const context = await resolveClientAccessContext(tenant);

  const phoneDigits = normalizePhone(normalizedQuery);
  const conditions = [
    { name: { [Op.like]: `%${normalizedQuery}%` } },
    { phone: { [Op.like]: `%${normalizedQuery}%` } },
  ];

  if (phoneDigits.length >= 2) {
    conditions.push({ phoneNormalized: { [Op.like]: `%${phoneDigits}%` } });
    conditions.push(
      db.Sequelize.where(normalizedPhoneColumn(), {
        [Op.like]: `%${phoneDigits}%`,
      }),
    );

    const localDigits = getPhoneLookupDigits(phoneDigits);
    if (localDigits !== phoneDigits && localDigits.length >= 2) {
      conditions.push(
        db.Sequelize.where(normalizedPhoneColumn(), {
          [Op.like]: `%${localDigits}%`,
        }),
      );
    }
  }

  const users = await db.User.findAll({
    where: {
      ...(context.scoped ? { organizationId: context.organizationId } : {}),
      status: 'active',
      isTraining: false,
      mergedIntoUserId: null,
      [Op.or]: conditions,
    },
    order: [['createdAt', 'DESC']],
    limit: 10,
  });

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    phone: user.phone,
    source: user.source,
  }));
}

async function findUserByPhone(phone, tenant = null) {
  const phoneDigits = getPhoneLookupDigits(phone);
  if (phoneDigits.length < 10) return null;

  return clientsService.findActiveByPhone(phoneDigits, tenant);
}

async function findUserByQr(qr, tenant = null) {
  return clientsService.findCanonicalByQr(qr, tenant);
}

async function createVisitForUser(user, options = {}) {
  const {
    account = null,
    clientEventId = null,
    entrySource = 'qr',
    metadata = null,
    rawQr = null,
    source = null,
  } = options;

  const normalizedClientEventId = normalizeClientEventId(clientEventId);
  const trainingMarker = await onboardingService.getTrainingDataMarker(account);

  let visitResult;

  try {
    visitResult = await db.sequelize.transaction(async (transaction) => {
      if (normalizedClientEventId) {
        const existingVisit = await db.Visit.findOne({
          where: { clientEventId: normalizedClientEventId },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });

        if (existingVisit) {
          return {
            visitId: existingVisit.id,
            isRepeated: true,
            duplicateCode: 'CLIENT_EVENT_RETRY',
            duplicateMessage:
              'Повторная отправка того же события не создала новый визит',
            clientEventId: normalizedClientEventId,
          };
        }
      }

      const lockedUser = await db.User.findByPk(user.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!lockedUser || lockedUser.status !== 'active') return null;

      const lastVisit = await db.Visit.findOne({
        where: { userId: lockedUser.id },
        order: [
          ['scannedAt', 'DESC'],
          ['createdAt', 'DESC'],
        ],
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      const isRepeated =
        lastVisit &&
        (Date.now() - new Date(lastVisit.scannedAt || lastVisit.createdAt).getTime()) /
          60000 <
          REPEAT_SCAN_WINDOW_MINUTES;

      if (isRepeated) {
        return {
          visitId: lastVisit.id,
          isRepeated: true,
          duplicateCode: 'REPEAT_SCAN_WINDOW',
          duplicateMessage: 'Повторный вход в коротком окне не создал новый визит',
          clientEventId: normalizedClientEventId,
        };
      }

      const visit = await db.Visit.create(
        {
          userId: lockedUser.id,
          scannedAt: new Date(),
          entrySource,
          qrRaw: rawQr || null,
          clientEventId: normalizedClientEventId,
          ...trainingMarker,
        },
        { transaction },
      );

      return {
        visitId: visit.id,
        isRepeated: false,
        clientEventId: normalizedClientEventId,
      };
    });
  } catch (error) {
    if (
      normalizedClientEventId &&
      (error?.name === 'SequelizeUniqueConstraintError' ||
        error?.parent?.code === 'ER_DUP_ENTRY')
    ) {
      const existingVisit = await db.Visit.findOne({
        where: { clientEventId: normalizedClientEventId },
      });

      if (existingVisit) {
        visitResult = {
          visitId: existingVisit.id,
          isRepeated: true,
          duplicateCode: 'CLIENT_EVENT_RETRY',
          duplicateMessage: 'Повторная отправка того же события не создала новый визит',
          clientEventId: normalizedClientEventId,
        };
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }

  if (!visitResult) return null;

  const result = await serializeVisitEvent(visitResult.visitId, {
    isRepeated: visitResult.isRepeated,
    clientEventId: visitResult.clientEventId,
  });
  if (!result) return null;

  await scannerEventsService.recordEvent({
    eventType: result.isRepeated ? `${entrySource}_duplicate` : `${entrySource}_success`,
    severity: result.isRepeated ? 'warning' : 'info',
    status: result.isRepeated ? 'ignored' : 'created',
    message: result.isRepeated
      ? visitResult.duplicateMessage
      : 'Создан визит клиента',
    code: result.isRepeated ? visitResult.duplicateCode : null,
    source,
    rawQr,
    visitId: result.visitId,
    userId: result.user.id,
    account,
    clientEventId: visitResult.clientEventId,
    metadata: {
      ...metadata,
      entrySource,
      repeatWindowMinutes: REPEAT_SCAN_WINDOW_MINUTES,
    },
  });

  if (!result.isRepeated) {
    await onboardingService.recordEventSafe(account, 'access.visit_created', {
      entityId: result.visitId,
      entityType: 'visit',
      payload: {
        entrySource,
        userId: result.user.id,
        visitId: result.visitId,
      },
    });
  }

  return result;
}

async function createManualVisit(userId, options = {}) {
  const canonicalUser = await clientsService.findCanonicalById(
    userId,
    options.tenant || null,
  );
  if (!canonicalUser || canonicalUser.status !== 'active') return null;

  return createVisitForUser(canonicalUser, {
    ...options,
    entrySource: 'manual',
  });
}

async function scanQr(rawQr, options = {}) {
  const qr = normalizeQr(rawQr);
  const user = await findUserByQr(qr, options.tenant || null);

  if (!user || user.status !== 'active') {
    await scannerEventsService.recordEvent({
      eventType: 'qr_not_found',
      severity: 'warning',
      status: 'not_found',
      message: 'QR не найден в активной базе клиентов',
      code: 'QR_NOT_FOUND',
      source: options.source,
      rawQr: qr,
      account: options.account,
      clientEventId: options.clientEventId,
      metadata: options.metadata,
    });
    const qrPreview = scannerEventsService.sanitizeQrPreview(qr);

    return {
      found: false,
      qr: qrPreview,
      event: {
        success: false,
        id: qrPreview,
        qrPreview,
        clientEventId: options.clientEventId || null,
      },
    };
  }

  const event = await createVisitForUser(user, {
    ...options,
    entrySource: 'qr',
    rawQr: qr,
  });
  if (!event) {
    return {
      found: false,
      qr: scannerEventsService.sanitizeQrPreview(qr),
      event: {
        success: false,
        id: scannerEventsService.sanitizeQrPreview(qr),
        qrPreview: scannerEventsService.sanitizeQrPreview(qr),
        clientEventId: options.clientEventId || null,
      },
    };
  }

  return {
    found: true,
    qr,
    event,
  };
}

async function registerReceptionUser({
  name,
  phone,
  source,
  sourceId,
  tenant = null,
}) {
  const existingUser = await findUserByPhone(phone, tenant);
  if (existingUser) {
    return {
      status: 'exists',
      user: existingUser,
      qrData: existingUser.webId || existingUser.telegramId || existingUser.vkId,
      alreadyExists: true,
    };
  }

  const result = await clientsService.createClient(
    {
      name,
      phone,
      source,
      sourceId,
    },
    null,
    tenant,
  );
  const user = result.client;

  return {
    status: 'success',
    user,
    qrData: user.webId,
  };
}

async function getRecentVisitCards(limit = 50) {
  const visits = await db.Visit.findAll({
    limit,
    order: [
      ['scannedAt', 'DESC'],
      ['createdAt', 'DESC'],
    ],
    include: [
      { model: db.User },
      {
        model: db.VisitCategory,
        as: 'categories',
        attributes: ['id', 'name'],
        through: { attributes: [] },
      },
    ],
  });

  return visits.map((visit) => {
    const categories = visit.categories || [];
    return {
      id: String(visit.id),
      success: true,
      time: new Date(visit.scannedAt || visit.createdAt).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      }),
      name: visit.User?.name || 'Неизвестный',
      phone: visit.User?.phone || '',
      source: visit.User?.source || '-',
      visitId: visit.id,
      keyNumber: visit.keyNumber || '',
      keyIssued: !!visit.keyNumber,
      category: visit.category || categories.map((category) => category.name).join(', '),
      categoryIds: categories.map((category) => category.id),
    };
  });
}

async function issueKey(visitId, keyNumber, account = null) {
  const cleanKeyNumber = String(keyNumber || '').replace(/\D/g, '');
  if (!cleanKeyNumber) {
    throw appError('Номер ключа обязателен');
  }

  const visit = await db.sequelize.transaction(async (transaction) => {
    const lockedVisit = await db.Visit.findByPk(Number(visitId), {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!lockedVisit) throw appError('Визит не найден', 404);
    if (lockedVisit.keyNumber) {
      throw appError(
        `Ключ уже выдан: №${lockedVisit.keyNumber}`,
        409,
        'KEY_ALREADY_ISSUED',
      );
    }

    await lockedVisit.update(
      {
        keyNumber: cleanKeyNumber,
        keyIssuedAt: new Date(),
        keyIssuedByAccountId: account?.id || null,
      },
      { transaction },
    );

    return lockedVisit;
  });

  await scannerEventsService.recordEvent({
    eventType: 'key_issued',
    severity: 'info',
    status: 'updated',
    message: `Выдан ключ №${cleanKeyNumber}`,
    source: 'reception',
    visitId: visit.id,
    userId: visit.userId,
    account,
    metadata: {
      keyNumber: cleanKeyNumber,
    },
  });

  return visit;
}

async function correctKey(visitId, keyNumber, account = null) {
  const cleanKeyNumber = String(keyNumber ?? '').trim();
  if (!/^\d+$/.test(cleanKeyNumber)) {
    throw appError(
      'Номер ключа должен содержать только цифры',
      400,
      'INVALID_KEY_NUMBER',
    );
  }

  return db.sequelize.transaction(async (transaction) => {
    const lockedVisit = await db.Visit.findByPk(Number(visitId), {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!lockedVisit) throw appError('Визит не найден', 404);

    const oldKeyNumber = String(lockedVisit.keyNumber || '');
    if (!oldKeyNumber) {
      throw appError(
        'Ключ для визита еще не выдан',
        409,
        'KEY_NOT_ISSUED',
      );
    }
    if (oldKeyNumber === cleanKeyNumber) {
      throw appError(
        'Номер ключа не изменился',
        409,
        'KEY_UNCHANGED',
      );
    }

    await lockedVisit.update(
      { keyNumber: cleanKeyNumber },
      { transaction },
    );

    await scannerEventsService.recordEvent({
      eventType: 'key_changed',
      severity: 'info',
      status: 'updated',
      message: `Номер ключа изменен: №${oldKeyNumber} → №${cleanKeyNumber}`,
      source: 'reception',
      visitId: lockedVisit.id,
      userId: lockedVisit.userId,
      account,
      metadata: {
        visitId: lockedVisit.id,
        oldKeyNumber,
        newKeyNumber: cleanKeyNumber,
        changedByAccountId: account?.id || null,
        changedByRole: account?.role || null,
      },
      transaction,
      throwOnError: true,
    });

    return {
      id: lockedVisit.id,
      visitId: lockedVisit.id,
      userId: lockedVisit.userId,
      keyNumber: cleanKeyNumber,
      oldKeyNumber,
    };
  });
}

function splitVisitCategories(category) {
  return String(category || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function updateVisitCategory(
  visitId,
  category,
  categoryIds = [],
  account = null,
  tenant = null,
) {
  const categories =
    Array.isArray(categoryIds) && categoryIds.length > 0
      ? await referencesService.getVisitCategoriesByIds(categoryIds, { tenant })
      : await referencesService.getVisitCategoriesByNames(
          splitVisitCategories(category),
          { tenant },
        );
  const categoryName = categories.map((item) => item.name).join(', ');
  let userId = null;

  await db.sequelize.transaction(async (transaction) => {
    const visit = await db.Visit.findByPk(Number(visitId), {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!visit) throw appError('Визит не найден', 404);
    userId = visit.userId;

    await db.VisitCategoryAssignment.destroy({
      where: { visitId: visit.id },
      transaction,
    });

    if (categories.length > 0) {
      await db.VisitCategoryAssignment.bulkCreate(
        categories.map((item) => ({
          visitId: visit.id,
          visitCategoryId: item.id,
        })),
        { transaction },
      );
    }

    await visit.update({ category: categoryName || null }, { transaction });
  });

  await scannerEventsService.recordEvent({
    eventType: 'visit_category_changed',
    severity: 'info',
    status: 'updated',
    message: categoryName
      ? `Цель визита: ${categoryName}`
      : 'Цель визита очищена',
    source: 'reception',
    visitId: Number(visitId),
    userId,
    account,
    metadata: {
      categoryIds: categories.map((item) => item.id),
      categoryName,
    },
  });

  return {
    category: categoryName,
    categoryIds: categories.map((item) => item.id),
  };
}

module.exports = {
  searchUsers,
  createManualVisit,
  scanQr,
  registerReceptionUser,
  getRecentVisitCards,
  issueKey,
  correctKey,
  updateVisitCategory,
};
