'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const FEATURE_MIGRATION_FILE = '20260718120000-add-tenant-bookings-courts.js';
const BUSINESS_TABLES = Object.freeze([
  'Courts',
  'BookingSettings',
  'BookingPriceRules',
  'BookingScheduleExceptions',
  'BookingSeries',
  'Bookings',
  'Utilizations',
  'CourtBlocks',
  'BookingParticipants',
  'BookingChangeLogs',
]);

function databaseName() {
  return process.env.BOOKINGS_COURTS_DEFINITIONS_TEST_DB_NAME ||
    `setly_bookings_courts_definitions_${process.pid}_${Date.now()}`;
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

function normalizeSnapshotValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (Array.isArray(value)) return value.map(normalizeSnapshotValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, normalizeSnapshotValue(value[key])]),
    );
  }
  return value;
}

async function definitionAndBusinessSnapshot(sequelize, queryInterface, migration) {
  const inventory = await migration.__testing.readInventory(queryInterface);
  const business = {};
  for (const table of BUSINESS_TABLES) {
    business[table] = await sequelize.query(
      `SELECT * FROM \`${table}\` ORDER BY id`,
      { type: SequelizePackage.QueryTypes.SELECT },
    );
  }
  const globalIndexes = {};
  for (const table of ['Courts', 'BookingScheduleExceptions', 'Utilizations']) {
    globalIndexes[table] = await queryInterface.showIndex(table);
  }
  return JSON.stringify(normalizeSnapshotValue({ business, globalIndexes, inventory }));
}

async function assertPartialRefusalIsMutationFree(
  sequelize,
  queryInterface,
  migration,
) {
  assert.equal(await migration.__testing.classifySchema(queryInterface), 'partial');
  const before = await definitionAndBusinessSnapshot(
    sequelize,
    queryInterface,
    migration,
  );
  await assert.rejects(
    () => migration.up(queryInterface, SequelizePackage),
    (error) => error.code === 'TENANT_BOOKINGS_COURTS_PARTIAL_SCHEMA',
  );
  const after = await definitionAndBusinessSnapshot(
    sequelize,
    queryInterface,
    migration,
  );
  assert.equal(after, before);
}

async function addCanonicalIndex(queryInterface, definition) {
  await queryInterface.addIndex(definition.table, definition.fields, {
    name: definition.name,
    unique: definition.unique,
  });
}

async function addCanonicalConstraint(queryInterface, definition) {
  await queryInterface.addConstraint(definition.table, {
    fields: definition.fields,
    name: definition.name,
    onDelete: definition.onDelete,
    onUpdate: definition.onUpdate,
    references: {
      fields: definition.referencedFields,
      table: definition.referencedTable,
    },
    type: 'foreign key',
  });
}

