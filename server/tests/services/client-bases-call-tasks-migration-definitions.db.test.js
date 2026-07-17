'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const FEATURE_MIGRATION_FILE =
  '20260717100000-add-tenant-client-bases-call-tasks.js';
const FEATURE_TABLES = Object.freeze([
  'ClientSavedViews',
  'ClientBases',
  'CallTasks',
]);
const RESERVED_COLUMN_NAMES = Object.freeze([
  'organizationId',
  'clubId',
  'membershipId',
  'originOrganizationId',
  'originClubId',
]);
const EXPECTED_COLUMN_PAIRS = new Set([
  'ClientSavedViews.organizationId',
  'ClientSavedViews.clubId',
  'ClientSavedViews.membershipId',
  'ClientBases.organizationId',
  'ClientBases.clubId',
  'ClientBases.originOrganizationId',
  'ClientBases.originClubId',
  'CallTasks.organizationId',
  'CallTasks.clubId',
]);
const WRONG_TABLE_RESERVED_COLUMN_PAIRS = Object.freeze(
  FEATURE_TABLES.flatMap((table) =>
    RESERVED_COLUMN_NAMES
      .filter((column) => !EXPECTED_COLUMN_PAIRS.has(`${table}.${column}`))
      .map((column) => Object.freeze({ column, table }))),
);

function databaseName() {
  return process.env.CLIENT_BASES_CALL_TASKS_DEFINITIONS_TEST_DB_NAME ||
    `setly_client_base_definitions_${process.pid}_${Date.now()}`;
}

