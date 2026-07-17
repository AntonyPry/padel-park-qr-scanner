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

function databaseName() {
  return process.env.CLIENT_BASES_CALL_TASKS_DEFINITIONS_TEST_DB_NAME ||
    `setly_client_base_definitions_${process.pid}_${Date.now()}`;
}

async function createReadySchema(database) {
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
    .filter((file) => file.endsWith('.js') && file <= FEATURE_MIGRATION_FILE)
    .sort();
  for (const file of migrations) {
    const migration = require(path.join(SERVER_ROOT, 'migrations', file));
    await migration.up(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
  }
  return sequelize;
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
  for (const tableName of [
    'ClientSavedViews',
    'ClientBases',
    'CallTasks',
    'TelephonyCalls',
  ]) {
    attribution[tableName] = await selectRows(
      sequelize,
      `SELECT organizationId,clubId,COUNT(*) rowCount
         FROM \`${tableName}\`
        GROUP BY organizationId,clubId
        ORDER BY organizationId,clubId`,
    );
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

async function createTrigger(sequelize, definition) {
  await sequelize.query(
    `CREATE TRIGGER \`${definition.name}\` ${definition.timing} ${definition.eventName}
       ON \`${definition.tableName}\` FOR EACH ROW ${definition.actionStatement}`,
  );
}

test('Feature 5.4 migration rejects definition lookalikes without mutation', async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
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
    schema = await createReadySchema(database);
    await seedMultiTenantGraph(schema);
    const queryInterface = schema.getQueryInterface();
    const migration = require(`../../migrations/${FEATURE_MIGRATION_FILE}`);
    const triggerName =
      'trg_telephony_calls_follow_up_task_tenant_insert';
    const originalTrigger = await triggerDefinition(schema, triggerName);

    async function probe(name, damage, restore) {
      await t.test(name, async () => {
        await damage();
        const before = await snapshotDatabaseInvariants(schema);
        await assert.rejects(
          () => migration.up(queryInterface, SequelizePackage),
          (error) => error.code === 'TENANT_CLIENT_BASES_PARTIAL_SCHEMA',
        );
        assert.deepEqual(
          await snapshotDatabaseInvariants(schema),
          before,
          `${name} changed schema, rows, attribution, graph or checksums`,
        );
        await restore();
        await migration.up(queryInterface, SequelizePackage);
      });
    }

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
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
});
