const db = require('../../models');
const authService = require('./auth.service');
const { ACCOUNT_ROLE_VALUES } = require('../constants/account-roles');

const ACCOUNT_ATTRIBUTES = [
  'id',
  'email',
  'role',
  'status',
  'lastLoginAt',
  'staffId',
];

function getStaffById(id) {
  return db.Staff.findByPk(id, {
    include: [{ model: db.Account, attributes: ACCOUNT_ATTRIBUTES }],
  });
}

async function getAll() {
  return db.Staff.findAll({
    include: [{ model: db.Account, attributes: ACCOUNT_ATTRIBUTES }],
    order: [['createdAt', 'DESC']],
  });
}

async function create(data) {
  const {
    name,
    role,
    phone,
    status = 'active',
    email,
    password,
    accountRole = 'admin',
  } = data;

  if (!name || !role) {
    const error = new Error('Имя и роль сотрудника обязательны');
    error.statusCode = 400;
    throw error;
  }

  if (email && !password) {
    const error = new Error('Для аккаунта сотрудника нужен пароль');
    error.statusCode = 400;
    throw error;
  }

  if (email && !ACCOUNT_ROLE_VALUES.includes(accountRole)) {
    const error = new Error('Неизвестная роль аккаунта');
    error.statusCode = 400;
    throw error;
  }

  const transaction = await db.sequelize.transaction();

  try {
    const staff = await db.Staff.create(
      {
        name: String(name).trim(),
        role: String(role).trim(),
        phone: phone || null,
        status,
      },
      { transaction },
    );

    if (email) {
      await db.Account.create(
        {
          staffId: staff.id,
          email: String(email).trim().toLowerCase(),
          passwordHash: authService.hashPassword(password),
          role: accountRole,
          status: 'active',
        },
        { transaction },
      );
    }

    await transaction.commit();
    return getStaffById(staff.id);
  } catch (error) {
    await transaction.rollback();

    if (error.name === 'SequelizeUniqueConstraintError') {
      error.statusCode = 409;
      error.message = 'Аккаунт с таким email уже существует';
    }

    throw error;
  }
}

module.exports = {
  getStaffById,
  getAll,
  create,
};
