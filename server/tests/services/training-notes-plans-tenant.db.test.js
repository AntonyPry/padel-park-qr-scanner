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
  '20260718160000-add-tenant-training-notes-plans.js';
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
  'TENANT_TRAINING_NOTES_PLANS_ENABLED',
];

function databaseName() {
  return process.env.TRAINING_NOTES_PLANS_TEST_DB_NAME ||
    `setly_training_f6_2_${process.pid}_${Date.now()}`;
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

test('Feature 6.2 migration and two-Organization/two-Club training isolation', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const previous = Object.fromEntries([
    ...CAPABILITY_ENV,
    'DB_NAME',
    'NODE_ENV',
    'TENANT_TRAINING_NOTES_PLANS_MIGRATION_FAIL_STEP',
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
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');

    await queryInterface.addIndex('TrainingNotes', ['userId'], {
      name: 'lookalike_training_notes_club_index',
    });
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    await queryInterface.removeIndex('TrainingNotes', 'lookalike_training_notes_club_index');

    const noteCountBeforePartial = await selectOne(
      schema,
      'SELECT COUNT(*) AS count FROM TrainingNotes',
    );
    await queryInterface.addColumn('TrainingNotes', 'clubId', {
      allowNull: true,
      type: SequelizePackage.STRING,
    });
    await assert.rejects(migration.up(queryInterface, SequelizePackage), /refused partial schema/);
    assert.equal(
      Number((await selectOne(schema, 'SELECT COUNT(*) AS count FROM TrainingNotes')).count),
      Number(noteCountBeforePartial.count),
    );
    assert.equal(
      await selectOne(schema, `
        SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='TrainingPlans' AND COLUMN_NAME='clubId'
      `).then((row) => Number(row.count)),
      0,
    );
    await queryInterface.removeColumn('TrainingNotes', 'clubId');

    for (const forcedStage of [
      'after_columns',
      'after_backfill',
      'after_constraints',
      'after_triggers',
    ]) {
      process.env.TENANT_TRAINING_NOTES_PLANS_MIGRATION_FAIL_STEP = forcedStage;
      await assert.rejects(
        migration.up(queryInterface, SequelizePackage),
        (error) => error.code === 'TENANT_TRAINING_OPERATIONS_FORCED_FAILURE',
      );
      delete process.env.TENANT_TRAINING_NOTES_PLANS_MIGRATION_FAIL_STEP;
      assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    }

    const ownedColumn = { name: 'clubId', table: 'TrainingNotes' };
    await queryInterface.addColumn(ownedColumn.table, ownedColumn.name, {
      allowNull: true,
      type: SequelizePackage.INTEGER,
    });
    const ownedRows = await migration.__testing.readArtifact(
      queryInterface,
      'column',
      ownedColumn,
    );
    const cleanupTracker = {
      column: [{
        ...ownedColumn,
        signature: migration.__testing.signature('column', ownedRows),
      }],
      foreignKey: [],
      index: [],
      trigger: [],
    };
    await queryInterface.changeColumn(ownedColumn.table, ownedColumn.name, {
      allowNull: true,
      type: SequelizePackage.BIGINT,
    });
    await assert.rejects(
      migration.__testing.cleanupInvocation(queryInterface, cleanupTracker),
      (error) => error.code === 'TENANT_TRAINING_OPERATIONS_CLEANUP_OWNERSHIP_LOST',
    );
    assert.equal(
      (await queryInterface.describeTable('TrainingNotes')).clubId.type
        .toUpperCase().includes('BIGINT'),
      true,
    );
    await queryInterface.removeColumn(ownedColumn.table, ownedColumn.name);

    await migration.up(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
    await migration.up(queryInterface, SequelizePackage);

    db = require('../../models');
    const tenantContextService = require('../../src/services/tenant-context.service');
    const methodologyService = require('../../src/services/training-methodology.service');
    const notesService = require('../../src/services/training-notes.service');
    const plansService = require('../../src/services/training-plans.service');
    const recommendationsService = require('../../src/services/training-recommendations.service');
    const onboardingService = require('../../src/services/onboarding.service');

    const defaultOrganization = await db.Organization.findOne({
      where: { slug: DEFAULT_ORGANIZATION_SLUG },
    });
    const defaultClub = await db.Club.findOne({
      where: { organizationId: defaultOrganization.id, slug: DEFAULT_CLUB_SLUG },
    });
    const siblingClub = await db.Club.create({
      name: 'Feature 6.2 sibling club',
      organizationId: defaultOrganization.id,
      slug: `feature-6-2-sibling-${Date.now()}`,
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const organizationB = await db.Organization.create({
      name: 'Feature 6.2 Organization B',
      slug: `feature-6-2-org-b-${Date.now()}`,
      status: 'active',
    });
    const clubB = await db.Club.create({
      name: 'Feature 6.2 Club B',
      organizationId: organizationB.id,
      slug: `feature-6-2-club-b-${Date.now()}`,
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const ownerA = await db.Account.create({
      email: `feature-6-2-owner-a-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'owner',
      status: 'active',
    });
    const ownerB = await db.Account.create({
      email: `feature-6-2-owner-b-${Date.now()}@example.test`,
      passwordHash: 'test-only',
      role: 'owner',
      status: 'active',
    });
    const membershipA = await db.Membership.create({
      accountId: ownerA.id,
      organizationId: defaultOrganization.id,
      role: 'owner',
      status: 'active',
    });
    const membershipB = await db.Membership.create({
      accountId: ownerB.id,
      organizationId: organizationB.id,
      role: 'owner',
      status: 'active',
    });
    const actorA = { id: ownerA.id, role: 'owner' };
    const actorB = { id: ownerB.id, role: 'owner' };
    const organizationTenantA = await tenantContextService.resolveTenantContext({
      accountId: ownerA.id,
      organizationId: defaultOrganization.id,
      scope: 'organization',
    });
    const organizationTenantB = await tenantContextService.resolveTenantContext({
      accountId: ownerB.id,
      organizationId: organizationB.id,
      scope: 'organization',
    });
    const tenantA = await tenantContextService.resolveTenantContext({
      accountId: ownerA.id,
      clubId: defaultClub.id,
      organizationId: defaultOrganization.id,
      scope: 'club',
    });
    const tenantSibling = await tenantContextService.resolveTenantContext({
      accountId: ownerA.id,
      clubId: siblingClub.id,
      organizationId: defaultOrganization.id,
      scope: 'club',
    });
    const tenantB = await tenantContextService.resolveTenantContext({
      accountId: ownerB.id,
      clubId: clubB.id,
      organizationId: organizationB.id,
      scope: 'club',
    });

    const userA = await db.User.create({
      name: 'Feature 6.2 Client A',
      organizationId: defaultOrganization.id,
      phone: '+79996200001',
      phoneNormalized: '9996200001',
      source: 'Feature 6.2',
      status: 'active',
      webId: `feature-6-2-client-a-${Date.now()}`,
    });
    const userB = await db.User.create({
      name: 'Feature 6.2 Client B',
      organizationId: organizationB.id,
      phone: '+79996200002',
      phoneNormalized: '9996200002',
      source: 'Feature 6.2',
      status: 'active',
      webId: `feature-6-2-client-b-${Date.now()}`,
    });
    const skillA = await methodologyService.createSkill({
      direction: 'technique',
      name: `Feature 6.2 shared skill ${Date.now()}`,
    }, actorA, organizationTenantA);
    const skillB = await methodologyService.createSkill({
      direction: 'technique',
      name: skillA.name,
    }, actorB, organizationTenantB);
    const exerciseA = await methodologyService.createExercise({
      eLevel: 'E1',
      formats: ['personal'],
      mainSkillId: skillA.id,
      name: 'Feature 6.2 Organization A drill',
      skillLevelMax: 1,
      skillLevelMin: 0,
      status: 'approved',
    }, actorA, organizationTenantA);
    const exerciseB = await methodologyService.createExercise({
      eLevel: 'E1',
      formats: ['personal'],
      mainSkillId: skillB.id,
      name: 'Feature 6.2 Organization B drill',
      skillLevelMax: 1,
      skillLevelMin: 0,
      status: 'approved',
    }, actorB, organizationTenantB);

    await notesService.create(userA.id, {
      exerciseResults: [{ rating: 4, trainingExerciseId: exerciseA.id }],
      level: 'D',
      trainedAt: '2099-03-01',
    }, actorA, tenantA);
    await notesService.create(userA.id, {
      exercises: 'Sibling club session',
      level: 'D+',
      trainedAt: '2099-03-02',
    }, actorA, tenantSibling);
    await notesService.create(userB.id, {
      exercises: 'Organization B session',
      level: 'D',
      trainedAt: '2099-03-03',
    }, actorB, tenantB);
    assert.deepEqual(
      (await notesService.listByClient(userA.id, { actor: actorA, tenant: tenantA }))
        .map((note) => note.trainedAt),
      ['2099-03-01'],
    );
    assert.deepEqual(
      (await notesService.listByClient(userA.id, { actor: actorA, tenant: tenantSibling }))
        .map((note) => note.trainedAt),
      ['2099-03-02'],
    );
    await assert.rejects(
      notesService.listByClient(userB.id, { actor: actorA, tenant: tenantA }),
      /Клиент не найден/,
    );
    const defaultClubRecommendation = await recommendationsService.recommendForClient(
      userA.id,
      { date: '2099-03-03' },
      actorA,
      tenantA,
    );
    const siblingClubRecommendation = await recommendationsService.recommendForClient(
      userA.id,
      { date: '2099-03-03' },
      actorA,
      tenantSibling,
    );
    assert.equal(defaultClubRecommendation.summary.historyDepth, 1);
    assert.equal(defaultClubRecommendation.summary.latestTrainingLevel, 'D');
    assert.equal(siblingClubRecommendation.summary.historyDepth, 1);
    assert.equal(siblingClubRecommendation.summary.latestTrainingLevel, 'D+');
    await assert.rejects(
      notesService.create(userA.id, {
        exerciseResults: [{ rating: 4, trainingExerciseId: exerciseB.id }],
        level: 'D',
        trainedAt: '2099-03-04',
      }, actorA, tenantA),
      /утвержденной базы/,
    );
    await assert.rejects(
      notesService.listByClient(userA.id, { actor: actorA, tenant: { ...tenantA } }),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );

    const planA = await plansService.create({
      clientIds: [userA.id],
      kind: 'personal',
      plannedAt: '2099-03-05',
      plannedExercises: [{ trainingExerciseId: exerciseA.id }],
    }, actorA, tenantA);
    const planSibling = await plansService.create({
      clientIds: [userA.id],
      kind: 'personal',
      plannedAt: '2099-03-06',
      plannedExercises: [{ trainingExerciseId: exerciseA.id }],
    }, actorA, tenantSibling);
    assert.deepEqual(
      (await plansService.list({}, actorA, tenantA)).map((plan) => Number(plan.id)),
      [Number(planA.id)],
    );
    assert.deepEqual(
      (await plansService.list({}, actorA, tenantSibling)).map((plan) => Number(plan.id)),
      [Number(planSibling.id)],
    );
    await assert.rejects(
      plansService.getById(planA.id, actorA, tenantSibling),
      /План тренировки не найден/,
    );
    await assert.rejects(
      plansService.updateExercises(planA.id, {
        plannedExercises: [{ trainingExerciseId: exerciseA.id }],
      }, actorA, tenantSibling),
      /План тренировки не найден/,
    );
    await assert.rejects(
      plansService.complete(planA.id, { level: 'D' }, actorA, tenantSibling),
      /План тренировки не найден/,
    );

    const noteA = await db.TrainingNote.findOne({
      where: { clubId: defaultClub.id, userId: userA.id },
    });
    await assert.rejects(
      notesService.update(noteA.id, { note: 'cross-club update' }, actorA, tenantSibling),
      /Запись тренировки не найдена/,
    );
    await assert.rejects(
      notesService.remove(noteA.id, actorA, tenantSibling),
      /Запись тренировки не найдена/,
    );
    await assert.rejects(
      plansService.quickComplete(planA.id, {}, actorA, tenantSibling),
      /План тренировки не найден/,
    );
    await expectDatabaseReject(
      db.TrainingPlanParticipant.update(
        { trainingNoteId: noteA.id },
        { where: { trainingPlanId: planSibling.id } },
      ),
      /participant note provenance mismatch/,
    );
    await expectDatabaseReject(
      db.sequelize.query(
        'UPDATE TrainingNotes SET clubId=:clubId WHERE id=:id',
        { replacements: { clubId: siblingClub.id, id: noteA.id } },
      ),
      /clubId is immutable/,
    );

    const trainerStaff = await db.Staff.create({
      name: 'Feature 6.2 trainer',
      organizationId: defaultOrganization.id,
      role: 'Тренер',
      status: 'active',
    });
    const trainerAccount = await db.Account.create({
      email: `feature-6-2-trainer-${Date.now()}@example.test`,
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
    const trainerAccess = await db.MembershipClubAccess.create({
      clubId: defaultClub.id,
      membershipId: trainerMembership.id,
      organizationId: defaultOrganization.id,
      roleOverride: null,
      status: 'active',
    });
    const staleTrainerTenant = await tenantContextService.resolveTenantContext({
      accountId: trainerAccount.id,
      clubId: defaultClub.id,
      organizationId: defaultOrganization.id,
      scope: 'club',
    });
    await trainerAccess.update({ status: 'inactive' });
    await assert.rejects(
      notesService.create(userA.id, {
        exercises: 'stale authority',
        level: 'D',
        trainedAt: '2099-03-07',
      }, { id: trainerAccount.id, role: 'trainer' }, staleTrainerTenant),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    await trainerAccess.update({ status: 'active' });

    const court = await db.Court.create({
      clubId: defaultClub.id,
      isActive: true,
      name: `Feature 6.2 court ${Date.now()}`,
      organizationId: defaultOrganization.id,
      sortOrder: 0,
      type: 'padel_double',
    });
    const booking = await db.Booking.create({
      bookingType: 'personal_training',
      clientName: userA.name,
      clientPhone: userA.phone,
      clubId: defaultClub.id,
      courtId: court.id,
      durationMinutes: 60,
      endsAt: new Date('2099-03-08T11:00:00.000Z'),
      organizationId: defaultOrganization.id,
      responsibleStaffId: trainerStaff.id,
      startsAt: new Date('2099-03-08T10:00:00.000Z'),
      userId: userA.id,
    });
    await assert.rejects(
      plansService.createFromBooking(booking.id, actorA, tenantSibling),
      /Бронь не найдена/,
    );
    const bookingPlan = await plansService.createFromBooking(booking.id, actorA, tenantA);
    assert.equal(Number(bookingPlan.bookingId), Number(booking.id));
    await plansService.quickComplete(bookingPlan.id, {}, actorA, tenantA);
    assert.equal(
      await db.TrainingNote.count({
        where: { clubId: defaultClub.id, userId: userA.id },
      }) >= 2,
      true,
    );

    await db.TrainingNote.create({
      clubId: defaultClub.id,
      exercises: 'training A',
      isTraining: true,
      level: 'D',
      trainedAt: '2099-03-09',
      trainingAccountId: ownerA.id,
      trainingRole: 'owner',
      userId: userA.id,
    });
    const siblingTrainingNote = await db.TrainingNote.create({
      clubId: siblingClub.id,
      exercises: 'training sibling',
      isTraining: true,
      level: 'D',
      trainedAt: '2099-03-10',
      trainingAccountId: ownerA.id,
      trainingRole: 'owner',
      userId: userA.id,
    });
    process.env.TENANT_TRAINING_NOTES_PLANS_ENABLED = 'false';
    const legacyNotes = await notesService.listByClient(userA.id, {
      actor: actorA,
      tenant: tenantSibling,
    });
    assert.equal(legacyNotes.some((note) => note.id === siblingTrainingNote.id), true);
    const legacyCreatedNotes = await notesService.create(
      userA.id,
      {
        exercises: 'flag-off default-club compatibility',
        level: 'D',
        trainedAt: '2099-03-11',
      },
      actorA,
      tenantSibling,
    );
    const legacyCreatedId = legacyCreatedNotes.find((note) =>
      note.exercises === 'flag-off default-club compatibility')?.id;
    assert.ok(legacyCreatedId);
    assert.equal(
      Number((await db.TrainingNote.findByPk(legacyCreatedId)).clubId),
      Number(defaultClub.id),
    );
    process.env.TENANT_TRAINING_NOTES_PLANS_ENABLED = 'true';
    const summary = await onboardingService.getTrainingDataSummary(
      actorA,
      { role: 'owner' },
      tenantA,
    );
    assert.equal(summary.entities.find((item) => item.key === 'trainingNotes').count, 1);
    await onboardingService.cleanupTrainingData(actorA, { role: 'owner' }, tenantA);
    assert.equal(await db.TrainingNote.count({ where: { id: siblingTrainingNote.id } }), 1);

    await assert.rejects(
      migration.down(queryInterface, SequelizePackage),
      (error) => error.code === 'TENANT_TRAINING_OPERATIONS_ROLLBACK_SECOND_ORGANIZATION',
    );

    await db.TrainingNote.destroy({ where: { clubId: clubB.id } });
    await db.TrainingExercise.destroy({ where: { organizationId: organizationB.id } });
    await db.TrainingSkill.destroy({ where: { organizationId: organizationB.id } });
    await db.User.destroy({ where: { organizationId: organizationB.id } });
    await membershipB.destroy();
    await ownerB.destroy();
    await clubB.destroy();
    await organizationB.destroy();
    await assert.rejects(
      migration.down(queryInterface, SequelizePackage),
      (error) => error.code === 'TENANT_TRAINING_OPERATIONS_ROLLBACK_NON_DEFAULT_CLUB',
    );

    await db.TrainingPlan.destroy({ where: { clubId: siblingClub.id } });
    await db.TrainingNote.destroy({ where: { clubId: siblingClub.id } });
    const beforeLifecycle = JSON.stringify(await schema.query(
      'SELECT id, clubId, userId, trainedAt FROM TrainingNotes ORDER BY id',
      { type: SequelizePackage.QueryTypes.SELECT },
    ));
    await migration.down(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'legacy');
    await migration.up(queryInterface, SequelizePackage);
    assert.equal((await migration.__testing.classifyState(queryInterface)).state, 'ready');
    assert.equal(JSON.stringify(await schema.query(
      'SELECT id, clubId, userId, trainedAt FROM TrainingNotes ORDER BY id',
      { type: SequelizePackage.QueryTypes.SELECT },
    )), beforeLifecycle);
    await migration.up(queryInterface, SequelizePackage);
  } finally {
    if (db?.sequelize) await db.sequelize.close();
    if (schema) await schema.close();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
    restoreEnv(previous);
  }
});
