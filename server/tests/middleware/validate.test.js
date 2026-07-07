const assert = require('node:assert/strict');
const test = require('node:test');
const { validate } = require('../../src/middleware/validate');
const { apiSchemas } = require('../../src/contracts/api-schemas');

function createResponse() {
  return {
    body: null,
    statusCode: null,
    json(payload) {
      this.body = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}

function runValidation(schemas, req) {
  const res = createResponse();
  let nextCalled = false;
  validate(schemas)(req, res, () => {
    nextCalled = true;
  });

  return { nextCalled, res };
}

test('returns normalized validation error for invalid params', () => {
  const { nextCalled, res } = runValidation({ params: apiSchemas.clients.params }, {
    body: {},
    params: { id: 'abc' },
    query: {},
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
  assert.equal(res.body.status, 400);
  assert.equal(res.body.details[0].path, 'id');
});

test('passes valid payloads and preserves query strings used by controllers', () => {
  const req = {
    body: {},
    params: {},
    query: {
      includeArchived: 'true',
      phone: '+7 (901) 300-10-01',
    },
  };
  const { nextCalled, res } = runValidation(
    { query: apiSchemas.clients.lookupQuery },
    req,
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.query.includeArchived, 'true');
});

test('accepts whitespace clients list numeric query values as empty', () => {
  const req = {
    body: {},
    params: {},
    query: {
      lastVisitDaysFrom: '   ',
      lastVisitDaysTo: '   ',
      page: '1',
      pageSize: '10',
      segment: 'all',
      status: 'active',
      visitCountMax: '   ',
      visitCountMin: '   ',
    },
  };
  const { nextCalled, res } = runValidation(
    { query: apiSchemas.clients.listQuery },
    req,
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.query.visitCountMax, '');
  assert.equal(req.query.visitCountMin, '');
  assert.equal(req.query.lastVisitDaysFrom, '');
  assert.equal(req.query.lastVisitDaysTo, '');
});

test('accepts explicit zero clients list numeric query values', () => {
  const req = {
    body: {},
    params: {},
    query: {
      lastVisitDaysFrom: '0',
      lastVisitDaysTo: '0',
      page: '1',
      pageSize: '10',
      segment: 'all',
      status: 'active',
      visitCountMax: '0',
      visitCountMin: '0',
    },
  };
  const { nextCalled, res } = runValidation(
    { query: apiSchemas.clients.listQuery },
    req,
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.query.visitCountMax, '0');
  assert.equal(req.query.visitCountMin, '0');
  assert.equal(req.query.lastVisitDaysFrom, '0');
  assert.equal(req.query.lastVisitDaysTo, '0');
});

test('rejects incomplete client create payload before controller logic', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.clients.body },
    {
      body: { name: 'А' },
      params: {},
      query: {},
    },
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.details.some((detail) => detail.path === 'phone'), true);
});

test('accepts real payroll reviewed transition status', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.finance.payrollStatusBody },
    {
      body: { status: 'reviewed' },
      params: {},
      query: {},
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('accepts manual shift payload used by staff page', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.shifts.body },
    {
      body: {
        adminName: 'Администратор',
        comment: '',
        date: '2026-05-24',
        hours: 12,
        manualAdjustment: -500,
        staffId: 1,
      },
      params: {},
      query: {},
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('accepts shift report template and answer payloads', () => {
  const templateResult = runValidation(
    { body: apiSchemas.shiftReports.templateBody },
    {
      body: {
        description: '',
        gracePeriodMinutes: '15',
        name: 'Утренний отчет',
        scheduleConfig: { times: ['09:00', '13:30'] },
        scheduleType: 'daily_times',
        status: 'active',
      },
      params: {},
      query: {},
    },
  );
  assert.equal(templateResult.nextCalled, true);
  assert.equal(templateResult.res.statusCode, null);

  const itemResult = runValidation(
    { body: apiSchemas.shiftReports.templateItemBody },
    {
      body: {
        itemType: 'checkbox',
        label: 'Проверить ресепшн',
        photoRequired: true,
      },
      params: {},
      query: {},
    },
  );
  assert.equal(itemResult.nextCalled, true);
  assert.equal(itemResult.res.statusCode, null);

  const answerResult = runValidation(
    { body: apiSchemas.shiftReports.reportSaveBody },
    {
      body: {
        comment: 'Комментарий по отчету',
        answers: [
          {
            booleanValue: true,
            id: 1,
          },
        ],
      },
      params: {},
      query: {},
    },
  );
  assert.equal(answerResult.nextCalled, true);
  assert.equal(answerResult.res.statusCode, null);
});

test('rejects invalid shift report attachment mime type', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.shiftReports.attachmentBody },
    {
      body: {
        data: 'data:image/svg+xml;base64,PHN2Zy8+',
        fileName: 'bad.svg',
        mimeType: 'image/svg+xml',
      },
      params: {},
      query: {},
    },
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
});

test('accepts scanner diagnostic statuses from the browser scanner', () => {
  const { nextCalled, res } = runValidation(apiSchemas.access.scannerEvent, {
    body: {
      eventType: 'scanner_status',
      severity: 'warning',
      status: 'retry_scheduled',
    },
    params: {},
    query: {},
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('accepts catalog P&L groups used by the catalog page', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.catalog.categoryBody },
    {
      body: {
        commissionPercent: 0,
        group: 'OPEX',
        name: 'Расходы тест',
        parentId: '',
      },
      params: {},
      query: {},
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('requires corporate deposit category in create mode', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.corporateClients.depositBody },
    {
      body: {
        amount: 15000,
        date: '2026-06-20',
      },
      params: {},
      query: {},
    },
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Выберите категорию дохода');
  assert.equal(
    res.body.details.some(
      (detail) =>
        detail.path === 'category' &&
        detail.message === 'Выберите категорию дохода',
    ),
    true,
  );
});

test('accepts corporate deposit create mode with category', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.corporateClients.depositBody },
    {
      body: {
        amount: 15000,
        category: 'Корпоративные пополнения',
        date: '2026-06-20',
      },
      params: {},
      query: {},
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('accepts corporate deposit link mode without category', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.corporateClients.depositBody },
    {
      body: {
        financeId: 88,
      },
      params: {},
      query: {},
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('accepts booking payload used by the phone booking page', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.bookings.body },
    {
      body: {
        bookingType: 'personal_training',
        courtId: 1,
        durationMinutes: 90,
        paymentMethod: 'cashless',
        paymentStatus: 'partial',
        price: 4500,
        responsibleStaffId: 1,
        source: 'phone',
        startsAt: '2026-05-26T10:00:00.000Z',
        status: 'confirmed',
        userId: 1,
      },
      params: {},
      query: {},
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('accepts booking resource payload for custom calendar columns', () => {
  const middleware = validate({ body: apiSchemas.bookings.resourceBody });
  const req = {
    body: {
      isActive: true,
      name: 'Теннисный стол',
      sortOrder: 70,
      type: 'other',
    },
  };
  const res = createResponse();
  let nextCalled = false;

  middleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('rejects operational statuses for future booking series', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.bookings.seriesBody },
    {
      body: {
        courtId: 1,
        durationMinutes: 60,
        endsOn: '2026-06-30',
        name: 'Постоянка тест',
        startTime: '10:00',
        startsOn: '2026-06-01',
        status: 'arrived',
        userId: 1,
        weekday: 1,
      },
      params: {},
      query: {},
    },
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
});

test('accepts onboarding owner role override payloads', () => {
  const { nextCalled, res } = runValidation(
    {
      body: apiSchemas.onboarding.completeBody,
      params: apiSchemas.onboarding.taskParams,
    },
    {
      body: {
        metadata: { source: 'manual' },
        role: 'trainer',
      },
      params: { taskKey: 'trainer.training-note.create' },
      query: {},
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('accepts onboarding training mode settings', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.onboarding.trainingModeBody },
    {
      body: {
        isEnabled: true,
        metadata: { source: 'onboarding-page' },
        role: 'admin',
      },
      params: {},
      query: {},
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('accepts safe onboarding client checkpoint events', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.onboarding.eventBody },
    {
      body: {
        entityId: '/admin/visits-analytics',
        entityType: 'route',
        eventKey: 'report.viewed',
        payload: { report: 'visits_analytics' },
      },
      params: {},
      query: {},
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('accepts manager control route-view onboarding event', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.onboarding.eventBody },
    {
      body: {
        entityId: '/admin/manager-control',
        entityType: 'route',
        eventKey: 'manager_control.viewed',
        payload: {
          route: '/admin/manager-control',
          taskKey: 'manager.manager-control.daily-review',
        },
      },
      params: {},
      query: {},
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('rejects action onboarding events from client payloads', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.onboarding.eventBody },
    {
      body: {
        eventKey: 'booking.created',
        payload: { source: 'phone' },
      },
      params: {},
      query: {},
    },
  );

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 400);
});

test('accepts transcription job queue filters', () => {
  const { nextCalled, res } = runValidation(
    { query: apiSchemas.telephony.transcriptionJobsQuery },
    {
      body: {},
      params: {},
      query: {
        callId: '42',
        page: '1',
        pageSize: '20',
        status: 'processing',
      },
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('accepts transcription result segments with channel contract fields', () => {
  const { nextCalled, res } = runValidation(
    apiSchemas.telephony.transcriptionResult,
    {
      body: {
        corrections: [
          {
            original: 'подал теннис',
            normalized: 'падел-теннис',
            rule: 'padel_tennis_alias',
          },
        ],
        language: 'ru',
        rawAsrJson: { channels: [{ channel: 'right' }] },
        rawTranscriptText: 'Клиент: Хочу записаться на игру.',
        segments: [
          {
            channel: 'right',
            confidence: 0.87,
            endMs: 4200,
            speaker: 'client',
            startMs: 1200,
            text: 'Хочу записаться на игру.',
          },
        ],
        transcriptText: 'Хочу записаться на игру.',
      },
      params: { id: '12' },
      query: {},
    },
  );

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});
