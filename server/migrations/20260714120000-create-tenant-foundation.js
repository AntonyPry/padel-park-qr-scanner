'use strict';

const {
  BLOCKING_LATER_TENANT_MIGRATIONS,
  CLUB_ROLE_OVERRIDE_VALUES,
  DEFAULT_CLUB_SLUG,
  DEFAULT_CLUB_TIMEZONE,
  DEFAULT_ORGANIZATION_SLUG,
  DEFAULT_TENANT_NAME,
  MEMBERSHIP_ROLE_VALUES,
  TENANT_FOUNDATION_STATES,
  TENANT_FOUNDATION_TABLES,
  TENANT_STATUS_VALUES,
} = require('../src/tenant-foundation/constants');
const {
  assertTenantFoundationOperational,
  classifyTenantFoundation,
  invalidateTenantFoundationGateCache,
} = require('../src/services/tenant-foundation.service');

function normalizedTableNames(rawTables) {
  return new Set(
    rawTables.map((table) =>
      typeof table === 'string'
        ? table
        : table.tableName || table.table_name || String(table),
    ),
  );
}

async function getFoundationTablePresence(queryInterface) {
  const tables = normalizedTableNames(await queryInterface.showAllTables());
  return TENANT_FOUNDATION_TABLES.filter((table) => tables.has(table));
}

