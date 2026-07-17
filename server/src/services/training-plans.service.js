const { Op } = require('sequelize');
const db = require('../../models');
const onboardingService = require('./onboarding.service');
const trainingNotesService = require('./training-notes.service');
const {
  methodologyTenantWhere,
  resolveMethodologyAccessContext,
} = require('./methodology-access-context.service');
const trainingRecommendationsService = require('./training-recommendations.service');

const VIEW_ROLES = new Set(['owner', 'manager', 'trainer']);
const MANAGE_ROLES = new Set(['owner', 'manager', 'trainer']);
const BOOKING_PLAN_ROLES = new Set(['owner', 'manager', 'admin']);
const PLAN_KINDS = new Set(['personal', 'group']);
const PLAN_STATUSES = new Set(['planned', 'completed', 'all']);
const PLAN_SOURCE_TYPES = new Set([
  'manual',
  'personal_recommendation',
  'group_recommendation',
]);
const TRAINING_LEVELS = new Set(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A']);
const MAX_PARTICIPANTS = 12;
const MAX_PLAN_EXERCISES = 20;
const SHORT_TEXT_MAX_LENGTH = 160;
const LONG_TEXT_MAX_LENGTH = 4000;
const TRAINING_BOOKING_TYPES = new Set(['personal_training', 'group_training']);

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertCanView(actor) {
  if (!VIEW_ROLES.has(actor?.role)) {
    throw appError('Недостаточно прав для просмотра планов тренировок', 403);
  }
}

function assertCanManage(actor) {
  if (!MANAGE_ROLES.has(actor?.role)) {
    throw appError('Недостаточно прав для управления планами тренировок', 403);
  }
}

function assertCanCreateFromBooking(actor) {
  if (!BOOKING_PLAN_ROLES.has(actor?.role)) {
    throw appError('Недостаточно прав для создания плана из бронирования', 403);
  }
}

function assertCanChangePlan(plan, actor) {
  if (['owner', 'manager'].includes(actor?.role)) return;
  if (actor?.role === 'trainer' && Number(plan.trainerAccountId) === Number(actor.id)) {
    return;
  }

  throw appError('Можно менять только свои планы тренировок', 403);
}

function getTodayDate() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function normalizeDateOnly(value, label = 'Дата') {
  if (value === undefined || value === null || value === '') return getTodayDate();
  const date = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw appError(`${label} должна быть в формате YYYY-MM-DD`);
  }
  return date;
}

function normalizeOptionalDateOnly(value, label = 'Дата') {
  if (value === undefined || value === null || value === '') return null;
  return normalizeDateOnly(value, label);
}

function normalizePositiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw appError(`Некорректный ${label}`);
  }
  return id;
}

function normalizeShortText(value, label) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  if (text.length > SHORT_TEXT_MAX_LENGTH) {
    throw appError(`${label} должен быть не длиннее ${SHORT_TEXT_MAX_LENGTH} символов`);
  }
  return text;
}

function normalizeLongText(value, label) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (text.length > LONG_TEXT_MAX_LENGTH) {
    throw appError(`${label} слишком длинный`);
  }
  return text;
}

function normalizeKind(value) {
  const kind = String(value || 'personal').trim();
  if (!PLAN_KINDS.has(kind)) throw appError('Некорректный тип плана тренировки');
  return kind;
}

function normalizeSourceType(value) {
  const sourceType = String(value || 'manual').trim();
  if (!PLAN_SOURCE_TYPES.has(sourceType)) {
    throw appError('Некорректный источник плана тренировки');
  }
  return sourceType;
}

function normalizeStatus(value) {
  const status = String(value || 'all').trim();
  if (!PLAN_STATUSES.has(status)) {
    throw appError('Некорректный статус плана тренировки');
  }
  return status;
}

function normalizeTrainingLevel(value) {
  const level = String(value || '').trim().toUpperCase();
  if (!TRAINING_LEVELS.has(level)) throw appError('Некорректный уровень игрока');
  return level;
}

