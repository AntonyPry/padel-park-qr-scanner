const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const db = require('../../models');
const {
  buildOnboardingResponse,
  cleanupTrainingData,
  getAvailableRoles,
  getTrainingMode,
  getTrainingDataMarker,
  getTrainingDataSummary,
  getOnboardingMetrics,
  matchesCheckpointConditions,
  recordClientEvent,
  recordEvent,
  resolveTargetRole,
  setTrainingMode,
} = require('../../src/services/onboarding.service');

const originalEventModel = db.OnboardingEvent;
const originalProgressModel = db.OnboardingProgress;
const originalTrainingModeModel = db.OnboardingTrainingMode;
const originalAccountModel = db.Account;
const originalSequelize = db.sequelize;
const originalBookingChangeLogModel = db.BookingChangeLog;
const originalVisitCategoryAssignmentModel = db.VisitCategoryAssignment;
const trainingModelNames = [
  'User',
  'Visit',
  'Booking',
  'BookingSeries',
  'Finance',
  'ClientBase',
  'CallTask',
  'CallTaskClient',
  'CallTaskAttempt',
  'TrainingNote',
];
const originalTrainingModels = new Map(
  trainingModelNames.map((name) => [name, db[name]]),
);

after(() => {
  db.OnboardingEvent = originalEventModel;
  db.OnboardingProgress = originalProgressModel;
  db.OnboardingTrainingMode = originalTrainingModeModel;
  db.Account = originalAccountModel;
  db.sequelize = originalSequelize;
  db.BookingChangeLog = originalBookingChangeLogModel;
  db.VisitCategoryAssignment = originalVisitCategoryAssignmentModel;
  for (const [name, model] of originalTrainingModels) {
    db[name] = model;
  }
});

test('owner can choose any onboarding role', () => {
  const actor = { id: 1, role: 'owner' };

  assert.equal(resolveTargetRole(actor, 'admin'), 'admin');
  assert.equal(resolveTargetRole(actor, 'trainer'), 'trainer');
  assert.equal(getAvailableRoles(actor).length, 6);
});

test('non-owner can only pass own onboarding role', () => {
  const actor = { id: 2, role: 'admin' };

  assert.equal(resolveTargetRole(actor), 'admin');
  assert.throws(
    () => resolveTargetRole(actor, 'manager'),
    /Проходить обучение за другую роль/,
  );
  assert.deepEqual(
    getAvailableRoles(actor).map((role) => role.value),
    ['admin'],
  );
});

test('onboarding response decorates progress and calculates next task', () => {
  const response = buildOnboardingResponse(
    { id: 1, role: 'owner' },
    'admin',
    [
      {
        completedAt: new Date('2026-05-31T10:00:00.000Z'),
        status: 'completed',
        taskKey: 'admin.access.create-visit',
      },
    ],
  );

  assert.equal(response.selectedRole, 'admin');
  assert.equal(response.summary.completedTasks, 1);
  assert.equal(response.summary.totalTasks > 1, true);
  assert.equal(response.summary.completedTaskKeys[0], 'admin.access.create-visit');
  assert.equal(response.summary.nextTaskKey, 'admin.client.create');
  assert.deepEqual(
    response.summary.skills.find((skill) => skill.name === 'Входы'),
    {
      completedTasks: 1,
      earnedXp: 30,
      name: 'Входы',
      percent: 100,
      totalTasks: 1,
      totalXp: 30,
    },
  );
  assert.equal(response.path.missions[0].tasks[0].progress.isCompleted, true);
  assert.equal(response.path.missions[0].tasks[0].badge, 'Монитор входов');
  assert.equal(response.path.missions[0].tasks[1].progress.isNext, true);
});

