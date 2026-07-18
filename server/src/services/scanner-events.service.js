const { Op } = require('sequelize');
const crypto = require('crypto');
const db = require('../../models');
const {
  resolveVisitAccessContext,
  visitTenantWhere,
} = require('./visit-access-context.service');

const MAX_PAGE_SIZE = 100;
const QR_PREVIEW_TAIL = 4;

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeQrPreview(rawQr) {
  const value = String(rawQr || '').trim();
  if (!value) return null;
  if (value.length <= QR_PREVIEW_TAIL) return '[masked]';
  return `...${value.slice(-QR_PREVIEW_TAIL)}`;
}

function hashQr(rawQr) {
  const value = String(rawQr || '').trim();
  if (!value) return null;
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sanitizeMetadata(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMetadata(item, depth + 1));
  }
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return value;

  return Object.entries(value).reduce((acc, [key, item]) => {
    if (/token|password|authorization|secret|qr/i.test(key)) {
      acc[key] = '[redacted]';
      return acc;
    }

    acc[key] = sanitizeMetadata(item, depth + 1);
    return acc;
  }, {});
}

async function recordEvent({
  eventType,
  severity = 'info',
  status = null,
  message = null,
  code = null,
  source = null,
  rawQr = null,
  visitId = null,
  userId = null,
  account = null,
  accountId = null,
  clientEventId = null,
  metadata = null,
  throwOnError = false,
  transaction = undefined,
  tenant = null,
}) {
  if (!eventType) return null;

  try {
    const context = await resolveVisitAccessContext(tenant, {
      lock: Boolean(transaction),
      transaction,
    });
    let authoritativeUserId = userId;
    if (visitId) {
      const visit = await db.Visit.findOne({
        attributes: ['id', 'userId'],
        transaction,
        where: visitTenantWhere(
          context,
          { id: Number(visitId) },
          { force: true },
        ),
      });
      if (!visit || (userId && Number(userId) !== Number(visit.userId))) {
        throw appError('Связанный визит недоступен', 404);
      }
      authoritativeUserId = visit.userId;
    } else if (userId) {
      const user = await db.User.findOne({
        attributes: ['id'],
        transaction,
        where: {
          id: Number(userId),
          organizationId: context.organizationId,
        },
      });
      if (!user) throw appError('Связанный клиент недоступен', 404);
    }
    return await db.ScannerEvent.create(
      {
        organizationId: context.organizationId,
        clubId: context.clubId,
        eventType,
        severity,
        status,
        message,
        code,
        source,
        qrPreview: sanitizeQrPreview(rawQr),
        qrHash: hashQr(rawQr),
        visitId,
        userId: authoritativeUserId,
        accountId: account?.id || accountId || null,
        clientEventId: clientEventId || null,
        metadata: sanitizeMetadata(metadata),
      },
      transaction ? { transaction } : undefined,
    );
  } catch (error) {
    if (
      error?.name === 'SequelizeUniqueConstraintError' ||
      error?.parent?.code === 'ER_DUP_ENTRY'
    ) {
      return null;
    }

    if (throwOnError) throw error;
    console.error('Ошибка записи события сканера:', error);
    return null;
  }
}

function parseMetadata(metadata) {
  if (!metadata || typeof metadata !== 'string') return metadata || null;
  try {
    return JSON.parse(metadata);
  } catch {
    return null;
  }
}

function serializeEvent(row) {
  const raw = row.toJSON ? row.toJSON() : row;

  return {
    id: raw.id,
    eventType: raw.eventType,
    severity: raw.severity,
    status: raw.status,
    message: raw.message,
    code: raw.code,
    source: raw.source,
    qrPreview: raw.qrPreview,
    qrHash: raw.qrHash,
    visitId: raw.visitId,
    userId: raw.userId,
    clientEventId: raw.clientEventId,
    metadata: parseMetadata(raw.metadata),
    createdAt: raw.createdAt,
    account: raw.account
      ? {
          id: raw.account.id,
          email: raw.account.email,
          role: raw.account.role,
          name: raw.account.Staff?.name || raw.account.email,
        }
      : null,
    user: raw.user
      ? {
          id: raw.user.id,
          name: raw.user.name,
        }
      : null,
  };
}

async function listEvents(query = {}, tenant = null) {
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(10, Number.parseInt(query.limit, 10) || 30),
  );
  const where = {};
  const context = await resolveVisitAccessContext(tenant);

  if (query.eventType && query.eventType !== 'all') {
    where.eventType = query.eventType;
  }
  if (query.severity && query.severity !== 'all') {
    where.severity = query.severity;
  }
  if (query.since) {
    const since = new Date(query.since);
    if (Number.isNaN(since.getTime())) {
      throw appError('Некорректная дата начала журнала', 400);
    }
    where.createdAt = { [Op.gte]: since };
  }

  const rows = await db.ScannerEvent.findAll({
    where: visitTenantWhere(context, where),
    include: [
      {
        model: db.Account,
        as: 'account',
        attributes: ['id', 'email', 'role', 'staffId'],
        include: [{ model: db.Staff, attributes: ['id', 'name'] }],
      },
      {
        model: db.User,
        as: 'user',
        attributes: ['id', 'name'],
      },
    ],
    limit,
    order: [['createdAt', 'DESC']],
  });

  return rows.map(serializeEvent);
}

module.exports = {
  hashQr,
  listEvents,
  recordEvent,
  sanitizeMetadata,
  sanitizeQrPreview,
};
