const db = require('../../models');

const MAX_PAGE_SIZE = 100;
const SENSITIVE_KEYS = new Set([
  'authorization',
  'clientPhone',
  'password',
  'passwordHash',
  'phone',
  'phoneNormalized',
  'telegramId',
  'token',
  'accessToken',
  'refreshToken',
  'vkId',
  'webId',
]);

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function sanitizeValue(value, depth = 0) {
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  }
  if (!value || typeof value !== 'object') return value;

  return Object.entries(value).reduce((acc, [key, item]) => {
    if (SENSITIVE_KEYS.has(key)) {
      acc[key] = '[redacted]';
      return acc;
    }

    acc[key] = sanitizeValue(item, depth + 1);
    return acc;
  }, {});
}

function inferEntity(path = '') {
  const normalizedPath = path.replace(/^\/api\//, '').split('?')[0];
  const [first, second, third] = normalizedPath.split('/');

  if (first === 'client-bases') return { entityType: 'client_base', entityId: second };
  if (first === 'clients' && second === 'views') {
    return { entityType: 'client_saved_view', entityId: third };
  }
  if (first === 'clients' && third === 'call-tasks') {
    return { entityType: 'client_call_task', entityId: second };
  }
  if (first === 'clients') return { entityType: 'client', entityId: second };
  if (first === 'call-tasks') return { entityType: 'call_task', entityId: second };
  if (first === 'call-task-clients') return { entityType: 'call_task_client', entityId: second };
  if (first === 'staff') return { entityType: 'staff', entityId: second };
  if (first === 'accounts') return { entityType: 'account', entityId: second };
  if (first === 'catalog' && second === 'categories') {
    return { entityType: 'catalog_category', entityId: third };
  }
  if (first === 'catalog' && second === 'rules') {
    return { entityType: 'catalog_rule', entityId: third };
  }
  if (first === 'categories') return { entityType: 'catalog_category', entityId: second };
  if (first === 'rules') return { entityType: 'catalog_rule', entityId: second };
  if (first === 'references') return { entityType: `reference:${second || 'unknown'}`, entityId: third };
  if (first === 'finance' && second === 'payroll' && third === 'periods') {
    return { entityType: 'payroll_period', entityId: normalizedPath.split('/')[3] };
  }
  if (first === 'motivation') return { entityType: `motivation:${second || 'unknown'}`, entityId: third };
  if (first === 'shifts') return { entityType: 'shift', entityId: second };
  if (first === 'finance') return { entityType: 'finance', entityId: second };
  if (first === 'training-notes') return { entityType: 'training_note', entityId: second };

  return { entityType: first || 'unknown', entityId: second };
}

function inferAction(method, path = '', statusCode) {
  const normalizedPath = path.split('?')[0];
  if (statusCode >= 400) return `${method.toLowerCase()}.failed`;
  if (normalizedPath.endsWith('/restore')) return 'restore';
  if (normalizedPath.endsWith('/permanent')) return 'delete_permanent';
  if (normalizedPath.endsWith('/sync')) return 'sync';
  if (normalizedPath.endsWith('/recurring/run')) return 'run_recurring';
  if (normalizedPath.endsWith('/attempts')) return 'create_attempt';
  if (method === 'POST') return 'create';
  if (method === 'PUT' || method === 'PATCH') return 'update';
  if (method === 'DELETE') return 'archive_or_delete';
  return method.toLowerCase();
}

function buildSummary({ action, entityType, method, path, statusCode }) {
  const status = statusCode >= 400 ? `ошибка ${statusCode}` : 'успешно';
  return `${action}: ${entityType} (${method} ${path}) - ${status}`;
}

function parseMetadata(metadata) {
  if (!metadata || typeof metadata !== 'string') return metadata || null;
  try {
    return JSON.parse(metadata);
  } catch {
    return null;
  }
}

async function record(entry) {
  try {
    const { entityType, entityId } = entry.entityType
      ? entry
      : inferEntity(entry.path);
    const action =
      entry.action || inferAction(entry.method, entry.path, entry.statusCode);

    await db.AuditLog.create({
      accountId: entry.account?.id || entry.accountId || null,
      role: entry.account?.role || entry.role || null,
      action,
      entityType,
      entityId: entry.entityId || entityId || null,
      method: entry.method,
      path: entry.path,
      statusCode: entry.statusCode,
      summary:
        entry.summary ||
        buildSummary({
          action,
          entityType,
          method: entry.method,
          path: entry.path,
          statusCode: entry.statusCode,
        }),
      metadata: sanitizeValue(entry.metadata || {}),
    });
  } catch (error) {
    console.error('Ошибка записи аудита:', error);
  }
}

async function list(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(10, Number.parseInt(query.pageSize, 10) || 25),
  );
  const where = {};

  if (query.action && query.action !== 'all') where.action = query.action;
  if (query.entityType && query.entityType !== 'all') {
    where.entityType = query.entityType;
  }
  if (query.accountId) where.accountId = Number(query.accountId);

  const { count, rows } = await db.AuditLog.findAndCountAll({
    where,
    include: [
      {
        model: db.Account,
        as: 'account',
        attributes: ['id', 'email', 'role', 'staffId'],
        include: [{ model: db.Staff, attributes: ['id', 'name'] }],
      },
    ],
    limit: pageSize,
    offset: (page - 1) * pageSize,
    order: [['createdAt', 'DESC']],
  });

  return {
    items: rows.map((row) => {
      const raw = row.toJSON();
      return {
        ...raw,
        metadata: parseMetadata(raw.metadata),
        account: raw.account
          ? {
              id: raw.account.id,
              email: raw.account.email,
              role: raw.account.role,
              name: raw.account.Staff?.name || raw.account.email,
            }
          : null,
      };
    }),
    page,
    pageSize,
    total: count,
    totalPages: Math.max(1, Math.ceil(count / pageSize)),
  };
}

function assertCanView(actor) {
  if (!['owner', 'manager'].includes(actor?.role)) {
    throw appError('Недостаточно прав для просмотра аудита', 403);
  }
}

module.exports = {
  assertCanView,
  list,
  record,
};