function normalizeClientIds(data = {}) {
  const source = Array.isArray(data.clientIds)
    ? data.clientIds
    : [data.clientId].filter(Boolean);
  const ids = Array.from(new Set(source.map((value) => normalizePositiveId(value, 'ID клиента'))));
  const kind = normalizeKind(data.kind);

  if (kind === 'personal' && ids.length !== 1) {
    throw appError('Персональный план должен содержать одного клиента');
  }
  if (kind === 'group' && ids.length < 2) {
    throw appError('Групповой план должен содержать минимум двух клиентов');
  }
  if (ids.length > MAX_PARTICIPANTS) {
    throw appError(`В плане можно выбрать до ${MAX_PARTICIPANTS} клиентов`);
  }

  return ids;
}

function normalizeReasonSnapshot(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return normalizeLongText(value, 'Обоснование упражнения');
  return normalizeLongText(JSON.stringify(value), 'Обоснование упражнения');
}

function normalizePlannedExercises(value) {
  const items = Array.isArray(value) ? value : [];
  if (items.length === 0) {
    throw appError('Добавьте упражнения в план тренировки');
  }
  if (items.length > MAX_PLAN_EXERCISES) {
    throw appError(`В плане можно указать до ${MAX_PLAN_EXERCISES} упражнений`);
  }

  const seenExerciseIds = new Set();
  return items.map((item, index) => {
    const trainingExerciseId = normalizePositiveId(
      item?.trainingExerciseId ?? item?.exerciseId ?? item?.id,
      'ID упражнения',
    );
    if (seenExerciseIds.has(trainingExerciseId)) {
      throw appError('Одно упражнение нельзя добавить в план дважды');
    }
    seenExerciseIds.add(trainingExerciseId);

    return {
      blockKey: normalizeShortText(item?.blockKey ?? item?.key, 'Ключ блока'),
      blockTitle: normalizeShortText(item?.blockTitle ?? item?.title, 'Название блока'),
      orderIndex: index,
      reasonSnapshot: normalizeReasonSnapshot(item?.reasonSnapshot ?? item?.reason),
      trainingExerciseId,
    };
  });
}

function normalizeCompletionExerciseResults(value, plannedExercises = []) {
  const items = Array.isArray(value) && value.length > 0
    ? value
    : plannedExercises.map((item) => ({
        rating: 3,
        trainingExerciseId: item.trainingExerciseId,
      }));

  return trainingNotesService.normalizeExerciseResults(items);
}

function normalizeParticipantResults(data, plan) {
  const byClientId = new Map();
  if (Array.isArray(data.participantResults)) {
    data.participantResults.forEach((item) => {
      const clientId = normalizePositiveId(item?.clientId, 'ID клиента');
      byClientId.set(clientId, item || {});
    });
  }

  return (plan.participants || []).map((participant) => {
    const clientId = Number(participant.userId);
    const override = byClientId.get(clientId) || {};
    const level = override.level || data.level;
    const plannedExercises = plan.plannedExercises || [];

    return {
      clientId,
      exercises: normalizeLongText(override.exercises ?? data.exercises, 'Упражнения'),
      exerciseResults: normalizeCompletionExerciseResults(
        override.exerciseResults ?? data.exerciseResults,
        plannedExercises,
      ),
      level: normalizeTrainingLevel(level),
      note: normalizeLongText(override.note ?? data.note, 'Заметка тренировки'),
      trainedAt: normalizeDateOnly(override.trainedAt ?? data.trainedAt ?? plan.plannedAt, 'Дата тренировки'),
    };
  });
}

function mapExerciseLite(exercise, fallbackName = '') {
  if (!exercise && !fallbackName) return null;
  const raw = exercise?.toJSON ? exercise.toJSON() : exercise;
  const mainSkill = raw?.mainSkill;

  return {
    eLevel: raw?.eLevel || null,
    id: raw?.id || null,
    mainSkill: mainSkill
      ? {
          direction: mainSkill.direction,
          id: Number(mainSkill.id),
          name: mainSkill.name,
        }
      : null,
    name: raw?.name || fallbackName || 'Упражнение',
    status: raw?.status || null,
  };
}

