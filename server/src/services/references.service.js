const { Op } = require('sequelize');
const db = require('../../models');
const cacheService = require('./cache.service');
const {
  resolveClientAccessContext,
} = require('./client-access-context.service');

const REFERENCE_CONFIG = {
  'client-sources': {
    modelName: 'ClientSource',
    label: 'Источник клиента',
  },
  'visit-categories': {
    modelName: 'VisitCategory',
    label: 'Категория визита',
  },
};

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getConfig(type) {
  const config = REFERENCE_CONFIG[type];
  if (!config) throw appError('Неизвестный справочник', 404);
  return config;
}

function getModel(type) {
  return db[getConfig(type).modelName];
}

function normalizeName(value, label = 'Значение') {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) {
    throw appError(`${label} должен быть не короче 2 символов`);
  }

  return name;
}

function normalizeLookupName(value) {
  return normalizeName(value).toLowerCase();
}

function normalizeStatus(status = 'active') {
  if (!['active', 'archived'].includes(status)) {
    throw appError('Некорректный статус справочника');
  }

  return status;
}

function mapReference(row) {
  const raw = row.toJSON ? row.toJSON() : row;
  return {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    sortOrder: Number(raw.sortOrder || 0),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function getListCacheKey(type, query = {}, tenant = null) {
  if (cacheService.isTenantIsolationEnabled()) {
    return cacheService.tenantCacheKey(
      {
        domain: 'references',
        scope: 'organization',
        suffix: `${type}:list`,
        tenant,
      },
      { status: query.status || 'active' },
    );
  }
  return cacheService.cacheKey(`references:${type}:list`, {
    status: query.status || 'active',
  });
}

async function invalidateReferenceCache(type, tenant = null) {
  if (cacheService.isTenantIsolationEnabled()) {
    await cacheService.deleteTenantByPrefix({
      domain: 'references',
      scope: 'organization',
      suffix: type,
      tenant,
    });
    return;
  }
  await cacheService.deleteByPrefix(`references:${type}:`);
}

function parseFilters(filters) {
  if (!filters) return {};
  if (typeof filters === 'string') {
    try {
      return JSON.parse(filters);
    } catch {
      return {};
    }
  }

  return filters;
}

function referenceWhere(context, where = {}) {
  return context.scoped
    ? { ...where, organizationId: context.organizationId }
    : where;
}

async function assertNameAvailable(
  type,
  name,
  id = null,
  context,
  transaction = undefined,
) {
  const Model = getModel(type);
  const where = referenceWhere(context, { name });

  if (id) {
    where.id = { [Op.ne]: Number(id) };
  }

  const existing = await Model.findOne({ transaction, where });
  if (existing) {
    throw appError('Такое значение уже есть в справочнике', 409);
  }
}

async function listFromDb(type, query = {}, context) {
  const Model = getModel(type);
  const where = referenceWhere(context);

  if (query.status && query.status !== 'all') {
    where.status = normalizeStatus(query.status);
  } else if (!query.status) {
    where.status = 'active';
  }

  const rows = await Model.findAll({
    where,
    order: [
      ['sortOrder', 'ASC'],
      ['name', 'ASC'],
    ],
  });

  return rows.map(mapReference);
}

async function list(type, query = {}, tenant = null) {
  getConfig(type);
  const context = await resolveClientAccessContext(tenant);
  if (cacheService.isTenantIsolationEnabled()) {
    return cacheService.rememberTenantJson(
      {
        domain: 'references',
        scope: 'organization',
        suffix: `${type}:list`,
        tenant: context,
      },
      { status: query.status || 'active' },
      () => listFromDb(type, query, context),
      { ttlSeconds: 300 },
    );
  }
  return cacheService.rememberJson(
    getListCacheKey(type, query, tenant),
    () => listFromDb(type, query, context),
    { ttlSeconds: 300 },
  );
}

async function create(type, data, tenant = null) {
  const config = getConfig(type);
  const Model = getModel(type);
  const name = normalizeName(data.name, config.label);
  const { context, row } = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveClientAccessContext(tenant, {
      lock: true,
      transaction,
    });
    await assertNameAvailable(type, name, null, context, transaction);
    const maxSortOrder = await Model.max('sortOrder', {
      transaction,
      where: { organizationId: context.organizationId },
    });
    const row = await Model.create({
      name,
      organizationId: context.organizationId,
      status: normalizeStatus(data.status || 'active'),
      sortOrder:
        data.sortOrder === undefined || data.sortOrder === null
          ? Number(maxSortOrder || 0) + 1
          : Number(data.sortOrder) || 0,
    }, { transaction });
    return { context, row };
  });

  await invalidateReferenceCache(type, context);
  return mapReference(row);
}