async function createSchema(queryInterface, Sequelize) {
  await queryInterface.createTable('Organizations', {
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: Sequelize.INTEGER,
    },
    slug: { allowNull: false, type: Sequelize.STRING(191) },
    name: { allowNull: false, type: Sequelize.STRING },
    status: {
      allowNull: false,
      type: Sequelize.ENUM(...TENANT_STATUS_VALUES),
    },
    createdAt: { allowNull: false, type: Sequelize.DATE },
    updatedAt: { allowNull: false, type: Sequelize.DATE },
  });
  await queryInterface.addConstraint('Organizations', {
    fields: ['slug'],
    name: 'uq_organizations_slug',
    type: 'unique',
  });

  await queryInterface.createTable('Clubs', {
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: Sequelize.INTEGER,
    },
    organizationId: {
      allowNull: false,
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      references: { key: 'id', model: 'Organizations' },
      type: Sequelize.INTEGER,
    },
    slug: { allowNull: false, type: Sequelize.STRING(191) },
    name: { allowNull: false, type: Sequelize.STRING },
    timezone: { allowNull: false, type: Sequelize.STRING },
    status: {
      allowNull: false,
      type: Sequelize.ENUM(...TENANT_STATUS_VALUES),
    },
    createdAt: { allowNull: false, type: Sequelize.DATE },
    updatedAt: { allowNull: false, type: Sequelize.DATE },
  });
  await queryInterface.addConstraint('Clubs', {
    fields: ['organizationId', 'slug'],
    name: 'uq_clubs_organization_slug',
    type: 'unique',
  });
  await queryInterface.addConstraint('Clubs', {
    fields: ['organizationId', 'id'],
    name: 'uq_clubs_organization_id',
    type: 'unique',
  });
  await queryInterface.addIndex('Clubs', ['organizationId', 'status', 'id'], {
    name: 'idx_clubs_organization_status_id',
  });

  await queryInterface.createTable('Memberships', {
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: Sequelize.INTEGER,
    },
    organizationId: {
      allowNull: false,
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      references: { key: 'id', model: 'Organizations' },
      type: Sequelize.INTEGER,
    },
    accountId: {
      allowNull: false,
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      references: { key: 'id', model: 'Accounts' },
      type: Sequelize.INTEGER,
    },
    role: {
      allowNull: false,
      type: Sequelize.ENUM(...MEMBERSHIP_ROLE_VALUES),
    },
    status: {
      allowNull: false,
      type: Sequelize.ENUM(...TENANT_STATUS_VALUES),
    },
    createdAt: { allowNull: false, type: Sequelize.DATE },
    updatedAt: { allowNull: false, type: Sequelize.DATE },
  });
  await queryInterface.addConstraint('Memberships', {
    fields: ['organizationId', 'accountId'],
    name: 'uq_memberships_organization_account',
    type: 'unique',
  });
  await queryInterface.addConstraint('Memberships', {
    fields: ['organizationId', 'id'],
    name: 'uq_memberships_organization_id',
    type: 'unique',
  });
  await queryInterface.addIndex(
    'Memberships',
    ['accountId', 'status', 'organizationId'],
    { name: 'idx_memberships_account_status_organization' },
  );
  await queryInterface.addIndex(
    'Memberships',
    ['organizationId', 'role', 'status'],
    { name: 'idx_memberships_organization_role_status' },
  );

  await queryInterface.createTable('MembershipClubAccesses', {
    organizationId: { allowNull: false, type: Sequelize.INTEGER },
    membershipId: {
      allowNull: false,
      primaryKey: true,
      type: Sequelize.INTEGER,
    },
    clubId: {
      allowNull: false,
      primaryKey: true,
      type: Sequelize.INTEGER,
    },
    roleOverride: {
      allowNull: true,
      type: Sequelize.ENUM(...CLUB_ROLE_OVERRIDE_VALUES),
    },
    status: {
      allowNull: false,
      type: Sequelize.ENUM(...TENANT_STATUS_VALUES),
    },
    createdAt: { allowNull: false, type: Sequelize.DATE },
    updatedAt: { allowNull: false, type: Sequelize.DATE },
  });
  await queryInterface.addConstraint('MembershipClubAccesses', {
    fields: ['organizationId', 'membershipId'],
    name: 'fk_accesses_organization_membership',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    references: {
      fields: ['organizationId', 'id'],
      table: 'Memberships',
    },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('MembershipClubAccesses', {
    fields: ['organizationId', 'clubId'],
    name: 'fk_accesses_organization_club',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    references: {
      fields: ['organizationId', 'id'],
      table: 'Clubs',
    },
    type: 'foreign key',
  });
  await queryInterface.addIndex(
    'MembershipClubAccesses',
    ['organizationId', 'membershipId'],
    { name: 'idx_accesses_organization_membership' },
  );
  await queryInterface.addIndex(
    'MembershipClubAccesses',
    ['organizationId', 'clubId', 'status'],
    { name: 'idx_accesses_organization_club_status' },
  );
}

async function dropSchema(queryInterface) {
  for (const table of [
    'MembershipClubAccesses',
    'Memberships',
    'Clubs',
    'Organizations',
  ]) {
    try {
      await queryInterface.dropTable(table);
    } catch (error) {
      if (!['ER_BAD_TABLE_ERROR', 'ER_NO_SUCH_TABLE'].includes(error?.original?.code)) {
        throw error;
      }
    }
  }
}

async function backfillDefaultTenant(queryInterface) {
  return queryInterface.sequelize.transaction(async (transaction) => {
    const now = new Date();
    await queryInterface.bulkInsert(
      'Organizations',
      [
        {
          createdAt: now,
          name: DEFAULT_TENANT_NAME,
          slug: DEFAULT_ORGANIZATION_SLUG,
          status: 'active',
          updatedAt: now,
        },
      ],
      { transaction },
    );
    const [[organization]] = await queryInterface.sequelize.query(
      'SELECT id FROM Organizations WHERE slug = :slug FOR UPDATE',
      { replacements: { slug: DEFAULT_ORGANIZATION_SLUG }, transaction },
    );

    await queryInterface.bulkInsert(
      'Clubs',
      [
        {
          createdAt: now,
          name: DEFAULT_TENANT_NAME,
          organizationId: organization.id,
          slug: DEFAULT_CLUB_SLUG,
          status: 'active',
          timezone: DEFAULT_CLUB_TIMEZONE,
          updatedAt: now,
        },
      ],
      { transaction },
    );
    const [[club]] = await queryInterface.sequelize.query(
      'SELECT id FROM Clubs WHERE organizationId = :organizationId AND slug = :slug FOR UPDATE',
      {
        replacements: {
          organizationId: organization.id,
          slug: DEFAULT_CLUB_SLUG,
        },
        transaction,
      },
    );

    const [accounts] = await queryInterface.sequelize.query(
      'SELECT id, role, status FROM Accounts ORDER BY id FOR UPDATE',
      { transaction },
    );
    if (accounts.length === 0) {
      return;
    }

    const invalidAccount = accounts.find(
      (account) =>
        !MEMBERSHIP_ROLE_VALUES.includes(account.role) ||
        !TENANT_STATUS_VALUES.includes(account.status),
    );
    if (invalidAccount) {
      throw new Error(
        `Account ${invalidAccount.id} has role/status outside the tenant foundation contract`,
      );
    }
    if (!accounts.some((account) => account.role === 'owner' && account.status === 'active')) {
      throw new Error('Existing Accounts require at least one active owner before tenant backfill');
    }

    await queryInterface.bulkInsert(
      'Memberships',
      accounts.map((account) => ({
        accountId: account.id,
        createdAt: now,
        organizationId: organization.id,
        role: account.role,
        status: account.status,
        updatedAt: now,
      })),
      { transaction },
    );

    const [memberships] = await queryInterface.sequelize.query(
      'SELECT id, accountId, role, status FROM Memberships WHERE organizationId = :organizationId ORDER BY id FOR UPDATE',
      { replacements: { organizationId: organization.id }, transaction },
    );
    const nonOwners = memberships.filter((membership) => membership.role !== 'owner');
    if (nonOwners.length > 0) {
      await queryInterface.bulkInsert(
        'MembershipClubAccesses',
        nonOwners.map((membership) => ({
          clubId: club.id,
          createdAt: now,
          membershipId: membership.id,
          organizationId: organization.id,
          roleOverride: null,
          status: membership.status,
          updatedAt: now,
        })),
        { transaction },
      );
    }

    const classification = await classifyTenantFoundation({
      sequelize: queryInterface.sequelize,
      transaction,
    });
    if (classification.state !== TENANT_FOUNDATION_STATES.INITIALIZED) {
      throw new Error(
        `Tenant foundation backfill assertion failed: ${classification.diagnostics.reasons.join('; ')}`,
      );
    }
  });
}

async function findExternalFoundationReferences(queryInterface, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName,
            REFERENCED_TABLE_NAME AS referencedTable
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IN (:foundationTables)
        AND TABLE_NAME NOT IN (:foundationTables)`,
    {
      replacements: { foundationTables: TENANT_FOUNDATION_TABLES },
      transaction,
    },
  );
  return rows;
}

async function findExternalTenantColumns(queryInterface, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND COLUMN_NAME IN ('organizationId', 'clubId', 'membershipId')
        AND TABLE_NAME NOT IN (:foundationTables)`,
    {
      replacements: { foundationTables: TENANT_FOUNDATION_TABLES },
      transaction,
    },
  );
  return rows;
}

