const db = require('../../models');

const STAFF_STATUS_VALUES = ['active', 'inactive', 'archived'];

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function serializeStaff(staff) {
  if (!staff) return null;

  const raw = staff.toJSON ? staff.toJSON() : staff;
  return {
    ...raw,
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

async function getStaffById(id) {
  return serializeStaff(await db.Staff.findByPk(id));
}

async function getAll(query = {}) {
  const where = {};
  if (query.status && query.status !== 'all') {
    if (!STAFF_STATUS_VALUES.includes(query.status)) {
      throw appError('Неизвестный статус сотрудника');
    }
    where.status = query.status;
  }

  const staff = await db.Staff.findAll({
    where,
    order: [['createdAt', 'DESC']],
  });

  return staff.map(serializeStaff);
}

async function create(data) {
  const staff = await db.Staff.create(normalizePayload(data));

  return getStaffById(staff.id);
}

async function update(id, data) {
  const staff = await db.Staff.findByPk(id);
  if (!staff) throw appError('Сотрудник не найден', 404);

  await staff.update(normalizePayload(data));

  return getStaffById(staff.id);
}

async function remove(id) {
  const staff = await db.Staff.findByPk(id);
  if (!staff) throw appError('Сотрудник не найден', 404);

  await staff.update({ status: 'archived' });

  return getStaffById(staff.id);
}

async function restore(id) {
  const staff = await db.Staff.findByPk(id);
  if (!staff) throw appError('Сотрудник не найден', 404);

  await staff.update({ status: 'active' });
  return getStaffById(staff.id);
}

async function removeArchived(id) {
  const staff = await db.Staff.findByPk(id);
  if (!staff) throw appError('Сотрудник не найден', 404);
  if (staff.status !== 'archived') {
    throw appError('Удалять безвозвратно можно только сотрудника из архива', 409);
  }

  const references = await Promise.all([
    db.Account.count({ where: { staffId: staff.id } }),
    db.Shift.count({ where: { staffId: staff.id } }),
  ]);
  if (references.some((count) => count > 0)) {
    throw appError(
      'Сотрудника нельзя удалить безвозвратно: по нему уже есть аккаунт или смены. Оставьте его в архиве.',
      409,
    );
  }

  await staff.destroy();
  return { success: true };
}

module.exports = {
  getStaffById,
  getAll,
  create,
  remove,
  removeArchived,
  restore,
  update,
};
