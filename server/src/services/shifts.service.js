const db = require('../../models');
const payrollService = require('./payroll.service');

const SHIFT_INCLUDE = [{ model: db.Staff, attributes: ['id', 'name', 'role'] }];

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

async function getActive() {
  return db.Shift.findOne({
    where: { status: 'active', archivedAt: null },
    include: SHIFT_INCLUDE,
    order: [['startedAt', 'DESC']],
  });
}

async function getStaffForAccount(account) {
  if (account.Staff) return account.Staff;
  if (account.staffId) return db.Staff.findByPk(account.staffId);
  return null;
}

async function resolveShiftOwner({ staffId, adminName }) {
  if (staffId) {
    const staff = await db.Staff.findByPk(Number(staffId));

    if (!staff || staff.status !== 'active') {
      const error = new Error('Активный сотрудник не найден');
      error.statusCode = 400;
      throw error;
    }

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

async function create(data, account) {
  const { date, hours, manualAdjustment, comment } = data;
  await payrollService.assertDateEditable(date, 'смену');
  assertManualAdjustmentReason(data);

  const owner = await resolveShiftOwner(data);
  const normalizedHours = normalizeHours(hours);

  const shift = await db.Shift.create({
    date,
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
    account,
    date,
    reason: comment,
    afterData: shift.toJSON(),
  });

  return shift;
}

async function update(data, account) {
  const { id, date, hours, manualAdjustment, comment } = data;
  const shift = await db.Shift.findByPk(id);

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

  const owner = await resolveShiftOwner(data);
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
    account,
    date: shift.date,
    reason: comment,
    beforeData: before,
    afterData: shift.toJSON(),
  });

  return shift;
}

async function remove(id, account, reason) {
  const shift = await db.Shift.findByPk(id);
  if (!shift) return null;
  if (shift.archivedAt) return shift;

  await payrollService.assertDateEditable(shift.date, 'смену');
  const before = shift.toJSON();
  await shift.update({
    archivedAt: new Date(),
    archivedByAccountId: account?.id || null,
    archiveReason: reason ? String(reason).trim() : null,
  });

  await payrollService.recordChange({
    action: 'shift.archive',
    entityType: 'shift',
    entityId: shift.id,
    account,
    date: shift.date,
    reason,
    beforeData: before,
    afterData: shift.toJSON(),
  });

  return shift;
}

async function startActive(account) {
  const activeShift = await getActive();
  if (activeShift) {
    const error = new Error('В клубе уже идет активная смена');
    error.statusCode = 409;
    throw error;
  }

  const staff = await getStaffForAccount(account);
  if (!staff || staff.status !== 'active') {
    const error = new Error('Активный сотрудник аккаунта не найден');
    error.statusCode = 400;
    throw error;
  }

  const date = getMoscowDateString();
  await payrollService.assertDateEditable(date, 'смену');

  const shift = await db.Shift.create({
    date,
    staffId: staff.id,
    adminName: staff.name,
    hours: 0,
    actualHours: null,
    startedAt: new Date(),
    status: 'active',
    manualAdjustment: 0,
    comment: 'Смена начата через трекер администратора',
  });

  await payrollService.recordChange({
    action: 'shift.start',
    entityType: 'shift',
    entityId: shift.id,
    account,
    date,
    afterData: shift.toJSON(),
  });

  return shift;
}

async function endActive(account) {
  const activeShift = await getActive();
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
    Math.round(Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 3600000) * 10) /
    10;

  const before = activeShift.toJSON();
  await activeShift.update({
    endedAt,
    hours: actualHours,
    actualHours,
    status: 'closed',
    approvedByAccountId: account.id,
  });

  await payrollService.recordChange({
    action: 'shift.close',
    entityType: 'shift',
    entityId: activeShift.id,
    account,
    date: activeShift.date,
    beforeData: before,
    afterData: activeShift.toJSON(),
  });

  return db.Shift.findByPk(activeShift.id, { include: SHIFT_INCLUDE });
}

module.exports = {
  create,
  endActive,
  getActive,
  update,
  remove,
  startActive,
};
