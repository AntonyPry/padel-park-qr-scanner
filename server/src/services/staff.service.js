'use strict';

const db = require('../../models');
const {
  countAuthUsableOwners,
  isAuthUsableOwnerMembership,
} = require('./owner-access-invariant.service');
const { resolveStaffAccessContext } = require('./staff-access-context.service');
const {
  invalidateTenantFoundationGateCache,
} = require('./tenant-foundation.service');

const STAFF_STATUS_VALUES = ['active', 'inactive', 'archived'];

function appError(message, statusCode = 400, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function serializeStaff(staff) {
  if (!staff) return null;

  const raw = staff.toJSON ? staff.toJSON() : staff;
  const { organizationId: _organizationId, ...publicStaff } = raw;
  return {
    ...publicStaff,
    position: raw.position || raw.role,
  };
}

function normalizePayload(data) {
  const name = String(data.name || '').trim();
  const position = String(data.position || data.role || '').trim();
  const status = data.status || 'active';

  if (!name || !position) {
    throw appError('Имя и должность сотрудника обязательны');
  }

  if (!STAFF_STATUS_VALUES.includes(status)) {
    throw appError('Неизвестный статус сотрудника');
  }

  return {
    name,
    role: position,
    phone: data.phone ? String(data.phone).trim() : null,
    status,
  };
}

function staffWhere(id, context) {
  const where = { id: Number(id) };
  if (context.scoped) where.organizationId = context.organizationId;
  return where;
}

async function findStaff(id, context, options = {}) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
    throw appError('Сотрудник не найден', 404, 'STAFF_NOT_FOUND');
  }
  const staff = await db.Staff.findOne({
    ...options,
    where: staffWhere(id, context),
  });
  if (!staff) throw appError('Сотрудник не найден', 404, 'STAFF_NOT_FOUND');
  return staff;
}

async function getStaffById(id, tenant = null) {
  const context = await resolveStaffAccessContext(tenant);
  return serializeStaff(await findStaff(id, context));
}

async function getAll(query = {}, tenant = null) {
  const context = await resolveStaffAccessContext(tenant);
  const where = context.scoped
    ? { organizationId: context.organizationId }
    : {};
  if (query.status && query.status !== 'all') {
    if (!STAFF_STATUS_VALUES.includes(query.status)) {
      throw appError('Неизвестный статус сотрудника');
    }
    where.status = query.status;
  }
  const search = String(query.q || '').trim();
  if (search) {
    where[db.Sequelize.Op.or] = ['name', 'role', 'phone'].map((field) => ({
      [field]: { [db.Sequelize.Op.like]: `%${search}%` },
    }));
  }

  const staff = await db.Staff.findAll({
    where,
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
  });

  return staff.map(serializeStaff);
}

async function create(data, tenant = null) {
  const staff = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveStaffAccessContext(tenant, {
      lock: true,
      transaction,
    });
    return db.Staff.create(
      { ...normalizePayload(data), organizationId: context.organizationId },
      { transaction },
    );
  });
  invalidateTenantFoundationGateCache();
  return serializeStaff(staff);
}

async function assertStaffOwnerCanBecomeInactive(staff, transaction) {
  const membership = await db.Membership.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: {
      organizationId: staff.organizationId,
      staffId: staff.id,
    },
  });
  if (
    !membership ||
    membership.role !== 'owner' ||
    membership.status !== 'active'
  ) {
    return;
  }
  const removesUsableOwner = await isAuthUsableOwnerMembership({
    membershipId: membership.id,
    organizationId: staff.organizationId,
    transaction,
  });
  if (!removesUsableOwner) return;

  const remainingOwners = await countAuthUsableOwners({
    excludeMembershipId: membership.id,
    organizationId: staff.organizationId,
    transaction,
  });
  if (remainingOwners < 1) {
    throw appError(
      'Нельзя удалить или отключить последнего владельца',
      409,
      'LAST_ACTIVE_OWNER',
    );
  }
}

async function mutateStatus(id, status, tenant) {
  const staff = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveStaffAccessContext(tenant, {
      lock: true,
      transaction,
    });
    const locked = await findStaff(id, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (status !== 'active' && locked.status === 'active') {
      await assertStaffOwnerCanBecomeInactive(locked, transaction);
    }
    await locked.update({ status }, { transaction });
    return locked;
  });
  invalidateTenantFoundationGateCache();
  return serializeStaff(staff);
}

async function update(id, data, tenant = null) {
  const staff = await db.sequelize.transaction(async (transaction) => {
    const context = await resolveStaffAccessContext(tenant, {
      lock: true,
      transaction,
    });
    const locked = await findStaff(id, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    const payload = normalizePayload(data);
    if (payload.status !== 'active' && locked.status === 'active') {
      await assertStaffOwnerCanBecomeInactive(locked, transaction);
    }
    await locked.update(payload, { transaction });
    return locked;
  });
  invalidateTenantFoundationGateCache();
  return serializeStaff(staff);
}

async function remove(id, tenant = null) {
  return mutateStatus(id, 'archived', tenant);
}

async function restore(id, tenant = null) {
  return mutateStatus(id, 'active', tenant);
}

async function removeArchived(id, tenant = null) {
  await db.sequelize.transaction(async (transaction) => {
    const context = await resolveStaffAccessContext(tenant, {
      lock: true,
      transaction,
    });
    const staff = await findStaff(id, context, {
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (staff.status !== 'archived') {
      throw appError(
        'Удалять безвозвратно можно только сотрудника из архива',
        409,
      );
    }

    const references = await Promise.all([
      db.Account.count({ transaction, where: { staffId: staff.id } }),
      db.Membership.count({
        transaction,
        where: { organizationId: staff.organizationId, staffId: staff.id },
      }),
      db.Shift.count({ transaction, where: { staffId: staff.id } }),
    ]);
    if (references.some((count) => count > 0)) {
      throw appError(
        'Сотрудника нельзя удалить безвозвратно: по нему уже есть аккаунт, доступ или смены. Оставьте его в архиве.',
        409,
      );
    }

    await staff.destroy({ transaction });
  });
  invalidateTenantFoundationGateCache();
  return { success: true };
}

module.exports = {
  _private: {
    assertStaffOwnerCanBecomeInactive,
    findStaff,
    staffWhere,
  },
  create,
  getAll,
  getStaffById,
  remove,
  removeArchived,
  restore,
  update,
};
