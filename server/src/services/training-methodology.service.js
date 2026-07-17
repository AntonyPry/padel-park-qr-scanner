const { Op } = require('sequelize');
const db = require('../../models');
const {
  TRAINING_EXERCISE_E_LEVEL_VALUES,
  TRAINING_EXERCISE_FORMAT_VALUES,
  TRAINING_EXERCISE_STATUS_VALUES,
  TRAINING_SKILL_DIRECTION_VALUES,
  TRAINING_SKILL_STATUS_VALUES,
} = require('../constants/training-methodology');
const {
  methodologyTenantWhere,
  resolveMethodologyAccessContext,
} = require('./methodology-access-context.service');

const MANAGER_ROLES = new Set(['owner', 'manager']);
const VIEW_ROLES = new Set(['owner', 'manager', 'trainer']);

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertCanView(actor) {
  if (!VIEW_ROLES.has(actor?.role)) {
    throw appError('Недостаточно прав для просмотра методической базы', 403);
  }
}

function canManage(actor) {
  return MANAGER_ROLES.has(actor?.role);
}

function assertCanManage(actor) {
  if (!canManage(actor)) {
    throw appError('Недостаточно прав для управления методической базой', 403);
  }
}

function normalizeText(value, { label = 'Поле', min = 0, max = 4000 } = {}) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim().replace(/\s+/g, ' ');
  if (!text) {
    if (min > 0) throw appError(`${label} должно быть заполнено`);
    return null;
  }
  if (text.length < min) throw appError(`${label} должно быть не короче ${min} символов`);
  if (text.length > max) throw appError(`${label} слишком длинное`);
  return text;
}

function normalizeLongText(value, label) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > 4000) throw appError(`${label} слишком длинное`);
  return text;
}

function normalizeEnum(value, allowedValues, label, fallback = undefined) {
  const rawValue = value === undefined || value === null || value === '' ? fallback : value;
  const normalized = String(rawValue || '').trim();
  if (!allowedValues.includes(normalized)) {
    throw appError(`Некорректное значение поля «${label}»`);
  }

  return normalized;
}

function normalizeOptionalEnum(value, allowedValues, label) {
  if (value === undefined || value === null || value === '') return null;
  return normalizeEnum(value, allowedValues, label);
}

function normalizeId(value, label, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw appError(`${label} должен быть указан`);
  }

  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw appError(`${label} должен быть положительным числом`);
  }

  return id;
}

function normalizeSkillLevel(value, { optional = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw appError('Уровень навыка должен быть указан');
  }

  const level = Number(value);
  if (!Number.isInteger(level) || level < 0 || level > 5) {
    throw appError('Уровень навыка должен быть от 0 до 5');
  }

  return level;
}

function normalizeSkillLevelRange(data, existing = {}) {
  if ('skillLevel' in data) {
    const level = normalizeSkillLevel(data.skillLevel);
    return {
      skillLevelMax: level,
      skillLevelMin: level,
    };
  }

  const skillLevelMin = 'skillLevelMin' in data
    ? normalizeSkillLevel(data.skillLevelMin)
    : existing.skillLevelMin ?? null;
  const skillLevelMax = 'skillLevelMax' in data
    ? normalizeSkillLevel(data.skillLevelMax)
    : existing.skillLevelMax ?? null;

  if (skillLevelMin !== null && skillLevelMax !== null && skillLevelMin > skillLevelMax) {
    throw appError('Минимальный уровень навыка не может быть выше максимального');
  }

  return {
    skillLevelMax,
    skillLevelMin,
  };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeFormats(value = []) {
  const values = Array.isArray(value) ? value : [value];
  const uniqueValues = Array.from(
    new Set(values.map((item) => String(item || '').trim()).filter(Boolean)),
  );

  uniqueValues.forEach((format) => {
    if (!TRAINING_EXERCISE_FORMAT_VALUES.includes(format)) {
      throw appError('Некорректный формат упражнения');
    }
  });

  return uniqueValues;
}

function normalizeSkillIds(value = []) {
  const values = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      values
        .map((item) => normalizeId(item, 'ID навыка', { optional: true }))
        .filter(Boolean),
    ),
  );
}