function mapPlanExercise(row) {
  const raw = row.toJSON ? row.toJSON() : row;
  const exercise = mapExerciseLite(raw.exercise, raw.exerciseNameSnapshot);

  return {
    blockKey: raw.blockKey || null,
    blockTitle: raw.blockTitle || '',
    exercise,
    exerciseName: exercise?.name || raw.exerciseNameSnapshot || 'Упражнение',
    id: raw.id,
    orderIndex: raw.orderIndex || 0,
    reasonSnapshot: raw.reasonSnapshot || '',
    trainingExerciseId: raw.trainingExerciseId,
  };
}

function mapParticipant(row) {
  const raw = row.toJSON ? row.toJSON() : row;
  const client = raw.client;
  const note = raw.trainingNote;

  return {
    client: client
      ? {
          id: Number(client.id),
          name: client.name,
          status: client.status,
        }
      : null,
    clientId: Number(raw.userId),
    id: raw.id,
    trainingNote: note
      ? {
          id: note.id,
          level: note.level,
          trainedAt: note.trainedAt,
        }
      : null,
    trainingNoteId: raw.trainingNoteId || null,
  };
}

function mapBookingLite(booking) {
  if (!booking) return null;
  const raw = booking.toJSON ? booking.toJSON() : booking;
  return {
    bookingSeriesId: raw.bookingSeriesId || null,
    bookingType: raw.bookingType || 'game',
    court: raw.Court
      ? {
          id: Number(raw.Court.id),
          name: raw.Court.name,
          type: raw.Court.type,
        }
      : null,
    courtId: raw.courtId || null,
    endsAt: raw.endsAt,
    id: raw.id,
    responsibleStaff: raw.responsibleStaff
      ? {
          id: Number(raw.responsibleStaff.id),
          name: raw.responsibleStaff.name,
          position: raw.responsibleStaff.position || raw.responsibleStaff.role || null,
        }
      : null,
    startsAt: raw.startsAt,
    status: raw.status,
  };
}

function mapPlan(plan) {
  const raw = plan.toJSON ? plan.toJSON() : plan;
  const trainer = raw.trainerAccount;
  const participants = (raw.participants || [])
    .map(mapParticipant)
    .sort((left, right) => String(left.client?.name || '').localeCompare(String(right.client?.name || '')));
  const plannedExercises = (raw.plannedExercises || [])
    .map(mapPlanExercise)
    .sort((left, right) => left.orderIndex - right.orderIndex);

  return {
    booking: mapBookingLite(raw.booking),
    bookingId: raw.bookingId || null,
    completedAt: raw.completedAt || null,
    createdAt: raw.createdAt,
    goal: raw.goal || '',
    id: raw.id,
    kind: raw.kind,
    notes: raw.notes || '',
    participants,
    plannedAt: raw.plannedAt,
    plannedExercises,
    sourceSnapshot: raw.sourceSnapshot || null,
    sourceType: raw.sourceType,
    status: raw.status,
    trainer: trainer
      ? {
          id: trainer.id,
          name: trainer.Staff?.name || 'Тренер',
          role: trainer.role,
        }
      : null,
    updatedAt: raw.updatedAt,
  };
}

