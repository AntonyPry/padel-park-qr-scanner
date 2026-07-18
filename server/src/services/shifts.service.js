const db = require('../../models');
const onboardingService = require('./onboarding.service');
const payrollService = require('./payroll.service');
const shiftReportsService = require('./shift-reports.service');
const shiftCashService = require('./shift-cash.service');
const {
  isTenantShiftsReportsEnabled,
} = require('../tenant-context/capabilities');
const {
  bindShiftOperationsActor,
  resolveShiftOperationsAccessContext,
  shiftOperationsTenantValues,
  shiftOperationsTenantWhere,
} = require('./shift-operations-access-context.service');

const SHIFT_INCLUDE = [{ model: db.Staff, attributes: ['id', 'name', 'role'] }];
const SHIFT_MANAGE_ROLES = new Set(['owner', 'manager']);
const SHIFT_OPERATE_ROLES = new Set(['owner', 'manager', 'admin']);

function getMoscowDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function normalizeHours(hours) {
  const normalized = Number(hours);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    const error = new Error('Укажите корректное количество часов');
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

async function resolveBoundary(account, tenant, options = {}) {
  if (!isTenantShiftsReportsEnabled()) return { account, context: null };
  const context = await resolveShiftOperationsAccessContext(tenant, options);
  return { account: bindShiftOperationsActor(account, context), context };
}

function tenantWhere(context, values = {}) {
  return context ? shiftOperationsTenantWhere(context, values) : values;
}

function tenantValues(context) {
  return context ? shiftOperationsTenantValues(context) : {};
}

function assertBoundaryRole(boundary, roles) {
  if (!boundary.context || roles.has(boundary.account?.role)) return;
  const error = new Error('Недостаточно прав');
  error.statusCode = 403;
  throw error;
}

function serializeShift(value) {
  if (!value) return value;
  const plain = value.toJSON ? value.toJSON() : { ...value };
  delete plain.clubId;
  delete plain.organizationId;
  return plain;
}

async function getActive(account, tenant) {
  const boundary = await resolveBoundary(account, tenant);
  assertBoundaryRole(boundary, SHIFT_OPERATE_ROLES);
  return db.Shift.findOne({
    where: tenantWhere(boundary.context, { status: 'active', archivedAt: null }),
    include: SHIFT_INCLUDE,
    order: [['startedAt', 'DESC']],
  });
}

async function getStaffForAccount(account, context, transaction) {
  if (!context && account.Staff) return account.Staff;
  if (account.staffId) {
    const staff = await db.Staff.findOne({
      transaction,
      where: {
        id: account.staffId,
        ...(context ? { organizationId: context.organizationId } : {}),
      },
    });
    await assertStaffClubAccess(staff, context, transaction);
    return staff;
  }
  return null;
}

async function assertStaffClubAccess(staff, context, transaction) {
  if (!context || !staff) return;
  const membership = await db.Membership.findOne({
    attributes: ['id', 'role'],
    transaction,
    where: {
      organizationId: context.organizationId,
      staffId: staff.id,
      status: 'active',
    },
  });
  if (!membership) {
    const error = new Error('Сотрудник не имеет активного доступа к клубу');
    error.statusCode = 400;
    throw error;
  }
  if (membership.role === 'owner') return;
  const clubAccess = await db.MembershipClubAccess.findOne({
    attributes: ['membershipId'],
    transaction,
    where: {
      clubId: context.clubId,
      membershipId: membership.id,
      organizationId: context.organizationId,
      status: 'active',
    },
  });
  if (!clubAccess) {
    const error = new Error('Сотрудник не имеет активного доступа к клубу');
    error.statusCode = 400;
    throw error;
  }
}

async function resolveShiftOwner({ staffId, adminName }, context, transaction) {
  if (staffId) {
    const staff = await db.Staff.findOne({
      transaction,
      where: {
        id: Number(staffId),
        ...(context ? { organizationId: context.organizationId } : {}),
      },
    });

    if (!staff || staff.status !== 'active') {
      const error = new Error('Активный сотрудник не найден');
      error.statusCode = 400;
      throw error;
    }
    await assertStaffClubAccess(staff, context, transaction);

    return {
      staffId: staff.id,
      adminName: staff.name,
    };
  }

  const normalizedName = String(adminName || '').trim();
  if (!normalizedName) {
    const error = new Error('Укажите сотрудника смены');
    error.statusCode = 400;
    throw error;
  }

  return {
    staffId: null,
    adminName: normalizedName,
  };
}

function assertManualAdjustmentReason(data) {
  const manualAdjustment = Number(data.manualAdjustment) || 0;
  const comment = String(data.comment || '').trim();

  if (manualAdjustment !== 0 && !comment) {
    const error = new Error('Укажите причину ручной корректировки зарплаты');
    error.statusCode = 400;
    throw error;
  }
}

async function create(data, account, tenant) {
  const boundary = await resolveBoundary(account, tenant);
  assertBoundaryRole(boundary, SHIFT_MANAGE_ROLES);
  const { date, hours, manualAdjustment, comment } = data;
  await payrollService.assertDateEditable(date, 'смену');
  assertManualAdjustmentReason(data);

  const owner = await resolveShiftOwner(data, boundary.context);
  const normalizedHours = normalizeHours(hours);

  const shift = await db.Shift.create({
    date,
    ...tenantValues(boundary.context),
    ...owner,
    hours: normalizedHours,
    actualHours: normalizedHours,
    manualAdjustment: Number(manualAdjustment) || 0,
    comment,
    status: data.status || 'closed',
  });

  await payrollService.recordChange({
    action: 'shift.create',
    entityType: 'shift',
    entityId: shift.id,
    account: boundary.account,
    date,
    reason: comment,
    afterData: shift.toJSON(),
  });

  await onboardingService.recordEventSafe(boundary.account, 'shift.approved', {
    entityId: shift.id,
    entityType: 'shift',
    payload: {
      date,
      shiftId: shift.id,
      status: shift.status,
    },
  });

  await shiftReportsService.ensureReportsForShift(shift, tenant);

  return shift;
}

async function update(data, account, tenant) {
  const boundary = await resolveBoundary(account, tenant);
  assertBoundaryRole(boundary, SHIFT_MANAGE_ROLES);
  const { id, date, hours, manualAdjustment, comment } = data;
  const shift = await db.Shift.findOne({
    where: tenantWhere(boundary.context, { id: Number(id) }),
  });

  if (!shift) return null;
  if (shift.archivedAt) {
    const error = new Error('Архивную смену нельзя редактировать');
    error.statusCode = 409;
    throw error;
  }

  await payrollService.assertDateEditable(shift.date, 'смену');
  if (date && date !== shift.date) {
    await payrollService.assertDateEditable(date, 'смену');
  }
  assertManualAdjustmentReason(data);

  const owner = await resolveShiftOwner(data, boundary.context);
  const normalizedHours = normalizeHours(hours);
  const before = shift.toJSON();

  await shift.update({
    date,
    ...owner,
    hours: normalizedHours,
    actualHours: normalizedHours,
    manualAdjustment: Number(manualAdjustment) || 0,
    comment,
    status: data.status || shift.status || 'closed',
  });

  await payrollService.recordChange({
    action: 'shift.update',
    entityType: 'shift',
    entityId: shift.id,
    account: boundary.account,
    date: shift.date,
    reason: comment,
    beforeData: before,
    afterData: shift.toJSON(),
  });

  await onboardingService.recordEventSafe(boundary.account, 'shift.approved', {
    entityId: shift.id,
    entityType: 'shift',
    payload: {
      date: shift.date,
      shiftId: shift.id,
      status: shift.status,
    },
  });

  return shift;
}

async function remove(id, account, reason, tenant) {
  const boundary = await resolveBoundary(account, tenant);
  assertBoundaryRole(boundary, SHIFT_MANAGE_ROLES);
  const shift = await db.Shift.findOne({
    where: tenantWhere(boundary.context, { id: Number(id) }),
  });
  if (!shift) return null;
  if (shift.archivedAt) return shift;

  await payrollService.assertDateEditable(shift.date, 'смену');
  const before = shift.toJSON();
  await shift.update({
    archivedAt: new Date(),
    archivedByAccountId: boundary.account?.id || null,
    archiveReason: reason ? String(reason).trim() : null,
  });

  await payrollService.recordChange({
    action: 'shift.archive',
    entityType: 'shift',
    entityId: shift.id,
    account: boundary.account,
    date: shift.date,
    reason,
    beforeData: before,
    afterData: shift.toJSON(),
  });

  return shift;
}

async function startActive(account, tenant) {
  const date = getMoscowDateString();
  await payrollService.assertDateEditable(date, 'смену');
  const result = await db.sequelize.transaction(async (transaction) => {
    const boundary = await resolveBoundary(account, tenant, {
      lock: true,
      transaction,
    });
    assertBoundaryRole(boundary, SHIFT_OPERATE_ROLES);
    if (boundary.context) {
      await db.Club.findOne({
        lock: transaction.LOCK.UPDATE,
        transaction,
        where: { id: boundary.context.clubId },
      });
    }
    const activeShift = await db.Shift.findOne({
      lock: transaction.LOCK.UPDATE,
      transaction,
      where: tenantWhere(boundary.context, {
        archivedAt: null,
        status: 'active',
      }),
    });
    if (activeShift) {
      const error = new Error('В клубе уже идет активная смена');
      error.statusCode = 409;
      throw error;
    }

    const staff = await getStaffForAccount(
      boundary.account,
      boundary.context,
      transaction,
    );
    if (!staff || staff.status !== 'active') {
      const error = new Error('Активный сотрудник аккаунта не найден');
      error.statusCode = 400;
      throw error;
    }
    const shift = await db.Shift.create({
      date,
      ...tenantValues(boundary.context),
      staffId: staff.id,
      adminName: staff.name,
      hours: 0,
      actualHours: null,
      startedAt: new Date(),
      status: 'active',
      manualAdjustment: 0,
      comment: 'Смена начата через трекер администратора',
    }, { transaction });
    return { account: boundary.account, shift };
  });

  await payrollService.recordChange({
    action: 'shift.start',
    entityType: 'shift',
    entityId: result.shift.id,
    account: result.account,
    date,
    afterData: result.shift.toJSON(),
  });

  return result.shift;
}

async function endActive(account, data = {}, tenant) {
  const trainingMarker = await onboardingService.getTrainingDataMarker(account);
  if (trainingMarker.isTraining) {
    const error = new Error(
      'Завершение реальной смены недоступно в режиме тренировки. Выключите режим тренировки и повторите действие.',
    );
    error.statusCode = 409;
    throw error;
  }

  const result = await db.sequelize.transaction(async (transaction) => {
    const boundary = await resolveBoundary(account, tenant, {
      lock: true,
      transaction,
    });
    assertBoundaryRole(boundary, SHIFT_OPERATE_ROLES);
    const activeShift = await db.Shift.findOne({
      lock: transaction.LOCK.UPDATE,
      order: [['startedAt', 'DESC']],
      transaction,
      where: tenantWhere(boundary.context, { status: 'active', archivedAt: null }),
    });
    if (!activeShift) {
      const error = new Error('Активная смена не найдена');
      error.statusCode = 404;
      throw error;
    }

    const endedAt = new Date();
    const startedAt = activeShift.startedAt
      ? new Date(activeShift.startedAt)
      : new Date(activeShift.createdAt);
    const actualHours =
      Math.round(
        Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 3600000) * 10,
      ) / 10;
    const cash = await shiftCashService.closeCashSession({
      account: boundary.account,
      data: data.cash || {},
      endedAt,
      shift: activeShift,
      transaction,
    });

    const before = activeShift.toJSON();
    await activeShift.update(
      {
        endedAt,
        hours: actualHours,
        actualHours,
        status: 'closed',
        approvedByAccountId: boundary.account.id,
      },
      { transaction },
    );

    await payrollService.recordChange({
      action: 'shift.close',
      entityType: 'shift',
      entityId: activeShift.id,
      account: boundary.account,
      date: activeShift.date,
      beforeData: before,
      afterData: activeShift.toJSON(),
      transaction,
    });

    return { account: boundary.account, cash, shiftId: activeShift.id };
  });

  const responseBoundary = await resolveBoundary(account, tenant);
  const activeShift = await db.Shift.findOne({
    include: SHIFT_INCLUDE,
    where: tenantWhere(responseBoundary.context, { id: result.shiftId }),
  });

  await onboardingService.recordEventSafe(result.account, 'shift.approved', {
    entityId: activeShift.id,
    entityType: 'shift',
    payload: {
      date: activeShift.date,
      shiftId: activeShift.id,
      status: activeShift.status,
    },
  });

  await onboardingService.recordEventSafe(result.account, 'shift_cash.closed', {
    entityId: result.cash.id,
    entityType: 'shift_cash_session',
    payload: {
      shiftId: activeShift.id,
      variance: result.cash.variance,
    },
  });

  await shiftReportsService.ensureReportsForShift(activeShift, tenant);

  return { cash: result.cash, shift: activeShift };
}

module.exports = {
  create,
  endActive,
  getActive,
  update,
  remove,
  startActive,
  serializeShift,
};
