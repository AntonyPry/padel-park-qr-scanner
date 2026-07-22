'use strict';

const {
  DEFAULT_ORGANIZATION_SLUG,
  TENANT_FOUNDATION_STATES,
} = require('../src/tenant-foundation/constants');
const {
  classifyTenantFoundation,
  invalidateTenantFoundationGateCache,
} = require('../src/services/tenant-foundation.service');

const MIGRATION_NAME = '20260716140000-add-tenant-staff-access-identity.js';
const CONSTRAINTS = Object.freeze({
  membershipStaff: 'fk_memberships_organization_staff',
  staffOrganization: 'fk_staffs_organization',
  uniqueMembershipStaff: 'uq_memberships_organization_staff',
  uniqueStaffOrganizationId: 'uq_staffs_organization_id',
});
const INDEXES = Object.freeze({
  staffName: 'idx_staffs_organization_name_id',
  staffStatus: 'idx_staffs_organization_status_created_id',
});

function migrationError(message) {
  return new Error(`Staff/access identity migration refused: ${message}`);
}

async function getSchemaState(queryInterface) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND ((TABLE_NAME = 'Staffs' AND COLUMN_NAME = 'organizationId')
          OR (TABLE_NAME = 'Memberships' AND COLUMN_NAME = 'staffId'))
      ORDER BY TABLE_NAME, COLUMN_NAME`,
  );
  const staffOrganization = rows.some(
    (row) =>
      row.tableName === 'Staffs' && row.columnName === 'organizationId',
  );
  const membershipStaff = rows.some(
    (row) =>
      row.tableName === 'Memberships' && row.columnName === 'staffId',
  );
  return {
    membershipStaff,
    mode:
      staffOrganization && membershipStaff
        ? 'ready'
        : staffOrganization || membershipStaff
          ? 'partial'
          : 'legacy',
    staffOrganization,
  };
}

async function getExactDefaultOrganization(queryInterface, transaction) {
  const [organizations] = await queryInterface.sequelize.query(
    'SELECT id, slug, status FROM Organizations ORDER BY id FOR UPDATE',
    { transaction },
  );
  if (
    organizations.length !== 1 ||
    organizations[0].slug !== DEFAULT_ORGANIZATION_SLUG ||
    organizations[0].status !== 'active'
  ) {
    throw migrationError('exactly one active default Organization is required');
  }
  return organizations[0];
}

async function assertLegacyPreflight(queryInterface) {
  return queryInterface.sequelize.transaction(async (transaction) => {
    const classification = await classifyTenantFoundation({
      lock: true,
      sequelize: queryInterface.sequelize,
      transaction,
    });
    if (classification.state === TENANT_FOUNDATION_STATES.INVALID) {
      throw migrationError(
        `tenant foundation is invalid (${classification.diagnostics.reasons.join('; ')})`,
      );
    }
    const organization = await getExactDefaultOrganization(
      queryInterface,
      transaction,
    );
    const [invalidReferences] = await queryInterface.sequelize.query(
      `SELECT a.id AS accountId, a.staffId
         FROM Accounts AS a
         LEFT JOIN Staffs AS s ON s.id = a.staffId
        WHERE a.staffId IS NOT NULL AND s.id IS NULL
        ORDER BY a.id
        FOR UPDATE`,
      { transaction },
    );
    if (invalidReferences.length > 0) {
      throw migrationError(
        `stale Account.staffId references (${invalidReferences
          .map((row) => `${row.accountId}->${row.staffId}`)
          .join(', ')})`,
      );
    }
    const [duplicates] = await queryInterface.sequelize.query(
      `SELECT staffId, COUNT(*) AS accountCount
         FROM Accounts
        WHERE staffId IS NOT NULL
        GROUP BY staffId
       HAVING COUNT(*) > 1
        FOR UPDATE`,
      { transaction },
    );
    if (duplicates.length > 0) {
      throw migrationError(
        `one Staff is assigned to multiple Accounts (${duplicates
          .map((row) => `${row.staffId}:${row.accountCount}`)
          .join(', ')})`,
      );
    }
    return { classification, organization };
  });
}

async function assertReadyData(queryInterface, { rollback = false } = {}) {
  return queryInterface.sequelize.transaction(async (transaction) => {
    const organization = await getExactDefaultOrganization(
      queryInterface,
      transaction,
    );
    const [invalidStaff] = await queryInterface.sequelize.query(
      `SELECT id, organizationId
         FROM Staffs
        WHERE organizationId IS NULL OR organizationId <> :organizationId
        ORDER BY id
        FOR UPDATE`,
      { replacements: { organizationId: organization.id }, transaction },
    );
    if (invalidStaff.length > 0) {
      throw migrationError(
        `${rollback ? 'rollback ' : ''}Staff organization attribution is invalid`,
      );
    }

    const [invalidLinks] = await queryInterface.sequelize.query(
      `SELECT a.id AS accountId,
              a.staffId AS accountStaffId,
              m.id AS membershipId,
              m.staffId AS membershipStaffId,
              m.organizationId,
              s.organizationId AS staffOrganizationId
         FROM Accounts AS a
         LEFT JOIN Memberships AS m ON m.accountId = a.id
         LEFT JOIN Staffs AS s ON s.id = m.staffId
        WHERE m.id IS NULL
           OR NOT (a.staffId <=> m.staffId)
           OR (m.staffId IS NOT NULL AND s.id IS NULL)
           OR (m.staffId IS NOT NULL AND m.organizationId <> s.organizationId)
        ORDER BY a.id
        FOR UPDATE`,
      { transaction },
    );
    if (invalidLinks.length > 0) {
      throw migrationError(
        `${rollback ? 'rollback ' : ''}Account/Membership/Staff parity is invalid`,
      );
    }

    const [duplicates] = await queryInterface.sequelize.query(
      `SELECT organizationId, staffId, COUNT(*) AS membershipCount
         FROM Memberships
        WHERE staffId IS NOT NULL
        GROUP BY organizationId, staffId
       HAVING COUNT(*) > 1
        FOR UPDATE`,
      { transaction },
    );
    if (duplicates.length > 0) {
      throw migrationError(
        `${rollback ? 'rollback ' : ''}duplicate Membership Staff links exist`,
      );
    }

    const classification = await classifyTenantFoundation({
      lock: true,
      sequelize: queryInterface.sequelize,
      transaction,
    });
    if (classification.state === TENANT_FOUNDATION_STATES.INVALID) {
      throw migrationError(
        `${rollback ? 'rollback ' : ''}tenant foundation is invalid (${classification.diagnostics.reasons.join('; ')})`,
      );
    }
    return classification;
  });
}

async function findLaterMigrations(queryInterface, transaction) {
  const [tables] = await queryInterface.sequelize.query(
    `SELECT TABLE_NAME AS tableName
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'SequelizeMeta'`,
    { transaction },
  );
  if (tables.length === 0) return [];
  const [rows] = await queryInterface.sequelize.query(
    'SELECT name FROM SequelizeMeta WHERE name > :migrationName ORDER BY name',
    { replacements: { migrationName: MIGRATION_NAME }, transaction },
  );
  return rows.map((row) => row.name);
}

async function findExternalCompositeReferences(queryInterface, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName,
            REFERENCED_TABLE_NAME AS referencedTable,
            REFERENCED_COLUMN_NAME AS referencedColumn
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IN ('Staffs', 'Memberships')
        AND (
          (REFERENCED_TABLE_NAME = 'Staffs'
            AND REFERENCED_COLUMN_NAME = 'organizationId'
            AND TABLE_NAME <> 'Memberships')
          OR
          (REFERENCED_TABLE_NAME = 'Memberships'
            AND REFERENCED_COLUMN_NAME = 'staffId')
        )
      ORDER BY TABLE_NAME, COLUMN_NAME`,
    { transaction },
  );
  return rows;
}

