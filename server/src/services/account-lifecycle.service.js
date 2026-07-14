'use strict';

const db = require('../../models');
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
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

function lifecycleError(message, statusCode = 409, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function assertRoleStatus(role, status) {
  if (!MEMBERSHIP_ROLE_VALUES.includes(role)) {
    throw lifecycleError(`Unsupported Account role: ${role}`, 400, 'INVALID_ACCOUNT_ROLE');
  }
  if (!TENANT_STATUS_VALUES.includes(status)) {
    throw lifecycleError(
      `Unsupported Account status: ${status}`,
      400,
      'INVALID_ACCOUNT_STATUS',
    );
  }
}

async function lockDefaultFoundation(transaction, { requireInitialized = true } = {}) {
  const organization = await db.Organization.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { slug: DEFAULT_ORGANIZATION_SLUG },
  });
  if (!organization || organization.status !== 'active') {
    const classification = await classifyTenantFoundation({ transaction });
    throw stateError(classification);
  }

  const [organizationCount, clubCount, club] = await Promise.all([
    db.Organization.count({ transaction }),
    db.Club.count({ transaction }),
    db.Club.findOne({
      transaction,
      where: {
        organizationId: organization.id,
        slug: DEFAULT_CLUB_SLUG,
      },
    }),
  ]);
  if (
    organizationCount !== 1 ||
    clubCount !== 1 ||
    !club ||
    club.status !== 'active'
  ) {
    const classification = await classifyTenantFoundation({ transaction });
    throw stateError(classification);
  }

  if (requireInitialized) {
    await assertTenantFoundationInitialized({ transaction });
  }

  return { club, organization };
}

async function lockAccountGraph(accountId, organizationId, transaction) {
  const account = await db.Account.findByPk(accountId, {
    lock: transaction.LOCK.UPDATE,
    transaction,
  });
  if (!account) throw lifecycleError('Пользователь не найден', 404, 'ACCOUNT_NOT_FOUND');

  const membership = await db.Membership.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { accountId: account.id, organizationId },
  });
  if (!membership) {
    const classification = await classifyTenantFoundation({ transaction });
    throw stateError(classification);
  }
  const accesses = await db.MembershipClubAccess.findAll({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { membershipId: membership.id },
  });

  return { accesses, account, membership };
}

async function assertLastActiveOwnerRemains(
  membership,
  finalValues,
  transaction,
) {
  const finalRole = finalValues.role ?? membership.role;
  const finalStatus = finalValues.status ?? membership.status;
  const removesActiveOwner =
    membership.role === 'owner' &&
    membership.status === 'active' &&
    (finalValues.delete || finalRole !== 'owner' || finalStatus !== 'active');

  if (!removesActiveOwner) return;
  const remainingOwners = await db.Membership.count({
    transaction,
    where: {
      id: { [db.Sequelize.Op.ne]: membership.id },
      organizationId: membership.organizationId,
      role: 'owner',
      status: 'active',
    },
  });
  if (remainingOwners < 1) {
    throw lifecycleError(
      'Нельзя удалить или отключить последнего владельца',
      409,
      'LAST_ACTIVE_OWNER',
    );
  }
}

async function reconcileAccess({
  club,
  finalRole,
  finalStatus,
  membership,
  organization,
  transaction,
}) {
  if (finalRole === 'owner') {
    await db.MembershipClubAccess.destroy({
      transaction,
      where: { membershipId: membership.id },
    });
    return;
  }

  const [access, created] = await db.MembershipClubAccess.findOrCreate({
    defaults: {
      organizationId: organization.id,
      roleOverride: null,
      status: finalStatus,
    },
    transaction,
    where: { clubId: club.id, membershipId: membership.id },
  });
  if (!created) {
    await access.update(
      {
        organizationId: organization.id,
        roleOverride: null,
        status: finalStatus,
      },
      { transaction },
    );
  }
}

async function createAccount(payload, options = {}) {
  const role = payload.role || 'admin';
  const status = payload.status || 'active';
  assertRoleStatus(role, status);

  const account = await db.sequelize.transaction(async (transaction) => {
    const { club, organization } = await lockDefaultFoundation(transaction);
    const createdAccount = await db.Account.create(
      { ...payload, role, status },
      { transaction },
    );
    if (options.failAfter === 'account') {
      throw lifecycleError('Forced Account lifecycle failure');
    }
    const membership = await db.Membership.create(
      {
        accountId: createdAccount.id,
        organizationId: organization.id,
        role,
        status,
      },
      { transaction },
    );
    if (options.failAfter === 'membership') {
      throw lifecycleError('Forced Membership lifecycle failure');
    }
    await reconcileAccess({
      club,
      finalRole: role,
      finalStatus: status,
      membership,
      organization,
      transaction,
    });
    if (options.failAfter === 'access') {
      throw lifecycleError('Forced access lifecycle failure');
    }
    await assertTenantFoundationInitialized({ transaction });
    return createdAccount;
  });

  invalidateTenantFoundationGateCache();
  await assertTenantFoundationInitialized();
  return account;
}

