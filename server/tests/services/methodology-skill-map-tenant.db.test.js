'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../../src/tenant-foundation/constants');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const FEATURE_MIGRATION_FILE =
  '20260718140000-add-tenant-methodology-skill-map.js';
const CAPABILITY_ENV = [
  'TENANT_CONTEXT_ENABLED',
  'TENANT_CACHE_REALTIME_ENABLED',
  'TENANT_FILES_WORKERS_ENABLED',
  'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
  'TENANT_STAFF_ACCESS_ENABLED',
  'TENANT_CLIENTS_REFERENCES_ENABLED',
  'TENANT_VISITS_SCANNER_ENABLED',
  'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
  'TENANT_BOOKINGS_COURTS_ENABLED',
  'TENANT_METHODOLOGY_SKILL_MAP_ENABLED',
];

function databaseName() {
  return process.env.METHODOLOGY_SKILL_MAP_TEST_DB_NAME ||
    `setly_methodology_f6_1_${process.pid}_${Date.now()}`;
}

async function createSchemaBeforeFeature(database) {
  const sequelize = new SequelizePackage.Sequelize(
    database,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      dialect: 'mysql',
      host: process.env.DB_HOST || '127.0.0.1',
      logging: false,
    },
  );
  const queryInterface = sequelize.getQueryInterface();
  await queryInterface.createTable('SequelizeMeta', {
    name: {
      allowNull: false,
      primaryKey: true,
      type: SequelizePackage.STRING,
      unique: true,
    },
  });
  const migrations = fs
    .readdirSync(path.join(SERVER_ROOT, 'migrations'))
    .filter((file) => file.endsWith('.js') && file < FEATURE_MIGRATION_FILE)
    .sort();
  for (const file of migrations) {
    const migration = require(path.join(SERVER_ROOT, 'migrations', file));
    await migration.up(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
  }
  return sequelize;
}

async function selectOne(sequelize, sql, replacements = {}) {
  const rows = await sequelize.query(sql, {
    replacements,
    type: SequelizePackage.QueryTypes.SELECT,
  });
  return rows[0] || null;
}

function restoreEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function expectDatabaseReject(promise, pattern) {
  await assert.rejects(
    promise,
    (error) => pattern.test(String(error?.parent?.sqlMessage || error?.message || error)),
  );
}