function planInclude(context) {
  return [
    {
      model: db.Account,
      as: 'trainerAccount',
      attributes: ['id', 'role', 'staffId'],
      include: [{ model: db.Staff, attributes: ['id', 'name'] }],
    },
    {
      model: db.Booking,
      as: 'booking',
      attributes: [
        'id',
        'organizationId',
        'bookingSeriesId',
        'bookingType',
        'courtId',
        'endsAt',
        'responsibleStaffId',
        'startsAt',
        'status',
      ],
      include: [
        { model: db.Court, attributes: ['id', 'name', 'type'] },
        {
          model: db.Staff,
          as: 'responsibleStaff',
          attributes: ['id', 'name', 'role'],
        },
      ],
    },
    {
      model: db.TrainingPlanParticipant,
      as: 'participants',
      include: [
        {
          model: db.User,
          as: 'client',
          attributes: ['id', 'name', 'organizationId', 'status', 'mergedIntoUserId', 'isTraining', 'trainingRole', 'trainingAccountId'],
        },
        {
          model: db.TrainingNote,
          as: 'trainingNote',
          attributes: ['id', 'level', 'trainedAt'],
        },
      ],
    },
    {
      model: db.TrainingPlanExercise,
      as: 'plannedExercises',
      include: [
        {
          model: db.TrainingExercise,
          as: 'exercise',
          attributes: ['id', 'name', 'eLevel', 'status', 'mainSkillId'],
          required: true,
          where: methodologyTenantWhere(context, {}),
          include: [
            {
              model: db.TrainingSkill,
              as: 'mainSkill',
              attributes: ['id', 'name', 'direction'],
              required: true,
              where: methodologyTenantWhere(context, {}),
            },
          ],
        },
      ],
    },
  ];
}

async function loadApprovedExercisesByIds(ids, context, options = {}) {
  const uniqueIds = Array.from(new Set(ids.map(Number)));
  if (uniqueIds.length === 0) return new Map();

  const rows = await db.TrainingExercise.findAll({
    attributes: ['id', 'name', 'status'],
    transaction: options.transaction,
    where: methodologyTenantWhere(context, {
      id: { [Op.in]: uniqueIds },
      status: 'approved',
    }, { force: true }),
  });
  if (rows.length !== uniqueIds.length) {
    throw appError('Выберите упражнения из утвержденной базы');
  }

  return new Map(rows.map((exercise) => [Number(exercise.id), exercise]));
}

async function loadClientsOrFail(clientIds, context, options = {}) {
  const clients = await db.User.findAll({
    attributes: ['id', 'name', 'organizationId', 'status', 'mergedIntoUserId', 'isTraining', 'trainingRole', 'trainingAccountId'],
    transaction: options.transaction,
    where: methodologyTenantWhere(context, {
      id: { [Op.in]: clientIds },
      mergedIntoUserId: null,
    }, { force: true }),
  });
  const clientById = new Map(clients.map((client) => [Number(client.id), client]));
  const missingId = clientIds.find((clientId) => !clientById.has(Number(clientId)));
  if (missingId) throw appError(`Клиент ${missingId} не найден`, 404);

  const archivedClient = clientIds
    .map((clientId) => clientById.get(Number(clientId)))
    .find((client) => client.status === 'archived');
  if (archivedClient) {
    throw appError(`Клиент ${archivedClient.name || archivedClient.id} в архиве`, 409);
  }

  return clientIds.map((clientId) => clientById.get(Number(clientId)));
}

function buildPlanExerciseRows(trainingPlanId, plannedExercises, exerciseById) {
  return plannedExercises.map((item) => ({
    ...item,
    exerciseNameSnapshot:
      exerciseById.get(Number(item.trainingExerciseId))?.name || 'Упражнение',
    trainingPlanId,
  }));
}

function planBelongsToOrganization(planValue, context) {
  if (!context?.readScoped) return true;
  const plan = planValue?.toJSON ? planValue.toJSON() : planValue;
  if (!plan) return false;
  if (
    plan.booking &&
    Number(plan.booking.organizationId) !== Number(context.organizationId)
  ) {
    return false;
  }
  const participants = plan.participants || [];
  return participants.length > 0 && participants.every((participant) =>
    Number(participant.client?.organizationId) === Number(context.organizationId));
}

async function getPlanOrFail(planId, context, options = {}) {
  const plan = await db.TrainingPlan.findOne({
    include: planInclude(context),
    lock: options.lock,
    transaction: options.transaction,
    where: { id: Number(planId) },
  });
  if (!plan || !planBelongsToOrganization(plan, context)) {
    throw appError('План тренировки не найден', 404);
  }
  return plan;
}