async function assertRollbackPreflight(queryInterface) {
  const classification = await assertReadyData(queryInterface, {
    rollback: true,
  });
  return queryInterface.sequelize.transaction(async (transaction) => {
    const [laterMigrations, externalReferences] = await Promise.all([
      findLaterMigrations(queryInterface, transaction),
      findExternalCompositeReferences(queryInterface, transaction),
    ]);
    if (laterMigrations.length > 0) {
      throw migrationError(
        `rollback has later migrations applied (${laterMigrations.join(', ')})`,
      );
    }
    if (externalReferences.length > 0) {
      throw migrationError(
        `rollback has external composite references (${externalReferences
          .map(
            (row) =>
              `${row.tableName}.${row.columnName}->${row.referencedTable}.${row.referencedColumn}`,
          )
          .join(', ')})`,
      );
    }
    console.info(
      '[tenant-staff-access] rollback preflight',
      JSON.stringify({
        checksum: classification.checksum,
        counts: classification.counts,
        state: classification.state,
      }),
    );
    return classification;
  });
}

async function dropReadySchema(queryInterface) {
  await queryInterface.removeConstraint(
    'Memberships',
    CONSTRAINTS.membershipStaff,
  );
  await queryInterface.removeConstraint(
    'Memberships',
    CONSTRAINTS.uniqueMembershipStaff,
  );
  await queryInterface.removeColumn('Memberships', 'staffId');
  await queryInterface.removeConstraint(
    'Staffs',
    CONSTRAINTS.staffOrganization,
  );
  await queryInterface.removeIndex('Staffs', INDEXES.staffName);
  await queryInterface.removeIndex('Staffs', INDEXES.staffStatus);
  await queryInterface.removeConstraint(
    'Staffs',
    CONSTRAINTS.uniqueStaffOrganizationId,
  );
  await queryInterface.removeColumn('Staffs', 'organizationId');
}

async function ignoreMissingSchemaObject(operation) {
  try {
    await operation();
  } catch (error) {
    const code = error?.original?.code || error?.parent?.code || error?.code;
    if (
      error?.name === 'SequelizeUnknownConstraintError' ||
      [
        'ER_BAD_FIELD_ERROR',
        'ER_CANT_DROP_FIELD_OR_KEY',
        'ER_KEY_DOES_NOT_EXITS',
        'ER_NO_SUCH_TABLE',
      ].includes(code)
    ) {
      return;
    }
    throw error;
  }
}