async function updateAccount(accountId, payload, options = {}) {
  const account = await db.sequelize.transaction(async (transaction) => {
    const { club, organization } = await lockDefaultFoundation(transaction);
    const graph = await lockAccountGraph(accountId, organization.id, transaction);
    const finalRole = payload.role ?? graph.account.role;
    const finalStatus = payload.status ?? graph.account.status;
    assertRoleStatus(finalRole, finalStatus);
    await assertLastActiveOwnerRemains(
      graph.membership,
      { role: finalRole, status: finalStatus },
      transaction,
    );

    await graph.account.update(payload, { transaction });
    if (options.failAfter === 'account') {
      throw lifecycleError('Forced Account lifecycle failure');
    }
    await graph.membership.update(
      { role: finalRole, status: finalStatus },
      { transaction },
    );
    if (options.failAfter === 'membership') {
      throw lifecycleError('Forced Membership lifecycle failure');
    }
    await reconcileAccess({
      club,
      finalRole,
      finalStatus,
      membership: graph.membership,
      organization,
      transaction,
    });
    if (options.failAfter === 'access') {
      throw lifecycleError('Forced access lifecycle failure');
    }
    await assertTenantFoundationInitialized({ transaction });
    return graph.account;
  });

  invalidateTenantFoundationGateCache();
  await assertTenantFoundationInitialized();
  return account;
}

async function permanentDeleteAccount(accountId, options = {}) {
  await db.sequelize.transaction(async (transaction) => {
    const { organization } = await lockDefaultFoundation(transaction);
    const graph = await lockAccountGraph(accountId, organization.id, transaction);
    await assertLastActiveOwnerRemains(
      graph.membership,
      { delete: true },
      transaction,
    );
    if (options.assertDeletable) {
      await options.assertDeletable(graph.account, transaction);
    }

    await db.MembershipClubAccess.destroy({
      transaction,
      where: { membershipId: graph.membership.id },
    });
    if (options.failAfter === 'access') {
      throw lifecycleError('Forced permanent-delete failure after access');
    }
    await graph.membership.destroy({ transaction });
    if (options.failAfter === 'membership') {
      throw lifecycleError('Forced permanent-delete failure after Membership');
    }
    await graph.account.destroy({ transaction });
    if (options.failAfter === 'account') {
      throw lifecycleError('Forced permanent-delete failure after Account');
    }
    await assertTenantFoundationInitialized({ transaction });
  });

  invalidateTenantFoundationGateCache();
  await assertTenantFoundationInitialized();
  return { success: true };
}

async function bootstrapInitialOwner(
  { account, staff },
  { failAfter } = {},
) {
  let accountId;
  await db.sequelize.transaction(async (transaction) => {
    const { organization } = await lockDefaultFoundation(transaction, {
      requireInitialized: false,
    });
    const classification = await classifyTenantFoundation({ transaction });
    if (classification.state === TENANT_FOUNDATION_STATES.INITIALIZED) {
      throw lifecycleError(
        'Система уже настроена',
        409,
        'ALREADY_BOOTSTRAPPED',
      );
    }
    if (classification.state !== TENANT_FOUNDATION_STATES.BOOTSTRAP_PENDING) {
      throw stateError(classification);
    }

    const createdStaff = await db.Staff.create(staff, { transaction });
    if (failAfter === 'staff') {
      throw lifecycleError('Forced bootstrap failure after Staff');
    }
    const createdAccount = await db.Account.create(
      { ...account, staffId: createdStaff.id, role: 'owner', status: 'active' },
      { transaction },
    );
    accountId = createdAccount.id;
    if (failAfter === 'account') {
      throw lifecycleError('Forced bootstrap failure after Account');
    }
    await db.Membership.create(
      {
        accountId: createdAccount.id,
        organizationId: organization.id,
        role: 'owner',
        status: 'active',
      },
      { transaction },
    );
    if (failAfter === 'membership') {
      throw lifecycleError('Forced bootstrap failure after Membership');
    }

    const projected = await classifyTenantFoundation({ transaction });
    if (
      projected.state !== TENANT_FOUNDATION_STATES.INITIALIZED ||
      projected.diagnostics.activeOwners !== 1
    ) {
      throw stateError(projected);
    }
  });

  invalidateTenantFoundationGateCache();
  await assertTenantFoundationInitialized();
  return accountId;
}

module.exports = {
  _private: {
    assertLastActiveOwnerRemains,
    lockAccountGraph,
    lockDefaultFoundation,
    reconcileAccess,
  },
  bootstrapInitialOwner,
  createAccount,
  permanentDeleteAccount,
  updateAccount,
};
