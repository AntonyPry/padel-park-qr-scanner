'use strict';

const db = require('../../models');
const {
  MEMBERSHIP_ROLE_VALUES,
  TENANT_FOUNDATION_STATES,
  TENANT_STATUS_VALUES,
} = require('../tenant-foundation/constants');
const {
  assertTenantFoundationInitialized,
  classifyTenantFoundation,
  invalidateTenantFoundationGateCache,
  stateError,
} = require('./tenant-foundation.service');
const accountLifecycle = require('./account-lifecycle.service');
const normalUserSessions = require('./normal-user-session.service');
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../tenant-foundation/constants');

function seederError(message, code = 'TENANT_SEEDER_INVALID') {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

function validateAccountRows(rows) {
  const emails = new Set();
  const staffIds = new Set();
  for (const row of rows) {
    const email = String(row.email || '').trim().toLowerCase();
    if (!email || emails.has(email)) {
      throw seederError(`Seeder Account email is missing or duplicated: ${email}`);
    }
    emails.add(email);
    if (!MEMBERSHIP_ROLE_VALUES.includes(row.role)) {
      throw seederError(`Seeder Account role is invalid: ${row.role}`);
    }
    if (!TENANT_STATUS_VALUES.includes(row.status)) {
      throw seederError(`Seeder Account status is invalid: ${row.status}`);
    }
    if (row.staffId !== null && row.staffId !== undefined) {
      const staffId = Number(row.staffId);
      if (!Number.isSafeInteger(staffId) || staffId <= 0 || staffIds.has(staffId)) {
        throw seederError(`Seeder Account staffId is invalid or duplicated: ${row.staffId}`);
      }
      staffIds.add(staffId);
    }
  }
}

function createTransactionQueryInterface(queryInterface, transaction) {
  const sequelize = Object.create(queryInterface.sequelize);
  sequelize.query = (sql, options = {}) =>
    queryInterface.sequelize.query(sql, { ...options, transaction });

  return {
    ...queryInterface,
    sequelize,
    bulkDelete: (table, where, options = {}, model) =>
      queryInterface.bulkDelete(
        table,
        where,
        { ...options, transaction },
        model,
      ),
    bulkInsert: (table, rows, options = {}, attributes) =>
      queryInterface.bulkInsert(
        table,
        rows,
        { ...options, transaction },
        attributes,
      ),
    bulkUpdate: (table, values, where, options = {}, attributes) =>
      queryInterface.bulkUpdate(
        table,
        values,
        where,
        { ...options, transaction },
        attributes,
      ),
  };
}

async function deleteAccountsByEmails(
  queryInterface,
  transaction,
  emails,
  organizationId,
) {
  if (!Array.isArray(emails) || emails.length === 0) return [];
  const normalizedEmails = [...new Set(emails.map((email) => String(email).trim().toLowerCase()))];
  if (normalizedEmails.length !== emails.length || normalizedEmails.some((email) => !email)) {
    throw seederError('Seeder Account delete requires unique exact emails');
  }
  const [accounts] = await queryInterface.sequelize.query(
    `SELECT a.id FROM Accounts a JOIN Memberships m ON m.accountId=a.id
      WHERE a.email IN (:emails) AND m.organizationId=:organizationId
      ORDER BY a.id FOR UPDATE`,
    { replacements: { emails: normalizedEmails, organizationId }, transaction },
  );
  if (accounts.length === 0) return [];
  const accountIds = accounts.map((row) => row.id);
  const [memberships] = await queryInterface.sequelize.query(
    'SELECT id FROM Memberships WHERE accountId IN (:accountIds) ORDER BY id FOR UPDATE',
    { replacements: { accountIds }, transaction },
  );
  const membershipIds = memberships.map((row) => row.id);
  if (membershipIds.length > 0) {
    await queryInterface.sequelize.query(
      'SELECT membershipId, clubId FROM MembershipClubAccesses WHERE membershipId IN (:membershipIds) FOR UPDATE',
      { replacements: { membershipIds }, transaction },
    );
    await queryInterface.sequelize.query(
      'DELETE FROM MembershipClubAccesses WHERE membershipId IN (:membershipIds)',
      { replacements: { membershipIds }, transaction },
    );
    await queryInterface.sequelize.query(
      'DELETE FROM Memberships WHERE id IN (:membershipIds)',
      { replacements: { membershipIds }, transaction },
    );
  }
  await queryInterface.sequelize.query(
    'DELETE FROM Accounts WHERE id IN (:accountIds)',
    { replacements: { accountIds }, transaction },
  );
  return accountIds;
}

async function insertAccountsWithParity(
  queryInterface,
  transaction,
  rows,
  foundation,
) {
  if (rows.length === 0) return [];
  validateAccountRows(rows);
  await queryInterface.bulkInsert('Accounts', rows, { transaction });
  const emails = rows.map((row) => String(row.email).trim().toLowerCase());
  const [accounts] = await queryInterface.sequelize.query(
    'SELECT id, email, role, staffId, status FROM Accounts WHERE email IN (:emails) ORDER BY id FOR UPDATE',
    { replacements: { emails }, transaction },
  );
  if (accounts.length !== rows.length) {
    throw seederError('Seeder Account insert did not produce exact email parity');
  }
  const now = new Date();
  await queryInterface.bulkInsert(
    'Memberships',
    accounts.map((account) => ({
      accountId: account.id,
      createdAt: now,
      organizationId: foundation.organization.id,
      role: account.role,
      staffId: account.staffId,
      status: account.status,
      updatedAt: now,
    })),
    { transaction },
  );
  const accountIds = accounts.map((account) => account.id);
  const [memberships] = await queryInterface.sequelize.query(
    'SELECT id, role, status FROM Memberships WHERE accountId IN (:accountIds) ORDER BY id FOR UPDATE',
    { replacements: { accountIds }, transaction },
  );
  const accessRows = memberships
    .filter((membership) => membership.role !== 'owner')
    .map((membership) => ({
      clubId: foundation.club.id,
      createdAt: now,
      membershipId: membership.id,
      organizationId: foundation.organization.id,
      roleOverride: null,
      status: membership.status,
      updatedAt: now,
    }));
  if (accessRows.length > 0) {
    await queryInterface.bulkInsert('MembershipClubAccesses', accessRows, {
      transaction,
    });
  }
  return accountIds;
}

async function runInitializedSeederBatch(
  queryInterface,
  execute,
  options = {},
) {
  const [[tenantShape]] = await queryInterface.sequelize.query(
    `SELECT
       (SELECT COUNT(*) FROM Organizations) organizations,
       (SELECT COUNT(*) FROM Clubs) clubs,
       (SELECT COUNT(*) FROM Organizations
         WHERE slug=:organizationSlug AND status='active') defaultOrganizations,
       (SELECT COUNT(*) FROM Clubs c JOIN Organizations o ON o.id=c.organizationId
         WHERE o.slug=:organizationSlug AND c.slug=:clubSlug
           AND o.status='active' AND c.status='active') defaultClubs`,
    {
      replacements: {
        clubSlug: DEFAULT_CLUB_SLUG,
        organizationSlug: DEFAULT_ORGANIZATION_SLUG,
      },
    },
  );
  if (
    Number(tenantShape.organizations) !== 1 ||
    Number(tenantShape.clubs) !== 1 ||
    Number(tenantShape.defaultOrganizations) !== 1 ||
    Number(tenantShape.defaultClubs) !== 1
  ) {
    throw seederError(
      'Demo seeder requires the exact initialized default Organization and Club; it is not a provisioning mechanism',
      'TENANT_SEEDER_DEFAULT_ONLY',
    );
  }
  await assertTenantFoundationInitialized({
    sequelize: queryInterface.sequelize,
  });
  const result = await queryInterface.sequelize.transaction(async (transaction) => {
    const [organizations] = await queryInterface.sequelize.query(
      `SELECT id FROM Organizations
        WHERE slug=:organizationSlug AND status='active' ORDER BY id FOR UPDATE`,
      {
        replacements: { organizationSlug: DEFAULT_ORGANIZATION_SLUG },
        transaction,
      },
      { transaction },
    );
    const classification = await classifyTenantFoundation({
      sequelize: queryInterface.sequelize,
      transaction,
    });
    if (classification.state !== TENANT_FOUNDATION_STATES.INITIALIZED) {
      throw stateError(classification);
    }
    const [[tenantCounts]] = await queryInterface.sequelize.query(
      'SELECT (SELECT COUNT(*) FROM Organizations) organizations,(SELECT COUNT(*) FROM Clubs) clubs',
      { transaction },
    );
    const [clubs] = await queryInterface.sequelize.query(
      `SELECT id FROM Clubs WHERE organizationId=:organizationId
        AND slug=:clubSlug AND status='active' ORDER BY id FOR UPDATE`,
      {
        replacements: {
          clubSlug: DEFAULT_CLUB_SLUG,
          organizationId: organizations[0]?.id || 0,
        },
        transaction,
      },
    );
    if (
      organizations.length !== 1 ||
      clubs.length !== 1 ||
      Number(tenantCounts.organizations) !== 1 ||
      Number(tenantCounts.clubs) !== 1
    ) {
      throw seederError(
        'Demo seeder requires the exact initialized default Organization and Club; it is not a provisioning mechanism',
        'TENANT_SEEDER_DEFAULT_ONLY',
      );
    }
    const foundation = { club: clubs[0], organization: organizations[0] };
    const scopedQueryInterface = createTransactionQueryInterface(
      queryInterface,
      transaction,
    );
    const accountBatch = {
      deleteAccountsByEmails: (emails) =>
        deleteAccountsByEmails(
          queryInterface,
          transaction,
          emails,
          foundation.organization.id,
        ),
      insertAccounts: (rows) =>
        insertAccountsWithParity(
          queryInterface,
          transaction,
          rows,
          foundation,
        ),
    };

    const callbackResult = await execute(
      scopedQueryInterface,
      accountBatch,
      foundation,
    );
    if (options.failAfter === 'batch') {
      throw seederError('Forced seeder batch failure');
    }
    const [[ownerParity]] = await queryInterface.sequelize.query(
      `SELECT COUNT(*) activeOwners FROM Memberships membership
       JOIN Accounts account ON account.id=membership.accountId
       WHERE membership.organizationId=:organizationId
         AND membership.role='owner' AND membership.status='active'
         AND account.status='active'`,
      {
        replacements: { organizationId: foundation.organization.id },
        transaction,
      },
    );
    if (Number(ownerParity.activeOwners) < 1) {
      throw seederError(
        'Demo seeder would remove the last active Organization owner',
        'TENANT_SEEDER_LAST_OWNER',
      );
    }
    const finalState = await classifyTenantFoundation({
      sequelize: queryInterface.sequelize,
      transaction,
    });
    if (finalState.state !== TENANT_FOUNDATION_STATES.INITIALIZED) {
      throw stateError(finalState);
    }
    return callbackResult;
  });
  invalidateTenantFoundationGateCache();
  await assertTenantFoundationInitialized({ sequelize: queryInterface.sequelize });
  return result;
}

async function seedDemoAccounts(accounts, options = {}) {
  validateAccountRows(accounts);
  await assertTenantFoundationInitialized();
  const results = await db.sequelize.transaction(async (transaction) => {
    const { club, organization } =
      await accountLifecycle._private.lockDefaultFoundation(transaction);
    const output = [];

    for (const definition of accounts) {
      const staffPayload = {
        name: definition.name,
        organizationId: organization.id,
        phone: definition.phone,
        role: definition.staffRole,
        status: definition.status,
      };
      let staff = await db.Staff.findOne({
        lock: transaction.LOCK.UPDATE,
        transaction,
        where: {
          organizationId: organization.id,
          phone: definition.phone,
        },
      });
      if (staff) {
        await staff.update(staffPayload, { transaction });
      } else {
        staff = await db.Staff.create(staffPayload, { transaction });
      }

      let account = await db.Account.findOne({
        lock: transaction.LOCK.UPDATE,
        transaction,
        where: { email: definition.email },
      });
      const payload = {
        email: definition.email,
        passwordHash: definition.passwordHash,
        role: definition.role,
        staffId: staff.id,
        status: definition.status,
      };
      let action;
      if (account) {
        const graph = await accountLifecycle._private.lockAccountGraph(
          account.id,
          organization.id,
          transaction,
        );
        const revocationReason = definition.status !== 'active'
          ? normalUserSessions.REVOCATION_REASONS.ACCOUNT_DISABLED
          : definition.passwordHash !== graph.account.passwordHash
            ? normalUserSessions.REVOCATION_REASONS.PASSWORD_CHANGED
            : definition.role !== graph.account.role || staff.id !== graph.account.staffId
              ? normalUserSessions.REVOCATION_REASONS.SECURITY_CONTEXT_CHANGED
              : null;
        if (revocationReason) {
          await normalUserSessions.revokeAllForAccount(
            graph.account.id,
            revocationReason,
            { transaction },
          );
        }
        await graph.account.update(payload, { transaction });
        await graph.membership.update(
          {
            role: definition.role,
            staffId: staff.id,
            status: definition.status,
          },
          { transaction },
        );
        await accountLifecycle._private.reconcileAccess({
          club,
          finalRole: definition.role,
          finalStatus: definition.status,
          membership: graph.membership,
          organization,
          transaction,
        });
        action = 'updated';
      } else {
        account = await db.Account.create(payload, { transaction });
        const membership = await db.Membership.create(
          {
            accountId: account.id,
            organizationId: organization.id,
            role: definition.role,
            staffId: staff.id,
            status: definition.status,
          },
          { transaction },
        );
        await accountLifecycle._private.reconcileAccess({
          club,
          finalRole: definition.role,
          finalStatus: definition.status,
          membership,
          organization,
          transaction,
        });
        action = 'created';
      }
      output.push({ action, email: definition.email, role: definition.role });
    }

    if (options.failAfter === 'batch') {
      throw seederError('Forced demo Account seed failure');
    }
    const classification = await classifyTenantFoundation({ transaction });
    if (classification.state !== TENANT_FOUNDATION_STATES.INITIALIZED) {
      throw stateError(classification);
    }
    return output;
  });
  invalidateTenantFoundationGateCache();
  await assertTenantFoundationInitialized();
  return results;
}

module.exports = {
  _private: {
    createTransactionQueryInterface,
    deleteAccountsByEmails,
    insertAccountsWithParity,
    validateAccountRows,
  },
  runInitializedSeederBatch,
  seedDemoAccounts,
};