test('Feature 6.1 migration and two-Organization methodology isolation', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const previous = Object.fromEntries([
    ...CAPABILITY_ENV,
    'DB_NAME',
    'NODE_ENV',
    'TENANT_METHODOLOGY_SKILL_MAP_MIGRATION_FAIL_STEP',
  ].map((name) => [name, process.env[name]]));
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    password: process.env.DB_PASSWORD,
    user: process.env.DB_USER,
  });
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );

  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  for (const name of CAPABILITY_ENV) process.env[name] = 'true';

  let schema;
  let db;
  try {
    schema = await createSchemaBeforeFeature(database);
    const queryInterface = schema.getQueryInterface();
    const migration = require(`../../migrations/${FEATURE_MIGRATION_FILE}`);
    const trackedArtifact = async (kind, item) => ({
      ...item,
      signature: migration.__testing.artifactSignature(
        kind,
        await migration.__testing.readArtifactRows(queryInterface, kind, item),
      ),
    });
    const cleanupTracker = () => ({
      columns: [],
      foreignKeys: [],
      indexes: [],
      removedLegacyUnique: null,
      triggers: [],
    });
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    await migration.up(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
    await migration.up(queryInterface, SequelizePackage);
    await migration.down(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');

    const legacyNow = new Date();
    await queryInterface.bulkInsert('TrainingSkills', [{
      createdAt: legacyNow,
      description: 'legacy row',
      direction: 'technique',
      name: 'Legacy methodology skill',
      status: 'active',
      updatedAt: legacyNow,
    }]);
    const legacySkill = await selectOne(
      schema,
      'SELECT id FROM TrainingSkills WHERE name=:name',
      { name: 'Legacy methodology skill' },
    );
    await queryInterface.bulkInsert('TrainingExercises', [{
      createdAt: legacyNow,
      description: 'legacy exercise',
      eLevel: 'E1',
      formats: JSON.stringify(['personal']),
      mainSkillId: legacySkill.id,
      name: 'Legacy methodology exercise',
      skillLevelMax: 1,
      skillLevelMin: 0,
      status: 'approved',
      updatedAt: legacyNow,
    }]);

    const dataBeforePartial = JSON.stringify(await schema.query(
      'SELECT id, name, status FROM TrainingSkills ORDER BY id',
      { type: SequelizePackage.QueryTypes.SELECT },
    ));
    await queryInterface.addColumn('TrainingSkills', 'organizationId', {
      allowNull: true,
      type: SequelizePackage.INTEGER,
    });
    await assert.rejects(
      migration.up(queryInterface, SequelizePackage),
      /refused partial schema/,
    );
    assert.equal(JSON.stringify(await schema.query(
      'SELECT id, name, status FROM TrainingSkills ORDER BY id',
      { type: SequelizePackage.QueryTypes.SELECT },
    )), dataBeforePartial);
    assert.equal(await queryInterface.describeTable('TrainingExercises').then(
      (columns) => Boolean(columns.organizationId),
    ), false);
    await queryInterface.removeColumn('TrainingSkills', 'organizationId');

    await queryInterface.addIndex('TrainingSkills', ['status', 'name'], {
      name: 'lookalike_methodology_tenant_index',
    });
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    await queryInterface.removeIndex('TrainingSkills', 'lookalike_methodology_tenant_index');

    for (const forcedStage of [
      'after_columns',
      'after_backfill',
      'after_constraints',
      'after_triggers',
      'after_legacy_unique_drop',
    ]) {
      process.env.TENANT_METHODOLOGY_SKILL_MAP_MIGRATION_FAIL_STEP = forcedStage;
      await assert.rejects(
        migration.up(queryInterface, SequelizePackage),
        /Forced methodology migration failure/,
      );
      delete process.env.TENANT_METHODOLOGY_SKILL_MAP_MIGRATION_FAIL_STEP;
      assert.equal(
        (await migration.__testing.classifyState(queryInterface)).state,
        'legacy',
      );
    }

    const columnTracker = cleanupTracker();
    await queryInterface.addColumn('TrainingSkills', 'organizationId', {
      allowNull: true,
      type: SequelizePackage.INTEGER,
    });
    columnTracker.columns.push(await trackedArtifact('column', {
      name: 'organizationId',
      table: 'TrainingSkills',
    }));
    await queryInterface.changeColumn('TrainingSkills', 'organizationId', {
      allowNull: true,
      type: SequelizePackage.BIGINT,
    });
    await assert.rejects(
      migration.__testing.cleanupInvocation(queryInterface, columnTracker),
      (error) => error.code === 'TENANT_METHODOLOGY_CLEANUP_OWNERSHIP_LOST',
    );
    assert.equal(
      (await queryInterface.describeTable('TrainingSkills')).organizationId.type
        .toUpperCase().includes('BIGINT'),
      true,
    );
    await queryInterface.removeColumn('TrainingSkills', 'organizationId');

    const indexTracker = cleanupTracker();
    const probeIndex = {
      name: 'training_skills_org_status_direction_idx',
      table: 'TrainingSkills',
    };
    await queryInterface.addIndex(probeIndex.table, ['status'], {
      name: probeIndex.name,
    });
    indexTracker.indexes.push(await trackedArtifact('index', probeIndex));
    await queryInterface.removeIndex(probeIndex.table, probeIndex.name);
    await queryInterface.addIndex(probeIndex.table, ['direction'], {
      name: probeIndex.name,
    });
    await assert.rejects(
      migration.__testing.cleanupInvocation(queryInterface, indexTracker),
      (error) => error.code === 'TENANT_METHODOLOGY_CLEANUP_OWNERSHIP_LOST',
    );
    assert.equal(
      (await queryInterface.showIndex(probeIndex.table))
        .some((index) => index.name === probeIndex.name),
      true,
    );
    await queryInterface.removeIndex(probeIndex.table, probeIndex.name);

    await queryInterface.createTable('MethodologyCleanupParents', {
      id: { primaryKey: true, type: SequelizePackage.INTEGER },
    });
    await queryInterface.createTable('MethodologyCleanupChildren', {
      id: { primaryKey: true, type: SequelizePackage.INTEGER },
      parentId: { allowNull: true, type: SequelizePackage.INTEGER },
    });
    const foreignKeyTracker = cleanupTracker();
    const probeForeignKey = {
      name: 'training_skills_organization_fk',
      table: 'MethodologyCleanupChildren',
    };
    await queryInterface.addConstraint(probeForeignKey.table, {
      fields: ['parentId'],
      name: probeForeignKey.name,
      onDelete: 'RESTRICT',
      onUpdate: 'RESTRICT',
      references: { field: 'id', table: 'MethodologyCleanupParents' },
      type: 'foreign key',
    });
    foreignKeyTracker.foreignKeys.push(
      await trackedArtifact('constraint', probeForeignKey),
    );
    await queryInterface.removeConstraint(probeForeignKey.table, probeForeignKey.name);
    await queryInterface.addConstraint(probeForeignKey.table, {
      fields: ['parentId'],
      name: probeForeignKey.name,
      onDelete: 'CASCADE',
      onUpdate: 'RESTRICT',
      references: { field: 'id', table: 'MethodologyCleanupParents' },
      type: 'foreign key',
    });
    await assert.rejects(
      migration.__testing.cleanupInvocation(queryInterface, foreignKeyTracker),
      (error) => error.code === 'TENANT_METHODOLOGY_CLEANUP_OWNERSHIP_LOST',
    );
    await queryInterface.removeConstraint(probeForeignKey.table, probeForeignKey.name);
    await queryInterface.dropTable('MethodologyCleanupChildren');
    await queryInterface.dropTable('MethodologyCleanupParents');

    const triggerTracker = cleanupTracker();
    const probeTrigger = {
      name: 'training_skills_tenant_bi',
      table: 'TrainingSkills',
    };
    await schema.query(
      `CREATE TRIGGER \`${probeTrigger.name}\` BEFORE INSERT ON \`${probeTrigger.table}\`
       FOR EACH ROW BEGIN IF NEW.status = 'active' THEN SET NEW.status = 'active'; END IF; END`,
    );
    triggerTracker.triggers.push(await trackedArtifact('trigger', probeTrigger));
    await schema.query(`DROP TRIGGER \`${probeTrigger.name}\``);
    await schema.query(
      `CREATE TRIGGER \`${probeTrigger.name}\` BEFORE INSERT ON \`${probeTrigger.table}\`
       FOR EACH ROW BEGIN IF NEW.status = 'ACTIVE' THEN SET NEW.status = 'active'; END IF; END`,
    );
    await assert.rejects(
      migration.__testing.cleanupInvocation(queryInterface, triggerTracker),
      (error) => error.code === 'TENANT_METHODOLOGY_CLEANUP_OWNERSHIP_LOST',
    );
    assert.equal(await selectOne(schema, `
      SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = :name
    `, { name: probeTrigger.name }).then((row) => Number(row.count)), 1);
    await schema.query(`DROP TRIGGER \`${probeTrigger.name}\``);

    const removedUniqueTracker = cleanupTracker();
    const removedLegacyUnique = {
      name: 'training_skills_name_unique',
      table: 'TrainingSkills',
    };
    removedUniqueTracker.removedLegacyUnique =
      await trackedArtifact('index', removedLegacyUnique);
    await queryInterface.removeIndex(
      removedLegacyUnique.table,
      removedLegacyUnique.name,
    );
    await queryInterface.bulkInsert('TrainingSkills', [{
      createdAt: legacyNow,
      description: 'cleanup restoration collision',
      direction: 'technique',
      name: 'Legacy methodology skill',
      status: 'active',
      updatedAt: legacyNow,
    }]);
    await assert.rejects(
      migration.__testing.cleanupInvocation(queryInterface, removedUniqueTracker),
      (error) => error.code === 'TENANT_METHODOLOGY_CLEANUP_OWNERSHIP_LOST',
    );
    await schema.query(
      `DELETE FROM TrainingSkills
       WHERE description = 'cleanup restoration collision'`,
    );
    await queryInterface.addIndex('TrainingSkills', ['name'], {
      name: removedLegacyUnique.name,
      unique: true,
    });

    await migration.up(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
    const historyTriggerName = 'client_training_skill_history_tenant_bi';
    const historyTrigger = migration.__testing.TRIGGERS[historyTriggerName];
    await schema.query(`DROP TRIGGER \`${historyTriggerName}\``);
    await schema.query(
      `CREATE TRIGGER \`${historyTriggerName}\` BEFORE ${historyTrigger.event}
       ON \`${historyTrigger.table}\` FOR EACH ROW
       ${historyTrigger.body.replace("'structured_training'", "'STRUCTURED_TRAINING'")}`,
    );
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'partial');
    await schema.query(`DROP TRIGGER \`${historyTriggerName}\``);
    await schema.query(
      `CREATE TRIGGER \`${historyTriggerName}\` BEFORE ${historyTrigger.event}
       ON \`${historyTrigger.table}\` FOR EACH ROW ${historyTrigger.body}`,
    );
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
    const defaultOrganization = await selectOne(
      schema,
      'SELECT id FROM Organizations WHERE slug=:slug',
      { slug: DEFAULT_ORGANIZATION_SLUG },
    );
    const defaultClub = await selectOne(
      schema,
      'SELECT id FROM Clubs WHERE slug=:slug',
      { slug: DEFAULT_CLUB_SLUG },
    );
    assert.deepEqual(
      await schema.query(
        'SELECT DISTINCT organizationId FROM TrainingSkills UNION SELECT DISTINCT organizationId FROM TrainingExercises',
        { type: SequelizePackage.QueryTypes.SELECT },
      ),
      [{ organizationId: defaultOrganization.id }],
    );

    db = require('../../models');
    const tenantContextService = require('../../src/services/tenant-context.service');
    const methodologyService = require('../../src/services/training-methodology.service');
    const skillMapService = require('../../src/services/client-skill-map.service');
    const recommendationService = require('../../src/services/training-recommendations.service');
    const analyticsService = require('../../src/services/training-methodology-analytics.service');
    const clientsService = require('../../src/services/clients.service');
    const onboardingService = require('../../src/services/onboarding.service');
    const trainingPlansService = require('../../src/services/training-plans.service');
    const methodologyAccessService = require(
      '../../src/services/methodology-access-context.service',
    );

    const organizationB = await db.Organization.create({
      name: 'Feature 6.1 Organization B',
      slug: `feature-6-1-org-b-${Date.now()}`,
      status: 'active',
    });
    const clubB = await db.Club.create({
      name: 'Feature 6.1 Club B',
      organizationId: organizationB.id,
      slug: `feature-6-1-club-b-${Date.now()}`,
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const accountA = await db.Account.create({
      email: `feature-6-1-a-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'owner',
      status: 'active',
    });
    const accountB = await db.Account.create({
      email: `feature-6-1-b-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'owner',
      status: 'active',
    });
    const membershipA = await db.Membership.create({
      accountId: accountA.id,
      organizationId: defaultOrganization.id,
      role: 'owner',
      status: 'active',
    });
    const membershipB = await db.Membership.create({
      accountId: accountB.id,
      organizationId: organizationB.id,
      role: 'owner',
      status: 'active',
    });
    const tenantA = await tenantContextService.resolveTenantContext({
      accountId: accountA.id,
      organizationId: defaultOrganization.id,
      scope: 'organization',
    });
    const tenantB = await tenantContextService.resolveTenantContext({
      accountId: accountB.id,
      organizationId: organizationB.id,
      scope: 'organization',
    });
    const actorA = { id: accountA.id, role: 'owner' };
    const actorB = { id: accountB.id, role: 'owner' };
    const staleManagerAccount = await db.Account.create({
      email: `feature-6-1-stale-manager-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'manager',
      status: 'active',
    });
    const staleManagerMembership = await db.Membership.create({
      accountId: staleManagerAccount.id,
      organizationId: defaultOrganization.id,
      role: 'manager',
      status: 'active',
    });
    const staleManagerAccess = await db.MembershipClubAccess.create({
      clubId: defaultClub.id,
      membershipId: staleManagerMembership.id,
      organizationId: defaultOrganization.id,
      roleOverride: null,
      status: 'active',
    });
    const staleManagerActor = { id: staleManagerAccount.id, role: 'manager' };
    const staleManagerOrganizationTenant =
      await tenantContextService.resolveTenantContext({
        accountId: staleManagerAccount.id,
        organizationId: defaultOrganization.id,
        scope: 'organization',
      });
    await staleManagerMembership.update({ role: 'viewer' });
    await assert.rejects(
      methodologyService.createSkill({
        direction: 'technique',
        name: `Stale membership role ${Date.now()}`,
      }, staleManagerActor, staleManagerOrganizationTenant),
      (error) => error.statusCode === 403,
    );
    await staleManagerMembership.update({ role: 'manager' });
    const staleManagerClubTenant = await tenantContextService.resolveTenantContext({
      accountId: staleManagerAccount.id,
      clubId: defaultClub.id,
      organizationId: defaultOrganization.id,
      scope: 'club',
    });
    await staleManagerAccess.update({ roleOverride: 'viewer' });
    await assert.rejects(
      methodologyService.createSkill({
        direction: 'technique',
        name: `Stale club override ${Date.now()}`,
      }, staleManagerActor, staleManagerClubTenant),
      (error) => error.statusCode === 403,
    );
    await staleManagerAccess.update({ roleOverride: null });
    await assert.rejects(
      methodologyService.listSkills({}, actorB, tenantA),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    const userA = await db.User.create({
      name: 'Feature 6.1 Client A',
      organizationId: defaultOrganization.id,
      phone: '+79996100001',
      phoneNormalized: '9996100001',
      source: 'Feature 6.1',
      status: 'active',
      webId: `feature-6-1-client-a-${Date.now()}`,
    });
    const userB = await db.User.create({
      name: 'Feature 6.1 Client B',
      organizationId: organizationB.id,
      phone: '+79996100002',
      phoneNormalized: '9996100002',
      source: 'Feature 6.1',
      status: 'active',
      webId: `feature-6-1-client-b-${Date.now()}`,
    });

    const sharedName = `Shared skill ${Date.now()}`;
    const skillA = await methodologyService.createSkill({
      direction: 'technique',
      name: sharedName,
    }, actorA, tenantA);
    const skillB = await methodologyService.createSkill({
      direction: 'technique',
      name: sharedName,
    }, actorB, tenantB);
    assert.notEqual(skillA.id, skillB.id);

    const concurrentName = `Concurrent skill ${Date.now()}`;
    const concurrentCreates = await Promise.allSettled([
      methodologyService.createSkill({
        direction: 'tactics',
        name: concurrentName,
      }, actorA, tenantA),
      methodologyService.createSkill({
        direction: 'tactics',
        name: concurrentName,
      }, actorA, tenantA),
    ]);
    assert.equal(
      concurrentCreates.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      concurrentCreates.filter((result) => result.status === 'rejected').length,
      1,
    );
    await db.TrainingSkill.destroy({
      where: { id: concurrentCreates.find((result) => result.status === 'fulfilled').value.id },
    });

    const exerciseA = await methodologyService.createExercise({
      eLevel: 'E1',
      formats: ['personal'],
      mainSkillId: skillA.id,
      name: 'Organization A drill',
      skillLevelMax: 1,
      skillLevelMin: 0,
      status: 'approved',
    }, actorA, tenantA);
    const exerciseB = await methodologyService.createExercise({
      eLevel: 'E1',
      formats: ['personal'],
      mainSkillId: skillB.id,
      name: 'Organization B drill',
      skillLevelMax: 1,
      skillLevelMin: 0,
      status: 'approved',
    }, actorB, tenantB);
    assert.deepEqual(
      (await methodologyService.listExercises({}, actorA, tenantA)).map((row) => row.id),
      [exerciseA.id, Number((await selectOne(schema, 'SELECT id FROM TrainingExercises WHERE name=:name', { name: 'Legacy methodology exercise' })).id)].sort((a, b) => b - a),
    );
    assert.deepEqual(
      (await methodologyService.listExercises({}, actorB, tenantB)).map((row) => row.id),
      [exerciseB.id],
    );
    await assert.rejects(
      methodologyService.updateExercise(exerciseA.id, { name: 'forged' }, actorB, tenantB),
      /Упражнение не найдено/,
    );
    for (const operation of [
      methodologyService.approveExercise,
      methodologyService.archiveExercise,
      methodologyService.restoreExercise,
    ]) {
      await assert.rejects(
        operation(exerciseA.id, actorB, tenantB),
        /Упражнение не найдено/,
      );
    }
    await assert.rejects(
      methodologyService.listSkills({}, actorA, { ...tenantA }),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );

    await skillMapService.updateEntry(userA.id, skillA.id, { level: 2 }, actorA, tenantA);
    await skillMapService.updateEntry(userB.id, skillB.id, { level: 3 }, actorB, tenantB);
    const mapA = await skillMapService.listForClient(userA.id, actorA, { tenant: tenantA });
    const mapB = await skillMapService.listForClient(userB.id, actorB, { tenant: tenantB });
    assert.equal(mapA.some((row) => Number(row.skillId) === Number(skillB.id)), false);
    assert.deepEqual(mapB.map((row) => Number(row.skillId)), [Number(skillB.id)]);
    assert.equal(mapA.find((row) => Number(row.skillId) === Number(skillA.id)).history.length, 1);
    await assert.rejects(
      skillMapService.updateEntry(userA.id, skillB.id, { level: 4 }, actorA, tenantA),
      /Активный навык не найден/,
    );
    await assert.rejects(
      recommendationService.recommendForGroup(
        { clientIds: [userA.id, userB.id] },
        actorA,
        tenantA,
      ),
      /не найден/,
    );

    await expectDatabaseReject(
      db.sequelize.query(
        'UPDATE TrainingExercises SET mainSkillId=:skillId WHERE id=:exerciseId',
        { replacements: { exerciseId: exerciseA.id, skillId: skillB.id } },
      ),
      /main skill organization mismatch/,
    );
    await expectDatabaseReject(
      db.TrainingExerciseSkill.create({
        trainingExerciseId: exerciseA.id,
        trainingSkillId: skillB.id,
      }),
      /TrainingExerciseSkill organization mismatch/,
    );
    await expectDatabaseReject(
      db.sequelize.query(
        'UPDATE TrainingSkills SET organizationId=:organizationId WHERE id=:skillId',
        { replacements: { organizationId: organizationB.id, skillId: skillA.id } },
      ),
      /organizationId is immutable/,
    );
    await expectDatabaseReject(
      db.ClientTrainingSkill.create({
        level: 0,
        trainingSkillId: skillB.id,
        userId: userA.id,
      }),
      /ClientTrainingSkill organization mismatch/,
    );
    const entryA = await db.ClientTrainingSkill.findOne({
      where: { trainingSkillId: skillA.id, userId: userA.id },
    });
    await expectDatabaseReject(
      db.ClientTrainingSkillHistory.create({
        changeType: 'manual_update',
        clientTrainingSkillId: entryA.id,
        explanation: 'cross-org injection',
        nextLevel: 2,
        previousLevel: 1,
        repeatFlag: false,
        source: 'manual',
        trainingSkillId: skillB.id,
        updatedByAccountId: accountA.id,
        userId: userA.id,
      }),
      /parent organization mismatch/,
    );

    const duplicateA = await db.User.create({
      name: 'Feature 6.1 Client A duplicate',
      organizationId: defaultOrganization.id,
      phone: '+79996100003',
      phoneNormalized: '9996100003',
      source: 'Feature 6.1',
      status: 'active',
      webId: `feature-6-1-client-a-duplicate-${Date.now()}`,
    });
    await skillMapService.updateEntry(
      duplicateA.id,
      skillA.id,
      { level: 1 },
      actorA,
      tenantA,
    );
    await assert.rejects(
      clientsService.mergeClients(
        userA.id,
        [userB.id],
        { id: actorA.id, role: 'trainer' },
        tenantA,
      ),
      /не найдены/,
    );
    await clientsService.mergeClients(
      userA.id,
      [duplicateA.id],
      { id: actorA.id, role: 'trainer' },
      tenantA,
    );
    const mergedHistory = await db.ClientTrainingSkillHistory.findAll({
      where: { userId: userA.id },
    });
    assert.equal(mergedHistory.length >= 2, true);
    assert.equal(
      mergedHistory.every((row) => Number(row.userId) === Number(userA.id)),
      true,
    );

    const archivedB = await db.User.create({
      name: 'Feature 6.1 archived B',
      organizationId: organizationB.id,
      phone: '+79996100004',
      phoneNormalized: '9996100004',
      source: 'Feature 6.1',
      status: 'archived',
      webId: `feature-6-1-archived-b-${Date.now()}`,
    });
    await assert.rejects(
      clientsService.removeArchivedClient(archivedB.id, tenantA),
      /Клиент не найден/,
    );
    await clientsService.removeArchivedClient(archivedB.id, tenantB);

    const noteA = await db.TrainingNote.create({
      level: 'D',
      trainedAt: '2099-01-01',
      trainerAccountId: accountA.id,
      userId: userA.id,
    });
    await expectDatabaseReject(
      db.TrainingNoteExercise.create({
        exerciseNameSnapshot: 'cross-org',
        orderIndex: 0,
        rating: 4,
        trainingExerciseId: exerciseB.id,
        trainingNoteId: noteA.id,
      }),
      /TrainingNoteExercise organization mismatch/,
    );
    const noteExerciseA = await db.TrainingNoteExercise.create({
      exerciseNameSnapshot: exerciseA.name,
      orderIndex: 0,
      rating: 4,
      trainingExerciseId: exerciseA.id,
      trainingNoteId: noteA.id,
    });
    const legacyEntryA = await db.ClientTrainingSkill.findOne({
      where: { trainingSkillId: legacySkill.id, userId: userA.id },
    });
    await expectDatabaseReject(
      db.ClientTrainingSkillHistory.create({
        changeType: 'advanced',
        clientTrainingSkillId: legacyEntryA.id,
        explanation: 'same-org but unrelated exercise provenance',
        nextLevel: 1,
        previousLevel: 0,
        repeatFlag: false,
        source: 'structured_training',
        trainingNoteExerciseId: noteExerciseA.id,
        trainingNoteId: noteA.id,
        trainingSkillId: legacySkill.id,
        updatedByAccountId: accountA.id,
        userId: userA.id,
      }),
      /Structured skill history note provenance mismatch/,
    );

    const courtB = await db.Court.create({
      clubId: clubB.id,
      isActive: true,
      name: 'Feature 6.1 Court B',
      organizationId: organizationB.id,
      sortOrder: 0,
      type: 'padel_double',
    });
    const bookingB = await db.Booking.create({
      bookingType: 'personal_training',
      clientName: userB.name,
      clientPhone: userB.phone,
      clubId: clubB.id,
      courtId: courtB.id,
      durationMinutes: 60,
      endsAt: new Date('2099-01-02T11:00:00.000Z'),
      organizationId: organizationB.id,
      startsAt: new Date('2099-01-02T10:00:00.000Z'),
      userId: userB.id,
    });
    const planB = await db.TrainingPlan.create({
      bookingId: bookingB.id,
      kind: 'personal',
      plannedAt: '2099-01-02',
      sourceType: 'manual',
      status: 'planned',
      trainerAccountId: accountB.id,
    });
    await db.TrainingPlanParticipant.create({
      trainingPlanId: planB.id,
      userId: userB.id,
    });
    await expectDatabaseReject(
      db.TrainingPlanExercise.create({
        exerciseNameSnapshot: 'cross-org plan',
        orderIndex: 0,
        trainingExerciseId: exerciseA.id,
        trainingPlanId: planB.id,
      }),
      /TrainingPlanExercise organization mismatch/,
    );

    const recommendationA = await recommendationService.recommendForClient(
      userA.id,
      { date: '2099-01-03' },
      actorA,
      tenantA,
    );
    assert.equal(
      recommendationA.blocks.some((block) => Number(block.exercise?.id) === Number(exerciseB.id)),
      false,
    );
    const analyticsA = await analyticsService.getAnalytics(
      { from: '2098-01-01', to: '2099-12-31' },
      actorA,
      tenantA,
    );
    const analyticsB = await analyticsService.getAnalytics(
      { from: '2098-01-01', to: '2099-12-31' },
      actorB,
      tenantB,
    );
    assert.equal(analyticsA.summary.activeSkills, 2);
    assert.equal(analyticsB.summary.activeSkills, 1);
    assert.equal(analyticsB.summary.approvedExercises, 1);

    await membershipA.update({ status: 'inactive' });
    await assert.rejects(
      methodologyService.listSkills({}, actorA, tenantA),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    await membershipA.update({ status: 'active' });

    process.env.TENANT_METHODOLOGY_SKILL_MAP_ENABLED = 'false';
    const legacyRead = await methodologyService.listSkills({}, actorA, null);
    assert.equal(legacyRead.some((row) => Number(row.id) === Number(skillB.id)), true);
    const flagOffSkill = await methodologyService.createSkill({
      direction: 'tactics',
      name: `Flag-off default skill ${Date.now()}`,
    }, actorA, null);
    assert.equal(Number((await db.TrainingSkill.findByPk(flagOffSkill.id)).organizationId), Number(defaultOrganization.id));
    process.env.TENANT_METHODOLOGY_SKILL_MAP_ENABLED = 'true';

    const clubTenantA = await tenantContextService.resolveTenantContext({
      accountId: accountA.id,
      clubId: defaultClub.id,
      organizationId: defaultOrganization.id,
      scope: 'club',
    });
    const clubTenantB = await tenantContextService.resolveTenantContext({
      accountId: accountB.id,
      clubId: clubB.id,
      organizationId: organizationB.id,
      scope: 'club',
    });
    const adminAccount = await db.Account.create({
      email: `feature-6-1-admin-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'admin',
      status: 'active',
    });
    const adminMembership = await db.Membership.create({
      accountId: adminAccount.id,
      organizationId: defaultOrganization.id,
      role: 'admin',
      status: 'active',
    });
    const adminAccess = await db.MembershipClubAccess.create({
      clubId: defaultClub.id,
      membershipId: adminMembership.id,
      organizationId: defaultOrganization.id,
      roleOverride: null,
      status: 'active',
    });
    const adminTenant = await tenantContextService.resolveTenantContext({
      accountId: adminAccount.id,
      clubId: defaultClub.id,
      organizationId: defaultOrganization.id,
      scope: 'club',
    });
    const adminActor = { id: adminAccount.id, role: 'admin' };
    const internalRecommendationContext =
      await methodologyAccessService.resolveMethodologyAccessContext(adminTenant);
    const internalRecommendationDelegation =
      methodologyAccessService.createBookingPlanRecommendationDelegation(
        adminActor,
        internalRecommendationContext,
      );
    await assert.rejects(
      recommendationService.recommendForClient(
        userA.id,
        { date: '2099-02-01' },
        actorA,
        adminTenant,
        {
          bookingPlanRecommendationDelegation:
            internalRecommendationDelegation,
        },
      ),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    await adminAccess.update({ roleOverride: 'viewer' });
    await assert.rejects(
      recommendationService.recommendForClient(
        userA.id,
        { date: '2099-02-01' },
        adminActor,
        adminTenant,
        {
          bookingPlanRecommendationDelegation:
            internalRecommendationDelegation,
        },
      ),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    await adminAccess.update({ roleOverride: null });
    await assert.rejects(
      recommendationService.recommendForClient(
        userA.id,
        { date: '2099-02-01' },
        adminActor,
        adminTenant,
      ),
      (error) => error.statusCode === 403,
    );
    const managerRecommendation = await recommendationService.recommendForClient(
      userA.id,
      { date: '2099-02-01' },
      staleManagerActor,
      staleManagerClubTenant,
    );
    assert.equal(managerRecommendation.clientId, Number(userA.id));

    const trainerStaff = await db.Staff.create({
      name: 'Feature 6.1 booking-plan trainer',
      organizationId: defaultOrganization.id,
      role: 'Тренер',
      status: 'active',
    });
    const trainerAccount = await db.Account.create({
      email: `feature-6-1-plan-trainer-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'trainer',
      staffId: trainerStaff.id,
      status: 'active',
    });
    const trainerMembership = await db.Membership.create({
      accountId: trainerAccount.id,
      organizationId: defaultOrganization.id,
      role: 'trainer',
      staffId: trainerStaff.id,
      status: 'active',
    });
    await db.MembershipClubAccess.create({
      clubId: defaultClub.id,
      membershipId: trainerMembership.id,
      organizationId: defaultOrganization.id,
      roleOverride: null,
      status: 'active',
    });
    const trainerTenant = await tenantContextService.resolveTenantContext({
      accountId: trainerAccount.id,
      clubId: defaultClub.id,
      organizationId: defaultOrganization.id,
      scope: 'club',
    });
    const trainerRecommendation = await recommendationService.recommendForClient(
      userA.id,
      { date: '2099-02-01' },
      { id: trainerAccount.id, role: 'trainer' },
      trainerTenant,
    );
    assert.equal(trainerRecommendation.clientId, Number(userA.id));
    const adminCourt = await db.Court.create({
      clubId: defaultClub.id,
      isActive: true,
      name: `Feature 6.1 admin plan court ${Date.now()}`,
      organizationId: defaultOrganization.id,
      sortOrder: 0,
      type: 'padel_double',
    });
    const adminBooking = await db.Booking.create({
      bookingType: 'personal_training',
      clientName: userA.name,
      clientPhone: userA.phone,
      clubId: defaultClub.id,
      courtId: adminCourt.id,
      durationMinutes: 60,
      endsAt: new Date('2099-02-01T11:00:00.000Z'),
      organizationId: defaultOrganization.id,
      responsibleStaffId: trainerStaff.id,
      startsAt: new Date('2099-02-01T10:00:00.000Z'),
      userId: userA.id,
    });
    const adminPlan = await trainingPlansService.createFromBooking(
      adminBooking.id,
      adminActor,
      adminTenant,
    );
    assert.equal(Number(adminPlan.bookingId), Number(adminBooking.id));
    assert.equal(adminPlan.plannedExercises.length > 0, true);

    const trainingUserA = await db.User.create({
      isTraining: true,
      name: 'Feature 6.1 training client A',
      organizationId: defaultOrganization.id,
      phone: '+79996100005',
      phoneNormalized: '9996100005',
      source: 'Feature 6.1',
      status: 'active',
      trainingAccountId: accountA.id,
      trainingRole: 'owner',
      webId: `feature-6-1-training-a-${Date.now()}`,
    });
    const trainingUserB = await db.User.create({
      isTraining: true,
      name: 'Feature 6.1 training client B',
      organizationId: organizationB.id,
      phone: '+79996100006',
      phoneNormalized: '9996100006',
      source: 'Feature 6.1',
      status: 'active',
      trainingAccountId: accountB.id,
      trainingRole: 'owner',
      webId: `feature-6-1-training-b-${Date.now()}`,
    });
    await skillMapService.updateEntry(
      trainingUserA.id,
      skillA.id,
      { level: 1 },
      actorA,
      tenantA,
    );
    await skillMapService.updateEntry(
      trainingUserB.id,
      skillB.id,
      { level: 1 },
      actorB,
      tenantB,
    );
    const summaryA = await onboardingService.getTrainingDataSummary(
      actorA,
      { role: 'owner' },
      clubTenantA,
    );
    assert.equal(
      summaryA.entities.find((entry) => entry.key === 'clientTrainingSkills').count >= 1,
      true,
    );
    await onboardingService.cleanupTrainingData(
      actorA,
      { role: 'owner' },
      clubTenantA,
    );
    assert.equal(await db.User.count({ where: { id: trainingUserA.id } }), 0);
    assert.equal(await db.User.count({ where: { id: trainingUserB.id } }), 1);
    assert.equal(
      await db.ClientTrainingSkill.count({ where: { userId: trainingUserB.id } }) >= 1,
      true,
    );
    assert.equal(clubTenantB.organizationId, organizationB.id);

    await assert.rejects(
      migration.down(queryInterface, SequelizePackage),
      (error) => error.code === 'TENANT_METHODOLOGY_ROLLBACK_SECOND_ORGANIZATION',
    );

    await db.TrainingPlanParticipant.destroy({ where: { trainingPlanId: planB.id } });
    await planB.destroy();
    await bookingB.destroy();
    await courtB.destroy();
    await noteA.destroy();
    const organizationBUserIds = (await db.User.findAll({
      attributes: ['id'],
      where: { organizationId: organizationB.id },
    })).map((row) => row.id);
    await db.ClientTrainingSkillHistory.destroy({
      where: { userId: { [SequelizePackage.Op.in]: organizationBUserIds } },
    });
    await db.ClientTrainingSkill.destroy({
      where: { userId: { [SequelizePackage.Op.in]: organizationBUserIds } },
    });
    await db.TrainingExercise.destroy({ where: { organizationId: organizationB.id } });
    await db.TrainingSkill.destroy({ where: { organizationId: organizationB.id } });
    await db.User.destroy({ where: { organizationId: organizationB.id } });
    await membershipB.destroy();
    await accountB.destroy();
    await clubB.destroy();
    await organizationB.destroy();

    const beforeLifecycle = JSON.stringify(await schema.query(
      'SELECT id, name, organizationId FROM TrainingSkills ORDER BY id',
      { type: SequelizePackage.QueryTypes.SELECT },
    ));
    await migration.down(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    await migration.up(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
    assert.equal(JSON.stringify(await schema.query(
      'SELECT id, name, organizationId FROM TrainingSkills ORDER BY id',
      { type: SequelizePackage.QueryTypes.SELECT },
    )), beforeLifecycle);
    await migration.up(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
  } finally {
    if (db?.sequelize) await db.sequelize.close();
    if (schema) await schema.close();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
    restoreEnv(previous);
  }
});
