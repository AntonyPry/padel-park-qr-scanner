const { z } = require('zod');
const { ACCOUNT_ROLE_VALUES } = require('../constants/account-roles');
const { PNL_GROUP_VALUES } = require('../constants/catalog');
const {
  ONBOARDING_CLIENT_CHECKPOINT_EVENTS,
} = require('../onboarding/catalog');

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
const dateTime = z.union([
  z.string().trim().datetime({ offset: true }),
  z.string().trim().refine((value: string) => !Number.isNaN(new Date(value).getTime()), {
    message: 'Дата и время указаны некорректно',
  }),
  z.date(),
]);
const optionalDateTime = z.union([dateTime, z.literal(''), z.null()]).optional();
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
const boolValue = z.union([z.boolean(), z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')]);
const optionalBoolValue = boolValue.optional();
const statusFilter = z.enum(['active', 'archived', 'inactive', 'all']);
const archiveStatus = z.enum(['active', 'archived']);
const requiredString = z.string().trim().min(1, 'Поле обязательно');
const nameString = z.string().trim().min(2, 'Минимум 2 символа').max(160, 'Слишком длинное значение');
const optionalString = z.union([z.string().trim(), z.literal(''), z.null()]).optional();
const jsonObject = z.record(z.string(), z.unknown());
const optionalJsonObject = z.union([jsonObject, z.null()]).optional();
const accountRoleValue = z.enum(ACCOUNT_ROLE_VALUES);
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
const viewIdParams = z.object({ viewId: id });
const clientIdParams = z.object({ clientId: id });
const noteIdParams = z.object({ noteId: id });
const baseIdParams = z.object({ baseId: id });
const taskClientIdParams = z.object({ taskClientId: id });
const typeParams = z.object({
  type: z.enum(['client-sources', 'visit-categories']),
});
const referenceParams = z.object({
  id,
  type: z.enum(['client-sources', 'visit-categories']),
});
const dateRangeQuery = z
  .object({
    from: optionalDateOnly,
    to: optionalDateOnly,
  })
  .passthrough();

const clientFilters = z
  .object({
    duplicateOnly: optionalBoolValue,
    includeMerged: optionalBoolValue,
    lastVisitDaysFrom: optionalNonNegativeNumberValue,
    lastVisitDaysTo: optionalNonNegativeNumberValue,
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
    visitCountMax: optionalNonNegativeNumberValue,
    visitCountMin: optionalNonNegativeNumberValue,
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
    dueAt: optionalDateTime,
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

const apiSchemas = {
  access: {
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
    ruleBody: z
      .object({
        category: nameString,
        itemName: nameString,
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
  trainingNotes: {
    body: z
      .object({
        exercises: optionalString,
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
        level: z.enum(['D', 'D+', 'C', 'C+', 'B', 'B+', 'A']).optional(),
        note: optionalString,
        trainedAt: dateOnly.optional(),
      })
      .passthrough(),
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
    dateRangeQuery,
  },
};

module.exports = {
  apiSchemas,
};