async function list(query = {}, actor = null, tenant = null) {
  assertCanView(actor);
  const context = await resolveMethodologyAccessContext(tenant);
  const status = normalizeStatus(query.status);
  const where = {};
  if (status !== 'all') where.status = status;
  if (actor?.role === 'trainer') where.trainerAccountId = actor.id;

  if (query.clientId) {
    const clientId = normalizePositiveId(query.clientId, 'ID клиента');
    const participantRows = await db.TrainingPlanParticipant.findAll({
      attributes: ['trainingPlanId'],
      where: { userId: clientId },
    });
    where.id = {
      [Op.in]: participantRows.map((row) => Number(row.trainingPlanId)),
    };
  }
  if (query.bookingId) {
    where.bookingId = normalizePositiveId(query.bookingId, 'ID бронирования');
  }
  const from = normalizeOptionalDateOnly(query.from, 'Дата начала');
  const to = normalizeOptionalDateOnly(query.to, 'Дата окончания');
  if (from || to) {
    where.plannedAt = {
      ...(from ? { [Op.gte]: from } : {}),
      ...(to ? { [Op.lte]: to } : {}),
    };
  }

  const plans = await db.TrainingPlan.findAll({
    include: planInclude(context),
    limit: 100,
    order: [
      ['status', 'ASC'],
      ['plannedAt', status === 'completed' ? 'DESC' : 'ASC'],
      ['createdAt', 'DESC'],
    ],
    where,
  });

  return plans.filter((plan) => planBelongsToOrganization(plan, context)).map(mapPlan);
}

async function getById(planId, actor = null, tenant = null) {
  assertCanView(actor);
  const context = await resolveMethodologyAccessContext(tenant);
  const plan = await getPlanOrFail(planId, context);
  if (actor?.role === 'trainer' && Number(plan.trainerAccountId) !== Number(actor.id)) {
    throw appError('План тренировки не найден', 404);
  }
  return mapPlan(plan);
}

function getDateOnly(value) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function extractInsertablePlanExercises(blocks = []) {
  const seenExerciseIds = new Set();
  return blocks.reduce((items, block) => {
    const trainingExerciseId = Number(block?.exercise?.id);
    if (!block?.insertable || !trainingExerciseId) return items;
    if (seenExerciseIds.has(trainingExerciseId)) return items;

    seenExerciseIds.add(trainingExerciseId);
    items.push({
      blockKey: normalizeShortText(block.key, 'Ключ блока'),
      blockTitle: normalizeShortText(block.title, 'Название блока'),
      reasonSnapshot: block.reason || null,
      trainingExerciseId,
    });
    return items;
  }, []);
}

function getRecommendationActor(actor) {
  if (actor?.role === 'admin') {
    return { ...actor, role: 'manager' };
  }
  return actor;
}

async function findTrainerAccountForStaff(staffId) {
  const id = staffId ? Number(staffId) : null;
  if (!id) {
    throw appError('Выберите ответственного тренера в бронировании', 409);
  }

  const account = await db.Account.findOne({
    include: [{ model: db.Staff, attributes: ['id', 'name', 'role'] }],
    where: {
      role: 'trainer',
      staffId: id,
      status: 'active',
    },
  });
  if (!account) {
    throw appError('У ответственного сотрудника нет активного аккаунта тренера', 409);
  }
  return account;
}

function getBookingClientIds(booking) {
  const raw = booking.toJSON ? booking.toJSON() : booking;
  if (raw.bookingType === 'personal_training') {
    return [Number(raw.userId)];
  }

  return Array.from(
    new Set(
      [
        raw.userId,
        ...(raw.participants || []).map((participant) => participant.userId),
      ]
        .map(Number)
        .filter(Boolean),
    ),
  );
}

