const { z } = require('zod');
const { ACCOUNT_ROLE_VALUES } = require('../constants/account-roles');
const { PNL_GROUP_VALUES } = require('../constants/catalog');
const {
  ONBOARDING_CLIENT_CHECKPOINT_EVENTS,
} = require('../onboarding/catalog');
const {
  TRAINING_EXERCISE_E_LEVEL_VALUES,
  TRAINING_EXERCISE_FORMAT_VALUES,
  TRAINING_EXERCISE_STATUS_VALUES,
  TRAINING_SKILL_DIRECTION_VALUES,
  TRAINING_SKILL_STATUS_VALUES,
} = require('../constants/training-methodology');

const id = z.union([
  z.number().int().positive(),
  z.string().trim().regex(/^[1-9]\d*$/, 'ID должен быть положительным числом'),
]);
const nullableId = z.union([id, z.literal(''), z.null()]).optional();
const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата должна быть в формате YYYY-MM-DD');
const optionalDateOnly = z.union([dateOnly, z.literal('')]).optional();
const dateTimeString = z.string().trim().refine(
  (value: string) => !Number.isNaN(new Date(value).getTime()),
  {
    message: 'Дата и время указаны некорректно',
  },
);
const dateTime = z.union([
  dateTimeString,
  z.date(),
]);
const optionalDateTime = z.union([dateTime, z.literal(''), z.null()]).optional();
const optionalHttpDateTime = z
  .union([dateTimeString, z.literal(''), z.null()])
  .optional();
const numberValue = z.union([
  z.number().finite(),
  z
    .string()
    .trim()
    .regex(/^-?\d+([.,]\d+)?$/, 'Значение должно быть числом'),
]);
const positiveNumberValue = z.union([
  z.number().finite().positive(),
  z
    .string()
    .trim()
    .regex(/^\d+([.,]\d+)?$/, 'Значение должно быть положительным числом'),
]);
const nonNegativeNumberValue = z.union([
  z.number().finite().min(0),
  z
    .string()
    .trim()
    .regex(/^\d+([.,]\d+)?$/, 'Значение должно быть неотрицательным числом'),
]);
const optionalNumberValue = z.union([numberValue, z.literal(''), z.null()]).optional();
const optionalNonNegativeNumberValue = z
  .union([nonNegativeNumberValue, z.literal(''), z.null()])
  .optional();