function mapAccount(account) {
  if (!account) return null;
  const raw = account.toJSON ? account.toJSON() : account;

  return {
    email: raw.email,
    id: raw.id,
    name: raw.Staff?.name || raw.email || null,
    role: raw.role,
  };
}

function mapSkillLite(skill) {
  if (!skill) return null;
  const raw = skill.toJSON ? skill.toJSON() : skill;

  return {
    description: raw.description || '',
    direction: raw.direction,
    id: raw.id,
    name: raw.name,
    status: raw.status,
  };
}

function mapSkill(skill) {
  const raw = skill.toJSON ? skill.toJSON() : skill;

  return {
    ...mapSkillLite(raw),
    createdAt: raw.createdAt,
    createdBy: mapAccount(raw.createdBy),
    updatedAt: raw.updatedAt,
    updatedBy: mapAccount(raw.updatedBy),
  };
}

function mapExercise(exercise) {
  const raw = exercise.toJSON ? exercise.toJSON() : exercise;

  return {
    additionalSkillIds: (raw.additionalSkills || []).map((skill) => skill.id),
    additionalSkills: (raw.additionalSkills || []).map(mapSkillLite),
    approvedAt: raw.approvedAt,
    approvedBy: mapAccount(raw.approvedBy),
    complication: raw.complication || '',
    createdAt: raw.createdAt,
    createdBy: mapAccount(raw.createdBy),
    description: raw.description || '',
    eLevel: raw.eLevel || null,
    formats: parseJsonArray(raw.formats),
    id: raw.id,
    mainSkill: mapSkillLite(raw.mainSkill),
    mainSkillId: raw.mainSkillId || null,
    name: raw.name,
    simplification: raw.simplification || '',
    skillLevelMax: raw.skillLevelMax,
    skillLevelMin: raw.skillLevelMin,
    status: raw.status,
    successCriterion: raw.successCriterion || '',
    updatedAt: raw.updatedAt,
    updatedBy: mapAccount(raw.updatedBy),
  };
}

function accountInclude(alias) {
  return {
    as: alias,
    attributes: ['id', 'email', 'role', 'staffId'],
    include: [{ model: db.Staff, attributes: ['id', 'name'] }],
    model: db.Account,
  };
}

function exerciseInclude(context) {
  const skillWhere = context?.readScoped
    ? { organizationId: context.organizationId }
    : undefined;
  return [
    {
      as: 'mainSkill',
      model: db.TrainingSkill,
      required: false,
      where: skillWhere,
    },
    {
      as: 'additionalSkills',
      model: db.TrainingSkill,
      required: false,
      through: { attributes: [] },
      where: skillWhere,
    },
    accountInclude('createdBy'),
    accountInclude('updatedBy'),
    accountInclude('approvedBy'),
  ];
}

async function assertSkillNameAvailable(name, id = null, context, options = {}) {
  const where = {
    [Op.and]: [
      db.Sequelize.where(
        db.Sequelize.fn('LOWER', db.Sequelize.col('name')),
        name.toLowerCase(),
      ),
    ],
  };
  if (context?.readScoped) where.organizationId = context.organizationId;
  if (id) where.id = { [Op.ne]: Number(id) };

  const existing = await db.TrainingSkill.findOne({
    transaction: options.transaction,
    where,
  });
  if (existing) {
    throw appError('Навык с таким названием уже есть', 409);
  }
}

async function loadSkillOrFail(id, context, options = {}) {
  const skill = await db.TrainingSkill.findOne({
    include: [accountInclude('createdBy'), accountInclude('updatedBy')],
    lock: options.lock,
    transaction: options.transaction,
    where: methodologyTenantWhere(context, { id: Number(id) }),
  });
  if (!skill) throw appError('Навык не найден', 404);
  return skill;
}

