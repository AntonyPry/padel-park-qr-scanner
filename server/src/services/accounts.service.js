const db = require('../../models');
const authService = require('./auth.service');
const accountLifecycle = require('./account-lifecycle.service');
const accountMetadata = require('./account-metadata.service');
const onboardingService = require('./onboarding.service');
const { ACCOUNT_ROLE_VALUES } = require('../constants/account-roles');

const ACCOUNT_ATTRIBUTES = [
  'id',
  'email',
  'role',
  'status',
  'lastLoginAt',
  'staffId',
  'createdAt',
  'updatedAt',
];
const STAFF_ATTRIBUTES = ['id', 'name', 'role', 'phone', 'status'];
const MANAGER_MANAGED_ROLES = ['admin', 'accountant', 'viewer', 'trainer'];
const ACCOUNT_STATUS_VALUES = ['active', 'inactive', 'archived'];

function appError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeRole(role) {
  if (!ACCOUNT_ROLE_VALUES.includes(role)) {
    throw appError('Неизвестная роль пользователя');
  }

  return role;
}

function normalizeStatus(status = 'active') {
  if (!ACCOUNT_STATUS_VALUES.includes(status)) {
    throw appError('Неизвестный статус пользователя');
  }

  return status;
}

function assertCanManageRole(actor, role) {
  if (actor.role === 'owner') return;

  if (actor.role === 'manager' && MANAGER_MANAGED_ROLES.includes(role)) {
    return;
  }

  throw appError('Недостаточно прав для управления этой ролью', 403);
}

function assertCanManageAccount(actor, account, nextRole = account.role) {
  if (actor.role === 'owner') return;

  if (
    actor.role === 'manager' &&
    MANAGER_MANAGED_ROLES.includes(account.role) &&
    MANAGER_MANAGED_ROLES.includes(nextRole)
  ) {
    return;
  }

  throw appError('Недостаточно прав для управления этим пользователем', 403);
}

async function normalizeStaffId(staffId, accountId = null) {
  if (staffId === null || staffId === undefined || staffId === '') return null;

  const normalizedStaffId = Number(staffId);
  if (!Number.isInteger(normalizedStaffId)) {
    throw appError('Некорректный сотрудник');
  }

  const staff = await db.Staff.findByPk(normalizedStaffId);
  if (!staff) throw appError('Сотрудник не найден', 404);
  if (staff.status !== 'active') {
    throw appError('К пользователю можно привязать только активного сотрудника', 409);
  }

  const where = { staffId: normalizedStaffId };
  if (accountId) {
    where.id = { [db.Sequelize.Op.ne]: Number(accountId) };
  }

  const existingAccount = await db.Account.findOne({ where });
  if (existingAccount) {
    throw appError('Этот сотрудник уже привязан к другому пользователю', 409);
  }

  return normalizedStaffId;
}

function getById(id) {
  return db.Account.findByPk(id, {
    attributes: ACCOUNT_ATTRIBUTES,
    include: [{ model: db.Staff, attributes: STAFF_ATTRIBUTES }],
  });
}

async function getAll(query = {}) {
  const where = {};
  if (query.status && query.status !== 'all') {
    where.status = normalizeStatus(query.status);
  }

  return db.Account.findAll({
    attributes: ACCOUNT_ATTRIBUTES,
    include: [{ model: db.Staff, attributes: STAFF_ATTRIBUTES }],
    where,
    order: [['createdAt', 'DESC']],
  });
}

async function create(actor, data) {
  const email = normalizeEmail(data.email);
  const password = String(data.password || '');
  const role = normalizeRole(data.role || 'admin');
  const status = normalizeStatus(data.status);

  assertCanManageRole(actor, role);

  if (!email) throw appError('Email обязателен');
  if (password.length < 6) {
    throw appError('Пароль должен быть не короче 6 символов');
  }

  const staffId = await normalizeStaffId(data.staffId);

  try {
    const account = await accountLifecycle.createAccount({
      email,
      passwordHash: authService.hashPassword(password),
      role,
      status,
      staffId,
    });

    await onboardingService.recordEventSafe(actor, 'account.created', {
      entityId: account.id,
      entityType: 'account',
      payload: {
        role,
        staffId,
        status,
      },
    });

    return getById(account.id);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      throw appError('Пользователь с таким email уже существует', 409);
    }

    throw error;
  }
}