async function getBookingForPlanOrFail(bookingId, context) {
  const booking = await db.Booking.findOne({
    include: [
      db.Court,
      db.User,
      { as: 'responsibleStaff', model: db.Staff },
      {
        as: 'participants',
        model: db.BookingParticipant,
        include: [{ as: 'client', model: db.User }],
      },
      { as: 'trainingPlan', model: db.TrainingPlan },
    ],
    where: methodologyTenantWhere(context, { id: Number(bookingId) }),
  });
  if (!booking) throw appError('Бронь не найдена', 404);
  if (!TRAINING_BOOKING_TYPES.has(booking.bookingType)) {
    throw appError('Training plan доступен только для тренировочных броней', 409);
  }
  if (booking.status === 'canceled') {
    throw appError('Нельзя создать план для отмененной брони', 409);
  }
  return booking;
}

async function getByBookingId(bookingId, actor = null, options = {}) {
  const context = await resolveMethodologyAccessContext(options.tenant);
  const plan = await db.TrainingPlan.findOne({
    include: planInclude(context),
    where: { bookingId: normalizePositiveId(bookingId, 'ID бронирования') },
  });
  if (!plan || !planBelongsToOrganization(plan, context)) return null;
  if (!options.allowBookingViewer) {
    assertCanView(actor);
    if (actor?.role === 'trainer' && Number(plan.trainerAccountId) !== Number(actor.id)) {
      throw appError('План тренировки не найден', 404);
    }
  }
  return mapPlan(plan);
}

function buildBookingPlanSourceSnapshot({ booking, recommendation }) {
  return {
    booking: mapBookingLite(booking),
    generatedAt: recommendation.generatedAt,
    prioritySkillIds: (recommendation.prioritySkills || [])
      .map((skill) => skill.skillId)
      .filter(Boolean),
    source: 'booking',
    summary: recommendation.summary || null,
  };
}

async function createFromBooking(bookingId, actor = null, tenant = null) {
  assertCanCreateFromBooking(actor);
  const context = await resolveMethodologyAccessContext(tenant);
  const booking = await getBookingForPlanOrFail(bookingId, context);
  if (booking.trainingPlan) {
    return mapPlan(await getPlanOrFail(booking.trainingPlan.id, context));
  }

  const kind = booking.bookingType === 'personal_training' ? 'personal' : 'group';
  const clientIds = getBookingClientIds(booking);
  if (kind === 'group' && clientIds.length < 2) {
    throw appError('Добавьте минимум двух участников групповой тренировки в бронь', 409);
  }

  const trainerAccount = await findTrainerAccountForStaff(booking.responsibleStaffId);
  const plannedAt = getDateOnly(booking.startsAt);
  const goal = normalizeShortText(
    booking.comment || (kind === 'personal' ? 'Персональная тренировка' : 'Групповая тренировка'),
    'Цель плана',
  );
  const recommendationActor = getRecommendationActor(actor);
  const recommendation = kind === 'personal'
    ? await trainingRecommendationsService.recommendForClient(
        clientIds[0],
        { date: plannedAt, goal },
        recommendationActor,
        tenant,
      )
    : await trainingRecommendationsService.recommendForGroup(
        { clientIds, date: plannedAt, goal },
        recommendationActor,
        tenant,
      );
  const plannedExercises = extractInsertablePlanExercises(recommendation.blocks);
  if (plannedExercises.length === 0) {
    throw appError(
      'Нет уникальных упражнений для автоплана по этой брони. Откройте рекомендацию и соберите план вручную или обновите approved-упражнения.',
      409,
    );
  }

  const created = await createPlanRecord(
    {
      clientIds,
      goal,
      kind,
      plannedAt,
      plannedExercises,
      sourceSnapshot: buildBookingPlanSourceSnapshot({ booking, recommendation }),
      sourceType: kind === 'personal' ? 'personal_recommendation' : 'group_recommendation',
    },
    actor,
    {
      bookingId: booking.id,
      tenant,
      trainerAccountId: trainerAccount.id,
    },
  );

  return mapPlan(await getPlanOrFail(created.id, context));
}