async function loadSkillsByIds(ids, context, { requireActive = true, transaction } = {}) {
  const uniqueIds = Array.from(new Set((ids || []).filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const rows = await db.TrainingSkill.findAll({
    transaction,
    where: methodologyTenantWhere(context, {
      id: { [Op.in]: uniqueIds },
    }, { force: true }),
  });

  if (rows.length !== uniqueIds.length) {
    throw appError('Один или несколько навыков не найдены', 404);
  }

  if (requireActive && rows.some((row) => row.status !== 'active')) {
    throw appError('Для упражнения можно выбирать только активные навыки', 409);
  }

  return rows;
}

async function loadExerciseOrFail(id, context, options = {}) {
  const exercise = await db.TrainingExercise.findOne({
    include: exerciseInclude(context),
    lock: options.lock,
    transaction: options.transaction,
    where: methodologyTenantWhere(context, { id: Number(id) }),
  });
  if (!exercise) throw appError('Упражнение не найдено', 404);
  return exercise;
}

function assertCanChangeExercise(exercise, actor) {
  if (canManage(actor)) return;
  if (
    actor?.role === 'trainer' &&
    exercise.status === 'draft' &&
    Number(exercise.createdByAccountId) === Number(actor.id)
  ) {
    return;
  }

  throw appError('Тренер может менять только свои черновики упражнений', 403);
}

function assertExerciseCanBeApproved(payload) {
  if (payload.status !== 'approved') return;
  if (!payload.mainSkillId) {
    throw appError('Нельзя утвердить упражнение без главного навыка');
  }
  if (!payload.eLevel) {
    throw appError('Нельзя утвердить упражнение без E-level');
  }
}

function normalizeSkillPayload(data, actor, existing = null) {
  const payload = {};

  if (!existing || 'name' in data) {
    payload.name = normalizeText(data.name, {
      label: 'Название навыка',
      max: 160,
      min: 2,
    });
  }
  if (!existing || 'direction' in data) {
    payload.direction = normalizeEnum(
      data.direction,
      TRAINING_SKILL_DIRECTION_VALUES,
      'направление',
    );
  }
  if (!existing || 'description' in data) {
    payload.description = normalizeLongText(data.description, 'Описание навыка');
  }
  if ('status' in data) {
    payload.status = normalizeEnum(
      data.status,
      TRAINING_SKILL_STATUS_VALUES,
      'статус навыка',
      existing?.status || 'active',
    );
  } else if (!existing) {
    payload.status = 'active';
  }

  payload.updatedByAccountId = actor?.id || null;
  if (!existing) payload.createdByAccountId = actor?.id || null;
  return payload;
}

function normalizeExercisePayload(data, actor, existing = null) {
  const canActorManage = canManage(actor);
  const payload = {};

  if (!existing || 'name' in data) {
    payload.name = normalizeText(data.name, {
      label: 'Название упражнения',
      max: 160,
      min: 2,
    });
  }

  for (const field of ['description', 'successCriterion', 'simplification', 'complication']) {
    if (!existing || field in data) {
      payload[field] = normalizeLongText(data[field], 'Описание упражнения');
    }
  }

  if (!existing || 'mainSkillId' in data) {
    payload.mainSkillId = normalizeId(data.mainSkillId, 'Главный навык', {
      optional: true,
    });
  }
  if (!existing || 'eLevel' in data) {
    payload.eLevel = normalizeOptionalEnum(
      data.eLevel,
      TRAINING_EXERCISE_E_LEVEL_VALUES,
      'E-level',
    );
  }
  if (!existing || 'formats' in data) {
    payload.formats = normalizeFormats(data.formats || []);
  }
  if (!existing || 'skillLevel' in data || 'skillLevelMin' in data || 'skillLevelMax' in data) {
    Object.assign(payload, normalizeSkillLevelRange(data, existing || {}));
  }

  const requestedStatus =
    'status' in data
      ? normalizeEnum(
          data.status,
          TRAINING_EXERCISE_STATUS_VALUES,
          'статус упражнения',
          existing?.status || 'draft',
        )
      : existing?.status || 'draft';
  payload.status = canActorManage ? requestedStatus : 'draft';
  payload.updatedByAccountId = actor?.id || null;
  if (!existing) payload.createdByAccountId = actor?.id || null;

  assertExerciseCanBeApproved({
    eLevel: 'eLevel' in payload ? payload.eLevel : existing?.eLevel,
    mainSkillId: 'mainSkillId' in payload ? payload.mainSkillId : existing?.mainSkillId,
    status: payload.status,
  });

  return payload;
}

function getExerciseAdditionalSkillIds(data, payload, existing = null) {
  if (!existing || 'additionalSkillIds' in data) {
    const mainSkillId = payload.mainSkillId ?? existing?.mainSkillId ?? null;
    return normalizeSkillIds(data.additionalSkillIds || []).filter(
      (skillId) => Number(skillId) !== Number(mainSkillId),
    );
  }

  return null;
}

function filterExercises(rows, query = {}) {
  const skillId = query.skillId ? normalizeId(query.skillId, 'Навык', { optional: true }) : null;
  const direction = query.direction
    ? normalizeEnum(query.direction, TRAINING_SKILL_DIRECTION_VALUES, 'направление')
    : null;
  const format = query.format
    ? normalizeEnum(query.format, TRAINING_EXERCISE_FORMAT_VALUES, 'формат')
    : null;
  const skillLevel = query.skillLevel !== undefined && query.skillLevel !== ''
    ? normalizeSkillLevel(query.skillLevel)
    : null;

  return rows
    .map(mapExercise)
    .filter((exercise) => {
      const skills = [
        exercise.mainSkill,
        ...(exercise.additionalSkills || []),
      ].filter(Boolean);
      if (skillId && !skills.some((skill) => Number(skill.id) === skillId)) return false;
      if (direction && !skills.some((skill) => skill.direction === direction)) return false;
      if (format && !exercise.formats.includes(format)) return false;
      if (
        skillLevel !== null &&
        (exercise.skillLevelMin === null ||
          exercise.skillLevelMax === null ||
          skillLevel < exercise.skillLevelMin ||
          skillLevel > exercise.skillLevelMax)
      ) {
        return false;
      }

      return true;
    });
}

async function listSkills(query = {}, actor, tenant = null) {
  assertCanView(actor);
  const context = await resolveMethodologyAccessContext(tenant);

  const where = methodologyTenantWhere(context, {});
  const requestedStatus = query.status || 'active';
  if (actor?.role === 'trainer') {
    where.status = 'active';
  } else if (requestedStatus !== 'all') {
    where.status = normalizeEnum(
      requestedStatus,
      TRAINING_SKILL_STATUS_VALUES,
      'статус навыка',
      'active',
    );
  }
  if (query.direction) {
    where.direction = normalizeEnum(
      query.direction,
      TRAINING_SKILL_DIRECTION_VALUES,
      'направление',
    );
  }
  if (query.q) {
    const q = `%${String(query.q).trim()}%`;
    where[Op.or] = [
      { name: { [Op.like]: q } },
      { description: { [Op.like]: q } },
    ];
  }

  const rows = await db.TrainingSkill.findAll({
    include: [accountInclude('createdBy'), accountInclude('updatedBy')],
    order: [
      ['direction', 'ASC'],
      ['name', 'ASC'],
    ],
    where,
  });

  return rows.map(mapSkill);
}

async function createSkill(data, actor, tenant = null) {
  assertCanManage(actor);
  const payload = normalizeSkillPayload(data, actor);
  const skillId = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveMethodologyAccessContext(tenant, {
      lock: true,
      transaction,
    });
    await assertSkillNameAvailable(payload.name, null, context, { transaction });
    const skill = await db.TrainingSkill.create(
      { ...payload, organizationId: context.organizationId },
      { transaction },
    );
    return skill.id;
  });
  const context = await resolveMethodologyAccessContext(tenant);
  return mapSkill(await loadSkillOrFail(skillId, context));
}