async function update(actor, id, data) {
  const account = await db.Account.findByPk(id);
  if (!account) throw appError('Пользователь не найден', 404);

  const payload = {};
  const nextRole = data.role ? normalizeRole(data.role) : account.role;

  assertCanManageAccount(actor, account, nextRole);
  assertCanManageRole(actor, nextRole);

  if ('email' in data) {
    const email = normalizeEmail(data.email);
    if (!email) throw appError('Email обязателен');
    payload.email = email;
  }

  if ('role' in data) {
    payload.role = nextRole;
  }

  if ('status' in data) {
    payload.status = normalizeStatus(data.status);
  }

  if ('staffId' in data) {
    payload.staffId = await normalizeStaffId(data.staffId, account.id);
  }

  if (data.password) {
    if (String(data.password).length < 6) {
      throw appError('Пароль должен быть не короче 6 символов');
    }
    payload.passwordHash = authService.hashPassword(data.password);
  }

  try {
    if ('role' in payload || 'status' in payload) {
      await accountLifecycle.updateAccount(account.id, payload);
    } else {
      await accountMetadata.updateAccountMetadata(account.id, payload);
    }
    return getById(account.id);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      throw appError('Пользователь с таким email уже существует', 409);
    }

    throw error;
  }
}

async function remove(actor, id) {
  const account = await db.Account.findByPk(id);
  if (!account) throw appError('Пользователь не найден', 404);

  assertCanManageAccount(actor, account);
  await accountLifecycle.updateAccount(account.id, { status: 'archived' });

  return getById(account.id);
}

async function restore(actor, id) {
  const account = await db.Account.findByPk(id);
  if (!account) throw appError('Пользователь не найден', 404);

  assertCanManageAccount(actor, account);
  await accountLifecycle.updateAccount(account.id, { status: 'active' });
  return getById(account.id);
}

async function removeArchived(actor, id) {
  const account = await db.Account.findByPk(id);
  if (!account) throw appError('Пользователь не найден', 404);

  assertCanManageAccount(actor, account);
  if (account.status !== 'archived') {
    throw appError('Удалять безвозвратно можно только пользователя из архива', 409);
  }
  if (actor?.id === account.id) {
    throw appError('Нельзя удалить собственный аккаунт', 409);
  }

  return accountLifecycle.permanentDeleteAccount(account.id, {
    assertDeletable: async (lockedAccount, transaction) => {
      const references = await Promise.all([
        db.Shift.count({
          transaction,
          where: { approvedByAccountId: lockedAccount.id },
        }),
        db.TrainingNote.count({
          transaction,
          where: { trainerAccountId: lockedAccount.id },
        }),
        db.ClientBase.count({
          transaction,
          where: {
            [db.Sequelize.Op.or]: [
              { createdByAccountId: lockedAccount.id },
              { recurringAssignedToAccountId: lockedAccount.id },
            ],
          },
        }),
        db.CallTask.count({
          transaction,
          where: {
            [db.Sequelize.Op.or]: [
              { assignedToAccountId: lockedAccount.id },
              { createdByAccountId: lockedAccount.id },
            ],
          },
        }),
        db.CallTaskAttempt.count({
          transaction,
          where: { actorAccountId: lockedAccount.id },
        }),
        db.User.count({
          transaction,
          where: { mergedByAccountId: lockedAccount.id },
        }),
      ]);

      if (references.some((count) => count > 0)) {
        throw appError(
          'Пользователя нельзя удалить безвозвратно: по нему уже есть связанные действия. Оставьте его в архиве.',
          409,
        );
      }
    },
  });
}

module.exports = {
  create,
  getAll,
  remove,
  removeArchived,
  restore,
  update,
};