test('Feature 5.5 classifier and cleanup require exact owned definitions', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const previousFailure = process.env.TENANT_BOOKINGS_COURTS_MIGRATION_FAIL_STEP;
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    password: process.env.DB_PASSWORD,
    user: process.env.DB_USER,
  });
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );

  let schema;
  try {
    schema = await createSchemaBeforeFeature(database);
    const queryInterface = schema.getQueryInterface();
    const migration = require(`../../migrations/${FEATURE_MIGRATION_FILE}`);

    const owned = migration.__testing.tracker();
    await queryInterface.addColumn('Courts', 'organizationId', {
      allowNull: true,
      type: SequelizePackage.INTEGER,
    });
    await migration.__testing.trackCreatedArtifact(
      queryInterface,
      owned.columns,
      'column',
      { table: 'Courts', name: 'organizationId' },
    );
    await schema.query(
      'ALTER TABLE Courts MODIFY organizationId INT NULL DEFAULT 77',
    );
    const changedBeforeCleanup = await migration.__testing.readArtifactRows(
      queryInterface,
      'column',
      { table: 'Courts', name: 'organizationId' },
    );
    await assert.rejects(
      () => migration.__testing.cleanupInvocation(queryInterface, owned),
      (error) => error.code === 'TENANT_BOOKINGS_COURTS_CLEANUP_OWNERSHIP_LOST',
    );
    assert.equal(
      migration.__testing.artifactSignature(
        'column',
        await migration.__testing.readArtifactRows(
          queryInterface,
          'column',
          { table: 'Courts', name: 'organizationId' },
        ),
      ),
      migration.__testing.artifactSignature('column', changedBeforeCleanup),
    );
    await queryInterface.removeColumn('Courts', 'organizationId');

    for (const stage of [
      'columns',
      'not-null',
      'indexes',
      'constraints',
      'triggers',
      'legacy-uniques',
    ]) {
      process.env.TENANT_BOOKINGS_COURTS_MIGRATION_FAIL_STEP = stage;
      await assert.rejects(
        () => migration.up(queryInterface, SequelizePackage),
        (error) => error.code === 'TENANT_BOOKINGS_COURTS_MIGRATION_FORCED_FAILURE',
      );
      delete process.env.TENANT_BOOKINGS_COURTS_MIGRATION_FAIL_STEP;
      assert.equal(await migration.__testing.classifySchema(queryInterface), 'legacy');
    }

    await migration.up(queryInterface, SequelizePackage);
    assert.equal(await migration.__testing.classifySchema(queryInterface), 'ready');

    const columnCases = [
      {
        alter: 'ALTER TABLE Bookings MODIFY creationKeyHash VARCHAR(64) NULL DEFAULT \'forged-default\'',
        restore: 'ALTER TABLE Bookings MODIFY creationKeyHash VARCHAR(64) NULL DEFAULT NULL',
      },
      {
        alter: 'ALTER TABLE BookingSeries MODIFY creationPayloadHash VARCHAR(64) NOT NULL DEFAULT \'forged\'',
        restore: 'ALTER TABLE BookingSeries MODIFY creationPayloadHash VARCHAR(64) NULL DEFAULT NULL',
      },
      {
        alter: 'ALTER TABLE Bookings MODIFY lastMutationKeyHash VARCHAR(63) NULL DEFAULT NULL',
        restore: 'ALTER TABLE Bookings MODIFY lastMutationKeyHash VARCHAR(64) NULL DEFAULT NULL',
      },
      {
        alter: 'ALTER TABLE Bookings MODIFY lastMutationPayloadHash VARCHAR(64) NULL DEFAULT NULL INVISIBLE',
        restore: 'ALTER TABLE Bookings MODIFY lastMutationPayloadHash VARCHAR(64) NULL DEFAULT NULL',
      },
      {
        alter: 'ALTER TABLE Utilizations MODIFY organizationId INT NOT NULL DEFAULT 1',
        restore: 'ALTER TABLE Utilizations MODIFY organizationId INT NOT NULL',
      },
    ];
    for (const definitionCase of columnCases) {
      await schema.query(definitionCase.alter);
      await assertPartialRefusalIsMutationFree(schema, queryInterface, migration);
      await schema.query(definitionCase.restore);
      assert.equal(await migration.__testing.classifySchema(queryInterface), 'ready');
    }

    const clubConstraint = migration.__testing.FOREIGN_KEY_DEFINITIONS.find(
      (definition) =>
        definition.table === 'BookingPriceRules' &&
        definition.fields.length === 2,
    );
    await queryInterface.removeConstraint(clubConstraint.table, clubConstraint.name);
    await schema.query(
      'ALTER TABLE BookingPriceRules MODIFY organizationId INT UNSIGNED NOT NULL',
    );
    await assertPartialRefusalIsMutationFree(schema, queryInterface, migration);
    await schema.query('ALTER TABLE BookingPriceRules MODIFY organizationId INT NOT NULL');
    await addCanonicalConstraint(queryInterface, clubConstraint);
    assert.equal(await migration.__testing.classifySchema(queryInterface), 'ready');

    await queryInterface.removeConstraint(clubConstraint.table, clubConstraint.name);
    await schema.query(
      'ALTER TABLE BookingPriceRules MODIFY organizationId BIGINT NOT NULL',
    );
    await assertPartialRefusalIsMutationFree(schema, queryInterface, migration);
    await schema.query('ALTER TABLE BookingPriceRules MODIFY organizationId INT NOT NULL');
    await addCanonicalConstraint(queryInterface, clubConstraint);
    assert.equal(await migration.__testing.classifySchema(queryInterface), 'ready');

    const creationIndex = migration.__testing.INDEX_DEFINITIONS.find(
      (definition) => definition.name === 'uq_mt_bookings_creation_key',
    );
    await queryInterface.removeIndex(creationIndex.table, creationIndex.name);
    await schema.query(
      'CREATE UNIQUE INDEX uq_mt_bookings_creation_key ON Bookings (clubId, creationKeyHash(8))',
    );
    await assertPartialRefusalIsMutationFree(schema, queryInterface, migration);
    await queryInterface.removeIndex(creationIndex.table, creationIndex.name);
    await addCanonicalIndex(queryInterface, creationIndex);
    assert.equal(await migration.__testing.classifySchema(queryInterface), 'ready');

    const analyticsIndex = migration.__testing.INDEX_DEFINITIONS.find(
      (definition) => definition.name === 'idx_mt_bookings_analytics',
    );
    await queryInterface.removeIndex(analyticsIndex.table, analyticsIndex.name);
    await schema.query(
      'CREATE INDEX idx_mt_bookings_analytics ON Bookings (organizationId, clubId, status DESC, startsAt)',
    );
    const descendingRows = await migration.__testing.readArtifactRows(
      queryInterface,
      'index',
      { table: analyticsIndex.table, name: analyticsIndex.name },
    );
    if (descendingRows.some((row) => row.COLLATION === 'D')) {
      await assertPartialRefusalIsMutationFree(schema, queryInterface, migration);
    } else {
      const syntheticDescending = descendingRows.map((row, index) =>
        index === 2 ? { ...row, COLLATION: 'D' } : row);
      assert.equal(migration.__testing.indexesReady([
        ...(await migration.__testing.readInventory(queryInterface)).indexes
          .filter((row) => row.INDEX_NAME !== analyticsIndex.name),
        ...syntheticDescending,
      ]), false);
    }
    await queryInterface.removeIndex(analyticsIndex.table, analyticsIndex.name);
    await addCanonicalIndex(queryInterface, analyticsIndex);
    assert.equal(await migration.__testing.classifySchema(queryInterface), 'ready');

    await queryInterface.removeIndex(analyticsIndex.table, analyticsIndex.name);
    await schema.query(
      'CREATE FULLTEXT INDEX idx_mt_bookings_analytics ON Courts (name)',
    );
    await assertPartialRefusalIsMutationFree(schema, queryInterface, migration);
    await queryInterface.removeIndex('Courts', analyticsIndex.name);
    await addCanonicalIndex(queryInterface, analyticsIndex);
    assert.equal(await migration.__testing.classifySchema(queryInterface), 'ready');

    const trigger = migration.__testing.TRIGGER_DEFINITIONS.find(
      (definition) => definition.name === 'trg_mt_booking_bookings_bi',
    );
    await schema.query(`DROP TRIGGER \`${trigger.name}\``);
    const formattedBody = trigger.body
      .replace('BEGIN', 'BEGIN\n    ')
      .replace(/IF NOT EXISTS/g, 'IF   NOT   EXISTS')
      .replace('FROM Clubs club', 'FROM `Clubs` club');
    await schema.query(
      `CREATE TRIGGER \`${trigger.name}\` ${trigger.timing} ${trigger.event} ON \`${trigger.table}\` FOR EACH ROW ${formattedBody}`,
    );
    assert.equal(await migration.__testing.classifySchema(queryInterface), 'ready');
    assert.notEqual(
      migration.__testing.normalizeSql(trigger.body),
      migration.__testing.normalizeSql(
        trigger.body.replace(
          'Bookings requires an active authoritative Club',
          'bookings requires an active authoritative Club',
        ),
      ),
    );

    await schema.query(`DROP TRIGGER \`${trigger.name}\``);
    await schema.query(
      `CREATE TRIGGER \`${trigger.name}\` ${trigger.timing} ${trigger.event} ON \`${trigger.table}\` FOR EACH ROW BEGIN SET @feature_5_5_wrong = 1; END`,
    );
    await schema.query(
      'ALTER TABLE Bookings MODIFY creationKeyHash VARCHAR(64) NULL DEFAULT \'multiple-mismatch\'',
    );
    await queryInterface.removeIndex(creationIndex.table, creationIndex.name);
    await schema.query(
      'CREATE UNIQUE INDEX uq_mt_bookings_creation_key ON Bookings (clubId, creationKeyHash(8))',
    );
    await assertPartialRefusalIsMutationFree(schema, queryInterface, migration);

    await schema.query(`DROP TRIGGER \`${trigger.name}\``);
    await schema.query(
      `CREATE TRIGGER \`${trigger.name}\` ${trigger.timing} ${trigger.event} ON \`${trigger.table}\` FOR EACH ROW ${trigger.body}`,
    );
    await schema.query(
      'ALTER TABLE Bookings MODIFY creationKeyHash VARCHAR(64) NULL DEFAULT NULL',
    );
    await queryInterface.removeIndex(creationIndex.table, creationIndex.name);
    await addCanonicalIndex(queryInterface, creationIndex);
    assert.equal(await migration.__testing.classifySchema(queryInterface), 'ready');
  } finally {
    if (schema) await schema.close();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
    if (previousFailure === undefined) {
      delete process.env.TENANT_BOOKINGS_COURTS_MIGRATION_FAIL_STEP;
    } else {
      process.env.TENANT_BOOKINGS_COURTS_MIGRATION_FAIL_STEP = previousFailure;
    }
  }
});