async function cleanupPartialSchema(queryInterface) {
  await ignoreMissingSchemaObject(() =>
    queryInterface.removeConstraint(
      'Memberships',
      CONSTRAINTS.membershipStaff,
    ),
  );
  await ignoreMissingSchemaObject(() =>
    queryInterface.removeConstraint(
      'Memberships',
      CONSTRAINTS.uniqueMembershipStaff,
    ),
  );
  await ignoreMissingSchemaObject(() =>
    queryInterface.removeColumn('Memberships', 'staffId'),
  );
  await ignoreMissingSchemaObject(() =>
    queryInterface.removeConstraint(
      'Staffs',
      CONSTRAINTS.staffOrganization,
    ),
  );
  await ignoreMissingSchemaObject(() =>
    queryInterface.removeIndex('Staffs', INDEXES.staffName),
  );
  await ignoreMissingSchemaObject(() =>
    queryInterface.removeIndex('Staffs', INDEXES.staffStatus),
  );
  await ignoreMissingSchemaObject(() =>
    queryInterface.removeConstraint(
      'Staffs',
      CONSTRAINTS.uniqueStaffOrganizationId,
    ),
  );
  await ignoreMissingSchemaObject(() =>
    queryInterface.removeColumn('Staffs', 'organizationId'),
  );
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const schema = await getSchemaState(queryInterface);
    if (schema.mode === 'partial') {
      throw migrationError('partial Staff/Membership identity schema exists');
    }
    if (schema.mode === 'ready') {
      const classification = await assertReadyData(queryInterface);
      console.info(
        '[tenant-staff-access] repeated migration assertion',
        JSON.stringify({
          checksum: classification.checksum,
          counts: classification.counts,
          state: classification.state,
        }),
      );
      invalidateTenantFoundationGateCache();
      return;
    }

    const { organization } = await assertLegacyPreflight(queryInterface);
    let schemaTouched = false;
    try {
      schemaTouched = true;
      await queryInterface.addColumn('Staffs', 'organizationId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await queryInterface.sequelize.query(
        'UPDATE Staffs SET organizationId = :organizationId WHERE organizationId IS NULL',
        { replacements: { organizationId: organization.id } },
      );
      await queryInterface.addConstraint('Staffs', {
        fields: ['organizationId'],
        name: CONSTRAINTS.staffOrganization,
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        references: { field: 'id', table: 'Organizations' },
        type: 'foreign key',
      });
      await queryInterface.addConstraint('Staffs', {
        fields: ['organizationId', 'id'],
        name: CONSTRAINTS.uniqueStaffOrganizationId,
        type: 'unique',
      });
      await queryInterface.addIndex(
        'Staffs',
        ['organizationId', 'status', 'createdAt', 'id'],
        { name: INDEXES.staffStatus },
      );
      await queryInterface.addIndex('Staffs', ['organizationId', 'name', 'id'], {
        name: INDEXES.staffName,
      });

      await queryInterface.addColumn('Memberships', 'staffId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await queryInterface.sequelize.query(
        `UPDATE Memberships AS m
           JOIN Accounts AS a ON a.id = m.accountId
            SET m.staffId = a.staffId`,
      );
      await queryInterface.addConstraint('Memberships', {
        fields: ['organizationId', 'staffId'],
        name: CONSTRAINTS.uniqueMembershipStaff,
        type: 'unique',
      });
      await queryInterface.addConstraint('Memberships', {
        fields: ['organizationId', 'staffId'],
        name: CONSTRAINTS.membershipStaff,
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        references: {
          fields: ['organizationId', 'id'],
          table: 'Staffs',
        },
        type: 'foreign key',
      });
      await queryInterface.changeColumn('Staffs', 'organizationId', {
        allowNull: false,
        type: Sequelize.INTEGER,
      });

      const classification = await assertReadyData(queryInterface);
      console.info(
        '[tenant-staff-access] migration assertion',
        JSON.stringify({
          checksum: classification.checksum,
          counts: classification.counts,
          state: classification.state,
        }),
      );
      invalidateTenantFoundationGateCache();
    } catch (error) {
      if (schemaTouched) {
        try {
          await cleanupPartialSchema(queryInterface);
        } catch (cleanupError) {
          error.cleanupError = cleanupError;
        }
      }
      invalidateTenantFoundationGateCache();
      throw error;
    }
  },

  async down(queryInterface) {
    const schema = await getSchemaState(queryInterface);
    if (schema.mode !== 'ready') {
      throw migrationError(
        `rollback expected ready schema, found ${schema.mode}`,
      );
    }
    await assertRollbackPreflight(queryInterface);
    await dropReadySchema(queryInterface);
    invalidateTenantFoundationGateCache();
  },

  _private: {
    assertLegacyPreflight,
    assertReadyData,
    assertRollbackPreflight,
    cleanupPartialSchema,
    dropReadySchema,
    findExternalCompositeReferences,
    findLaterMigrations,
    getSchemaState,
  },
};
