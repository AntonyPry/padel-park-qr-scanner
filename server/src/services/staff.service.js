const db = require('../../models');

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

  if (!['active', 'inactive'].includes(status)) {
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

async function getAll() {
  const staff = await db.Staff.findAll({
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

  await staff.destroy();

  return { success: true };
}

module.exports = {
  getStaffById,
  getAll,
  create,
  remove,
  update,
};