test('training mode persists account role and can be disabled', async () => {
  const rows = new Map();
  db.OnboardingTrainingMode = {
    async create(payload) {
      const row = {
        ...payload,
        async update(nextPayload) {
          Object.assign(row, nextPayload);
          return row;
        },
      };
      rows.set(payload.accountId, row);
      return row;
    },
    async findOne({ where }) {
      return rows.get(where.accountId) || null;
    },
  };

  const actor = { id: 10, role: 'owner' };
  const enabled = await setTrainingMode(actor, {
    isEnabled: true,
    role: 'admin',
  });
  const current = await getTrainingMode(actor);

  assert.equal(enabled.isEnabled, true);
  assert.equal(enabled.role, 'admin');
  assert.equal(Boolean(enabled.enabledAt), true);
  assert.deepEqual(current, enabled);

  const disabled = await setTrainingMode(actor, {
    isEnabled: false,
    role: 'admin',
  });

  assert.equal(disabled.isEnabled, false);
  assert.equal(disabled.role, 'admin');
  assert.equal(Boolean(disabled.disabledAt), true);
});

test('training data marker mirrors the active training role', async () => {
  db.OnboardingTrainingMode = {
    async findOne() {
      return { isEnabled: true, role: 'trainer' };
    },
  };

  const marker = await getTrainingDataMarker({ id: 10, role: 'owner' });

  assert.deepEqual(marker, {
    isTraining: true,
    trainingAccountId: 10,
    trainingRole: 'trainer',
  });
});

test('owner can inspect training data summary by role', async () => {
  const seen = [];
  for (const name of trainingModelNames) {
    db[name] = {
      async count({ where }) {
        seen.push({ name, where });
        return name === 'User' ? 2 : 0;
      },
    };
  }
  db.OnboardingEvent = {
    async count({ where }) {
      seen.push({ name: 'OnboardingEvent', where });
      return 1;
    },
  };

  const summary = await getTrainingDataSummary(
    { id: 1, role: 'owner' },
    { role: 'admin' },
  );

  assert.equal(summary.role, 'admin');
  assert.equal(summary.totalRecords, 3);
  assert.equal(summary.hasRecords, true);
  assert.equal(
    summary.entities.find((entity) => entity.key === 'clients').count,
    2,
  );
  assert.deepEqual(
    seen.find((item) => item.name === 'User').where,
    { isTraining: true, trainingRole: 'admin' },
  );
  assert.deepEqual(
    seen.find((item) => item.name === 'OnboardingEvent').where,
    { isTraining: true, role: 'admin' },
  );
});

test('non-owner cannot inspect training data summary', async () => {
  await assert.rejects(
    () => getTrainingDataSummary({ id: 2, role: 'manager' }),
    /Учебными данными может управлять только владелец/,
  );
});

test('owner can inspect onboarding completion metrics by role', async () => {
  db.Account = {
    async findAll({ where }) {
      assert.deepEqual(where, { status: 'active' });
      return [
        { id: 1, role: 'admin', status: 'active' },
        { id: 2, role: 'admin', status: 'active' },
        { id: 3, role: 'trainer', status: 'active' },
        { id: 4, role: 'owner', status: 'active' },
      ];
    },
  };
  db.OnboardingProgress = {
    async findAll({ where }) {
      assert.deepEqual(where, { status: 'completed' });
      return [
        {
          accountId: 1,
          completedAt: '2026-05-31T08:00:00.000Z',
          role: 'admin',
          status: 'completed',
          taskKey: 'admin.access.create-visit',
        },
        {
          accountId: 1,
          completedAt: '2026-05-31T09:00:00.000Z',
          role: 'admin',
          status: 'completed',
          taskKey: 'admin.client.create',
        },
        {
          accountId: 2,
          completedAt: '2026-05-31T10:00:00.000Z',
          role: 'admin',
          status: 'completed',
          taskKey: 'admin.access.create-visit',
        },
        {
          accountId: 3,
          completedAt: '2026-05-31T11:00:00.000Z',
          role: 'trainer',
          status: 'completed',
          taskKey: 'trainer.client.open-card',
        },
        {
          accountId: 1,
          completedAt: '2026-05-31T12:00:00.000Z',
          role: 'admin',
          status: 'completed',
          taskKey: 'admin.unknown-task',
        },
      ];
    },
  };

  const metrics = await getOnboardingMetrics({ id: 4, role: 'owner' });
  const admin = metrics.roles.find((role) => role.role === 'admin');
  const trainer = metrics.roles.find((role) => role.role === 'trainer');

  assert.equal(metrics.summary.activeAccounts, 4);
  assert.equal(metrics.summary.roles, 6);
  assert.equal(admin.totalAccounts, 2);
  assert.equal(admin.taskCount, 8);
  assert.equal(admin.completedTaskSlots, 3);
  assert.equal(admin.totalTaskSlots, 16);
  assert.equal(admin.percent, 19);
  assert.equal(admin.startedAccounts, 2);
  assert.equal(admin.completedAccounts, 0);
  assert.equal(admin.lastCompletedAt, '2026-05-31T10:00:00.000Z');
  assert.deepEqual(
    admin.tasks.find((task) => task.key === 'admin.access.create-visit'),
    {
      completedAccounts: 2,
      key: 'admin.access.create-visit',
      percent: 100,
      title: 'Создать вход гостя вручную',
    },
  );
  assert.equal(trainer.totalAccounts, 1);
  assert.equal(trainer.completedTaskSlots, 1);
  assert.equal(trainer.percent, 25);
});

