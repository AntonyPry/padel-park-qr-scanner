const db = require('../../models');
const {
  isTenantAuditLogEnabled,
} = require('../tenant-context/capabilities');
const {
  requireExactSingletonDefault,
} = require('../tenant-enforcement/legacy-singleton');
const {
  auditTenantValues,
  auditTenantWhere,
  bindAuditActor,
  resolveAuditAccessContext,
  toOrganizationRealtimeContext,
} = require('./audit-access-context.service');

const MAX_PAGE_SIZE = 100;
const SENSITIVE_KEYS = new Set([
  'authorization',
  'challengeToken',
  'clientPhone',
  'code',
  'ciphertext',
  'manualKey',
  'otpAuthUri',
  'password',
  'passwordHash',
  'phone',
  'phoneNormalized',
  'phoneCiphertext',
  'pendingSecretCiphertext',
  'recoveryCodes',
  'secret',
  'secretCiphertext',
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
  if (first === 'catalog' && second === 'sale-settings') {
    return { entityType: 'evotor_sale_setting', entityId: third };
  }
  if (first === 'catalog' && second === 'pending-sales') {
    return { entityType: 'pending_sale', entityId: third };
  }
  if (
    first === 'corporate-clients' &&
    (third === 'deposits' || third === 'spendings')
  ) {
    const entryId = normalizedPath.split('/')[3];
    if (entryId) {
      return { entityType: 'corporate_ledger_entry', entityId: entryId };
    }
    return { entityType: 'corporate_client', entityId: second };
  }
  if (first === 'corporate-clients') {
    return { entityType: 'corporate_client', entityId: second };
  }
  if (first === 'subscriptions' && second === 'types') {
    return { entityType: 'subscription_type', entityId: third };
  }
  if (first === 'client-subscriptions') {
    return { entityType: 'client_subscription', entityId: second };
  }
  if (first === 'clients' && third === 'subscriptions') {
    return { entityType: 'client_subscription', entityId: second };
  }
  if (first === 'categories') return { entityType: 'catalog_category', entityId: second };
  if (first === 'rules') return { entityType: 'catalog_rule', entityId: second };
  if (first === 'references') return { entityType: `reference:${second || 'unknown'}`, entityId: third };
  if (first === 'finance' && second === 'payroll' && third === 'periods') {
    return { entityType: 'payroll_period', entityId: normalizedPath.split('/')[3] };
  }
  if (first === 'motivation') return { entityType: `motivation:${second || 'unknown'}`, entityId: third };
  if (first === 'methodology' && second === 'skills') {
    return { entityType: 'training_skill', entityId: third };
  }
  if (first === 'methodology' && second === 'exercises') {
    return { entityType: 'training_exercise', entityId: third };
  }
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
  if (normalizedPath.endsWith('/reverse')) return 'reverse';
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
    if (!isTenantAuditLogEnabled()) {
      await requireExactSingletonDefault();
      const row = await createRecord(entry, null);
      return {
        actor: entry.account || null,
        auditLogId: row?.id || null,
        recorded: true,
        tenant: null,
      };
    }

    return await db.sequelize.transaction(async (transaction) => {
      const scope = entry.tenantScope || entry.tenant?.scope;
      const context = await resolveAuditAccessContext(
        entry.account,
        entry.tenant,
        scope,
        { lock: true, transaction },
      );
      const actor = bindAuditActor(entry.account, context);
      const row = await createRecord({ ...entry, account: actor }, context, transaction);
      return {
        actor,
        auditLogId: row.id,
        recorded: true,
        tenant: toOrganizationRealtimeContext(context),
      };
    });
  } catch (error) {
    console.error('Ошибка записи аудита:', error);
    return {
      actor: null,
      auditLogId: null,
      errorCode: error?.code || null,
      recorded: false,
      tenant: null,
    };
  }
}

async function recordInstallation(entry, transaction) {
  if (!transaction) {
    throw appError(
      'Installation audit requires the provisioning transaction',
      500,
    );
  }
  if (!Number.isSafeInteger(Number(entry.organizationId))) {
    throw appError('Installation audit requires Organization scope', 500);
  }
  return createRecord(
    {
      ...entry,
      account: null,
      accountId: null,
      role: null,
      tenantScope: 'installation',
    },
    null,
    transaction,
  );
}

async function createRecord(entry, context, transaction) {
    const { entityType, entityId } = entry.entityType
      ? entry
      : inferEntity(entry.path);
    const action =
      entry.action || inferAction(entry.method, entry.path, entry.statusCode);

    return db.AuditLog.create({
      ...(context
        ? auditTenantValues(context)
        : Number.isSafeInteger(Number(entry.organizationId))
          ? {
              clubId: entry.clubId || null,
              organizationId: Number(entry.organizationId),
            }
          : {}),
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
    }, { transaction });
}

function normalizeListQuery(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(10, Number.parseInt(query.pageSize, 10) || 25),
  );
  const filters = {};

  if (query.action && query.action !== 'all') filters.action = query.action;
  if (query.entityType && query.entityType !== 'all') {
    filters.entityType = query.entityType;
  }
  if (query.accountId) filters.accountId = Number(query.accountId);
  return { filters, page, pageSize };
}

async function queryAuditRows({ context, filters, page, pageSize, transaction }) {
  const where = context ? auditTenantWhere(context, filters) : filters;
  const staffWhere = context?.readScoped
    ? { organizationId: context.organizationId }
    : undefined;

  const [count, rows] = await Promise.all([
    db.AuditLog.count({ transaction, where }),
    db.AuditLog.findAll({
      attributes: [
        'id',
        'accountId',
        'role',
        'action',
        'entityType',
        'entityId',
        'method',
        'path',
        'statusCode',
        'summary',
        'createdAt',
        'updatedAt',
      ],
      where,
      include: [
        {
          model: db.Account,
          as: 'account',
          attributes: ['id', 'email', 'role', 'staffId'],
          include: [{
            model: db.Staff,
            attributes: ['id', 'name'],
            required: false,
            where: staffWhere,
          }],
        },
      ],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      transaction,
    }),
  ]);

  return {
    items: rows.map((row) => {
      const raw = row.toJSON();
      return {
        ...raw,
        account: raw.account
          ? {
              id: raw.account.id,
              email: raw.account.email,
              role: raw.role || raw.account.role,
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

async function list(query = {}, actor, tenant) {
  const normalized = normalizeListQuery(query);
  if (!isTenantAuditLogEnabled()) {
    await requireExactSingletonDefault();
    assertCanView(actor);
    return queryAuditRows({ ...normalized, context: null, transaction: undefined });
  }

  return db.sequelize.transaction(async (transaction) => {
    const context = await resolveAuditAccessContext(
      actor,
      tenant,
      'organization',
      { lock: true, transaction },
    );
    const authorityActor = bindAuditActor(actor, context);
    assertCanView(authorityActor);
    return queryAuditRows({ ...normalized, context, transaction });
  });
}

function assertCanView(actor) {
  if (!['owner', 'manager'].includes(actor?.role)) {
    throw appError('Недостаточно прав для просмотра аудита', 403);
  }
}

module.exports = {
  _private: {
    buildSummary,
    createRecord,
    inferAction,
    inferEntity,
    normalizeListQuery,
    parseMetadata,
    sanitizeValue,
  },
  assertCanView,
  list,
  record,
  recordInstallation,
};
