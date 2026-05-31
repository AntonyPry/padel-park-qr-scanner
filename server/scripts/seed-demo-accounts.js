#!/usr/bin/env node

const db = require('../models');
const authService = require('../src/services/auth.service');

const PASSWORD = process.env.DEMO_ACCOUNT_PASSWORD || 'Demo1234!';
const ALLOW_NON_LOCAL = process.env.ALLOW_DEMO_ACCOUNT_SEED === 'true';

const DEMO_ACCOUNTS = [
  {
    email: 'owner@padelpark.demo',
    name: 'Антон Pry',
    phone: '+79000000100',
    role: 'owner',
    staffRole: 'Владелец',
  },
  {
    email: 'manager@padelpark.demo',
    name: 'Мария Орлова',
    phone: '+79000000101',
    role: 'manager',
    staffRole: 'Управляющий',
  },
  {
    email: 'admin@padelpark.demo',
    name: 'Илья Смирнов',
    phone: '+79000000102',
    role: 'admin',
    staffRole: 'Администратор',
  },
  {
    email: 'accountant@padelpark.demo',
    name: 'Елена Морозова',
    phone: '+79000000104',
    role: 'accountant',
    staffRole: 'Бухгалтер',
  },
  {
    email: 'viewer@padelpark.demo',
    name: 'Виктория Лебедева',
    phone: '+79000000105',
    role: 'viewer',
    staffRole: 'Наблюдатель',
  },
  {
    email: 'trainer@padelpark.demo',
    name: 'Павел Романов',
    phone: '+79000000106',
    role: 'trainer',
    staffRole: 'Тренер',
  },
];

function assertSafeEnvironment() {
  const env = process.env.NODE_ENV || 'development';
  if ((env === 'production' || env === 'staging') && !ALLOW_NON_LOCAL) {
    throw new Error(
      'Demo account seed is local-only. Set ALLOW_DEMO_ACCOUNT_SEED=true to override intentionally.',
    );
  }
}

async function upsertStaff(account, transaction) {
  const payload = {
    name: account.name,
    phone: account.phone,
    role: account.staffRole,
    status: 'active',
  };
  const existing = await db.Staff.findOne({
    transaction,
    where: { phone: account.phone },
  });

  if (existing) {
    await existing.update(payload, { transaction });
    return existing;
  }

  return db.Staff.create(payload, { transaction });
}

async function upsertAccount(account, staff, transaction) {
  const payload = {
    email: account.email,
    passwordHash: authService.hashPassword(PASSWORD),
    role: account.role,
    staffId: staff.id,
    status: 'active',
  };
  const existing = await db.Account.findOne({
    transaction,
    where: { email: account.email },
  });

  if (existing) {
    await existing.update(payload, { transaction });
    return 'updated';
  }

  await db.Account.create(payload, { transaction });
  return 'created';
}

async function main() {
  assertSafeEnvironment();

  const results = [];
  await db.sequelize.transaction(async (transaction) => {
    for (const account of DEMO_ACCOUNTS) {
      const staff = await upsertStaff(account, transaction);
      const action = await upsertAccount(account, staff, transaction);
      results.push({ action, email: account.email, role: account.role });
    }
  });

  console.log('Demo role accounts are ready.');
  console.log(`Password: ${PASSWORD}`);
  for (const result of results) {
    console.log(`- ${result.email} (${result.role}) ${result.action}`);
  }
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close();
  });