async function findBlockingLaterMigrations(queryInterface, transaction) {
  if (BLOCKING_LATER_TENANT_MIGRATIONS.length === 0) return [];
  const [rows] = await queryInterface.sequelize.query(
    'SELECT name FROM SequelizeMeta WHERE name IN (:names)',
    {
      replacements: { names: BLOCKING_LATER_TENANT_MIGRATIONS },
      transaction,
    },
  );
  return rows.map((row) => row.name);
}

async function assertRollbackPreflight(queryInterface) {
  return queryInterface.sequelize.transaction(async (transaction) => {
    const classification = await classifyTenantFoundation({
      lock: true,
      sequelize: queryInterface.sequelize,
      transaction,
    });
    if (classification.state === TENANT_FOUNDATION_STATES.INVALID) {
      throw new Error(
        `Tenant foundation rollback refused: ${classification.diagnostics.reasons.join('; ')}`,
      );
    }

    const accountColumns = await queryInterface.describeTable('Accounts');
    for (const column of ['role', 'status', 'staffId']) {
      if (!accountColumns[column]) {
        throw new Error(`Tenant foundation rollback refused: Accounts.${column} is missing`);
      }
    }

    const [externalReferences, externalTenantColumns, laterMigrations] =
      await Promise.all([
        findExternalFoundationReferences(queryInterface, transaction),
        findExternalTenantColumns(queryInterface, transaction),
        findBlockingLaterMigrations(queryInterface, transaction),
      ]);

    if (externalReferences.length > 0) {
      throw new Error(
        `Tenant foundation rollback refused: external FKs exist (${externalReferences
          .map((row) => `${row.tableName}.${row.columnName}->${row.referencedTable}`)
          .join(', ')})`,
      );
    }
    if (externalTenantColumns.length > 0) {
      throw new Error(
        `Tenant foundation rollback refused: later tenant columns exist (${externalTenantColumns
          .map((row) => `${row.tableName}.${row.columnName}`)
          .join(', ')})`,
      );
    }
    if (laterMigrations.length > 0) {
      throw new Error(
        `Tenant foundation rollback refused: later tenant migrations applied (${laterMigrations.join(', ')})`,
      );
    }

    console.info(
      '[tenant-foundation] rollback preflight',
      JSON.stringify({
        checksum: classification.checksum,
        counts: classification.counts,
        state: classification.state,
      }),
    );
    return classification;
  });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const presentTables = await getFoundationTablePresence(queryInterface);
    if (presentTables.length > 0) {
      if (presentTables.length !== TENANT_FOUNDATION_TABLES.length) {
        throw new Error(
          `Partial tenant foundation schema exists: ${presentTables.join(', ')}`,
        );
      }
      const classification = await assertTenantFoundationOperational({
        sequelize: queryInterface.sequelize,
      });
      console.info(
        '[tenant-foundation] repeated migration assertion',
        JSON.stringify({
          checksum: classification.checksum,
          counts: classification.counts,
          state: classification.state,
        }),
      );
      invalidateTenantFoundationGateCache();
      return;
    }

    let schemaCreated = false;
    try {
      schemaCreated = true;
      await createSchema(queryInterface, Sequelize);
      await backfillDefaultTenant(queryInterface);
      const classification = await assertTenantFoundationOperational({
        sequelize: queryInterface.sequelize,
      });
      console.info(
        '[tenant-foundation] migration assertion',
        JSON.stringify({
          checksum: classification.checksum,
          counts: classification.counts,
          state: classification.state,
        }),
      );
      invalidateTenantFoundationGateCache();
    } catch (error) {
      if (schemaCreated) {
        try {
          await dropSchema(queryInterface);
        } catch (cleanupError) {
          error.cleanupError = cleanupError;
        }
      }
      invalidateTenantFoundationGateCache();
      throw error;
    }
  },

  async down(queryInterface) {
    const presentTables = await getFoundationTablePresence(queryInterface);
    if (presentTables.length !== TENANT_FOUNDATION_TABLES.length) {
      throw new Error(
        `Tenant foundation rollback refused: expected all foundation tables, found ${presentTables.join(', ') || 'none'}`,
      );
    }
    await assertRollbackPreflight(queryInterface);
    await dropSchema(queryInterface);
    invalidateTenantFoundationGateCache();
  },

  _private: {
    assertRollbackPreflight,
    backfillDefaultTenant,
    createSchema,
    dropSchema,
    findExternalFoundationReferences,
    findExternalTenantColumns,
    getFoundationTablePresence,
  },
};
