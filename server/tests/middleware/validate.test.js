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

test('accepts booking payload used by the phone booking page', () => {
  const { nextCalled, res } = runValidation(
    { body: apiSchemas.bookings.body },
    {
      body: {
        courtId: 1,
        durationMinutes: 90,
        paymentMethod: 'cashless',
        paymentStatus: 'partial',
        price: 4500,
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
