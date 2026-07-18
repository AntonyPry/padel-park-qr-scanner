const assert = require('node:assert/strict');
const test = require('node:test');
const clientsController = require('../../src/controllers/clients.controller');
const clientsService = require('../../src/services/clients.service');
const {
  ONBOARDING_PROGRESSED_TASKS_HEADER,
} = require('../../src/middleware/onboarding-quest');

test('client create response returns confirmed exact onboarding progress without changing body contract', async () => {
  const originalCreateClientWithEventResult =
    clientsService.createClientWithEventResult;
  const calls = [];
  clientsService.createClientWithEventResult = async (...args) => {
    calls.push(args);
    return {
      onboardingEventResult: {
        completedTaskKeys: [],
        progressedTaskKeys: ['admin.client.create'],
      },
      result: { client: { id: 42, name: 'Тестовый клиент' } },
    };
  };
  const headers = new Map();
  let body;
  let statusCode;
  const res = {
    json(value) {
      body = value;
      return this;
    },
    set(name, value) {
      headers.set(name, value);
      return this;
    },
    status(value) {
      statusCode = value;
      return this;
    },
  };

  try {
    await clientsController.create(
      {
        account: { id: 10, role: 'admin' },
        body: { name: 'Тестовый клиент', phone: '+79990000000' },
        onboardingQuest: {
          role: 'admin',
          taskKey: 'admin.client.create',
        },
        tenant: { clubId: 20, organizationId: 30 },
      },
      res,
    );
  } finally {
    clientsService.createClientWithEventResult =
      originalCreateClientWithEventResult;
  }

  assert.equal(statusCode, 201);
  assert.deepEqual(body, { client: { id: 42, name: 'Тестовый клиент' } });
  assert.equal(
    headers.get(ONBOARDING_PROGRESSED_TASKS_HEADER),
    'admin.client.create',
  );
  assert.deepEqual(calls[0][2], {
    onboardingContext: {
      role: 'admin',
      taskKey: 'admin.client.create',
    },
    tenant: { clubId: 20, organizationId: 30 },
  });
});