async function updateSkill(id, data, actor, tenant = null) {
  assertCanManage(actor);
  const skillId = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveMethodologyAccessContext(tenant, {
      lock: true,
      transaction,
    });
    const skill = await loadSkillOrFail(id, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    const payload = normalizeSkillPayload(data, actor, skill);
    if (payload.name && payload.name !== skill.name) {
      await assertSkillNameAvailable(payload.name, skill.id, context, { transaction });
    }
    await skill.update(payload, { transaction });
    return skill.id;
  });
  const context = await resolveMethodologyAccessContext(tenant);
  return mapSkill(await loadSkillOrFail(skillId, context));
}

function buildExerciseWhere(query = {}, actor) {
  const where = {};
  const andFilters = [];
  const requestedStatus = query.status || (canManage(actor) ? 'all' : 'approved');

  if (canManage(actor)) {
    if (requestedStatus !== 'all') {
      where.status = normalizeEnum(
        requestedStatus,
        TRAINING_EXERCISE_STATUS_VALUES,
        'статус упражнения',
      );
    }
  } else if (actor?.role === 'trainer') {
    if (requestedStatus === 'all') {
      andFilters.push({
        [Op.or]: [
          { status: 'approved' },
          { createdByAccountId: actor.id, status: 'draft' },
        ],
      });
    } else if (requestedStatus === 'draft') {
      where.createdByAccountId = actor.id;
      where.status = 'draft';
    } else if (requestedStatus === 'approved' || requestedStatus === undefined) {
      where.status = 'approved';
    } else {
      where.id = null;
    }
  }

  if (query.eLevel) {
    where.eLevel = normalizeEnum(
      query.eLevel,
      TRAINING_EXERCISE_E_LEVEL_VALUES,
      'E-level',
    );
  }
  if (query.q) {
    const q = `%${String(query.q).trim()}%`;
    andFilters.push({
      [Op.or]: [
        { name: { [Op.like]: q } },
        { description: { [Op.like]: q } },
        { successCriterion: { [Op.like]: q } },
      ],
    });
  }
  if (query.mainSkillId) {
    where.mainSkillId = normalizeId(query.mainSkillId, 'Главный навык', {
      optional: true,
    });
  }
  if (andFilters.length > 0) {
    where[Op.and] = andFilters;
  }

  return where;
}

