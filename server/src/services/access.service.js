const { Op } = require('sequelize');
const db = require('../../models');
const clientsService = require('./clients.service');
const {
  getPhoneLookupDigits,
  normalizePhone,
  normalizedPhoneColumn,
} = require('../utils/phone');

const REPEAT_SCAN_WINDOW_MINUTES = 5;

function normalizeQr(rawQr) {
  return String(rawQr).replace(/[\s@\r\n]/g, '');
}

async function searchUsers(query) {
  const normalizedQuery = String(query || '').trim();
  if (normalizedQuery.length < 2) return [];

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

  return db.User.findAll({
    where: {
      status: 'active',
      [Op.or]: conditions,
    },
    order: [['createdAt', 'DESC']],
    limit: 10,
  });
}

async function findUserByPhone(phone) {
  const phoneDigits = getPhoneLookupDigits(phone);
  if (phoneDigits.length < 10) return null;

  return clientsService.findActiveByPhone(phoneDigits);
}

async function findUserByQr(qr) {
  return clientsService.findCanonicalByQr(qr);
}

async function createVisitForUser(user) {
  const lastVisit = await db.Visit.findOne({
    where: { userId: user.id },
    order: [['createdAt', 'DESC']],
  });

  let visitId;
  let isNewVisit = true;

  if (
    lastVisit &&
    (Date.now() - new Date(lastVisit.createdAt).getTime()) / 60000 <
      REPEAT_SCAN_WINDOW_MINUTES
  ) {
    visitId = lastVisit.id;
    isNewVisit = false;
  }

  if (isNewVisit) {
    const newVisit = await db.Visit.create({ userId: user.id });
    visitId = newVisit.id;
  }

  return {
    success: true,
    user,
    visitId,
    isRepeated: !isNewVisit,
  };
}

async function createManualVisit(userId) {
  const user = await db.User.findByPk(userId);
  if (!user) return null;

  const canonicalUser =
    user.status === 'merged' && user.mergedIntoUserId
      ? await db.User.findByPk(user.mergedIntoUserId)
      : user;
  if (!canonicalUser) return null;

  return createVisitForUser(canonicalUser);
}

async function scanQr(rawQr) {
  const qr = normalizeQr(rawQr);
  const user = await findUserByQr(qr);

  if (!user) {
    return {
      found: false,
      qr,
      event: { success: false, id: qr },
    };
  }

  const event = await createVisitForUser(user);
  return {
    found: true,
    qr,
    event,
  };
}

async function registerReceptionUser({ name, phone, source }) {
  const existingUser = await findUserByPhone(phone);
  if (existingUser) {
    return {
      status: 'exists',
      user: existingUser,
      qrData: existingUser.webId || existingUser.telegramId || existingUser.vkId,
      alreadyExists: true,
    };
  }

  const result = await clientsService.createClient({ name, phone, source });
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
    order: [['createdAt', 'DESC']],
    include: [{ model: db.User }],
  });

  return visits.map((visit) => ({
    id: String(visit.id),
    success: true,
    time: new Date(visit.createdAt).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    name: visit.User?.name || 'Неизвестный',
    phone: visit.User?.phone || '',
    source: visit.User?.source || '-',
    visitId: visit.id,
    keyNumber: visit.keyNumber || '',
    keyIssued: !!visit.keyNumber,
    category: visit.category || '',
  }));
}

async function issueKey(visitId, keyNumber) {
  return db.Visit.update({ keyNumber }, { where: { id: visitId } });
}

async function updateVisitCategory(visitId, category) {
  return db.Visit.update({ category }, { where: { id: visitId } });
}

module.exports = {
  searchUsers,
  createManualVisit,
  scanQr,
  registerReceptionUser,
  getRecentVisitCards,
  issueKey,
  updateVisitCategory,
};