async function update(type, id, data, tenant = null) {
  const config = getConfig(type);
  const Model = getModel(type);
  const { context, row } = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveClientAccessContext(tenant, {
      lock: true,
      transaction,
    });
    const row = await Model.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: referenceWhere(context, { id: Number(id) }),
    });
    if (!row) throw appError('Значение справочника не найдено', 404);

    const payload = {};
    if ('name' in data) {
      const name = normalizeName(data.name, config.label);
      await assertNameAvailable(
        type,
        name,
        row.id,
        context,
        transaction,
      );
      payload.name = name;
    }
    if ('status' in data) payload.status = normalizeStatus(data.status);
    if ('sortOrder' in data) payload.sortOrder = Number(data.sortOrder) || 0;

    await row.update(payload, { transaction });
    return { context, row };
  });
  await invalidateReferenceCache(type, context);
  return mapReference(row);
}

async function archive(type, id, tenant = null) {
  return update(type, id, { status: 'archived' }, tenant);
}

async function restore(type, id, tenant = null) {
  return update(type, id, { status: 'active' }, tenant);
}

async function assertReferenceNotUsed(type, row, transaction) {
  const bases = await db.ClientBase.findAll({
    attributes: ['id', 'filters'],
    transaction,
  });
  const fieldName =
    type === 'client-sources' ? 'sourceId' : 'visitCategoryId';
  const usedInBase = bases.some((base) => {
    const filters = parseFilters(base.filters);
    return Number(filters[fieldName]) === Number(row.id);
  });

  if (usedInBase) {
    throw appError(
      'Значение нельзя удалить безвозвратно: оно используется в базе клиентов. Оставьте его в архиве.',
      409,
    );
  }

  if (type === 'client-sources') {
    const clientsCount = await db.User.count({
      transaction,
      where: { organizationId: row.organizationId, sourceId: row.id },
    });
    if (clientsCount > 0) {
      throw appError(
        'Источник нельзя удалить безвозвратно: он используется у клиентов. Оставьте его в архиве.',
        409,
      );
    }
    return;
  }

  const assignmentsCount = await db.VisitCategoryAssignment.count({
    transaction,
    where: { visitCategoryId: row.id },
  });
  if (assignmentsCount > 0) {
    throw appError(
      'Категорию визита нельзя удалить безвозвратно: она используется в истории визитов. Оставьте ее в архиве.',
      409,
    );
  }
}

async function removeArchived(type, id, tenant = null) {
  const Model = getModel(type);
  const context = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveClientAccessContext(tenant, {
      lock: true,
      transaction,
    });
    const row = await Model.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: referenceWhere(context, { id: Number(id) }),
    });
    if (!row) throw appError('Значение справочника не найдено', 404);
    if (row.status !== 'archived') {
      throw appError(
        'Удалять безвозвратно можно только значения справочника из архива',
        409,
      );
    }

    await assertReferenceNotUsed(type, row, transaction);
    await row.destroy({ transaction });
    return context;
  });
  await invalidateReferenceCache(type, context);
  return { success: true };
}

async function getClientSourceByInput(
  { sourceId, source, allowArchived = false },
  tenant = null,
) {
  const rows = await list('client-sources', {
    status: allowArchived ? 'all' : 'active',
  }, tenant);

  if (sourceId) {
    const rowById = rows.find((row) => Number(row.id) === Number(sourceId));
    if (!rowById) throw appError('Источник клиента не найден в справочнике', 404);
    return rowById;
  }

  const name = normalizeLookupName(source || 'Ресепшн (Админ)');
  const row = rows.find((item) => normalizeLookupName(item.name) === name);
  if (!row) throw appError('Источник клиента не найден в справочнике', 404);
  return row;
}

async function getVisitCategoriesByIds(
  categoryIds,
  { allowArchived = false, tenant = null } = {},
) {
  const ids = Array.from(
    new Set(
      (categoryIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );

  if (ids.length === 0) return [];

  const rows = await list('visit-categories', {
    status: allowArchived ? 'all' : 'active',
  }, tenant);
  const matchedRows = rows.filter((row) => ids.includes(Number(row.id)));

  if (matchedRows.length !== ids.length) {
    throw appError('Одна или несколько категорий визита не найдены', 404);
  }

  return matchedRows;
}

async function getVisitCategoriesByNames(
  names,
  { allowArchived = false, tenant = null } = {},
) {
  const normalizedNames = Array.from(
    new Set((names || []).map((name) => normalizeLookupName(name))),
  );

  if (normalizedNames.length === 0) return [];

  const rows = await list('visit-categories', {
    status: allowArchived ? 'all' : 'active',
  }, tenant);
  const matchedRows = rows.filter((row) =>
    normalizedNames.includes(normalizeLookupName(row.name)),
  );

  if (matchedRows.length !== normalizedNames.length) {
    throw appError('Одна или несколько категорий визита не найдены', 404);
  }

  return matchedRows;
}

module.exports = {
  archive,
  create,
  getClientSourceByInput,
  getVisitCategoriesByIds,
  getVisitCategoriesByNames,
  list,
  removeArchived,
  restore,
  update,
};