async function listExercises(query = {}, actor, tenant = null) {
  assertCanView(actor);
  const context = await resolveMethodologyAccessContext(tenant);
  const rows = await db.TrainingExercise.findAll({
    include: exerciseInclude(context),
    order: [
      ['status', 'ASC'],
      ['updatedAt', 'DESC'],
      ['name', 'ASC'],
    ],
    where: methodologyTenantWhere(context, buildExerciseWhere(query, actor)),
  });

  return filterExercises(rows, query);
}

async function createExercise(data, actor, tenant = null) {
  assertCanView(actor);
  const payload = normalizeExercisePayload(data, actor);
  const additionalSkillIds = getExerciseAdditionalSkillIds(data, payload);

  const exercise = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveMethodologyAccessContext(tenant, {
      lock: true,
      transaction,
    });
    await loadSkillsByIds(
      [payload.mainSkillId, ...(additionalSkillIds || [])].filter(Boolean),
      context,
      { requireActive: true, transaction },
    );
    const created = await db.TrainingExercise.create(
      payload.status === 'approved'
        ? {
            ...payload,
            approvedAt: new Date(),
            approvedByAccountId: actor?.id || null,
            organizationId: context.organizationId,
          }
        : { ...payload, organizationId: context.organizationId },
      { transaction },
    );
    if (additionalSkillIds) {
      await created.setAdditionalSkills(additionalSkillIds, { transaction });
    }
    return created;
  });

  const context = await resolveMethodologyAccessContext(tenant);
  return mapExercise(await loadExerciseOrFail(exercise.id, context));
}