async function createPlanRecord(data = {}, actor = null, options = {}) {
  const context = await resolveMethodologyAccessContext(options.tenant, options);
  const kind = normalizeKind(data.kind);
  const clientIds = normalizeClientIds({ ...data, kind });
  const plannedExercises = normalizePlannedExercises(data.plannedExercises || data.exercises);
  const [clients, exerciseById, trainingMarker] = await Promise.all([
    loadClientsOrFail(clientIds, context, options),
    loadApprovedExercisesByIds(
      plannedExercises.map((item) => item.trainingExerciseId),
      context,
      options,
    ),
    onboardingService.getTrainingDataMarker(actor),
  ]);

  const created = await db.sequelize.transaction(async (transaction) => {
    const plan = await db.TrainingPlan.create(
      {
        goal: normalizeShortText(data.goal, 'Цель плана'),
        kind,
        notes: normalizeLongText(data.notes, 'Заметка плана'),
        plannedAt: normalizeDateOnly(data.plannedAt, 'Дата плана'),
        sourceSnapshot: data.sourceSnapshot || null,
        sourceType: normalizeSourceType(data.sourceType),
        status: 'planned',
        trainerAccountId:
          options.trainerAccountId === undefined
            ? actor?.id || null
            : options.trainerAccountId,
        bookingId: options.bookingId || null,
        ...trainingMarker,
      },
      { transaction },
    );

    await db.TrainingPlanParticipant.bulkCreate(
      clients.map((client) => ({
        trainingPlanId: plan.id,
        userId: Number(client.id),
      })),
      { transaction },
    );
    await db.TrainingPlanExercise.bulkCreate(
      buildPlanExerciseRows(plan.id, plannedExercises, exerciseById),
      { transaction },
    );

    return plan;
  });

  return created;
}

async function create(data = {}, actor = null, tenant = null) {
  assertCanManage(actor);
  const created = await createPlanRecord(data, actor, { tenant });
  return getById(created.id, actor, tenant);
}

async function updateExercises(planId, data = {}, actor = null, tenant = null) {
  assertCanManage(actor);
  const context = await resolveMethodologyAccessContext(tenant);
  const plan = await getPlanOrFail(planId, context);
  assertCanChangePlan(plan, actor);
  if (plan.status !== 'planned') {
    throw appError('Завершенный план нельзя менять: обновите факт тренировки', 409);
  }

  const plannedExercises = normalizePlannedExercises(data.plannedExercises || data.exercises);
  const exerciseById = await loadApprovedExercisesByIds(
    plannedExercises.map((item) => item.trainingExerciseId),
    context,
  );

  await db.sequelize.transaction(async (transaction) => {
    await db.TrainingPlanExercise.destroy({
      transaction,
      where: { trainingPlanId: plan.id },
    });
    await db.TrainingPlanExercise.bulkCreate(
      buildPlanExerciseRows(plan.id, plannedExercises, exerciseById),
      { transaction },
    );
  });

  return getById(plan.id, actor, tenant);
}