const optionalClientNumericQueryValue = z.preprocess(
  (value: unknown) =>
    typeof value === 'string' && value.trim() === '' ? '' : value,
  optionalNonNegativeNumberValue,
);
const boolValue = z.union([z.boolean(), z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')]);
const optionalBoolValue = boolValue.optional();
const statusFilter = z.enum(['active', 'archived', 'inactive', 'all']);
const archiveStatus = z.enum(['active', 'archived']);
const requiredString = z.string().trim().min(1, 'Поле обязательно');
const nameString = z.string().trim().min(2, 'Минимум 2 символа').max(160, 'Слишком длинное значение');
const optionalString = z.union([z.string().trim(), z.literal(''), z.null()]).optional();
const jsonObject = z.record(z.string(), z.unknown());
const optionalJsonObject = z.union([jsonObject, z.null()]).optional();
const optionalJsonArray = z.union([z.array(jsonObject), z.null()]).optional();
const accountRoleValue = z.enum(ACCOUNT_ROLE_VALUES);
const timeOfDay = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время должно быть в формате HH:mm');
const saleIntentValue = z.enum(['normal', 'subscription', 'certificate']);
const pendingSaleStatusValue = z.enum([
  'pending',
  'linked',
  'ignored',
  'canceled',
  'all',
]);
const subscriptionTypeStatusValue = z.enum(['active', 'archived', 'all']);
const clientSubscriptionStatusValue = z.enum([
  'active',
  'expired',
  'used',
  'canceled',
  'all',
]);
const certificateTypeValue = z.enum(['money', 'service']);
const certificateStatusValue = z.enum([
  'active',
  'expired',
  'redeemed',
  'canceled',
  'all',
]);
const corporateClientStatusValue = z.enum(['active', 'archived', 'all']);
const corporateLedgerStatusValue = z.enum(['active', 'canceled', 'all']);
const corporateLedgerTypeValue = z.enum(['deposit', 'spending', 'all']);
const prepaymentsDashboardTypeValue = z.enum([
  'all',
  'pending_sales',
  'subscriptions',
  'certificates',
  'corporate_balances',
]);
const prepaymentsDashboardStatusValue = z.enum([
  'all',
  'pending',
  'linked',
  'ignored',
  'active',
  'expiring_soon',
  'low_balance',
  'expired',
  'used',
  'redeemed',
  'canceled',
  'archived',
]);
const prepaymentsDashboardExpiryValue = z.enum([
  'all',
  'expiring_soon',
  'expired',
  'valid',
]);
const managerControlDashboardQuery = z
  .object({
    date: optionalDateOnly,
    expiringDays: z.union([id, z.literal('')]).optional(),
    limit: z.union([id, z.literal('')]).optional(),
    lowBalanceThreshold: optionalNonNegativeNumberValue,
  })
  .passthrough();
const subscriptionServiceTypeValue = z.enum(['training']);
const subscriptionTrainingKindValue = z.enum(['group', 'personal']);
const subscriptionTimeSegmentValue = z.enum([
  'single',
  'off_peak',
  'standard',
  'all',
]);
const onboardingTaskKey = z
  .string()
  .trim()
  .min(3, 'Ключ задания обязателен')
  .max(160, 'Ключ задания слишком длинный')
  .regex(/^[a-z0-9._-]+$/, 'Ключ задания указан некорректно');
const onboardingStepKey = z
  .string()
  .trim()
  .min(1, 'Ключ шага обязателен')
  .max(120, 'Ключ шага слишком длинный')
  .regex(/^[a-z0-9._-]+$/, 'Ключ шага указан некорректно');
const onboardingQuizAnswer = z.union([
  z.string().trim(),
  z.array(z.string().trim()),
]);
const paginationQuery = z
  .object({
    page: z.union([id, z.literal('')]).optional(),
    pageSize: z.union([id, z.literal('')]).optional(),
  })
  .passthrough();
const idParams = z.object({ id });
const transcriptionWorkerLeaseFields = {
  claimId: z.string().uuid().optional(),
  claimToken: z.string().trim().min(32).max(256).optional(),
};
const redemptionIdParams = z.object({ id, redemptionId: id });
const viewIdParams = z.object({ viewId: id });
const clientIdParams = z.object({ clientId: id });
const noteIdParams = z.object({ noteId: id });
const trainingPlanIdParams = z.object({ planId: id });
const clientSkillMapEntryParams = z.object({ clientId: id, skillId: id });
const baseIdParams = z.object({ baseId: id });
const taskClientIdParams = z.object({ taskClientId: id });
const typeParams = z.object({
  type: z.enum(['client-sources', 'visit-categories']),
});
const referenceParams = z.object({
  id,
  type: z.enum(['client-sources', 'visit-categories']),
});
const trainingMethodologySkillDirection = z.enum(TRAINING_SKILL_DIRECTION_VALUES);
const trainingMethodologySkillStatus = z.enum(TRAINING_SKILL_STATUS_VALUES);
const trainingMethodologyExerciseStatus = z.enum(TRAINING_EXERCISE_STATUS_VALUES);
const trainingMethodologyELevel = z.enum(TRAINING_EXERCISE_E_LEVEL_VALUES);
const trainingMethodologyFormat = z.enum(TRAINING_EXERCISE_FORMAT_VALUES);
const optionalTrainingMethodologySkillLevel = z
  .union([
    z.number().int().min(0).max(5),
    z.string().trim().regex(/^[0-5]$/, 'Уровень навыка должен быть от 0 до 5'),
    z.literal(''),
    z.null(),
  ])
  .optional();
const optionalTrainingMethodologyELevel = z
  .union([trainingMethodologyELevel, z.literal(''), z.null()])
  .optional();
const trainingMethodologyStatusQuery = z.enum([
  ...TRAINING_EXERCISE_STATUS_VALUES,
  'all',
]);
const trainingMethodologySkillStatusQuery = z.enum([
  ...TRAINING_SKILL_STATUS_VALUES,
  'all',
]);
const trainingNoteExerciseRating = z.union([
  z.number().int().min(1).max(5),
  z.string().trim().regex(/^[1-5]$/, 'Оценка упражнения должна быть от 1 до 5'),
]);
const trainingNoteExerciseComment = z
  .union([
    z.string().trim().max(240, 'Комментарий по упражнению должен быть не длиннее 240 символов'),
    z.literal(''),
    z.null(),
  ])
  .optional();
const trainingNoteExerciseResult = z
  .object({
    canAdvance: optionalBoolValue,
    comment: trainingNoteExerciseComment,
    rating: trainingNoteExerciseRating,
    repeatExercise: optionalBoolValue,
    repeatSkill: optionalBoolValue,
    trainingExerciseId: id,
  })
  .passthrough();
const trainingNoteExerciseResults = z
  .array(trainingNoteExerciseResult)
  .max(20, 'В одной записи можно указать до 20 упражнений')
  .optional();
const dateRangeQuery = z
  .object({
    from: optionalDateOnly,
    to: optionalDateOnly,
  })
  .passthrough();

const clientFilters = z
  .object({
    duplicateOnly: optionalBoolValue,
    lastVisitDaysFrom: optionalClientNumericQueryValue,
    lastVisitDaysTo: optionalClientNumericQueryValue,
    lastVisitFrom: optionalDateOnly,
    lastVisitTo: optionalDateOnly,
    q: optionalString,
    segment: z.enum(['all', 'new', 'regular', 'inactive', 'no_visits']).optional(),
    source: optionalString,
    sourceId: nullableId,
    status: z.enum(['active', 'archived', 'all']).optional(),
    trainingLevel: z.enum(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A']).optional(),
    visitCategory: optionalString,
    visitCategoryId: nullableId,
    visitCountMax: optionalClientNumericQueryValue,
    visitCountMin: optionalClientNumericQueryValue,
    visitsAnalytics: z
      .object({
        algorithmVersion: z.literal('visits_analytics_segment_v1'),
        asOf: z.string().datetime({ offset: true }),
        canonicalClientRule: z.literal('recursive_merged_root_v1'),
        clientStatus: z.literal('active'),
        excludeDuplicateVisits: z.literal(true),
        excludeTraining: z.literal(true),
        firstVisitFrom: optionalDateOnly,
        firstVisitMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        firstVisitTo: optionalDateOnly,
        lastVisitFrom: optionalDateOnly,
        lastVisitTo: optionalDateOnly,
        lifecycleStatus: z.enum(['new', 'developing', 'regular', 'atRisk', 'sleeping', 'lost']).optional(),
        sourceKeys: z.array(z.string().regex(/^(?:id:\d+|legacy:[A-Za-z0-9_-]+|unspecified)$/)).max(100),
        timeZone: z.literal('Europe/Moscow'),
        visitCountMax: optionalClientNumericQueryValue,
        visitCountMin: optionalClientNumericQueryValue,
      })
      .optional(),
  })
  .passthrough();

const visitsAnalyticsSegmentSelection = z
  .object({
    asOf: z.union([dateOnly, z.string().datetime({ offset: true })]).optional(),
    cohortMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    from: dateOnly,
    kind: z.enum(['source', 'lifecycle', 'cohort', 'filters']),
    lifecycleStatus: z.enum(['new', 'developing', 'regular', 'atRisk', 'sleeping', 'lost']).optional(),
    sourceKeys: z.array(z.string().regex(/^(?:id:\d+|legacy:[A-Za-z0-9_-]+|unspecified)$/)).max(100).optional(),
    to: dateOnly,
  })
  .passthrough();

const recurrence = z
  .object({
    assignedToAccountId: nullableId,
    description: optionalString,
    dueDays: optionalNonNegativeNumberValue,
    enabled: z.boolean().optional(),
    interval: z.enum(['none', 'daily', 'weekly']).optional(),
    scopeType: z.enum(['snapshot', 'dynamic']).optional(),
    time: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время должно быть в формате HH:mm')
      .optional(),
    title: optionalString,
    weekday: z.union([id, z.literal(''), z.null()]).optional(),
  })
  .passthrough();

const savedViewBody = z
  .object({
    filters: clientFilters.optional(),
    name: nameString,
  })
  .passthrough();

const savedViewUpdateBody = z
  .object({
    filters: clientFilters.optional(),
    name: nameString.optional(),
  })
  .passthrough();

const clientBody = z
  .object({
    name: nameString,
    note: optionalString,
    phone: requiredString,
    source: optionalString,
    sourceId: nullableId,
    status: archiveStatus.optional(),
    telegramId: optionalString,
    vkId: optionalString,
    webId: optionalString,
  })
  .passthrough();

const clientUpdateBody = clientBody
  .partial()
  .extend({
    status: archiveStatus.optional(),
  })
  .passthrough();

const clientSkillMapLevel = z
  .union([
    z.number().int().min(0).max(5),
    z.string().trim().regex(/^[0-5]$/, 'Уровень навыка должен быть от 0 до 5'),
  ])
  .optional();

const clientSkillMapUpdateBody = z
  .object({
    lastTrainedAt: z.union([dateOnly, z.literal(''), z.null()]).optional(),
    latestAssessment: optionalString,
    latestExercises: optionalString,
    level: clientSkillMapLevel,
    nextEStep: optionalTrainingMethodologyELevel,
    repeatFlag: optionalBoolValue,
  })
  .passthrough();

const trainingRecommendationQuery = z
  .object({
    date: optionalDateOnly,
    goal: z
      .union([
        z.string().trim().max(160, 'Цель тренировки слишком длинная'),
        z.literal(''),
        z.null(),
      ])
      .optional(),
  })
  .passthrough();

const groupTrainingRecommendationBody = z
  .object({
    clientIds: z
      .array(id)
      .min(2, 'Выберите минимум 2 клиентов для группы')
      .max(12, 'В группе можно выбрать до 12 клиентов'),
    date: optionalDateOnly,
    goal: z
      .union([
        z.string().trim().max(160, 'Тема тренировки слишком длинная'),
        z.literal(''),
        z.null(),
      ])
      .optional(),
  })
  .passthrough();

const subscriptionTypeBody = z
  .object({
    bonusPersonalSessions: optionalNonNegativeNumberValue,
    description: optionalString,
    isUnlimited: optionalBoolValue,
    metadata: optionalJsonObject,
    name: nameString,
    price: nonNegativeNumberValue,
    serviceType: subscriptionServiceTypeValue.optional(),
    sessionsTotal: nullableId,
    timeSegment: subscriptionTimeSegmentValue.optional(),
    trainingKind: subscriptionTrainingKindValue,
    validityDays: id,
  })
  .passthrough();

const subscriptionRedemptionBody = z
  .object({
    comment: optionalString,
    metadata: optionalJsonObject,
    quantity: z.union([id, z.literal(''), z.null()]).optional(),
    redeemedAt: optionalDateTime,
    serviceType: subscriptionServiceTypeValue.optional(),
    trainingKind: subscriptionTrainingKindValue.optional(),
  })
  .passthrough();

const subscriptionRedemptionReverseBody = z
  .object({
    reason: optionalString,
  })
  .passthrough();

const certificateSalePayload = z
  .object({
    amountTotal: positiveNumberValue.optional(),
    certificateType: certificateTypeValue.optional(),
    code: optionalString,
    metadata: optionalJsonObject,
    serviceName: optionalString,
    serviceType: optionalString,
    startsAt: optionalDateTime,
    title: optionalString,
    type: certificateTypeValue.optional(),
    unitsTotal: z.union([id, z.literal(''), z.null()]).optional(),
    validityDays: z.union([id, z.literal(''), z.null()]).optional(),
  })
  .passthrough();

const certificateRedemptionBody = z
  .object({
    amount: positiveNumberValue.optional(),
    comment: optionalString,
    metadata: optionalJsonObject,
    quantity: z.union([id, z.literal(''), z.null()]).optional(),
    redeemedAt: optionalDateTime,
  })
  .passthrough();

const certificateRedemptionReverseBody = z
  .object({
    reason: optionalString,
  })
  .passthrough();

const corporateClientBody = z
  .object({
    comment: optionalString,
    contactEmail: optionalString,
    contactName: optionalString,
    contactPhone: optionalString,
    name: nameString,
  })
  .passthrough();

const corporateDepositCategory = z
  .string({ error: 'Выберите категорию дохода' })
  .trim()
  .min(1, 'Выберите категорию дохода')
  .max(160, 'Категория дохода слишком длинная');

const corporateDepositCreateBody = z
  .object({
    amount: positiveNumberValue,
    category: corporateDepositCategory,
    comment: optionalString,
    date: dateOnly,
    financeId: z.union([z.literal(''), z.null()]).optional(),
    metadata: optionalJsonObject,
  })
  .passthrough();

const corporateDepositLinkBody = z
  .object({
    comment: optionalString,
    financeId: id,
    metadata: optionalJsonObject,
  })
  .passthrough();

const corporateDepositBody = z.union([
  corporateDepositLinkBody,
  corporateDepositCreateBody,
]);

const corporateDepositValidationBody = z
  .object({
    amount: positiveNumberValue.optional(),
    category: optionalString,
    comment: optionalString,
    date: optionalDateOnly,
    financeId: nullableId,
    metadata: optionalJsonObject,
  })
  .passthrough()
  .superRefine((value: { category?: unknown; financeId?: unknown }, ctx: any) => {
    if (value.financeId) return;
    const category = String(value.category || '').trim();
    if (!category) {
      ctx.addIssue({
        code: 'custom',
        message: 'Выберите категорию дохода',
        path: ['category'],
      });
    }
  });

const corporateSpendingBody = z
  .object({
    amount: positiveNumberValue,
    bookingId: nullableId,
    clientId: nullableId,
    comment: optionalString,
    date: dateOnly,
    metadata: optionalJsonObject,
    participantName: optionalString,
    service: requiredString.max(160, 'Название услуги слишком длинное'),
    trainingNoteId: nullableId,
    visitId: nullableId,
  })
  .passthrough();

const corporateReasonBody = z
  .object({
    reason: optionalString,
  })
  .passthrough();

const trainingPlanSourceType = z.enum([
  'manual',
  'personal_recommendation',
  'group_recommendation',
]);
const trainingPlanExercise = z
  .object({
    blockKey: optionalString,
    blockTitle: optionalString,
    exerciseId: id.optional(),
    id: id.optional(),
    reason: z.unknown().optional(),
    reasonSnapshot: z.unknown().optional(),
    title: optionalString,
    trainingExerciseId: id.optional(),
  })
  .passthrough()
  .refine(
    (value: {
      exerciseId?: unknown;
      id?: unknown;
      trainingExerciseId?: unknown;
    }) => Boolean(value.trainingExerciseId || value.exerciseId || value.id),
    'Укажите упражнение плана',
  );
const trainingPlanExercises = z
  .array(trainingPlanExercise)
  .min(1, 'Добавьте упражнения в план тренировки')
  .max(20, 'В плане можно указать до 20 упражнений');
const trainingPlanParticipantResult = z
  .object({
    clientId: id,
    exercises: optionalString,
    exerciseResults: trainingNoteExerciseResults,
    level: z.enum(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A']).optional(),
    note: optionalString,
    trainedAt: dateOnly.optional(),
  })
  .passthrough();
const trainingPlanBody = z
  .object({
    clientId: id.optional(),
    clientIds: z.array(id).optional(),
    exercises: trainingPlanExercises.optional(),
    goal: z
      .union([
        z.string().trim().max(160, 'Цель плана слишком длинная'),
        z.literal(''),
        z.null(),
      ])
      .optional(),
    kind: z.enum(['personal', 'group']),
    notes: optionalString,
    plannedAt: dateOnly.optional(),
    plannedExercises: trainingPlanExercises.optional(),
    sourceSnapshot: z.unknown().optional(),
    sourceType: trainingPlanSourceType.optional(),
  })
  .passthrough()
  .refine((value: { exercises?: unknown; plannedExercises?: unknown }) => Boolean(value.plannedExercises || value.exercises), {
    message: 'Добавьте упражнения в план тренировки',
    path: ['plannedExercises'],
  });
const trainingPlanExercisesBody = z
  .object({
    exercises: trainingPlanExercises.optional(),
    plannedExercises: trainingPlanExercises.optional(),
  })
  .passthrough()
  .refine((value: { exercises?: unknown; plannedExercises?: unknown }) => Boolean(value.plannedExercises || value.exercises), {
    message: 'Добавьте упражнения в план тренировки',
    path: ['plannedExercises'],
  });
const trainingPlanCompleteBody = z
  .object({
    exercises: optionalString,
    exerciseResults: trainingNoteExerciseResults,
    level: z.enum(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A']).optional(),
    note: optionalString,
    participantResults: z.array(trainingPlanParticipantResult).optional(),
    trainedAt: dateOnly.optional(),
  })
  .passthrough();
const trainingPlanQuickCompleteBody = z
  .object({
    note: optionalString,
    trainedAt: dateOnly.optional(),
  })
  .passthrough();

const bonusRuleBody = z
  .object({
    bonusPercent: nonNegativeNumberValue,
    categoryIds: z.array(id).optional(),
    description: optionalString,
    isActive: z.boolean().optional(),
    name: nameString,
    sortOrder: optionalNumberValue,
    thresholdType: z.enum(['none', 'revenue', 'quantity']).optional(),
    thresholdValue: optionalNonNegativeNumberValue,
  })
  .passthrough();

const bookingClientBody = z
  .object({
    name: nameString,
    note: optionalString,
    phone: requiredString,
    source: optionalString,
    sourceId: nullableId,
  })
  .passthrough();

const bookingDuration = z.union([
  z.number().int().positive(),
  z.string().trim().regex(/^[1-9]\d*$/, 'Длительность должна быть положительным целым числом'),
]);
const bookingRuleTime = z
  .string()
  .trim()
  .regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, 'Время должно быть в формате HH:mm');
const bookingWeekday = z.union([
  z.number().int().min(1).max(7),
  z.string().trim().regex(/^[1-7]$/, 'День недели должен быть от 1 до 7'),
]);
const requiredBookingDateTime = z.union([
  z.string().trim().datetime({ offset: true }),
  z.string().trim().refine((value: string) => !Number.isNaN(new Date(value).getTime()), {
    message: 'Дата и время указаны некорректно',
  }),
]);
const bookingDateTime = z.union([requiredBookingDateTime, z.literal(''), z.null()]).optional();
const bookingType = z.enum([
  'game',
  'tournament',
  'personal_training',
  'master_class',
  'group_training',
  'corporate',
]);
const bookingSettingsBody = z
  .object({
    cancellationDeadlineHours: optionalNonNegativeNumberValue,
    maxDurationMinutes: optionalNonNegativeNumberValue,
    minDurationMinutes: optionalNonNegativeNumberValue,
    rescheduleDeadlineHours: optionalNonNegativeNumberValue,
    slotStepMinutes: optionalNonNegativeNumberValue,
    workingHoursEnd: bookingRuleTime.optional(),
    workingHoursStart: bookingRuleTime.optional(),
  })
  .passthrough();
const bookingPriceRuleBody = z
  .object({
    courtType: z.enum(['all', 'padel_double', 'padel_single', 'other']).optional(),
    endTime: bookingRuleTime.optional(),
    name: nameString,
    pricePerHour: nonNegativeNumberValue,
    priority: optionalNonNegativeNumberValue,
    startTime: bookingRuleTime.optional(),
    status: z.enum(['active', 'archived']).optional(),
    weekdays: z.array(bookingWeekday).min(1).optional(),
  })
  .passthrough();
const bookingResourceBody = z
  .object({
    isActive: z.boolean().optional(),
    name: nameString,
    sortOrder: optionalNonNegativeNumberValue,
    type: z.enum(['padel_double', 'padel_single', 'other']).optional(),
  })
  .passthrough();
const bookingBlockBody = z
  .object({
    courtId: id,
    endsAt: requiredBookingDateTime,
    reason: nameString,
    startsAt: requiredBookingDateTime,
    status: z.enum(['active', 'archived']).optional(),
  })
  .passthrough();
const bookingExceptionBody = z
  .object({
    date: dateOnly,
    isClosed: z.boolean().optional(),
    reason: optionalString,
    status: z.enum(['active', 'archived']).optional(),
    workingHoursEnd: bookingRuleTime.optional(),
    workingHoursStart: bookingRuleTime.optional(),
  })
  .passthrough();
const bookingSeriesBody = z
  .object({
    bookingType: bookingType.optional(),
    client: bookingClientBody.optional(),
    comment: optionalString,
    courtId: id,
    durationMinutes: bookingDuration,
    endsOn: dateOnly,
    groupParticipantIds: z
      .array(id)
      .max(12, 'В групповой тренировке можно выбрать до 12 участников')
      .optional(),
    name: nameString,
    paymentMethod: z.enum(['unknown', 'cash', 'cashless', 'mixed']).optional(),
    paymentStatus: z.enum(['unpaid', 'partial', 'paid', 'refunded']).optional(),
    price: optionalNonNegativeNumberValue,
    responsibleStaffId: nullableId,
    source: z.enum(['phone', 'admin', 'walk_in', 'other']).optional(),
    startTime: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время должно быть в формате HH:mm'),
    startsOn: dateOnly,
    status: z.enum(['new', 'confirmed']).optional(),
    userId: nullableId,
    weekday: bookingWeekday,
  })
  .passthrough();
const bookingSeriesArchiveBody = z
  .object({
    cancelFuture: z.boolean().optional(),
    reason: optionalString,
  })
  .passthrough();

const bookingShape = {
  bookingType: bookingType.optional(),
  cancellationReason: optionalString,
  changeReason: optionalString,
  client: bookingClientBody.optional(),
  comment: optionalString,
  courtId: id,
  date: optionalDateOnly,
  durationMinutes: bookingDuration,
  groupParticipantIds: z
    .array(id)
    .max(12, 'В групповой тренировке можно выбрать до 12 участников')
    .optional(),
  paidAmount: optionalNonNegativeNumberValue,
  paymentMethod: z.enum(['unknown', 'cash', 'cashless', 'mixed']).optional(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid', 'refunded']).optional(),
  price: optionalNonNegativeNumberValue,
  responsibleStaffId: nullableId,
  source: z.enum(['phone', 'admin', 'walk_in', 'other']).optional(),
  startTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Время должно быть в формате HH:mm')
    .optional(),
  startsAt: bookingDateTime,
  status: z.enum(['new', 'confirmed', 'canceled', 'arrived', 'no_show']).optional(),
  userId: nullableId,
};

const bookingBody = z
  .object(bookingShape)
  .passthrough();

const shiftReportScheduleType = z.enum([
  'once_daily',
  'daily_times',
  'interval_hours',
  'shift_start',
  'shift_end',
]);
const shiftReportItemType = z.enum([
  'checkbox',
  'text',
  'number',
]);
const shiftReportTemplateStatus = z.enum(['active', 'archived']);
const shiftReportScheduleConfig = z
  .object({
    endTime: timeOfDay.optional(),
    everyHours: z.union([id, z.literal(''), z.null()]).optional(),
    startTime: timeOfDay.optional(),
    time: timeOfDay.optional(),
    times: z.array(timeOfDay).max(12).optional(),
  })
  .passthrough();
const shiftReportTemplateBody = z
  .object({
    appliesToRole: z.union([accountRoleValue, z.literal(''), z.null()]).optional(),
    appliesToShiftType: optionalString,
    description: optionalString,
    gracePeriodMinutes: optionalNonNegativeNumberValue,
    name: nameString,
    scheduleConfig: shiftReportScheduleConfig.optional(),
    scheduleType: shiftReportScheduleType,
    sortOrder: optionalNumberValue,
    status: shiftReportTemplateStatus.optional(),
  })
  .passthrough();
const shiftReportTemplateItemBody = z
  .object({
    itemType: shiftReportItemType,
    label: nameString,
    photoRequired: optionalBoolValue,
    sortOrder: optionalNumberValue,
    status: shiftReportTemplateStatus.optional(),
  })
  .passthrough();
const shiftReportAnswerBody = z
  .object({
    booleanValue: z.union([boolValue, z.null()]).optional(),
    id,
    numberValue: optionalNumberValue,
    textValue: optionalString,
  })
  .passthrough();
const shiftReportSaveBody = z
  .object({
    answers: z.array(shiftReportAnswerBody).max(80).optional(),
    comment: optionalString,
  })
  .passthrough();
const shiftReportAttachmentBody = z
  .object({
    data: z.string().min(16, 'Фото не передано').max(8_000_000, 'Фото слишком большое'),
    fileName: optionalString,
    mimeType: z.enum([
      'image/gif',
      'image/heic',
      'image/heif',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]),
  })
  .passthrough();

const shiftCashBalanceBody = z
  .object({
    banknotes: nonNegativeNumberValue,
    coins: nonNegativeNumberValue,
    comment: z
      .union([z.string().trim().max(1000, 'Комментарий слишком длинный'), z.null()])
      .optional(),
  })
  .passthrough();
const shiftCashExpenseBody = z
  .object({
    amount: positiveNumberValue,
    categoryId: id,
    description: z
      .string()
      .trim()
      .min(1, 'Описание расхода обязательно')
      .max(1000, 'Описание расхода слишком длинное'),
    spentAt: optionalHttpDateTime,
  })
  .passthrough();

const bookingUpdateBody = z
  .object(bookingShape)
  .partial()
  .extend({
    client: bookingClientBody.optional(),
    durationMinutes: bookingDuration.optional(),
    userId: nullableId,
  })
  .passthrough();

const callTaskBody = z
  .object({
    assignedToAccountId: nullableId,
    description: optionalString,
    dueAt: optionalHttpDateTime,
    scriptText: optionalString,
    scopeType: z.enum(['snapshot', 'dynamic']).optional(),
    title: optionalString,
  })
  .passthrough();

const callTaskUpdateBody = callTaskBody
  .extend({
    status: z.enum(['backlog', 'in_progress', 'done', 'archived']).optional(),
  })
  .partial()
  .passthrough();

const taskClientStatus = z.enum([
  'new',
  'no_answer',
  'callback',
  'doubting',
  'booked',
  'refused',
]);

const trainingMethodologySkillBody = z
  .object({
    description: optionalString,
    direction: trainingMethodologySkillDirection,
    name: nameString,
    status: trainingMethodologySkillStatus.optional(),
  })
  .passthrough();

const trainingMethodologySkillUpdateBody = z
  .object({
    description: optionalString,
    direction: trainingMethodologySkillDirection.optional(),
    name: nameString.optional(),
    status: trainingMethodologySkillStatus.optional(),
  })
  .passthrough();

const trainingMethodologyExerciseBody = z
  .object({
    additionalSkillIds: z.array(id).optional(),
    complication: optionalString,
    description: optionalString,
    eLevel: optionalTrainingMethodologyELevel,
    formats: z.array(trainingMethodologyFormat).optional(),
    mainSkillId: nullableId,
    name: nameString,
    simplification: optionalString,
    skillLevel: optionalTrainingMethodologySkillLevel,
    skillLevelMax: optionalTrainingMethodologySkillLevel,
    skillLevelMin: optionalTrainingMethodologySkillLevel,
    status: trainingMethodologyExerciseStatus.optional(),
    successCriterion: optionalString,
  })
  .passthrough();

const trainingMethodologyExerciseUpdateBody = trainingMethodologyExerciseBody
  .extend({
    name: nameString.optional(),
  })
  .partial()
  .passthrough();

const apiSchemas = {
  access: {
    correctKey: {
      body: z
        .object({
          keyNumber: z
            .string()
            .trim()
            .min(1, 'Номер ключа обязателен')
            .max(32, 'Номер ключа слишком длинный')
            .regex(/^\d+$/, 'Номер ключа должен содержать только цифры'),
          visitId: id,
        })
        .passthrough(),
    },
    issueKey: {
      body: z
        .object({
          keyNumber: requiredString,
          visitId: id,
        })
        .passthrough(),
    },
    manualVisit: {
      body: z
        .object({
          clientEventId: optionalString,
          metadata: optionalJsonObject,
          source: optionalString,
          userId: id,
        })
        .passthrough(),
    },
    register: { body: clientBody.pick({ name: true, phone: true, source: true, sourceId: true }).passthrough() },
    scannerEvent: {
      body: z
        .object({
          clientEventId: optionalString,
          code: optionalString,
          eventType: requiredString,
          message: optionalString,
          metadata: optionalJsonObject,
          qr: optionalString,
          severity: z.enum(['info', 'warning', 'error']).optional(),
          source: optionalString,
          status: optionalString,
          userId: nullableId,
          visitId: nullableId,
        })
        .passthrough(),
    },
    scannerEventsQuery: paginationQuery
      .extend({
        eventType: optionalString,
        severity: z.enum(['info', 'warning', 'error']).optional(),
        status: optionalString,
      })
      .passthrough(),
    scan: {
      body: z
        .object({
          clientEventId: optionalString,
          deviceLabel: optionalString,
          metadata: optionalJsonObject,
          qr: requiredString,
          scannerSessionId: optionalString,
        })
        .passthrough(),
    },
    searchQuery: z.object({ q: optionalString }).passthrough(),
    visitCategory: {
      body: z
        .object({
          category: optionalString,
          categoryIds: z.array(id).optional(),
          visitId: id,
        })
        .passthrough(),
    },
  },
  audit: {
    listQuery: paginationQuery
      .extend({
        accountId: nullableId,
        action: optionalString,
        entityType: optionalString,
      })
      .passthrough(),
  },
  bookings: {
    analyticsQuery: dateRangeQuery,
    blockBody: bookingBlockBody,
    body: bookingBody,
    exceptionBody: bookingExceptionBody,
    params: idParams,
    priceRuleBody: bookingPriceRuleBody,
    resourceBody: bookingResourceBody,
    quoteQuery: z
      .object({
        courtId: id,
        durationMinutes: bookingDuration,
        startsAt: requiredBookingDateTime,
      })
      .passthrough(),
    scheduleQuery: z
      .object({
        date: optionalDateOnly,
        status: z.enum(['all', 'new', 'confirmed', 'canceled', 'arrived', 'no_show']).optional(),
      })
      .passthrough(),
    settingsBody: bookingSettingsBody,
    seriesArchiveBody: bookingSeriesArchiveBody,
    seriesBody: bookingSeriesBody,
    statusBody: z
      .object({
        reason: optionalString,
        status: z.enum(['new', 'confirmed', 'canceled', 'arrived', 'no_show']),
      })
      .passthrough(),
    statusQuery: z.object({ status: z.enum(['active', 'archived', 'all']).optional() }).passthrough(),
    updateBody: bookingUpdateBody,
  },
  accounts: {
    body: z
      .object({
        email: z.string().trim().email('Некорректный email'),
        password: z.string().min(6, 'Пароль должен быть не короче 6 символов').optional(),
        role: z.enum(ACCOUNT_ROLE_VALUES).optional(),
        staffId: nullableId,
        status: z.enum(['active', 'inactive', 'archived']).optional(),
      })
      .passthrough(),
    createBody: z
      .object({
        email: z.string().trim().email('Некорректный email'),
        password: z.string().min(6, 'Пароль должен быть не короче 6 символов'),
        role: z.enum(ACCOUNT_ROLE_VALUES).optional(),
        staffId: nullableId,
        status: z.enum(['active', 'inactive', 'archived']).optional(),
      })
      .passthrough(),
    listQuery: z.object({ status: statusFilter.optional() }).passthrough(),
    params: idParams,
  },
  onboarding: {
    completeBody: z
      .object({
        metadata: optionalJsonObject,
        role: accountRoleValue.optional(),
      })
      .passthrough(),
    eventBody: z
      .object({
        entityId: optionalString,
        entityType: optionalString,
        eventKey: z.enum(ONBOARDING_CLIENT_CHECKPOINT_EVENTS),
        payload: optionalJsonObject,
        role: accountRoleValue.optional(),
      })
      .passthrough(),
    progressBody: z
      .object({
        metadata: optionalJsonObject,
        role: accountRoleValue.optional(),
      })
      .passthrough(),
    quizAttemptBody: z
      .object({
        answers: z.record(z.string(), onboardingQuizAnswer),
        metadata: optionalJsonObject,
        role: accountRoleValue.optional(),
      })
      .passthrough(),
    roleQuery: z.object({ role: accountRoleValue.optional() }).passthrough(),
    stepParams: z.object({
      stepKey: onboardingStepKey,
      taskKey: onboardingTaskKey,
    }),
    taskParams: z.object({ taskKey: onboardingTaskKey }),
    trainingModeBody: z
      .object({
        isEnabled: z.boolean(),
        metadata: optionalJsonObject,
        role: accountRoleValue.optional(),
      })
      .passthrough(),
  },
  auth: {
    bootstrap: {
      body: z
        .object({
          email: z.string().trim().email('Некорректный email'),
          name: nameString,
          password: z.string().min(6, 'Пароль должен быть не короче 6 символов'),
          phone: optionalString,
        })
        .passthrough(),
    },
    login: {
      body: z
        .object({
          email: z.string().trim().email('Некорректный email'),
          password: z.string().min(1, 'Пароль обязателен'),
        })
        .passthrough(),
    },
    membershipsResponse: z.object({
      memberships: z.array(
        z.object({
          clubs: z.array(
            z.object({
              effectiveRole: accountRoleValue,
              id: z.number().int().positive(),
              name: z.string(),
              slug: z.string(),
              timezone: z.string(),
            }),
          ),
          id: z.number().int().positive(),
          organization: z.object({
            id: z.number().int().positive(),
            name: z.string(),
            slug: z.string(),
          }),
          role: accountRoleValue,
        }),
      ),
      recommendedContext: z
        .object({
          clubId: z.number().int().positive(),
          effectiveRole: accountRoleValue,
          membershipId: z.number().int().positive(),
          organizationId: z.number().int().positive(),
        })
        .nullable(),
    }),
  },
  callTasks: {
    attempt: {
      body: z
        .object({
          deadlineAt: optionalDateTime,
          status: taskClientStatus.optional(),
          summary: optionalString,
        })
        .passthrough(),
      params: taskClientIdParams,
    },
    bulk: {
      body: z
        .object({
          deadlineAt: optionalDateTime,
          status: taskClientStatus.optional(),
          summary: optionalString,
          taskClientIds: z.array(id).min(1, 'Выберите клиентов для массового действия').max(500),
        })
        .passthrough(),
      params: idParams,
    },
    clientsQuery: paginationQuery
      .extend({
        overdue: optionalBoolValue,
        q: optionalString,
        status: z.union([taskClientStatus, z.literal('all')]).optional(),
      })
      .passthrough(),
    createFromBase: { body: callTaskBody, params: baseIdParams },
    createForClient: { body: callTaskBody, params: clientIdParams },
    listQuery: z
      .object({
        baseId: nullableId,
        status: z.enum(['active', 'all', 'backlog', 'in_progress', 'done', 'archived']).optional(),
      })
      .passthrough(),
    reportQuery: dateRangeQuery
      .extend({
        baseId: nullableId,
        status: z.enum(['active', 'all', 'backlog', 'in_progress', 'done', 'archived']).optional(),
      })
      .passthrough(),
    update: { body: callTaskUpdateBody, params: idParams },
    withId: { params: idParams },
  },
  telephony: {
    callsQuery: paginationQuery
      .extend({
        callStatus: z
          .enum([
            'ringing',
            'answered',
            'completed',
            'missed',
            'failed',
            'unknown',
          ])
          .optional(),
        direction: z.enum(['inbound', 'outbound', 'unknown']).optional(),
        from: optionalDateTime,
        q: optionalString,
        recordingStatus: z.enum(['available', 'missing', 'pending', 'unknown']).optional(),
        search: optionalString,
        status: z
          .enum(['active', 'all', 'new', 'in_progress', 'processed', 'ignored', 'missed'])
          .optional(),
        to: optionalDateTime,
      })
      .passthrough(),
    createClient: {
      body: clientBody
        .omit({ phone: true })
        .extend({
          status: archiveStatus.optional(),
        })
        .passthrough(),
      params: idParams,
    },
    linkClient: {
      body: z.object({ clientId: id }).passthrough(),
      params: idParams,
    },
    complete: {
      body: z
        .object({
          interest: z
            .enum(['game', 'training', 'tournament', 'master_class', 'corporate', 'other'])
            .optional()
            .nullable(),
          linkedBookingId: nullableId,
          nextActionAt: optionalDateTime,
          nextActionText: optionalString,
          result: z.enum([
            'booked',
            'refused',
            'thinking',
            'callback',
            'complaint',
            'corporate',
            'no_answer',
            'other',
          ]),
          summary: optionalString,
        })
        .passthrough(),
      params: idParams,
    },
    ignore: {
      body: z
        .object({
          summary: optionalString,
        })
        .passthrough(),
      params: idParams,
    },
    rawEventsQuery: paginationQuery
      .extend({
        status: z.enum(['all', 'new', 'processed', 'failed']).optional(),
      })
      .passthrough(),
    reportQuery: dateRangeQuery
      .extend({
        callStatus: z
          .enum([
            'ringing',
            'answered',
            'completed',
            'missed',
            'failed',
            'unknown',
          ])
          .optional(),
        direction: z.enum(['inbound', 'outbound', 'unknown']).optional(),
        recordingStatus: z.enum(['available', 'missing', 'pending', 'unknown']).optional(),
        status: z
          .enum(['all', 'new', 'in_progress', 'processed', 'ignored'])
          .optional(),
      })
      .passthrough(),
    transcriptionJobsQuery: paginationQuery
      .extend({
        callId: z.union([id, z.literal('')]).optional(),
        status: z
          .enum(['all', 'queued', 'processing', 'completed', 'failed'])
          .optional(),
      })
      .passthrough(),
    recordsSyncBody: z
      .object({
        dateFrom: optionalDateTime,
        dateTo: optionalDateTime,
        id: optionalString,
        userId: optionalString,
      })
      .passthrough(),
    subscribeBody: z
      .object({
        expires: optionalNonNegativeNumberValue,
        pattern: optionalString,
        subscriptionType: z.enum(['BASIC_CALL', 'ADVANCED_CALL']).optional(),
        url: optionalString,
      })
      .passthrough(),
    transcriptionClaimBody: z
      .object({
        workerId: optionalString,
      })
      .passthrough(),
    transcriptionAudioReference: {
      body: z.object(transcriptionWorkerLeaseFields).passthrough(),
      params: idParams,
    },
    transcriptionProgress: {
      body: z.object({
        ...transcriptionWorkerLeaseFields,
        message: z.string().trim().max(500).optional(),
        progress: z.number().int().min(0).max(100),
        stage: z.enum([
          'downloading_audio',
          'ffmpeg_preprocess',
          'transcribing_admin_channel',
          'transcribing_client_channel',
          'transcribing_unknown_channel',
          'merging_segments',
          'ai_postprocessing',
          'uploading_result',
        ]),
      }).passthrough(),
      params: idParams,
    },
    transcriptionBackfillBody: z.object({
      limit: z.number().int().min(1).max(200).optional(),
    }).passthrough(),
    transcriptionFail: {
      body: z
        .object({
          ...transcriptionWorkerLeaseFields,
          error: optionalString,
          errorMessage: optionalString,
        })
        .passthrough(),
      params: idParams,
    },
    transcriptionResult: {
      body: z
        .object({
          ...transcriptionWorkerLeaseFields,
          aiCorrections: optionalJsonArray,
          aiMetadata: optionalJsonObject,
          aiSegments: optionalJsonArray,
          aiTranscriptSegments: optionalJsonArray,
          aiTranscriptText: optionalString,
          language: optionalString,
          corrections: optionalJsonArray,
          metadata: optionalJsonObject,
          raw: optionalJsonObject,
          rawAsrJson: optionalJsonObject,
          rawAsrResult: optionalJsonObject,
          rawText: optionalString,
          rawTranscript: optionalString,
          rawTranscriptText: optionalString,
          segments: z
            .array(
              z
                .object({
                  confidence: optionalNonNegativeNumberValue,
                  channel: optionalString,
                  end: optionalNonNegativeNumberValue,
                  endMs: optionalNonNegativeNumberValue,
                  endSeconds: optionalNonNegativeNumberValue,
                  phrase: optionalString,
                  role: optionalString,
                  sortOrder: optionalNonNegativeNumberValue,
                  speaker: optionalString,
                  start: optionalNonNegativeNumberValue,
                  startMs: optionalNonNegativeNumberValue,
                  startSeconds: optionalNonNegativeNumberValue,
                  text: optionalString,
                  transcript: optionalString,
                })
                .passthrough(),
            )
            .optional(),
          text: optionalString,
          transcript: optionalString,
          transcriptText: optionalString,
        })
        .passthrough(),
      params: idParams,
    },
    syncBody: z
      .object({
        dateFrom: optionalDateTime,
        dateTo: optionalDateTime,
        pageSize: z.coerce.number().int().min(10).max(100).optional(),
      })
      .passthrough(),
    withId: { params: idParams },
  },
  catalog: {
    categoryBody: z
      .object({
        commissionPercent: optionalNonNegativeNumberValue,
        group: z.enum(PNL_GROUP_VALUES).optional(),
        name: nameString,
        parentId: nullableId,
      })
      .passthrough(),
    categoryUpdateBody: z
      .object({
        commissionPercent: optionalNonNegativeNumberValue,
        name: nameString.optional(),
        parentId: nullableId,
      })
      .passthrough(),
    listQuery: z.object({ status: z.enum(['active', 'archived', 'all']).optional() }).passthrough(),
    pendingSaleLinkBody: z
      .object({
        certificate: certificateSalePayload.optional(),
        clientId: id,
        comment: optionalString,
      })
      .passthrough(),
    pendingSaleReasonBody: z
      .object({
        reason: optionalString,
      })
      .passthrough(),
    pendingSalesQuery: z
      .object({
        saleIntent: saleIntentValue.optional(),
        status: pendingSaleStatusValue.optional(),
      })
      .passthrough(),
    ruleBody: z
      .object({
        category: nameString,
        itemName: nameString,
      })
      .passthrough(),
    saleSettingBody: z
      .object({
        itemName: nameString,
        saleIntent: saleIntentValue,
        saleSettings: optionalJsonObject,
      })
      .passthrough(),
    withId: { params: idParams },
  },
  clientBases: {
    body: z
      .object({
        description: optionalString,
        filters: clientFilters.optional(),
        name: nameString,
        recurrence: recurrence.optional(),
        slaDays: optionalNonNegativeNumberValue,
        status: archiveStatus.optional(),
      })
      .passthrough(),
    listQuery: z.object({ status: z.enum(['active', 'archived', 'all']).optional() }).passthrough(),
    updateBody: z
      .object({
        description: optionalString,
        filters: clientFilters.optional(),
        name: nameString.optional(),
        recurrence: recurrence.optional(),
        slaDays: optionalNonNegativeNumberValue,
        status: archiveStatus.optional(),
      })
      .passthrough(),
    withId: { params: idParams },
  },
  certificates: {
    clientListQuery: z
      .object({
        certificateType: certificateTypeValue.optional(),
        q: optionalString,
        status: certificateStatusValue.optional(),
      })
      .passthrough(),
    clientParams: clientIdParams,
    listQuery: z
      .object({
        certificateType: certificateTypeValue.optional(),
        clientId: nullableId,
        code: optionalString,
        q: optionalString,
        status: certificateStatusValue.optional(),
      })
      .passthrough(),
    redemptionBody: certificateRedemptionBody,
    redemptionReverse: {
      body: certificateRedemptionReverseBody,
      params: redemptionIdParams,
    },
    withId: { params: idParams },
  },
  corporateClients: {
    body: corporateClientBody,
    depositBody: corporateDepositValidationBody,
    depositContractBody: corporateDepositBody,
    entryParams: z.object({ id, entryId: id }),
    ledgerQuery: dateRangeQuery
      .extend({
        participant: optionalString,
        service: optionalString,
        status: corporateLedgerStatusValue.optional(),
        type: corporateLedgerTypeValue.optional(),
      })
      .passthrough(),
    listQuery: z
      .object({
        q: optionalString,
        status: corporateClientStatusValue.optional(),
      })
      .passthrough(),
    reasonBody: corporateReasonBody,
    spendingBody: corporateSpendingBody,
    updateBody: corporateClientBody.partial().passthrough(),
    withId: { params: idParams },
  },
  prepaymentsDashboard: {
    query: z
      .object({
        expiringDays: z.union([id, z.literal('')]).optional(),
        expiry: prepaymentsDashboardExpiryValue.optional(),
        limit: z.union([id, z.literal('')]).optional(),
        lowBalanceThreshold: optionalNonNegativeNumberValue,
        q: optionalString,
        query: optionalString,
        status: prepaymentsDashboardStatusValue.optional(),
        type: prepaymentsDashboardTypeValue.optional(),
      })
      .passthrough(),
  },
  managerControlDashboard: {
    query: managerControlDashboardQuery,
  },
  clients: {
    body: clientBody,
    listQuery: paginationQuery.merge(clientFilters),
    lookupQuery: z
      .object({
        excludeClientId: nullableId,
        includeArchived: optionalBoolValue,
        phone: requiredString,
      })
      .passthrough(),
    mergeBody: z
      .object({
        duplicateClientIds: z.array(id).min(1, 'Выберите дубликаты для объединения'),
      })
      .passthrough(),
    params: idParams,
    savedViewBody,
    savedViewUpdateBody,
    groupTrainingRecommendationBody,
    skillMapEntryParams: clientSkillMapEntryParams,
    skillMapParams: clientIdParams,
    skillMapUpdateBody: clientSkillMapUpdateBody,
    trainingRecommendationQuery,
    updateBody: clientUpdateBody,
    viewParams: viewIdParams,
  },
  finance: {
    dateRangeQuery,
    historyQuery: dateRangeQuery
      .extend({
        entityType: optionalString,
      })
      .passthrough(),
    manualBody: z
      .object({
        amount: nonNegativeNumberValue,
        category: nameString,
        comment: optionalString,
        date: dateOnly,
        type: z.enum(['income', 'expense']),
      })
      .passthrough(),
    payrollPeriodBody: z
      .object({
        from: dateOnly,
        note: optionalString,
        to: dateOnly,
      })
      .passthrough(),
    payrollStatusBody: z
      .object({
        note: optionalString,
        reason: optionalString,
        status: z.enum(['draft', 'reviewed', 'approved', 'paid']),
      })
      .passthrough(),
    recalculateBody: z.object({ reason: optionalString }).passthrough(),
    withId: { params: idParams },
  },
  motivation: {
    assignCategory: {
      body: z.object({ bonusRuleId: nullableId }).passthrough(),
      params: z.object({ categoryId: id }),
    },
    bonusRuleBody,
    currentSalesQuery: z.object({ includePaymentSummary: optionalBoolValue }).passthrough(),
    rule: {
      body: z.object({ value: nonNegativeNumberValue }).passthrough(),
      params: z.object({ key: requiredString }),
    },
    withId: { params: idParams },
  },
  methodology: {
    analyticsQuery: dateRangeQuery
      .extend({
        trainerAccountId: nullableId,
      })
      .passthrough(),
    exerciseBody: trainingMethodologyExerciseBody,
    exerciseListQuery: z
      .object({
        direction: trainingMethodologySkillDirection.optional(),
        eLevel: trainingMethodologyELevel.optional(),
        format: trainingMethodologyFormat.optional(),
        mainSkillId: nullableId,
        q: optionalString,
        skillId: nullableId,
        skillLevel: optionalTrainingMethodologySkillLevel,
        status: trainingMethodologyStatusQuery.optional(),
      })
      .passthrough(),
    exerciseUpdateBody: trainingMethodologyExerciseUpdateBody,
    skillBody: trainingMethodologySkillBody,
    skillListQuery: z
      .object({
        direction: trainingMethodologySkillDirection.optional(),
        q: optionalString,
        status: trainingMethodologySkillStatusQuery.optional(),
      })
      .passthrough(),
    skillUpdateBody: trainingMethodologySkillUpdateBody,
    withId: { params: idParams },
  },
  references: {
    body: z
      .object({
        name: nameString,
        sortOrder: optionalNumberValue,
        status: archiveStatus.optional(),
      })
      .passthrough(),
    listQuery: z.object({ status: z.enum(['active', 'archived', 'all']).optional() }).passthrough(),
    params: referenceParams,
    typeParams,
    updateBody: z
      .object({
        name: nameString.optional(),
        sortOrder: optionalNumberValue,
        status: archiveStatus.optional(),
      })
      .passthrough(),
  },
  shiftReports: {
    attachmentBody: shiftReportAttachmentBody,
    attachmentDeleteParams: z.object({
      answerId: id,
      attachmentId: z.string().trim().min(8).max(80),
      reportId: id,
    }),
    attachmentParams: z.object({
      answerId: id,
      reportId: id,
    }),
    reportListQuery: z
      .object({
        date: optionalDateOnly,
        from: optionalDateOnly,
        shiftId: nullableId,
        status: z.enum(['all', 'pending', 'draft', 'submitted', 'overdue']).optional(),
        templateId: nullableId,
        to: optionalDateOnly,
      })
      .passthrough(),
    reportSaveBody: shiftReportSaveBody,
    templateBody: shiftReportTemplateBody,
    templateItemBody: shiftReportTemplateItemBody,
    templateItemCreateParams: z.object({ templateId: id }),
    templateItemUpdateBody: shiftReportTemplateItemBody.partial().passthrough(),
    templateListQuery: z
      .object({
        status: z.enum(['active', 'archived', 'all']).optional(),
      })
      .passthrough(),
    templateUpdateBody: shiftReportTemplateBody.partial().passthrough(),
    withId: { params: idParams },
  },
  shiftCash: {
    attachmentBody: shiftReportAttachmentBody,
    attachmentParams: z.object({
      attachmentId: z.string().trim().min(8).max(80),
      expenseId: id,
    }),
    cancelBody: z
      .object({
        reason: z
          .string()
          .trim()
          .min(1, 'Причина отмены обязательна')
          .max(1000, 'Причина отмены слишком длинная'),
      })
      .passthrough(),
    closingBody: shiftCashBalanceBody,
    expenseBody: shiftCashExpenseBody,
    expenseParams: z.object({ expenseId: id }),
    openingBody: shiftCashBalanceBody,
    shiftParams: z.object({ shiftId: id }),
  },
  shifts: {
    body: z
      .object({
        adminName: optionalString,
        comment: optionalString,
        date: dateOnly,
        hours: positiveNumberValue,
        id: id.optional(),
        manualAdjustment: optionalNumberValue,
        staffId: nullableId,
        status: z.enum(['active', 'closed', 'draft', 'approved']).optional(),
      })
      .passthrough(),
    deleteBody: z.object({ id, reason: optionalString }).passthrough(),
    endBody: z.object({ cash: shiftCashBalanceBody }).passthrough(),
    updateBody: z
      .object({
        adminName: optionalString,
        comment: optionalString,
        date: dateOnly,
        hours: positiveNumberValue,
        id,
        manualAdjustment: optionalNumberValue,
        staffId: nullableId,
        status: z.enum(['active', 'closed', 'draft', 'approved']).optional(),
      })
      .passthrough(),
  },
  staff: {
    body: z
      .object({
        name: nameString,
        phone: optionalString,
        position: nameString.optional(),
        role: nameString.optional(),
        status: z.enum(['active', 'inactive', 'archived']).optional(),
      })
      .passthrough(),
    listQuery: z.object({ status: statusFilter.optional() }).passthrough(),
    params: idParams,
  },
  subscriptions: {
    clientListQuery: z
      .object({
        status: clientSubscriptionStatusValue.optional(),
      })
      .passthrough(),
    clientParams: clientIdParams,
    redemptionBody: subscriptionRedemptionBody,
    redemptionReverse: {
      body: subscriptionRedemptionReverseBody,
      params: redemptionIdParams,
    },
    typeBody: subscriptionTypeBody,
    typeListQuery: z
      .object({
        status: subscriptionTypeStatusValue.optional(),
      })
      .passthrough(),
    typeUpdateBody: subscriptionTypeBody.partial().passthrough(),
    withId: { params: idParams },
  },
  trainingNotes: {
    body: z
      .object({
        exercises: optionalString,
        exerciseResults: trainingNoteExerciseResults,
        level: z.enum(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A']),
        note: optionalString,
        trainedAt: dateOnly,
      })
      .passthrough(),
    clientParams: clientIdParams,
    noteParams: noteIdParams,
    updateBody: z
      .object({
        exercises: optionalString,
        exerciseResults: trainingNoteExerciseResults,
        level: z.enum(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A']).optional(),
        note: optionalString,
        trainedAt: dateOnly.optional(),
      })
      .passthrough(),
  },
  trainingPlans: {
    body: trainingPlanBody,
    completeBody: trainingPlanCompleteBody,
    exercisesBody: trainingPlanExercisesBody,
    listQuery: z
      .object({
        bookingId: nullableId,
        clientId: nullableId,
        from: optionalDateOnly,
        status: z.enum(['planned', 'completed', 'all']).optional(),
        to: optionalDateOnly,
      })
      .passthrough(),
    params: trainingPlanIdParams,
    quickCompleteBody: trainingPlanQuickCompleteBody,
  },
  utilization: {
    body: z.union([
      z
        .object({
          booked1: optionalNonNegativeNumberValue,
          booked2: optionalNonNegativeNumberValue,
          date: dateOnly,
          sessions1: optionalNonNegativeNumberValue,
          sessions2: optionalNonNegativeNumberValue,
        })
        .passthrough(),
      z.array(
        z
          .object({
            booked1: optionalNonNegativeNumberValue,
            booked2: optionalNonNegativeNumberValue,
            date: dateOnly,
            sessions1: optionalNonNegativeNumberValue,
            sessions2: optionalNonNegativeNumberValue,
          })
          .passthrough(),
      ),
    ]),
  },
  visitsAnalytics: {
    clientBaseCreateBody: z
      .object({
        description: optionalString,
        name: nameString,
        selection: visitsAnalyticsSegmentSelection,
      })
      .passthrough(),
    clientBasePreviewBody: visitsAnalyticsSegmentSelection,
    dateRangeQuery,
    filteredDateRangeQuery: dateRangeQuery.extend({
      sources: z.string().regex(/^(?:id:\d+|legacy:[A-Za-z0-9_-]+|unspecified)(?:,(?:id:\d+|legacy:[A-Za-z0-9_-]+|unspecified))*$/).optional(),
    }),
    sourceQualityQuery: dateRangeQuery.extend({
      sources: z.string().regex(/^(?:id:\d+|legacy:[A-Za-z0-9_-]+|unspecified)(?:,(?:id:\d+|legacy:[A-Za-z0-9_-]+|unspecified))*$/).optional(),
    }),
  },
};

module.exports = {
  apiSchemas,
};