async function updateExercise(id, data, actor, tenant = null) {
  const exerciseId = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveMethodologyAccessContext(tenant, {
      lock: true,
      transaction,
    });
    const exercise = await loadExerciseOrFail(id, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    assertCanChangeExercise(exercise, actor);
    const payload = normalizeExercisePayload(data, actor, exercise);
    const additionalSkillIds = getExerciseAdditionalSkillIds(data, payload, exercise);
    const skillIdsToValidate = payload.status === 'approved'
      ? [
          payload.mainSkillId ?? exercise.mainSkillId,
          ...(additionalSkillIds ||
            (exercise.additionalSkills || []).map((skill) => skill.id)),
        ].filter(Boolean)
      : [payload.mainSkillId, ...(additionalSkillIds || [])].filter(Boolean);
    await loadSkillsByIds(skillIdsToValidate, context, {
      requireActive: true,
      transaction,
    });
    await exercise.update(
      payload.status === 'approved' && exercise.status !== 'approved'
        ? {
            ...payload,
            approvedAt: new Date(),
            approvedByAccountId: actor?.id || null,
          }
        : payload,
      { transaction },
    );
    if (additionalSkillIds) {
      await exercise.setAdditionalSkills(additionalSkillIds, { transaction });
    }
    return exercise.id;
  });

  const context = await resolveMethodologyAccessContext(tenant);
  return mapExercise(await loadExerciseOrFail(exerciseId, context));
}

async function approveExercise(id, actor, tenant = null) {
  assertCanManage(actor);
  const exerciseId = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveMethodologyAccessContext(tenant, { lock: true, transaction });
    const exercise = await loadExerciseOrFail(id, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    assertExerciseCanBeApproved({
      eLevel: exercise.eLevel,
      mainSkillId: exercise.mainSkillId,
      status: 'approved',
    });
    await loadSkillsByIds([
      exercise.mainSkillId,
      ...(exercise.additionalSkills || []).map((skill) => skill.id),
    ], context, { requireActive: true, transaction });
    await exercise.update({
      approvedAt: new Date(),
      approvedByAccountId: actor?.id || null,
      status: 'approved',
      updatedByAccountId: actor?.id || null,
    }, { transaction });
    return exercise.id;
  });
  const context = await resolveMethodologyAccessContext(tenant);
  return mapExercise(await loadExerciseOrFail(exerciseId, context));
}

async function archiveExercise(id, actor, tenant = null) {
  assertCanManage(actor);
  const exerciseId = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveMethodologyAccessContext(tenant, { lock: true, transaction });
    const exercise = await loadExerciseOrFail(id, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    await exercise.update({
      status: 'archived',
      updatedByAccountId: actor?.id || null,
    }, { transaction });
    return exercise.id;
  });
  const context = await resolveMethodologyAccessContext(tenant);
  return mapExercise(await loadExerciseOrFail(exerciseId, context));
}

async function restoreExercise(id, actor, tenant = null) {
  assertCanManage(actor);
  const exerciseId = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveMethodologyAccessContext(tenant, { lock: true, transaction });
    const exercise = await loadExerciseOrFail(id, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    await exercise.update({
      approvedAt: null,
      approvedByAccountId: null,
      status: 'draft',
      updatedByAccountId: actor?.id || null,
    }, { transaction });
    return exercise.id;
  });
  const context = await resolveMethodologyAccessContext(tenant);
  return mapExercise(await loadExerciseOrFail(exerciseId, context));
}

module.exports = {
  approveExercise,
  archiveExercise,
  createExercise,
  createSkill,
  listExercises,
  listSkills,
  restoreExercise,
  updateExercise,
  updateSkill,
  __testing: {
    assertExerciseCanBeApproved,
    normalizeExercisePayload,
    normalizeFormats,
    normalizeSkillLevelRange,
  },
};
