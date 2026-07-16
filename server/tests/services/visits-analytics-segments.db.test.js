const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../../models');
const analyticsService = require('../../src/services/visits-analytics.service');
const clientBasesService = require('../../src/services/client-bases.service');
const callTasksService = require('../../src/services/call-tasks.service');
const clientBasesController = require('../../src/controllers/client-bases.controller');
const { getDefaultOrganizationId } = require('../helpers/tenant-fixtures');

function createApiResponse() {
  return {
    body: null,
    statusCode: 200,
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

test('DB-backed analytics → preview → client base → call task keeps count parity and canonical membership', async () => {
  await db.sequelize.authenticate();
  const organizationId = await getDefaultOrganizationId(db);
  const suffix = `${Date.now()}`;
  const users = [];
  let source;
  let actor;
  let base;
  let task;
  try {
    source = await db.ClientSource.create({ organizationId, name: `Segment source ${suffix}`, status: 'active' });
    actor = await db.Account.create({
      email: `visits-segment-${suffix}@example.test`,
      passwordHash: 'not-used-in-test',
      role: 'owner',
      status: 'active',
    });
    const makeUser = async (name, extra = {}) => {
      const user = await db.User.create({
        organizationId,
        name: `${name}-${suffix}`,
        phone: `79${suffix}${users.length}`.slice(-15),
        source: 'Legacy segment source',
        sourceId: source.id,
        ...extra,
      });
      users.push(user);
      return user;
    };

    const root = await makeUser('root');
    const middle = await makeUser('middle', { status: 'archived', mergedIntoUserId: root.id });
    const leaf = await makeUser('leaf', { status: 'archived', mergedIntoUserId: middle.id });
    const active = await makeUser('active');
    const archived = await makeUser('archived', { status: 'archived' });
    const training = await makeUser('training', { isTraining: true });
    const cycleA = await makeUser('cycle-a');
    const cycleB = await makeUser('cycle-b');
    await cycleA.update({ mergedIntoUserId: cycleB.id });
    await cycleB.update({ mergedIntoUserId: cycleA.id });

    const firstRootVisit = await db.Visit.create({ userId: leaf.id, scannedAt: '2091-01-05T10:00:00Z' });
    await db.Visit.bulkCreate([
      { userId: middle.id, scannedAt: '2091-02-10T10:00:00Z' },
      { userId: root.id, scannedAt: '2091-03-10T10:00:00Z' },
      { userId: active.id, scannedAt: '2091-01-12T10:00:00Z' },
      { userId: archived.id, scannedAt: '2091-01-13T10:00:00Z' },
      { userId: training.id, scannedAt: '2091-01-14T10:00:00Z', isTraining: true },
      { userId: cycleA.id, scannedAt: '2091-01-15T10:00:00Z' },
      { userId: cycleB.id, scannedAt: '2091-02-15T10:00:00Z' },
      { userId: root.id, scannedAt: '2091-03-10T10:01:00Z', duplicateOfVisitId: firstRootVisit.id },
    ]);

    const sourceQuality = await analyticsService.getSourceQuality('2091-01-01', '2091-01-31', {
      now: '2091-04-30T20:59:59Z',
      sourceKeys: [`id:${source.id}`],
    });
    const sourceRow = sourceQuality.sources[0];
    assert.equal(sourceRow.newClients, 4);
    assert.equal(sourceRow.actionableCount, 3);

    const preview = await analyticsService.previewVisitAnalyticsSegment({
      asOf: '2091-04-30',
      from: '2091-01-01',
      kind: 'source',
      sourceKeys: [sourceRow.sourceKey],
      to: '2091-01-31',
    });
    assert.equal(preview.count, sourceRow.actionableCount);
    assert.equal(preview.count, 3);

    const cohortAnalytics = await analyticsService.getCohortsLifecycle(
      '2091-01-01',
      '2091-01-31',
      { sourceKeys: [sourceRow.sourceKey] },
    );
    const januaryCohort = cohortAnalytics.cohorts.find((item) => item.cohortMonth === '2091-01');
    assert.equal(januaryCohort.actionableCount, 3);
    const cohortPreview = await analyticsService.previewVisitAnalyticsSegment({
      asOf: cohortAnalytics.asOf,
      cohortMonth: '2091-01',
      from: '2091-01-01',
      kind: 'cohort',
      sourceKeys: [sourceRow.sourceKey],
      to: '2091-01-31',
    });
    assert.equal(cohortPreview.count, januaryCohort.actionableCount);

    const lifecycleAnalytics = await analyticsService.getCohortsLifecycle(
      '2091-01-01',
      '2091-04-30',
      { sourceKeys: [sourceRow.sourceKey] },
    );
    const lifecycleStatus = lifecycleAnalytics.lifecycle.statuses.find((item) => item.actionableCount > 0);
    const lifecyclePreview = await analyticsService.previewVisitAnalyticsSegment({
      asOf: lifecycleAnalytics.asOf,
      from: '2091-01-01',
      kind: 'lifecycle',
      lifecycleStatus: lifecycleStatus.key,
      sourceKeys: [sourceRow.sourceKey],
      to: '2091-04-30',
    });
    assert.equal(lifecyclePreview.count, lifecycleStatus.actionableCount);

    const filtersPreview = await analyticsService.previewVisitAnalyticsSegment({
      asOf: lifecycleAnalytics.asOf,
      from: '2091-01-01',
      kind: 'filters',
      sourceKeys: [sourceRow.sourceKey],
      to: '2091-04-30',
    });
    assert.equal(filtersPreview.count, lifecycleAnalytics.lifecycle.actionableTotal);

    const resolved = await analyticsService.listVisitAnalyticsSegmentClients(
      preview.filters.visitsAnalytics,
      { limit: 20 },
    );
    assert.equal(resolved.total, preview.count);
    assert.equal(new Set(resolved.items.map((item) => Number(item.id))).size, preview.count);
    assert.equal(resolved.items.some((item) => Number(item.id) === leaf.id), false);
    assert.equal(resolved.items.some((item) => Number(item.id) === middle.id), false);
    assert.equal(resolved.items.some((item) => Number(item.id) === root.id), true);
    assert.equal(resolved.items.some((item) => Number(item.id) === archived.id), false);
    assert.equal(resolved.items.some((item) => Number(item.id) === training.id), false);
    assert.equal(resolved.items.find((item) => Number(item.id) === root.id).stats.visitCount, 3);

    await assert.rejects(
      () => clientBasesService.create(actor, {
        filters: preview.filters,
        name: preview.name,
        origin: preview.origin,
        status: 'active',
      }),
      (error) => error.statusCode === 400 && /только через аналитический сценарий/.test(error.message),
    );
    const spoofedCreateResponse = createApiResponse();
    await clientBasesController.create({
      account: actor,
      body: {
        filters: preview.filters,
        name: preview.name,
        origin: preview.origin,
        originMetadata: { algorithmVersion: 'spoofed-version' },
      },
    }, spoofedCreateResponse);
    assert.equal(spoofedCreateResponse.statusCode, 400);
    assert.match(spoofedCreateResponse.body.error, /только через аналитический сценарий/);
    await assert.rejects(
      () => clientBasesService.create(actor, {
        filters: preview.filters,
        name: preview.name,
        origin: preview.origin,
        originMetadata: {
          ...preview.originMetadata,
          algorithmVersion: 'spoofed-version',
          sourceFilters: { keys: ['id:999999999'], labels: ['Spoofed'] },
        },
        status: 'active',
      }),
      (error) => error.statusCode === 400 && /только через аналитический сценарий/.test(error.message),
    );

    const selection = {
      asOf: '2091-04-30',
      from: '2091-01-01',
      kind: 'source',
      sourceKeys: [sourceRow.sourceKey],
      to: '2091-01-31',
    };
    base = await clientBasesService.createFromVisitsAnalytics(actor, {
      description: preview.description,
      name: preview.name,
      filters: { visitsAnalytics: { sourceKeys: ['id:999999999'] } },
      originMetadata: { algorithmVersion: 'spoofed-version' },
      selection,
    });
    assert.equal(base.origin, 'visits_analytics');
    assert.equal(base.currentClientCount, preview.count);
    assert.deepEqual(base.filters, { ...preview.filters, segment: 'all' });
    assert.deepEqual(base.originMetadata, preview.originMetadata);

    const immutableFilters = structuredClone(base.filters);
    await assert.rejects(
      () => clientBasesService.update(base.id, {
        filters: {
          ...base.filters,
          visitsAnalytics: {
            ...base.filters.visitsAnalytics,
            sourceKeys: ['id:999999999'],
          },
        },
      }),
      (error) => error.statusCode === 409 && /нельзя изменить/.test(error.message),
    );
    const immutableUpdateResponse = createApiResponse();
    await clientBasesController.update({
      body: { filters: preview.filters },
      params: { id: String(base.id) },
    }, immutableUpdateResponse);
    assert.equal(immutableUpdateResponse.statusCode, 409);
    assert.match(immutableUpdateResponse.body.error, /нельзя изменить/);
    const updatedBase = await clientBasesService.update(base.id, {
      description: 'Описание можно менять',
      name: `${preview.name} updated`,
      recurrence: {
        dueDays: 2,
        enabled: true,
        interval: 'daily',
        scopeType: 'dynamic',
        time: '10:30',
      },
      slaDays: 4,
      status: 'archived',
    });
    assert.equal(updatedBase.name, `${preview.name} updated`);
    assert.equal(updatedBase.description, 'Описание можно менять');
    assert.equal(updatedBase.recurrence.enabled, true);
    assert.equal(updatedBase.recurrence.scopeType, 'dynamic');
    assert.equal(updatedBase.slaDays, 4);
    assert.equal(updatedBase.status, 'archived');
    assert.deepEqual(updatedBase.filters, immutableFilters);
    base = await clientBasesService.update(base.id, { status: 'active' });
    assert.deepEqual(base.filters, immutableFilters);

    const baseClients = await clientBasesService.getClients(base.id, { page: 1, pageSize: 20 });
    assert.equal(baseClients.total, preview.count);

    task = await callTasksService.createFromBase(actor, base.id, {
      description: 'DB parity task',
      scopeType: 'dynamic',
      scriptText: 'Existing call-task script',
      title: `Segment task ${suffix}`,
    });
    assert.equal(task.snapshotClientCount, preview.count);
    const taskClients = await db.CallTaskClient.findAll({ where: { callTaskId: task.id } });
    assert.equal(taskClients.length, preview.count);
    assert.equal(new Set(taskClients.map((item) => Number(item.userId))).size, preview.count);

    const joinedLater = await makeUser('joined-later');
    await db.Visit.create({ userId: joinedLater.id, scannedAt: '2091-01-20T10:00:00Z' });
    const syncResult = await callTasksService.sync(actor, task.id);
    assert.equal(syncResult.addedCount, 1);
    assert.equal(syncResult.task.snapshotClientCount, preview.count + 1);
    assert.equal(await clientBasesService.countBaseClients(base.filters), preview.count + 1);

    await assert.rejects(
      () => clientBasesService.createFromVisitsAnalytics(actor, {
        name: 'Empty analytics segment',
        selection: {
          ...selection,
          sourceKeys: ['id:999999999'],
        },
      }),
      /Пустой сегмент/,
    );
  } finally {
    if (task?.id) {
      await db.CallTaskClient.destroy({ where: { callTaskId: task.id } });
      await db.CallTask.destroy({ where: { id: task.id } });
    }
    if (base?.id) await db.ClientBase.destroy({ where: { id: base.id } });
    if (users.length) {
      await db.Visit.destroy({ where: { userId: users.map((user) => user.id) } });
      await db.User.update({ mergedIntoUserId: null }, { where: { id: users.map((user) => user.id) } });
      await db.User.destroy({ force: true, where: { id: users.map((user) => user.id) } });
    }
    if (actor?.id) {
      await db.OnboardingEvent.destroy({ where: { accountId: actor.id } });
      await db.Account.destroy({ force: true, where: { id: actor.id } });
    }
    if (source?.id) await source.destroy();
  }
});
