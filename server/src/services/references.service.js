const { Op } = require('sequelize');
const db = require('../../models');

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

async function assertNameAvailable(type, name, id = null) {
  const Model = getModel(type);
  const where = { name };

  if (id) {
    where.id = { [Op.ne]: Number(id) };
  }

  const existing = await Model.findOne({ where });
  if (existing) {
    throw appError('Такое значение уже есть в справочнике', 409);
  }
}

async function list(type, query = {}) {
  const Model = getModel(type);
  const where = {};

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

async function create(type, data) {
  const config = getConfig(type);
  const Model = getModel(type);
  const name = normalizeName(data.name, config.label);
  await assertNameAvailable(type, name);

  const maxSortOrder = await Model.max('sortOrder');
  const row = await Model.create({
    name,
    status: normalizeStatus(data.status || 'active'),
    sortOrder:
      data.sortOrder === undefined || data.sortOrder === null
        ? Number(maxSortOrder || 0) + 1
        : Number(data.sortOrder) || 0,
  });

  return mapReference(row);
}

async function update(type, id, data) {
  const config = getConfig(type);
  const Model = getModel(type);
  const row = await Model.findByPk(Number(id));
  if (!row) throw appError('Значение справочника не найдено', 404);

  const payload = {};
  if ('name' in data) {
    const name = normalizeName(data.name, config.label);
    await assertNameAvailable(type, name, row.id);
    payload.name = name;
  }
  if ('status' in data) {
    payload.status = normalizeStatus(data.status);
  }
  if ('sortOrder' in data) {
    payload.sortOrder = Number(data.sortOrder) || 0;
  }

  await row.update(payload);
  return mapReference(row);
}

async function archive(type, id) {
  return update(type, id, { status: 'archived' });
}

async function restore(type, id) {
  return update(type, id, { status: 'active' });
}

async function assertReferenceNotUsed(type, row) {
  const bases = await db.ClientBase.findAll({
    attributes: ['id', 'filters'],
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
    const clientsCount = await db.User.count({ where: { sourceId: row.id } });
    if (clientsCount > 0) {
      throw appError(
        'Источник нельзя удалить безвозвратно: он используется у клиентов. Оставьте его в архиве.',
        409,
      );
    }
    return;
  }

  const assignmentsCount = await db.VisitCategoryAssignment.count({
    where: { visitCategoryId: row.id },
  });
  if (assignmentsCount > 0) {
    throw appError(
      'Категорию визита нельзя удалить безвозвратно: она используется в истории визитов. Оставьте ее в архиве.',
      409,
    );
  }
}

async function removeArchived(type, id) {
  const Model = getModel(type);
  const row = await Model.findByPk(Number(id));
  if (!row) throw appError('Значение справочника не найдено', 404);
  if (row.status !== 'archived') {
    throw appError(
      'Удалять безвозвратно можно только значения справочника из архива',
      409,
    );
  }

  await assertReferenceNotUsed(type, row);
  await row.destroy();
  return { success: true };
}

async function getClientSourceByInput({ sourceId, source, allowArchived = false }) {
  const where = {};

  if (sourceId) {
    where.id = Number(sourceId);
  } else {
    where.name = normalizeName(source || 'Ресепшн (Админ)', 'Источник клиента');
  }

  if (!allowArchived) where.status = 'active';

  const row = await db.ClientSource.findOne({ where });
  if (!row) throw appError('Источник клиента не найден в справочнике', 404);
  return mapReference(row);
}

async function getVisitCategoriesByIds(categoryIds, { allowArchived = false } = {}) {
  const ids = Array.from(
    new Set(
      (categoryIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );

  if (ids.length === 0) return [];

  const where = { id: { [Op.in]: ids } };
  if (!allowArchived) where.status = 'active';

  const rows = await db.VisitCategory.findAll({
    where,
    order: [
      ['sortOrder', 'ASC'],
      ['name', 'ASC'],
    ],
  });

  if (rows.length !== ids.length) {
    throw appError('Одна или несколько категорий визита не найдены', 404);
  }

  return rows.map(mapReference);
}

async function getVisitCategoriesByNames(names, { allowArchived = false } = {}) {
  const normalizedNames = Array.from(
    new Set((names || []).map((name) => normalizeName(name, 'Категория визита'))),
  );

  if (normalizedNames.length === 0) return [];

  const where = { name: { [Op.in]: normalizedNames } };
  if (!allowArchived) where.status = 'active';

  const rows = await db.VisitCategory.findAll({
    where,
    order: [
      ['sortOrder', 'ASC'],
      ['name', 'ASC'],
    ],
  });

  if (rows.length !== normalizedNames.length) {
    throw appError('Одна или несколько категорий визита не найдены', 404);
  }

  return rows.map(mapReference);
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
