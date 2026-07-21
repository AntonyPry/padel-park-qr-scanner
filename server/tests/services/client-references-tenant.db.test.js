'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');
const {
  ACCEPTED_TENANT_CAPABILITY_ENV,
  applyAcceptedTenantMigrations,
} = require('../helpers/accepted-tenant-schema');
const {
  INSTALLATION_MANAGEMENT_MIGRATION_FILE,
  assertFeature10_4IntegrationConnectionSchema,
} = require('../helpers/feature-10-4-schema');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const FEATURE_MIGRATION_FILE =
  '20260716160000-add-tenant-clients-references.js';
const VISITS_MIGRATION_FILE = '20260716180000-add-tenant-visits-scanner.js';
const BIRTH_DATE_MIGRATION_FILE =
  '20260721100000-add-client-birth-date.js';
const CAPABILITY_ENV = ACCEPTED_TENANT_CAPABILITY_ENV;

function databaseName() {
  return (
    process.env.CLIENT_REFERENCES_TEST_DB_NAME ||
    `setly_clients_references_f5_2_${process.pid}_${Date.now()}`
  );
}

async function createSchema(database) {
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
    .filter((file) => file.endsWith('.js') && file <= VISITS_MIGRATION_FILE)
    .sort();
  for (const file of migrations) {
    const migration = require(path.join(SERVER_ROOT, 'migrations', file));
    await migration.up(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
  }
  return sequelize;
}

async function applyTrackedMigration(queryInterface, file) {
  const [applied] = await queryInterface.sequelize.query(
    'SELECT name FROM SequelizeMeta WHERE name=:name LIMIT 1',
    {
      replacements: { name: file },
      type: SequelizePackage.QueryTypes.SELECT,
    },
  );
  if (applied) return;

  const migration = require(path.join(SERVER_ROOT, 'migrations', file));
  await migration.up(queryInterface, SequelizePackage);
  await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
}

function databaseErrorCode(error) {
  return error?.original?.code || error?.parent?.code || error?.code;
}

async function snapshotClientReferenceData(sequelize) {
  const [users, sources, categories] = await Promise.all([
    sequelize.query(
      `SELECT id, organizationId, telegramId, vkId, webId, name, phone,
              phoneNormalized, source, sourceId, note, status,
              mergedIntoUserId, mergedAt, mergedByAccountId, isTraining,
              trainingRole, trainingAccountId, createdAt, updatedAt
         FROM Users
        ORDER BY id`,
      { type: SequelizePackage.QueryTypes.SELECT },
    ),
    sequelize.query(
      `SELECT id, organizationId, name, status, sortOrder, createdAt, updatedAt
         FROM ClientSources
        ORDER BY id`,
      { type: SequelizePackage.QueryTypes.SELECT },
    ),
    sequelize.query(
      `SELECT id, organizationId, name, status, sortOrder, createdAt, updatedAt
         FROM VisitCategories
        ORDER BY id`,
      { type: SequelizePackage.QueryTypes.SELECT },
    ),
  ]);
  const rows = { categories, sources, users };
  return {
    checksum: crypto
      .createHash('sha256')
      .update(JSON.stringify(rows))
      .digest('hex'),
    counts: {
      categories: categories.length,
      sources: sources.length,
      users: users.length,
    },
    rows,
  };
}

async function namedForeignKeyGraph(sequelize, constraintNames) {
  return sequelize.query(
    `SELECT kcu.CONSTRAINT_NAME AS constraintName,
            kcu.COLUMN_NAME AS columnName,
            kcu.ORDINAL_POSITION AS ordinalPosition,
            kcu.REFERENCED_TABLE_NAME AS referencedTableName,
            kcu.REFERENCED_COLUMN_NAME AS referencedColumnName,
            rc.DELETE_RULE AS deleteRule,
            rc.UPDATE_RULE AS updateRule
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS kcu
       JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS AS rc
         ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
        AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND rc.TABLE_NAME = kcu.TABLE_NAME
      WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
        AND kcu.TABLE_NAME = 'Users'
        AND kcu.CONSTRAINT_NAME IN (:constraintNames)
      ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
    {
      replacements: { constraintNames },
      type: SequelizePackage.QueryTypes.SELECT,
    },
  );
}

function assertSafeConflict(error) {
  assert.equal(error?.statusCode, 409);
  assert.ok(
    ['CLIENT_ACTIVE_CONFLICT', 'CLIENT_ARCHIVED_CONFLICT'].includes(error?.code),
    `unexpected conflict code: ${error?.code || '<missing>'}`,
  );
  return true;
}

async function oneSuccessOneConflict(operations) {
  const results = await Promise.allSettled(operations);
  const successes = results.filter((result) => result.status === 'fulfilled');
  const failures = results.filter((result) => result.status === 'rejected');
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assertSafeConflict(failures[0].reason);
  return successes[0].value;
}

test('Feature 5.2 clients/references DB isolation and compatibility', async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const previousCapabilities = Object.fromEntries(
    CAPABILITY_ENV.map((name) => [name, process.env[name]]),
  );
  const previousIntegrationSecretsMasterKey =
    process.env.INTEGRATION_SECRETS_MASTER_KEY;
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
  process.env.INTEGRATION_SECRETS_MASTER_KEY = Buffer.alloc(32, 52).toString(
    'base64',
  );
  for (const name of CAPABILITY_ENV) process.env[name] = 'true';

  let schema;
  let db;
  try {
    schema = await createSchema(database);
    db = require('../../models');
    const authService = require('../../src/services/auth.service');
    const clientsService = require('../../src/services/clients.service');
    const referencesService = require('../../src/services/references.service');
    const {
      createConnection,
      serializeConnection,
    } = require('../../src/provider-integrations/connection-service');
    const migration = require(`../../migrations/${FEATURE_MIGRATION_FILE}`);
    const visitsMigration = require(`../../migrations/${VISITS_MIGRATION_FILE}`);
    const queryInterface = schema.getQueryInterface();

    await visitsMigration.down(queryInterface, SequelizePackage);
    await queryInterface.bulkDelete('SequelizeMeta', { name: VISITS_MIGRATION_FILE });

    await t.test('fresh pending migration cleans up a forced failure and reapplies', async () => {
      await migration.down(queryInterface, SequelizePackage);
      for (const tableName of ['Users', 'ClientSources', 'VisitCategories']) {
        assert.equal(
          (await queryInterface.describeTable(tableName)).organizationId,
          undefined,
        );
      }

      const failingQueryInterface = new Proxy(queryInterface, {
        get(target, property) {
          if (property === 'addConstraint') {
            return async (table, definition) => {
              if (definition.name === 'fk_users_organization_source') {
                throw new Error('Forced client/reference migration failure');
              }
              return target.addConstraint(table, definition);
            };
          }
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      let forcedError;
      await assert.rejects(
        migration.up(failingQueryInterface, SequelizePackage),
        (error) => {
          forcedError = error;
          return /Forced client\/reference migration failure/.test(error.message);
        },
      );
      assert.equal(forcedError.cleanupError, undefined, forcedError.cleanupError?.stack);
      for (const tableName of ['Users', 'ClientSources', 'VisitCategories']) {
        assert.equal(
          (await queryInterface.describeTable(tableName)).organizationId,
          undefined,
        );
      }

      await migration.up(queryInterface, SequelizePackage);
      for (const tableName of ['Users', 'ClientSources', 'VisitCategories']) {
        const column = (await queryInterface.describeTable(tableName)).organizationId;
        assert.ok(column);
        assert.equal(column.allowNull, false);
      }
    });

    const ownerSession = await authService.bootstrapOwner({
      email: 'owner@clients-references.test',
      name: 'Client Tenant Owner',
      password: 'ClientTenant123!',
    });
    const owner = await db.Account.findByPk(ownerSession.account.id);
    const defaultOrganization = await db.Organization.findOne({
      where: { slug: 'padel-park' },
    });
    const defaultClub = await db.Club.findOne({
      where: { organizationId: defaultOrganization.id },
    });
    const defaultMembership = await db.Membership.findOne({
      where: {
        accountId: owner.id,
        organizationId: defaultOrganization.id,
      },
    });
    await t.test('single-default data-aware down/up preserves counts, checksum and FK graph', async () => {
      const migrationSource = await db.ClientSource.create({
        name: 'Migration roundtrip source',
        organizationId: defaultOrganization.id,
        sortOrder: 91,
        status: 'active',
      });
      const migrationCategory = await db.VisitCategory.create({
        name: 'Migration roundtrip category',
        organizationId: defaultOrganization.id,
        sortOrder: 92,
        status: 'active',
      });
      const migrationRoot = await db.User.create({
        name: 'Migration Root',
        organizationId: defaultOrganization.id,
        phone: '+7 (999) 710-00-01',
        phoneNormalized: '9997100001',
        source: migrationSource.name,
        sourceId: migrationSource.id,
        status: 'active',
        webId: 'migration-roundtrip-root',
      });
      const migrationMiddle = await db.User.create({
        mergedAt: new Date(),
        mergedIntoUserId: migrationRoot.id,
        name: 'Migration Middle',
        organizationId: defaultOrganization.id,
        phone: '+7 (999) 710-00-02',
        phoneNormalized: '9997100002',
        source: migrationSource.name,
        sourceId: migrationSource.id,
        status: 'archived',
        webId: 'migration-roundtrip-middle',
      });
      const migrationLeaf = await db.User.create({
        mergedAt: new Date(),
        mergedIntoUserId: migrationMiddle.id,
        name: 'Migration Leaf',
        organizationId: defaultOrganization.id,
        phone: '+7 (999) 710-00-03',
        phoneNormalized: '9997100003',
        source: migrationSource.name,
        sourceId: migrationSource.id,
        status: 'archived',
        webId: 'migration-roundtrip-leaf',
      });

      const before = await snapshotClientReferenceData(schema);
      await migration.down(queryInterface, SequelizePackage);
      for (const tableName of ['Users', 'ClientSources', 'VisitCategories']) {
        assert.equal(
          (await queryInterface.describeTable(tableName)).organizationId,
          undefined,
        );
      }
      const legacyRows = await schema.query(
        `SELECT id, sourceId, mergedIntoUserId
           FROM Users
          WHERE id IN (:ids)
          ORDER BY id`,
        {
          replacements: {
            ids: [migrationRoot.id, migrationMiddle.id, migrationLeaf.id],
          },
          type: SequelizePackage.QueryTypes.SELECT,
        },
      );
      assert.deepEqual(
        legacyRows.map((row) => ({
          id: Number(row.id),
          mergedIntoUserId:
            row.mergedIntoUserId == null ? null : Number(row.mergedIntoUserId),
          sourceId: Number(row.sourceId),
        })),
        [
          {
            id: migrationRoot.id,
            mergedIntoUserId: null,
            sourceId: migrationSource.id,
          },
          {
            id: migrationMiddle.id,
            mergedIntoUserId: migrationRoot.id,
            sourceId: migrationSource.id,
          },
          {
            id: migrationLeaf.id,
            mergedIntoUserId: migrationMiddle.id,
            sourceId: migrationSource.id,
          },
        ].sort((left, right) => left.id - right.id),
      );
      assert.deepEqual(
        await namedForeignKeyGraph(schema, [
          'fk_users_source_legacy',
          'fk_users_merged_into_legacy',
        ]),
        [
          {
            columnName: 'mergedIntoUserId',
            constraintName: 'fk_users_merged_into_legacy',
            deleteRule: 'SET NULL',
            ordinalPosition: 1,
            referencedColumnName: 'id',
            referencedTableName: 'Users',
            updateRule: 'CASCADE',
          },
          {
            columnName: 'sourceId',
            constraintName: 'fk_users_source_legacy',
            deleteRule: 'SET NULL',
            ordinalPosition: 1,
            referencedColumnName: 'id',
            referencedTableName: 'ClientSources',
            updateRule: 'CASCADE',
          },
        ],
      );

      await migration.up(queryInterface, SequelizePackage);
      const after = await snapshotClientReferenceData(schema);
      assert.deepEqual(after.counts, before.counts);
      assert.equal(after.checksum, before.checksum);
      assert.deepEqual(
        await namedForeignKeyGraph(schema, [
          'fk_users_organization_source',
          'fk_users_organization_merged_into',
        ]),
        [
          {
            columnName: 'organizationId',
            constraintName: 'fk_users_organization_merged_into',
            deleteRule: 'RESTRICT',
            ordinalPosition: 1,
            referencedColumnName: 'organizationId',
            referencedTableName: 'Users',
            updateRule: 'RESTRICT',
          },
          {
            columnName: 'mergedIntoUserId',
            constraintName: 'fk_users_organization_merged_into',
            deleteRule: 'RESTRICT',
            ordinalPosition: 2,
            referencedColumnName: 'id',
            referencedTableName: 'Users',
            updateRule: 'RESTRICT',
          },
          {
            columnName: 'organizationId',
            constraintName: 'fk_users_organization_source',
            deleteRule: 'RESTRICT',
            ordinalPosition: 1,
            referencedColumnName: 'organizationId',
            referencedTableName: 'ClientSources',
            updateRule: 'RESTRICT',
          },
          {
            columnName: 'sourceId',
            constraintName: 'fk_users_organization_source',
            deleteRule: 'RESTRICT',
            ordinalPosition: 2,
            referencedColumnName: 'id',
            referencedTableName: 'ClientSources',
            updateRule: 'RESTRICT',
          },
        ],
      );
      const historicalAttributes = [
        'id',
        'mergedIntoUserId',
        'organizationId',
        'sourceId',
      ];
      const restoredLeaf = await db.User.findByPk(migrationLeaf.id, {
        attributes: historicalAttributes,
      });
      const restoredMiddle = await db.User.findByPk(migrationMiddle.id, {
        attributes: historicalAttributes,
      });
      assert.equal(restoredLeaf.organizationId, defaultOrganization.id);
      assert.equal(restoredLeaf.sourceId, migrationSource.id);
      assert.equal(restoredLeaf.mergedIntoUserId, migrationMiddle.id);
      assert.equal(restoredMiddle.mergedIntoUserId, migrationRoot.id);
      assert.equal(
        (await db.VisitCategory.findByPk(migrationCategory.id)).organizationId,
        defaultOrganization.id,
      );

      await restoredLeaf.destroy();
      await restoredMiddle.destroy();
      await migrationRoot.destroy();
      await migrationSource.destroy();
      await migrationCategory.destroy();
    });

    await visitsMigration.up(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('SequelizeMeta', [{ name: VISITS_MIGRATION_FILE }]);
    await applyAcceptedTenantMigrations(queryInterface, {
      afterFile: VISITS_MIGRATION_FILE,
      throughFile: INSTALLATION_MANAGEMENT_MIGRATION_FILE,
    });
    await applyTrackedMigration(queryInterface, BIRTH_DATE_MIGRATION_FILE);
    assert.ok(
      (await queryInterface.describeTable('Users')).birthDate,
      'production-like schema must include Users.birthDate before current models load',
    );
    await assertFeature10_4IntegrationConnectionSchema(queryInterface);
    const tenantContextService = require('../../src/services/tenant-context.service');
    const defaultContext = await tenantContextService.resolveTenantContext({
      accountId: owner.id,
      organizationId: defaultOrganization.id,
      scope: 'organization',
    });
    const defaultClubContext = await tenantContextService.resolveTenantContext({
      accountId: owner.id,
      clubId: defaultClub.id,
      organizationId: defaultOrganization.id,
      scope: 'club',
    });

    const foreignOrganization = await db.Organization.create({
      name: 'Foreign Client Organization',
      slug: 'foreign-client-organization',
      status: 'active',
    });
    const foreignClub = await db.Club.create({
      name: 'Foreign Client Club',
      organizationId: foreignOrganization.id,
      slug: 'foreign-client-club',
      status: 'active',
    });
    const foreignOwner = await db.Account.create({
      email: `foreign-owner-${Date.now()}@clients-references.test`,
      passwordHash: 'test-only',
      role: 'owner',
      staffId: null,
      status: 'active',
    });
    const foreignMembership = await db.Membership.create({
      accountId: foreignOwner.id,
      organizationId: foreignOrganization.id,
      role: 'owner',
      staffId: null,
      status: 'active',
    });
    const foreignContext = await tenantContextService.resolveTenantContext({
      accountId: foreignOwner.id,
      organizationId: foreignOrganization.id,
      scope: 'organization',
    });
    const foreignClubContext = await tenantContextService.resolveTenantContext({
      accountId: foreignOwner.id,
      clubId: foreignClub.id,
      organizationId: foreignOrganization.id,
      scope: 'club',
    });

    let defaultSource;
    let foreignSource;
    let defaultCategory;
    let foreignCategory;
    let defaultClient;
    let foreignClient;

    await t.test('same dictionary names and client identities are unique per Organization', async () => {
      [defaultSource, foreignSource, defaultCategory, foreignCategory] =
        await Promise.all([
          referencesService.create(
            'client-sources',
            { name: 'Shared campaign' },
            defaultContext,
          ),
          referencesService.create(
            'client-sources',
            { name: 'Shared campaign' },
            foreignContext,
          ),
          referencesService.create(
            'visit-categories',
            { name: 'Shared purpose' },
            defaultContext,
          ),
          referencesService.create(
            'visit-categories',
            { name: 'Shared purpose' },
            foreignContext,
          ),
        ]);

      const sharedIdentity = `shared-client-${Date.now()}`;
      const defaultResult = await clientsService.createClient(
        {
          name: 'Default Client',
          phone: '+79990001122',
          sourceId: defaultSource.id,
          telegramId: sharedIdentity,
        },
        null,
        defaultContext,
      );
      const foreignResult = await clientsService.createClient(
        {
          name: 'Foreign Client',
          phone: '+79990001122',
          sourceId: foreignSource.id,
          telegramId: sharedIdentity,
        },
        null,
        foreignContext,
      );
      defaultClient = await db.User.findByPk(defaultResult.client.id);
      foreignClient = await db.User.findByPk(foreignResult.client.id);
      assert.equal(defaultClient.organizationId, defaultOrganization.id);
      assert.equal(foreignClient.organizationId, foreignOrganization.id);
      assert.notEqual(defaultClient.sourceId, foreignClient.sourceId);

      const defaultSources = await referencesService.list(
        'client-sources',
        { status: 'all' },
        defaultContext,
      );
      const foreignSources = await referencesService.list(
        'client-sources',
        { status: 'all' },
        foreignContext,
      );
      assert.ok(defaultSources.some((row) => row.id === defaultSource.id));
      assert.equal(defaultSources.some((row) => row.id === foreignSource.id), false);
      assert.ok(foreignSources.some((row) => row.id === foreignSource.id));
      assert.equal(foreignSources.some((row) => row.id === defaultSource.id), false);
    });

    await t.test('concurrent same-Organization phone and messenger writes yield one safe 409', async () => {
      const phoneWinner = await oneSuccessOneConflict([
        clientsService.createClient(
          {
            name: 'Concurrent Phone A',
            phone: '+7 (999) 555-10-01',
            sourceId: defaultSource.id,
            telegramId: 'concurrent-phone-a',
          },
          null,
          defaultContext,
        ),
        clientsService.createClient(
          {
            name: 'Concurrent Phone B',
            phone: '+7 (999) 555-10-01',
            sourceId: defaultSource.id,
            telegramId: 'concurrent-phone-b',
          },
          null,
          defaultContext,
        ),
      ]);
      assert.equal(
        await db.User.count({
          where: {
            organizationId: defaultOrganization.id,
            phoneNormalized: '9995551001',
          },
        }),
        1,
      );
      assert.equal(
        (await db.User.findByPk(phoneWinner.client.id)).organizationId,
        defaultOrganization.id,
      );

      const messengerIdentity = 'concurrent-messenger-identity';
      const messengerWinner = await oneSuccessOneConflict([
        clientsService.createClient(
          {
            name: 'Concurrent Messenger A',
            phone: '+7 (999) 555-10-02',
            sourceId: defaultSource.id,
            telegramId: messengerIdentity,
          },
          null,
          defaultContext,
        ),
        clientsService.createClient(
          {
            name: 'Concurrent Messenger B',
            phone: '+7 (999) 555-10-03',
            sourceId: defaultSource.id,
            telegramId: messengerIdentity,
          },
          null,
          defaultContext,
        ),
      ]);
      assert.equal(
        await db.User.count({
          where: {
            organizationId: defaultOrganization.id,
            telegramId: messengerIdentity,
          },
        }),
        1,
      );
      assert.equal(
        (await db.User.findByPk(messengerWinner.client.id)).organizationId,
        defaultOrganization.id,
      );
    });

    await t.test('identical identities can be created concurrently in different Organizations', async () => {
      const sharedMessengerIdentity = 'concurrent-cross-organization';
      const [defaultResult, foreignResult] = await Promise.all([
        clientsService.createClient(
          {
            name: 'Concurrent Default Organization',
            phone: '+7 (999) 555-20-01',
            sourceId: defaultSource.id,
            telegramId: sharedMessengerIdentity,
          },
          null,
          defaultContext,
        ),
        clientsService.createClient(
          {
            name: 'Concurrent Foreign Organization',
            phone: '+7 (999) 555-20-01',
            sourceId: foreignSource.id,
            telegramId: sharedMessengerIdentity,
          },
          null,
          foreignContext,
        ),
      ]);
      assert.notEqual(defaultResult.client.id, foreignResult.client.id);
      const rows = await db.User.findAll({
        order: [['organizationId', 'ASC']],
        where: {
          phoneNormalized: '9995552001',
          telegramId: sharedMessengerIdentity,
        },
      });
      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows.map((row) => Number(row.organizationId)).sort((left, right) => left - right),
        [defaultOrganization.id, foreignOrganization.id].sort(
          (left, right) => left - right,
        ),
      );
    });

    await t.test('authoritative Telegram/VK connections are reloaded and fail closed', async () => {
      const telegramConnection = await createConnection({
        clubId: defaultClub.id,
        connectionKey: 'clients-regression-telegram',
        organizationId: defaultOrganization.id,
        provider: 'telegram',
        secrets: { botToken: 'telegram-regression-secret' },
      });
      const vkConnection = await createConnection({
        clubId: defaultClub.id,
        connectionKey: 'clients-regression-vk',
        organizationId: defaultOrganization.id,
        provider: 'vk',
        secrets: { botToken: 'vk-regression-secret' },
      });
      const telegramAuthority = serializeConnection(telegramConnection);
      const vkAuthority = serializeConnection(vkConnection);

      const telegramResult = await clientsService.registerClientFromMessenger({
        externalId: 'authoritative-telegram-valid',
        messenger: 'telegram',
        name: 'Authoritative Telegram',
        phone: '+7 (999) 555-30-01',
        source: defaultSource.name,
        tenant: telegramAuthority,
      });
      const vkResult = await clientsService.registerClientFromMessenger({
        externalId: 'authoritative-vk-valid',
        messenger: 'vk',
        name: 'Authoritative VK',
        phone: '+7 (999) 555-30-02',
        source: defaultSource.name,
        tenant: vkAuthority,
      });
      assert.equal(
        (await db.User.findByPk(telegramResult.client.id)).organizationId,
        defaultOrganization.id,
      );
      assert.equal(
        (await db.User.findByPk(vkResult.client.id)).organizationId,
        defaultOrganization.id,
      );

      const forgedAuthorities = [
        Object.freeze({
          ...telegramAuthority,
          organizationId: foreignOrganization.id,
        }),
        Object.freeze({ ...telegramAuthority, clubId: foreignClub.id }),
        Object.freeze({ ...telegramAuthority, provider: 'vk' }),
      ];
      for (let index = 0; index < forgedAuthorities.length; index += 1) {
        await assert.rejects(
          clientsService.registerClientFromMessenger({
            externalId: `authoritative-forged-${index}`,
            messenger: 'telegram',
            name: `Forged Provider ${index}`,
            phone: `+7 (999) 555-31-0${index + 1}`,
            source: defaultSource.name,
            tenant: forgedAuthorities[index],
          }),
          (error) => error.statusCode === 404,
        );
      }
      assert.equal(
        await db.User.count({
          where: {
            telegramId: [
              'authoritative-forged-0',
              'authoritative-forged-1',
              'authoritative-forged-2',
            ],
          },
        }),
        0,
      );

      await telegramConnection.update({ status: 'disabled' });
      await telegramConnection.reload();
      assert.equal(telegramConnection.status, 'disabled');
      await assert.rejects(
        clientsService.registerClientFromMessenger({
          externalId: 'authoritative-telegram-disabled',
          messenger: 'telegram',
          name: 'Disabled Telegram',
          phone: '+7 (999) 555-32-01',
          source: defaultSource.name,
          tenant: telegramAuthority,
        }),
        (error) => error.statusCode === 404,
      );

      await vkConnection.update({ status: 'revoked' });
      await vkConnection.reload();
      assert.equal(vkConnection.status, 'revoked');
      await assert.rejects(
        clientsService.registerClientFromMessenger({
          externalId: 'authoritative-vk-revoked',
          messenger: 'vk',
          name: 'Revoked VK',
          phone: '+7 (999) 555-32-02',
          source: defaultSource.name,
          tenant: vkAuthority,
        }),
        (error) => error.statusCode === 404,
      );
      assert.equal(
        await db.User.count({
          where: {
            telegramId: 'authoritative-telegram-disabled',
          },
        }),
        0,
      );
      assert.equal(
        await db.User.count({ where: { vkId: 'authoritative-vk-revoked' } }),
        0,
      );
    });

    await t.test('organization and club request contexts isolate reads and ID mutations', async () => {
      const defaultList = await clientsService.listClients(
        { page: 1, pageSize: 25, status: 'all' },
        owner,
        defaultContext,
      );
      const foreignList = await clientsService.listClients(
        { page: 1, pageSize: 25, status: 'all' },
        owner,
        foreignClubContext,
      );
      assert.ok(defaultList.items.some((row) => row.id === defaultClient.id));
      assert.equal(defaultList.items.some((row) => row.id === foreignClient.id), false);
      assert.ok(foreignList.items.some((row) => row.id === foreignClient.id));
      assert.equal(foreignList.items.some((row) => row.id === defaultClient.id), false);
      assert.equal(
        Object.prototype.hasOwnProperty.call(defaultList.items[0], 'organizationId'),
        false,
      );

      assert.equal(
        (await clientsService.findActiveByPhone('+79990001122', defaultClubContext)).id,
        defaultClient.id,
      );
      assert.equal(
        (await clientsService.findActiveByPhone('+79990001122', foreignContext)).id,
        foreignClient.id,
      );
      await assert.rejects(
        clientsService.getClientDetails(foreignClient.id, owner, defaultContext),
        (error) => error.statusCode === 404,
      );
      await assert.rejects(
        clientsService.updateClient(
          foreignClient.id,
          { name: 'Cross-org update' },
          owner,
          defaultContext,
        ),
        (error) => error.statusCode === 404,
      );
      await assert.rejects(
        referencesService.update(
          'client-sources',
          foreignSource.id,
          { name: 'Cross-org source update' },
          defaultContext,
        ),
        (error) => error.statusCode === 404,
      );
      assert.equal((await db.User.findByPk(foreignClient.id)).name, 'Foreign Client');
    });

    await t.test('merge, reference assignment and tenant attribution reject cross-org graphs', async () => {
      await assert.rejects(
        clientsService.mergeClients(
          defaultClient.id,
          [foreignClient.id],
          owner,
          defaultContext,
        ),
        (error) => error.statusCode === 404,
      );
      await assert.rejects(
        foreignClient.update({ sourceId: defaultSource.id }),
        (error) => error.name === 'SequelizeForeignKeyConstraintError',
      );
      await assert.rejects(
        foreignClient.update({ mergedIntoUserId: defaultClient.id }),
        (error) => error.name === 'SequelizeForeignKeyConstraintError',
      );
      await assert.rejects(
        defaultClient.update({ organizationId: foreignOrganization.id }),
        (error) =>
          error.code === 'CLIENT_ORGANIZATION_IMMUTABLE' ||
          error.parent?.code === 'ER_SIGNAL_EXCEPTION',
      );
      const sourceRow = await db.ClientSource.findByPk(defaultSource.id);
      await assert.rejects(
        sourceRow.update({ organizationId: foreignOrganization.id }),
        (error) =>
          error.code === 'CLIENT_REFERENCE_ORGANIZATION_IMMUTABLE' ||
          error.parent?.code === 'ER_SIGNAL_EXCEPTION',
      );
      assert.equal(
        (await db.User.findByPk(defaultClient.id)).organizationId,
        defaultOrganization.id,
      );
    });

    await t.test('raw SQL organization attribution mutation is rejected without data changes', async () => {
      const targets = [
        { id: defaultClient.id, tableName: 'Users' },
        { id: defaultSource.id, tableName: 'ClientSources' },
        { id: defaultCategory.id, tableName: 'VisitCategories' },
      ];
      for (const target of targets) {
        const before = await schema.query(
          `SELECT * FROM \`${target.tableName}\` WHERE id = :id`,
          {
            replacements: { id: target.id },
            type: SequelizePackage.QueryTypes.SELECT,
          },
        );
        await assert.rejects(
          schema.query(
            `UPDATE \`${target.tableName}\`
                SET organizationId = :organizationId
              WHERE id = :id`,
            {
              replacements: {
                id: target.id,
                organizationId: foreignOrganization.id,
              },
            },
          ),
          (error) => databaseErrorCode(error) === 'ER_SIGNAL_EXCEPTION',
        );
        const after = await schema.query(
          `SELECT * FROM \`${target.tableName}\` WHERE id = :id`,
          {
            replacements: { id: target.id },
            type: SequelizePackage.QueryTypes.SELECT,
          },
        );
        assert.deepEqual(after, before);
        assert.equal(Number(after[0].organizationId), defaultOrganization.id);
      }
    });

    await t.test('forged and stale tenant authority fail closed', async () => {
      const forged = Object.freeze({
        ...defaultContext,
        membershipId: foreignMembership.id,
      });
      await assert.rejects(
        clientsService.listClients({}, owner, forged),
        (error) => error.statusCode === 404,
      );

      await foreignMembership.update({ status: 'inactive' });
      await assert.rejects(
        referencesService.list('client-sources', {}, foreignContext),
        (error) => error.statusCode === 404,
      );
      await foreignMembership.update({ status: 'active' });
    });

    await t.test('flag off fails closed after a second tenant exists', async () => {
      process.env.TENANT_CLIENTS_REFERENCES_ENABLED = 'false';
      await assert.rejects(
        clientsService.listClients({ page: 1, pageSize: 25, status: 'all' }),
        (error) => error.code === 'TENANT_SINGLE_DEFAULT_REQUIRED',
      );
      process.env.TENANT_CLIENTS_REFERENCES_ENABLED = 'true';
    });

    await t.test('rollback preflight refuses a second Organization without dropping attribution', async () => {
      await assert.rejects(
        migration.down(queryInterface, SequelizePackage),
        /exactly one active default Organization/,
      );
      for (const tableName of ['Users', 'ClientSources', 'VisitCategories']) {
        assert.ok((await queryInterface.describeTable(tableName)).organizationId);
      }
      assert.ok(defaultCategory.id);
      assert.ok(foreignCategory.id);
    });
  } finally {
    for (const name of CAPABILITY_ENV) {
      if (previousCapabilities[name] === undefined) delete process.env[name];
      else process.env[name] = previousCapabilities[name];
    }
    if (previousIntegrationSecretsMasterKey === undefined) {
      delete process.env.INTEGRATION_SECRETS_MASTER_KEY;
    } else {
      process.env.INTEGRATION_SECRETS_MASTER_KEY =
        previousIntegrationSecretsMasterKey;
    }
    if (db?.sequelize) await db.sequelize.close().catch(() => {});
    if (schema) await schema.close().catch(() => {});
    if (process.env.KEEP_CLIENT_REFERENCES_TEST_DB === 'true') {
      console.log(`[tenant-clients-references] kept QA database ${database}`);
    } else {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => {});
    }
    await admin.end();
  }
});