test('non-owner cannot inspect onboarding metrics', async () => {
  await assert.rejects(
    () => getOnboardingMetrics({ id: 2, role: 'manager' }),
    /Метрики обучения доступны только владельцу/,
  );
});

test('recordClientEvent completes matching review task from a safe client event', async () => {
  const progressRows = new Map();
  db.OnboardingTrainingMode = {
    async findOne() {
      return null;
    },
  };
  db.OnboardingProgress = {
    async create(payload) {
      progressRows.set(payload.taskKey, payload);
      return payload;
    },
    async findOne({ where }) {
      return progressRows.get(where.taskKey) || null;
    },
  };
  db.OnboardingEvent = {
    async create(payload) {
      return payload;
    },
  };

  const result = await recordClientEvent(
    { id: 20, role: 'manager' },
    {
      entityId: '/admin/visits-analytics',
      entityType: 'route',
      eventKey: 'report.viewed',
      payload: { report: 'visits_analytics', route: '/admin/visits-analytics' },
    },
  );

  assert.deepEqual(result.completedTaskKeys, ['manager.visits-analytics.review']);
  assert.equal(result.role, 'manager');
  assert.equal(result.event.eventKey, 'report.viewed');
  assert.equal(result.event.payload.source, 'client');
  assert.equal(
    progressRows.get('manager.visits-analytics.review').metadata.source,
    'event',
  );
});

test('recordClientEvent rejects action events from the browser', async () => {
  await assert.rejects(
    () =>
      recordClientEvent(
        { id: 20, role: 'manager' },
        {
          eventKey: 'booking.created',
          payload: { source: 'phone' },
        },
      ),
    /нельзя записывать из клиента/,
  );
});

