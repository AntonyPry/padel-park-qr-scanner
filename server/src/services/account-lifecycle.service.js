'use strict';

const db = require('../../models');
const {
  countAuthUsableOwners,
  isAuthUsableOwnerMembership,
} = require('./owner-access-invariant.service');
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

async function lockDefaultFoundation(
  transaction,
  { organizationId = null, requireInitialized = true } = {},
) {
  const organization = await db.Organization.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { slug: DEFAULT_ORGANIZATION_SLUG },
  });
  if (!organization || organization.status !== 'active') {
    const classification = await classifyTenantFoundation({ transaction });
    throw stateError(classification);
  }
  if (
    organizationId !== null &&
    Number(organization.id) !== Number(organizationId)
  ) {
    throw lifecycleError(
      'Контекст организации недоступен',
      404,
      'TENANT_CONTEXT_NOT_FOUND',
    );
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

async function assertStaffLinkAvailable(
  staffId,
  organizationId,
  transaction,
  { accountId = null } = {},
) {
  if (staffId === null || staffId === undefined || staffId === '') return null;
  const normalizedStaffId = Number(staffId);
  if (!Number.isSafeInteger(normalizedStaffId) || normalizedStaffId <= 0) {
    throw lifecycleError('Некорректный сотрудник', 400, 'INVALID_STAFF_ID');
  }

  const staff = await db.Staff.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { id: normalizedStaffId, organizationId },
  });
  if (!staff) {
    throw lifecycleError('Сотрудник не найден', 404, 'STAFF_NOT_FOUND');
  }
  if (staff.status !== 'active') {
    throw lifecycleError(
      'К пользователю можно привязать только активного сотрудника',
      409,
      'STAFF_NOT_ACTIVE',
    );
  }

  const membershipWhere = { organizationId, staffId: normalizedStaffId };
  if (accountId) {
    membershipWhere.accountId = { [db.Sequelize.Op.ne]: Number(accountId) };
  }
  const linkedMembership = await db.Membership.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: membershipWhere,
  });
  if (linkedMembership) {
    throw lifecycleError(
      'Этот сотрудник уже привязан к другому пользователю',
      409,
      'STAFF_ALREADY_LINKED',
    );
  }
  return normalizedStaffId;
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
  const removesUsableOwner = await isAuthUsableOwnerMembership({
    membershipId: membership.id,
    organizationId: membership.organizationId,
    transaction,
  });
  if (!removesUsableOwner) return;

  const remainingOwners = await countAuthUsableOwners({
    excludeMembershipId: membership.id,
    organizationId: membership.organizationId,
    transaction,
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
    const { club, organization } = await lockDefaultFoundation(transaction, {
      organizationId: options.organizationId,
    });
    const staffId = await assertStaffLinkAvailable(
      payload.staffId,
      organization.id,
      transaction,
    );
    const createdAccount = await db.Account.create(
      { ...payload, role, staffId, status },
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
        staffId,
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
    const { club, organization } = await lockDefaultFoundation(transaction, {
      organizationId: options.organizationId,
    });
    const graph = await lockAccountGraph(accountId, organization.id, transaction);
    const finalRole = payload.role ?? graph.account.role;
    const finalStatus = payload.status ?? graph.account.status;
    assertRoleStatus(finalRole, finalStatus);
    const finalStaffId = Object.prototype.hasOwnProperty.call(payload, 'staffId')
      ? await assertStaffLinkAvailable(
          payload.staffId,
          organization.id,
          transaction,
          { accountId: graph.account.id },
        )
      : graph.membership.staffId;
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
      { role: finalRole, staffId: finalStaffId, status: finalStatus },
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
    const { organization } = await lockDefaultFoundation(transaction, {
      organizationId: options.organizationId,
    });
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

    const createdStaff = await db.Staff.create(
      { ...staff, organizationId: organization.id },
      { transaction },
    );
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
        staffId: createdStaff.id,
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
    assertStaffLinkAvailable,
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