async function complete(planId, data = {}, actor = null, tenant = null) {
  assertCanManage(actor);
  const context = await resolveMethodologyAccessContext(tenant);
  const plan = await getPlanOrFail(planId, context);
  assertCanChangePlan(plan, actor);
  if (plan.status === 'completed') {
    throw appError('План уже завершен', 409);
  }
  if ((plan.participants || []).length === 0) {
    throw appError('В плане нет участников');
  }

  const participantResults = normalizeParticipantResults(data, plan);
  const resultByClientId = new Map(
    participantResults.map((result) => [Number(result.clientId), result]),
  );
  const completedNoteEvents = [];

  await db.sequelize.transaction(async (transaction) => {
    for (const participant of plan.participants || []) {
      const clientId = Number(participant.userId);
      const result = resultByClientId.get(clientId);
      if (!result) continue;
      const payload = {
        exerciseResults: result.exerciseResults,
        exercises: result.exercises,
        level: result.level,
        note: result.note,
        trainedAt: result.trainedAt,
      };

      if (participant.trainingNoteId) {
        const note = await trainingNotesService.updateRecord(
          participant.trainingNoteId,
          payload,
          actor,
          { tenant, transaction },
        );
        completedNoteEvents.push({
          clientId,
          eventKey: 'training_note.updated',
          level: payload.level,
          noteId: note.id,
          structured: payload.exerciseResults.length > 0,
        });
      } else {
        const note = await trainingNotesService.createRecord(
          clientId,
          payload,
          actor,
          {
            client: participant.client,
            tenant,
            transaction,
          },
        );
        await participant.update(
          { trainingNoteId: note.id },
          { transaction },
        );
        completedNoteEvents.push({
          clientId,
          eventKey: 'training_note.created',
          level: payload.level,
          noteId: note.id,
          structured: payload.exerciseResults.length > 0,
        });
      }
    }

    await plan.update(
      {
        completedAt: new Date(),
        status: 'completed',
      },
      { transaction },
    );
  });

  for (const event of completedNoteEvents) {
    await onboardingService.recordEventSafe(actor, event.eventKey, {
      entityId: event.noteId,
      entityType: 'training_note',
      payload: {
        clientId: event.clientId,
        level: event.level,
        noteId: event.noteId,
        planId: plan.id,
        structured: event.structured,
      },
    });
    if (event.eventKey === 'training_note.created') {
      await onboardingService.recordEventSafe(actor, 'training_level.updated', {
        entityId: event.clientId,
        entityType: 'client',
        payload: {
          clientId: event.clientId,
          level: event.level,
          noteId: event.noteId,
          planId: plan.id,
        },
      });
    }
  }

  return getById(plan.id, actor, tenant);
}

async function getLatestLevelByClientId(clientIds) {
  const ids = Array.from(new Set(clientIds.map(Number).filter(Boolean)));
  if (ids.length === 0) return new Map();

  const notes = await db.TrainingNote.findAll({
    attributes: ['userId', 'level', 'trainedAt', 'createdAt'],
    order: [
      ['userId', 'ASC'],
      ['trainedAt', 'DESC'],
      ['createdAt', 'DESC'],
    ],
    where: { userId: { [Op.in]: ids } },
  });
  const latestLevelByClientId = new Map();
  notes.forEach((note) => {
    const clientId = Number(note.userId);
    if (!latestLevelByClientId.has(clientId)) {
      latestLevelByClientId.set(clientId, note.level);
    }
  });
  return latestLevelByClientId;
}

async function quickComplete(planId, data = {}, actor = null, tenant = null) {
  assertCanManage(actor);
  const context = await resolveMethodologyAccessContext(tenant);
  const plan = await getPlanOrFail(planId, context);
  assertCanChangePlan(plan, actor);
  if (plan.status === 'completed') {
    throw appError('План уже завершен', 409);
  }

  const clientIds = (plan.participants || []).map((participant) => Number(participant.userId));
  const latestLevelByClientId = await getLatestLevelByClientId(clientIds);
  const trainedAt = normalizeDateOnly(data.trainedAt || plan.plannedAt, 'Дата тренировки');
  return complete(
    plan.id,
    {
      note: data.note,
      participantResults: clientIds.map((clientId) => ({
        clientId,
        level: latestLevelByClientId.get(clientId) || 'D',
        trainedAt,
      })),
    },
    actor,
    tenant,
  );
}

module.exports = {
  complete,
  create,
  createFromBooking,
  getByBookingId,
  getById,
  list,
  quickComplete,
  updateExercises,
  __testing: {
    extractInsertablePlanExercises,
    mapPlan,
    normalizeClientIds,
    normalizeCompletionExerciseResults,
    normalizeParticipantResults,
    normalizePlannedExercises,
  },
};