async function createSchemaThroughFeature(database, includeFeature) {
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
    .filter((file) => file.endsWith('.js') && (
      includeFeature
        ? file <= FEATURE_MIGRATION_FILE
        : file < FEATURE_MIGRATION_FILE
    ))
    .sort();
  for (const file of migrations) {
    const migration = require(path.join(SERVER_ROOT, 'migrations', file));
    await migration.up(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
  }
  return sequelize;
}

async function createReadySchema(database) {
  return createSchemaThroughFeature(database, true);
}

async function createLegacySchema(database) {
  return createSchemaThroughFeature(database, false);
}

async function selectRows(sequelize, sql, replacements = {}) {
  return sequelize.query(sql, {
    replacements,
    type: SequelizePackage.QueryTypes.SELECT,
  });
}

async function seedMultiTenantGraph(sequelize) {
  const queryInterface = sequelize.getQueryInterface();
  const now = new Date('2096-05-04T09:00:00.000Z');
  const [defaultOrganization] = await selectRows(
    sequelize,
    "SELECT id FROM Organizations WHERE slug='padel-park'",
  );
  const [defaultClub] = await selectRows(
    sequelize,
    "SELECT id FROM Clubs WHERE slug='padel-park'",
  );
  await queryInterface.bulkInsert('Organizations', [{
    createdAt: now,
    name: 'Definition probe foreign organization',
    slug: 'definition-probe-foreign-organization',
    status: 'active',
    updatedAt: now,
  }]);
  const [foreignOrganization] = await selectRows(
    sequelize,
    "SELECT id FROM Organizations WHERE slug='definition-probe-foreign-organization'",
  );
  await queryInterface.bulkInsert('Clubs', [
    {
      createdAt: now,
      name: 'Definition probe second club',
      organizationId: defaultOrganization.id,
      slug: 'definition-probe-second-club',
      status: 'active',
      timezone: 'Europe/Moscow',
      updatedAt: now,
    },
    {
      createdAt: now,
      name: 'Definition probe foreign club',
      organizationId: foreignOrganization.id,
      slug: 'definition-probe-foreign-club',
      status: 'active',
      timezone: 'Europe/Moscow',
      updatedAt: now,
    },
  ]);
  const [secondClub] = await selectRows(
    sequelize,
    "SELECT id FROM Clubs WHERE slug='definition-probe-second-club'",
  );
  const [foreignClub] = await selectRows(
    sequelize,
    "SELECT id FROM Clubs WHERE slug='definition-probe-foreign-club'",
  );
  await queryInterface.bulkInsert('Accounts', [{
    createdAt: now,
    email: 'definition-probe-owner@example.test',
    passwordHash: 'test-only',
    role: 'owner',
    status: 'active',
    updatedAt: now,
  }]);
  const [account] = await selectRows(
    sequelize,
    "SELECT id FROM Accounts WHERE email='definition-probe-owner@example.test'",
  );
  await queryInterface.bulkInsert('Memberships', [
    {
      accountId: account.id,
      createdAt: now,
      organizationId: defaultOrganization.id,
      role: 'owner',
      status: 'active',
      updatedAt: now,
    },
    {
      accountId: account.id,
      createdAt: now,
      organizationId: foreignOrganization.id,
      role: 'owner',
      status: 'active',
      updatedAt: now,
    },
  ]);
  const memberships = await selectRows(
    sequelize,
    'SELECT id, organizationId FROM Memberships WHERE accountId=:accountId ORDER BY organizationId',
    { accountId: account.id },
  );
  const membershipByOrganization = new Map(
    memberships.map((row) => [Number(row.organizationId), row]),
  );
  await queryInterface.bulkInsert('Users', [
    {
      createdAt: now,
      isTraining: false,
      name: 'Definition probe default client',
      organizationId: defaultOrganization.id,
      phone: '+79995554101',
      source: 'Definition probe',
      status: 'active',
      updatedAt: now,
    },
    {
      createdAt: now,
      isTraining: false,
      name: 'Definition probe foreign client',
      organizationId: foreignOrganization.id,
      phone: '+79995554101',
      source: 'Definition probe',
      status: 'active',
      updatedAt: now,
    },
  ]);
  const clients = await selectRows(
    sequelize,
    "SELECT id, organizationId, name FROM Users WHERE name LIKE 'Definition probe % client' ORDER BY organizationId",
  );
  const clientByOrganization = new Map(
    clients.map((row) => [Number(row.organizationId), row]),
  );
  const roots = [
    {
      clubId: defaultClub.id,
      label: 'default',
      organizationId: defaultOrganization.id,
    },
    {
      clubId: secondClub.id,
      label: 'second club',
      organizationId: defaultOrganization.id,
    },
    {
      clubId: foreignClub.id,
      label: 'foreign',
      organizationId: foreignOrganization.id,
    },
  ];
  for (const root of roots) {
    const membership = membershipByOrganization.get(Number(root.organizationId));
    await queryInterface.bulkInsert('ClientSavedViews', [{
      accountId: account.id,
      clubId: root.clubId,
      createdAt: now,
      filters: JSON.stringify({ status: 'active' }),
      membershipId: membership.id,
      name: `Definition probe ${root.label} view`,
      organizationId: root.organizationId,
      updatedAt: now,
    }]);
    await queryInterface.bulkInsert('ClientBases', [{
      clubId: root.clubId,
      createdAt: now,
      createdByAccountId: account.id,
      filters: JSON.stringify({ status: 'active' }),
      name: `Definition probe ${root.label} base`,
      organizationId: root.organizationId,
      recurringEnabled: false,
      recurringInterval: 'none',
      recurringScopeType: 'snapshot',
      status: 'active',
      updatedAt: now,
    }]);
    const [base] = await selectRows(
      sequelize,
      'SELECT id FROM ClientBases WHERE name=:name',
      { name: `Definition probe ${root.label} base` },
    );
    await queryInterface.bulkInsert('CallTasks', [{
      clubId: root.clubId,
      clientBaseId: base.id,
      createdAt: now,
      createdByAccountId: account.id,
      organizationId: root.organizationId,
      scopeType: 'snapshot',
      snapshotClientCount: 1,
      status: 'backlog',
      title: `Definition probe ${root.label} task`,
      updatedAt: now,
    }]);
    const [task] = await selectRows(
      sequelize,
      'SELECT id FROM CallTasks WHERE title=:title',
      { title: `Definition probe ${root.label} task` },
    );
    const client = clientByOrganization.get(Number(root.organizationId));
    await queryInterface.bulkInsert('CallTaskClients', [{
      callTaskId: task.id,
      clientName: client.name,
      clientPhone: '+79995554101',
      createdAt: now,
      status: 'new',
      updatedAt: now,
      userId: client.id,
      visitCount: 0,
    }]);
    const [taskClient] = await selectRows(
      sequelize,
      'SELECT id FROM CallTaskClients WHERE callTaskId=:taskId',
      { taskId: task.id },
    );
    await queryInterface.bulkInsert('CallTaskAttempts', [{
      actorAccountId: account.id,
      callTaskClientId: taskClient.id,
      createdAt: now,
      status: 'no_answer',
      summary: `Definition probe ${root.label} attempt`,
      updatedAt: now,
    }]);
    await queryInterface.bulkInsert('TelephonyCalls', [{
      callStatus: 'completed',
      clubId: root.clubId,
      createdAt: now,
      direction: 'outbound',
      followUpCallTaskId: task.id,
      organizationId: root.organizationId,
      processingStatus: 'processed',
      provider: 'beeline',
      recordingStatus: 'unknown',
      updatedAt: now,
      userId: client.id,
    }]);
  }
}

async function snapshotDatabaseInvariants(sequelize) {
  const schemaQueries = {
    columns: `SELECT TABLE_NAME tableName,COLUMN_NAME columnName,
        ORDINAL_POSITION ordinalPosition,COLUMN_DEFAULT columnDefault,
        IS_NULLABLE isNullable,DATA_TYPE dataType,COLUMN_TYPE columnType,
        NUMERIC_PRECISION numericPrecision,NUMERIC_SCALE numericScale,
        CHARACTER_MAXIMUM_LENGTH characterMaximumLength,EXTRA extra
      FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME,ORDINAL_POSITION`,
    constraints: `SELECT TABLE_NAME tableName,CONSTRAINT_NAME constraintName,
        CONSTRAINT_TYPE constraintType
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME,CONSTRAINT_NAME`,
    indexes: `SELECT TABLE_NAME tableName,INDEX_NAME indexName,
        NON_UNIQUE nonUnique,INDEX_TYPE indexType,SEQ_IN_INDEX sequenceInIndex,
        COLUMN_NAME columnName,SUB_PART subPart,COLLATION collation
      FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`,
    keyUsage: `SELECT TABLE_NAME tableName,CONSTRAINT_NAME constraintName,
        COLUMN_NAME columnName,ORDINAL_POSITION ordinalPosition,
        REFERENCED_TABLE_NAME referencedTableName,
        REFERENCED_COLUMN_NAME referencedColumnName
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION`,
    referentialRules: `SELECT TABLE_NAME tableName,CONSTRAINT_NAME constraintName,
        UPDATE_RULE updateRule,DELETE_RULE deleteRule
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE()
      ORDER BY TABLE_NAME,CONSTRAINT_NAME`,
    triggers: `SELECT TRIGGER_NAME triggerName,
        EVENT_MANIPULATION eventManipulation,EVENT_OBJECT_TABLE eventObjectTable,
        ACTION_TIMING actionTiming,ACTION_STATEMENT actionStatement
      FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()
      ORDER BY TRIGGER_NAME`,
  };
  const schema = {};
  for (const [key, sql] of Object.entries(schemaQueries)) {
    schema[key] = await selectRows(sequelize, sql);
  }
  const data = {};
  const counts = {};
  const checksums = {};
  for (const tableName of [
    'Organizations',
    'Clubs',
    'Accounts',
    'Memberships',
    'MembershipClubAccesses',
    'Staffs',
    'Users',
    'ClientSavedViews',
    'ClientBases',
    'CallTasks',
    'CallTaskClients',
    'CallTaskAttempts',
    'TelephonyCalls',
  ]) {
    const rows = await selectRows(
      sequelize,
      `SELECT * FROM \`${tableName}\` ORDER BY 1`,
    );
    data[tableName] = rows;
    counts[tableName] = rows.length;
    checksums[tableName] = crypto
      .createHash('sha256')
      .update(JSON.stringify(rows))
      .digest('hex');
  }
  const attribution = {};
  const existingColumns = new Set(schema.columns.map((column) =>
    `${column.tableName}.${column.columnName}`));
  for (const tableName of [
    'ClientSavedViews',
    'ClientBases',
    'CallTasks',
    'TelephonyCalls',
  ]) {
    attribution[tableName] = existingColumns.has(`${tableName}.organizationId`) &&
      existingColumns.has(`${tableName}.clubId`)
      ? await selectRows(
        sequelize,
        `SELECT organizationId,clubId,COUNT(*) rowCount
           FROM \`${tableName}\`
          GROUP BY organizationId,clubId
          ORDER BY organizationId,clubId`,
      )
      : null;
  }
  return { attribution, checksums, counts, data, schema };
}

async function triggerDefinition(sequelize, name) {
  const [row] = await selectRows(
    sequelize,
    `SELECT TRIGGER_NAME name,EVENT_OBJECT_TABLE tableName,
            ACTION_TIMING timing,EVENT_MANIPULATION eventName,
            ACTION_STATEMENT actionStatement
       FROM INFORMATION_SCHEMA.TRIGGERS
      WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=:name`,
    { name },
  );
  return row;
}

async function columnDefinition(sequelize, table, column) {
  const [row] = await selectRows(
    sequelize,
    `SELECT TABLE_NAME tableName,COLUMN_NAME columnName,
            ORDINAL_POSITION ordinalPosition,COLUMN_DEFAULT columnDefault,
            IS_NULLABLE isNullable,DATA_TYPE dataType,COLUMN_TYPE columnType,
            NUMERIC_PRECISION numericPrecision,NUMERIC_SCALE numericScale,
            CHARACTER_MAXIMUM_LENGTH characterMaximumLength,EXTRA extra
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME=:table AND COLUMN_NAME=:column`,
    { column, table },
  );
  return row;
}

async function createTrigger(sequelize, definition) {
  await sequelize.query(
    `CREATE TRIGGER \`${definition.name}\` ${definition.timing} ${definition.eventName}
       ON \`${definition.tableName}\` FOR EACH ROW ${definition.actionStatement}`,
  );
}

async function traceMigrationQueries(sequelize, operation) {
  const queries = [];
  const originalQuery = sequelize.query;
  sequelize.query = function tracedQuery(sql, ...args) {
    queries.push(String(sql?.query || sql));
    return originalQuery.call(this, sql, ...args);
  };
  try {
    await operation();
  } finally {
    sequelize.query = originalQuery;
  }
  return queries;
}

function assertClassificationOnlyQueries(queries, label) {
  assert.equal(queries.length, 4, `${label} must run only four inventory reads`);
  for (const sql of queries) {
    assert.match(sql.trim(), /^SELECT\b/i, `${label} attempted a non-read query`);
    assert.match(
      sql,
      /INFORMATION_SCHEMA\./i,
      `${label} reached default-tenant or business preflight`,
    );
  }
}

async function expectPartialBeforePreflight({
  label,
  migration,
  queryInterface,
  sequelize,
}) {
  const queries = await traceMigrationQueries(sequelize, () =>
    assert.rejects(
      () => migration.up(queryInterface, SequelizePackage),
      (error) => error.code === 'TENANT_CLIENT_BASES_PARTIAL_SCHEMA',
    ));
  assertClassificationOnlyQueries(queries, label);
}

async function expectReadyWithoutMutation({
  label,
  migration,
  queryInterface,
  sequelize,
}) {
  const before = await snapshotDatabaseInvariants(sequelize);
  const queries = await traceMigrationQueries(
    sequelize,
    () => migration.up(queryInterface, SequelizePackage),
  );
  assertClassificationOnlyQueries(queries, label);
  assert.deepEqual(
    await snapshotDatabaseInvariants(sequelize),
    before,
    `${label} changed a ready schema or its rows`,
  );
}

test('Feature 5.4 migration rejects definition lookalikes without mutation', async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const legacyDatabase = `${database}_legacy`;
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    password: process.env.DB_PASSWORD,
    user: process.env.DB_USER,
  });
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(`DROP DATABASE IF EXISTS \`${legacyDatabase}\``);
  await admin.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await admin.query(
    `CREATE DATABASE \`${legacyDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  let schema;
  let legacySchema;
  try {
    schema = await createReadySchema(database);
    await seedMultiTenantGraph(schema);
    const queryInterface = schema.getQueryInterface();
    const migration = require(`../../migrations/${FEATURE_MIGRATION_FILE}`);
    const triggerName =
      'trg_telephony_calls_follow_up_task_tenant_insert';
    const originalTrigger = await triggerDefinition(schema, triggerName);

    async function probe(name, damage, restore, unexpectedColumn) {
      await t.test(name, async () => {
        await damage();
        const before = await snapshotDatabaseInvariants(schema);
        const unexpectedBefore = unexpectedColumn
          ? await columnDefinition(
            schema,
            unexpectedColumn.table,
            unexpectedColumn.column,
          )
          : null;
        await expectPartialBeforePreflight({
          label: name,
          migration,
          queryInterface,
          sequelize: schema,
        });
        assert.deepEqual(
          await snapshotDatabaseInvariants(schema),
          before,
          `${name} changed schema, rows, attribution, graph or checksums`,
        );
        if (unexpectedColumn) {
          assert.deepEqual(
            await columnDefinition(
              schema,
              unexpectedColumn.table,
              unexpectedColumn.column,
            ),
            unexpectedBefore,
            `${name} removed or repaired the unexpected column`,
          );
        }
        await restore();
        await expectReadyWithoutMutation({
          label: `${name} restored canonical schema`,
          migration,
          queryInterface,
          sequelize: schema,
        });
      });
    }

    await t.test('canonical exact nine-column schema remains ready', () =>
      expectReadyWithoutMutation({
        label: 'canonical exact nine-column schema',
        migration,
        queryInterface,
        sequelize: schema,
      }));

    assert.deepEqual(
      WRONG_TABLE_RESERVED_COLUMN_PAIRS,
      [
        { column: 'originOrganizationId', table: 'ClientSavedViews' },
        { column: 'originClubId', table: 'ClientSavedViews' },
        { column: 'membershipId', table: 'ClientBases' },
        { column: 'membershipId', table: 'CallTasks' },
        { column: 'originOrganizationId', table: 'CallTasks' },
        { column: 'originClubId', table: 'CallTasks' },
      ],
      'generated wrong-table matrix must cover every non-canonical reserved pair',
    );
    for (const pair of WRONG_TABLE_RESERVED_COLUMN_PAIRS) {
      await probe(
        `ready plus unexpected ${pair.table}.${pair.column}`,
        () => queryInterface.addColumn(pair.table, pair.column, {
          allowNull: true,
          type: SequelizePackage.INTEGER,
        }),
        () => queryInterface.removeColumn(pair.table, pair.column),
        pair,
      );
    }

    await t.test(
      'legacy plus unexpected ClientBases.membershipId remains partial and untouched',
      async () => {
        legacySchema = await createLegacySchema(legacyDatabase);
        const legacyQueryInterface = legacySchema.getQueryInterface();
        const unexpectedColumn = {
          column: 'membershipId',
          table: 'ClientBases',
        };
        await legacyQueryInterface.addColumn(
          unexpectedColumn.table,
          unexpectedColumn.column,
          { allowNull: true, type: SequelizePackage.INTEGER },
        );
        const before = await snapshotDatabaseInvariants(legacySchema);
        const unexpectedBefore = await columnDefinition(
          legacySchema,
          unexpectedColumn.table,
          unexpectedColumn.column,
        );
        await expectPartialBeforePreflight({
          label: 'legacy plus unexpected ClientBases.membershipId',
          migration,
          queryInterface: legacyQueryInterface,
          sequelize: legacySchema,
        });
        assert.deepEqual(
          await snapshotDatabaseInvariants(legacySchema),
          before,
          'legacy wrong-table pair changed schema, rows, relationships or checksums',
        );
        assert.deepEqual(
          await columnDefinition(
            legacySchema,
            unexpectedColumn.table,
            unexpectedColumn.column,
          ),
          unexpectedBefore,
          'legacy wrong-table pair was removed or repaired',
        );
      },
    );

    await t.test(
      'semantically valid trigger formatting remains ready',
      async () => {
        await schema.query(`DROP TRIGGER \`${triggerName}\``);
        await createTrigger(schema, {
          ...originalTrigger,
          actionStatement: originalTrigger.actionStatement.replace(
            /^BEGIN/i,
            'BEGIN /* semantically valid Feature 5.4 formatting */',
          ),
        });
        try {
          await expectReadyWithoutMutation({
            label: 'semantically valid trigger formatting',
            migration,
            queryInterface,
            sequelize: schema,
          });
        } finally {
          await schema.query(`DROP TRIGGER \`${triggerName}\``);
          await createTrigger(schema, originalTrigger);
        }
        await expectReadyWithoutMutation({
          label: 'restored canonical trigger definition',
          migration,
          queryInterface,
          sequelize: schema,
        });
      },
    );

    const triggerVariants = [
      {
        actionStatement: 'BEGIN SET @feature54_noop = 1; END',
        label: 'replaced no-op trigger body',
      },
      {
        actionStatement: `BEGIN
          IF NEW.followUpCallTaskId IS NOT NULL AND NEW.organizationId IS NULL
          THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='lookalike'; END IF;
        END`,
        label: 'lookalike security trigger body',
      },
      { label: 'wrong trigger timing', timing: 'AFTER' },
      { eventName: 'UPDATE', label: 'wrong trigger event' },
      { label: 'wrong trigger table', tableName: 'ClientBases' },
    ];
    for (const variant of triggerVariants) {
      await probe(
        variant.label,
        async () => {
          await schema.query(`DROP TRIGGER \`${triggerName}\``);
          const { label, ...definitionChanges } = variant;
          void label;
          await createTrigger(schema, {
            ...originalTrigger,
            ...definitionChanges,
            actionStatement: variant.actionStatement || 'BEGIN SET @feature54_probe = 1; END',
          });
        },
        async () => {
          await schema.query(`DROP TRIGGER \`${triggerName}\``);
          await createTrigger(schema, originalTrigger);
        },
      );
    }

    await probe(
      'wrong FK child columns and actions',
      async () => {
        await queryInterface.removeConstraint(
          'TelephonyCalls',
          'fk_telephony_calls_follow_up_task_tenant',
        );
        const indexes = await queryInterface.showIndex('TelephonyCalls');
        if (indexes.some((index) =>
          index.name === 'fk_telephony_calls_follow_up_task_tenant')) {
          await queryInterface.removeIndex(
            'TelephonyCalls',
            'fk_telephony_calls_follow_up_task_tenant',
          );
        }
        await queryInterface.addConstraint('TelephonyCalls', {
          fields: ['followUpCallTaskId'],
          name: 'fk_telephony_calls_follow_up_task_tenant',
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
          references: { field: 'id', table: 'CallTasks' },
          type: 'foreign key',
        });
      },
      async () => {
        await queryInterface.removeConstraint(
          'TelephonyCalls',
          'fk_telephony_calls_follow_up_task_tenant',
        );
        const indexes = await queryInterface.showIndex('TelephonyCalls');
        if (indexes.some((index) =>
          index.name === 'fk_telephony_calls_follow_up_task_tenant')) {
          await queryInterface.removeIndex(
            'TelephonyCalls',
            'fk_telephony_calls_follow_up_task_tenant',
          );
        }
        await queryInterface.addConstraint('TelephonyCalls', {
          fields: ['organizationId', 'clubId', 'followUpCallTaskId'],
          name: 'fk_telephony_calls_follow_up_task_tenant',
          onDelete: 'RESTRICT',
          onUpdate: 'CASCADE',
          references: {
            fields: ['organizationId', 'clubId', 'id'],
            table: 'CallTasks',
          },
          type: 'foreign key',
        });
      },
    );

    await probe(
      'wrong index order and uniqueness',
      async () => {
        await queryInterface.removeIndex(
          'ClientBases',
          'idx_client_bases_tenant_origin',
        );
        await queryInterface.addIndex(
          'ClientBases',
          ['clubId', 'organizationId', 'origin'],
          { name: 'idx_client_bases_tenant_origin', unique: true },
        );
      },
      async () => {
        await queryInterface.removeIndex(
          'ClientBases',
          'idx_client_bases_tenant_origin',
        );
        await queryInterface.addIndex(
          'ClientBases',
          ['organizationId', 'clubId', 'origin'],
          { name: 'idx_client_bases_tenant_origin' },
        );
      },
    );

    await probe(
      'wrong column nullability',
      () => queryInterface.changeColumn('CallTasks', 'organizationId', {
        allowNull: true,
        type: SequelizePackage.INTEGER,
      }),
      () => queryInterface.changeColumn('CallTasks', 'organizationId', {
        allowNull: false,
        type: SequelizePackage.INTEGER,
      }),
    );
    await probe(
      'wrong column default',
      () => queryInterface.changeColumn('CallTasks', 'clubId', {
        allowNull: false,
        defaultValue: 7,
        type: SequelizePackage.INTEGER,
      }),
      () => queryInterface.changeColumn('CallTasks', 'clubId', {
        allowNull: false,
        type: SequelizePackage.INTEGER,
      }),
    );
    await probe(
      'wrong column type and precision',
      async () => {
        await queryInterface.removeConstraint(
          'ClientBases',
          'fk_client_bases_origin_club',
        );
        const indexes = await queryInterface.showIndex('ClientBases');
        if (indexes.some((index) =>
          index.name === 'fk_client_bases_origin_club')) {
          await queryInterface.removeIndex(
            'ClientBases',
            'fk_client_bases_origin_club',
          );
        }
        await queryInterface.changeColumn('ClientBases', 'originClubId', {
          allowNull: true,
          type: SequelizePackage.BIGINT.UNSIGNED,
        });
      },
      async () => {
        await queryInterface.changeColumn('ClientBases', 'originClubId', {
          allowNull: true,
          type: SequelizePackage.INTEGER,
        });
        await queryInterface.addConstraint('ClientBases', {
          fields: ['originOrganizationId', 'originClubId'],
          name: 'fk_client_bases_origin_club',
          onDelete: 'RESTRICT',
          onUpdate: 'CASCADE',
          references: {
            fields: ['organizationId', 'id'],
            table: 'Clubs',
          },
          type: 'foreign key',
        });
      },
    );
    await probe(
      'extra reserved lookalike artifact',
      () => queryInterface.addIndex(
        'CallTasks',
        ['organizationId'],
        { name: 'idx_call_tasks_tenant_lookalike' },
      ),
      () => queryInterface.removeIndex(
        'CallTasks',
        'idx_call_tasks_tenant_lookalike',
      ),
    );
  } finally {
    if (schema) await schema.close().catch(() => {});
    if (legacySchema) await legacySchema.close().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.query(`DROP DATABASE IF EXISTS \`${legacyDatabase}\``);
    await admin.end();
  }
});