test('owner cleanup removes dependent training data without touching progress', async () => {
  const transaction = { id: 'training-cleanup' };
  const operations = [];
  const opIn = db.Sequelize.Op.in;

  db.sequelize = {
    async transaction(callback) {
      return callback(transaction);
    },
  };
  db.OnboardingProgress = {
    async destroy() {
      throw new Error('progress should not be cleaned with training data');
    },
  };
  db.BookingChangeLog = {
    async destroy({ transaction: currentTransaction, where }) {
      operations.push({
        action: 'destroy',
        model: 'BookingChangeLog',
        transaction: currentTransaction,
        where,
      });
      return 2;
    },
  };
  db.VisitCategoryAssignment = {
    async destroy({ transaction: currentTransaction, where }) {
      operations.push({
        action: 'destroy',
        model: 'VisitCategoryAssignment',
        transaction: currentTransaction,
        where,
      });
      return 1;
    },
  };

  for (const name of trainingModelNames) {
    db[name] = {
      async count({ where }) {
        operations.push({ action: 'count', model: name, where });
        return 0;
      },
      async destroy({ transaction: currentTransaction, where }) {
        operations.push({
          action: 'destroy',
          model: name,
          transaction: currentTransaction,
          where,
        });
        return name === 'User' ? 3 : 1;
      },
      async findAll({ transaction: currentTransaction, where }) {
        operations.push({
          action: 'findAll',
          model: name,
          transaction: currentTransaction,
          where,
        });

        if (name === 'Booking') return [{ id: 10 }, { id: '11' }];
        if (name === 'Visit') return [{ id: 20 }];
        return [];
      },
    };
  }

  db.OnboardingEvent = {
    async count({ where }) {
      operations.push({ action: 'count', model: 'OnboardingEvent', where });
      return 0;
    },
    async destroy({ transaction: currentTransaction, where }) {
      operations.push({
        action: 'destroy',
        model: 'OnboardingEvent',
        transaction: currentTransaction,
        where,
      });
      return 4;
    },
  };

  const result = await cleanupTrainingData(
    { id: 1, role: 'owner' },
    { role: 'admin' },
  );

  assert.equal(result.role, 'admin');
  assert.equal(result.deleted.bookingChangeLogs, 2);
  assert.equal(result.deleted.visitCategoryAssignments, 1);
  assert.equal(result.deleted.onboardingEvents, 4);
  assert.equal(result.deleted.clients, 3);
  assert.equal(result.remaining.totalRecords, 0);

  assert.deepEqual(
    operations.find(
      (item) => item.model === 'Booking' && item.action === 'findAll',
    ).where,
    { isTraining: true, trainingRole: 'admin' },
  );
  assert.deepEqual(
    operations.find((item) => item.model === 'BookingChangeLog').where,
    { bookingId: { [opIn]: [10, 11] } },
  );
  assert.deepEqual(
    operations.find((item) => item.model === 'VisitCategoryAssignment').where,
    { visitId: { [opIn]: [20] } },
  );
  assert.deepEqual(
    operations.find(
      (item) => item.model === 'OnboardingEvent' && item.action === 'destroy',
    ).where,
    { isTraining: true, role: 'admin' },
  );
  assert.deepEqual(
    operations.find((item) => item.model === 'User' && item.action === 'destroy').where,
    { isTraining: true, trainingRole: 'admin' },
  );
  assert.deepEqual(
    operations
      .filter(
        (item) =>
          item.action === 'destroy' &&
          !['BookingChangeLog', 'VisitCategoryAssignment'].includes(item.model),
      )
      .map((item) => item.model),
    [
      'OnboardingEvent',
      'CallTaskAttempt',
      'CallTaskClient',
      'CallTask',
      'ClientBase',
      'TrainingNote',
      'Booking',
      'BookingSeries',
      'Finance',
      'Visit',
      'User',
    ],
  );
});

test('checkpoint conditions support exact nested payload matches', () => {
  assert.equal(
    matchesCheckpointConditions(
      { conditions: { source: 'phone', 'client.segment': 'new' } },
      { source: 'phone', client: { segment: 'new' } },
    ),
    true,
  );
  assert.equal(
    matchesCheckpointConditions(
      { conditions: { source: 'phone' } },
      { source: 'walk_in' },
    ),
    false,
  );
});

test('recordEvent stores event and completes matching tasks for training role', async () => {
  const progressRows = new Map();
  db.OnboardingTrainingMode = {
    async findOne() {
      return { isEnabled: true, role: 'admin' };
    },
  };
  db.OnboardingProgress = {
    async create(payload) {
      progressRows.set(payload.taskKey, payload);
      return payload;
    },
    async findOne({ where }) {
      return progressRows.get(where.taskKey) || null;
    },
  };
  db.OnboardingEvent = {
    async create(payload) {
      return payload;
    },
  };

  const result = await recordEvent(
    { id: 10, role: 'owner' },
    'booking.created',
    {
      entityId: 42,
      entityType: 'booking',
      payload: { id: 42, source: 'phone' },
    },
  );

  assert.deepEqual(result.completedTaskKeys, ['admin.booking.create-phone']);
  assert.equal(result.role, 'admin');
  assert.equal(progressRows.get('admin.booking.create-phone').status, 'completed');
  assert.equal(
    progressRows.get('admin.booking.create-phone').metadata.checkpointEvent,
    'booking.created',
  );
  assert.equal(result.event.isTraining, true);
});
