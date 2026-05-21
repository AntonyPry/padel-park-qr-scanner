const db = require('../../models');

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
    where: { status: 'active' },
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

async function create(data) {
  const { date, hours, manualAdjustment, comment } = data;
  const owner = await resolveShiftOwner(data);
  const normalizedHours = normalizeHours(hours);

  return db.Shift.create({
    date,
    ...owner,
    hours: normalizedHours,
    actualHours: normalizedHours,
    manualAdjustment: Number(manualAdjustment) || 0,
    comment,
    status: data.status || 'closed',
  });
}

async function update(data) {
  const { id, date, hours, manualAdjustment, comment } = data;
  const shift = await db.Shift.findByPk(id);

  if (!shift) return null;

  const owner = await resolveShiftOwner(data);
  const normalizedHours = normalizeHours(hours);

  await shift.update({
    date,
    ...owner,
    hours: normalizedHours,
    actualHours: normalizedHours,
    manualAdjustment: Number(manualAdjustment) || 0,
    comment,
    status: data.status || shift.status || 'closed',
  });

  return shift;
}

async function remove(id) {
  return db.Shift.destroy({ where: { id } });
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

  return db.Shift.create({
    date: getMoscowDateString(),
    staffId: staff.id,
    adminName: staff.name,
    hours: 0,
    actualHours: null,
    startedAt: new Date(),
    status: 'active',
    manualAdjustment: 0,
    comment: 'Смена начата через трекер администратора',
  });
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

  await activeShift.update({
    endedAt,
    hours: actualHours,
    actualHours,
    status: 'closed',
    approvedByAccountId: account.id,
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
