'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const {
  ACCEPTED_TENANT_CAPABILITY_ENV,
} = require('../helpers/accepted-tenant-schema');

function databaseName() {
  return process.env.MANUAL_CLIENT_MONEY_TEST_DB_NAME ||
    `setly_manual_money_issue_test_${process.pid}_${Date.now()}`;
}

function assertDisposableDatabase(database) {
  assert.match(
    database,
    /^setly_manual_money_issue_test_[a-zA-Z0-9_]+$/u,
    'manual money issue tests require their dedicated disposable database name',
  );
}

function restoreEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function jsonValue(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (
      error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve()
    )));
}

async function waitFor(check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for asynchronous mutation audit records');
}

test('manual subscription and certificate issue routes enforce money, role and tenant contracts', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed money tests');
  const database = databaseName();
  assertDisposableDatabase(database);
  const envKeys = [
    ...ACCEPTED_TENANT_CAPABILITY_ENV,
    'AUTH_SECRET',
    'DB_NAME',
    'MANUAL_CLIENT_MONEY_TEST_DB_NAME',
    'NODE_ENV',
    'TENANT_ENFORCEMENT_ENABLED',
  ];
  const previous = Object.fromEntries(envKeys.map((name) => [name, process.env[name]]));
  const adminConnection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    user: process.env.DB_USER,
  });

  await adminConnection.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await adminConnection.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  process.env.AUTH_SECRET = 'manual-money-route-test-secret';
  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  for (const name of ACCEPTED_TENANT_CAPABILITY_ENV) process.env[name] = 'false';
  process.env.TENANT_CONTEXT_ENABLED = 'true';
  process.env.TENANT_ENFORCEMENT_ENABLED = 'false';

  let db;
  let server;
  try {
    db = require('../../models');
    await db.sequelize.sync({ force: true });

    const authService = require('../../src/services/auth.service');
    const accountLifecycle = require('../../src/services/account-lifecycle.service');
    const createApp = require('../../src/app');
    await db.Organization.create({
      name: 'Setly manual money test',
      slug: 'padel-park',
      status: 'active',
    });
    const bootstrapOrganization = await db.Organization.findOne({
      where: { slug: 'padel-park' },
    });
    await db.Club.create({
      name: 'Setly manual money test club',
      organizationId: bootstrapOrganization.id,
      slug: 'padel-park',
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const password = 'ManualMoney123!';
    const ownerSession = await authService.bootstrapOwner({
      email: 'owner@manual-money.test',
      name: 'Manual Money Owner',
      password,
      phone: '+79995550001',
    });
    const organizationA = await db.Organization.findOne({ where: { slug: 'padel-park' } });
    const clubA = await db.Club.findOne({ where: { slug: 'padel-park' } });

    const sessions = { owner: ownerSession };
    for (const role of ['manager', 'admin', 'accountant', 'trainer', 'viewer']) {
      const account = await accountLifecycle.createAccount({
        email: `${role}@manual-money.test`,
        passwordHash: await authService.hashPassword(password),
        role,
        status: 'active',
      });
      sessions[role] = await authService.login({ email: account.email, password });
    }
    for (const name of ACCEPTED_TENANT_CAPABILITY_ENV) process.env[name] = 'true';
    process.env.TENANT_ENFORCEMENT_ENABLED = 'true';

    const organizationB = await db.Organization.create({
      name: 'Manual money foreign organization',
      slug: `manual-money-foreign-${Date.now()}`,
      status: 'active',
    });
    const clubB = await db.Club.create({
      name: 'Manual money foreign club',
      organizationId: organizationB.id,
      slug: `manual-money-foreign-club-${Date.now()}`,
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const ownerB = await db.Account.create({
      email: 'owner-b@manual-money.test',
      passwordHash: await authService.hashPassword(password),
      role: 'owner',
      status: 'active',
    });
    await db.Membership.create({
      accountId: ownerB.id,
      organizationId: organizationB.id,
      role: 'owner',
      status: 'active',
    });

    const clientA = await db.User.create({
      name: 'Manual Money Client A',
      organizationId: organizationA.id,
      phone: '+79995550101',
      phoneNormalized: '79995550101',
      source: 'manual money route test',
      status: 'active',
      webId: `manual-money-client-a-${Date.now()}`,
    });
    const clientB = await db.User.create({
      name: 'Manual Money Client B',
      organizationId: organizationB.id,
      phone: '+79995550102',
      phoneNormalized: '79995550102',
      source: 'manual money route test',
      status: 'active',
      webId: `manual-money-client-b-${Date.now()}`,
    });
    const activeType = await db.SubscriptionType.create({
      bonusPersonalSessions: 1,
      isUnlimited: false,
      name: 'Manual route active type',
      organizationId: organizationA.id,
      price: 3000,
      serviceType: 'training',
      sessionsTotal: 6,
      status: 'active',
      timeSegment: 'any',
      trainingKind: 'group',
      validityDays: 30,
    });
    const archivedType = await db.SubscriptionType.create({
      name: 'Manual route archived type',
      organizationId: organizationA.id,
      price: 1000,
      serviceType: 'training',
      sessionsTotal: 2,
      status: 'archived',
      validityDays: 10,
    });
    const foreignType = await db.SubscriptionType.create({
      name: 'Manual route foreign type',
      organizationId: organizationB.id,
      price: 4000,
      serviceType: 'training',
      sessionsTotal: 8,
      status: 'active',
      validityDays: 45,
    });

    server = await listen(createApp());
    const api = (path, options = {}) => fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      options,
    );
    const post = (role, path, body) => api(path, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${sessions[role].token}`,
        'Content-Type': 'application/json',
        'X-Club-Id': String(clubA.id),
        'X-Organization-Id': String(organizationA.id),
      },
      method: 'POST',
    });

    const subscriptionStartsAt = '2030-01-15T09:00:00.000Z';
    const subscriptionResponse = await post(
      'owner',
      `/clients/${clientA.id}/subscriptions`,
      {
        comment: 'Выдан администратором стойки',
        paymentMethod: 'cashless',
        saleAmount: 2400,
        startsAt: subscriptionStartsAt,
        subscriptionTypeId: activeType.id,
      },
    );
    assert.equal(
      subscriptionResponse.status,
      201,
      await subscriptionResponse.clone().text(),
    );
    const issuedSubscription = await subscriptionResponse.json();
    const storedSubscription = await db.ClientSubscription.findByPk(issuedSubscription.id);
    assert.equal(storedSubscription.organizationId, organizationA.id);
    assert.equal(storedSubscription.clubId, clubA.id);
    assert.equal(storedSubscription.clientId, clientA.id);
    assert.equal(storedSubscription.subscriptionTypeId, activeType.id);
    assert.equal(storedSubscription.createdByAccountId, sessions.owner.account.id);
    assert.equal(storedSubscription.source, 'manual');
    assert.equal(Number(storedSubscription.saleAmount), 2400);
    assert.equal(Number(storedSubscription.pricePaid), 2400);
    const subscriptionMetadata = jsonValue(storedSubscription.metadata);
    assert.equal(subscriptionMetadata.comment, 'Выдан администратором стойки');
    assert.equal(subscriptionMetadata.paymentMethod, 'cashless');
    assert.equal(subscriptionMetadata.issuedManually, true);
    assert.equal(subscriptionMetadata.subscriptionTypeSnapshot.id, activeType.id);
    assert.equal(subscriptionMetadata.subscriptionTypeSnapshot.name, activeType.name);
    assert.equal(storedSubscription.expiresAt.toISOString(), '2030-02-14T09:00:00.000Z');

    const moneyCertificateResponse = await post(
      'manager',
      `/clients/${clientA.id}/certificates`,
      {
        amountTotal: 5000,
        certificateType: 'money',
        code: 'MANUAL-MONEY-5000',
        comment: 'Подарок клиенту',
        paymentMethod: 'cash',
        saleAmount: 4500,
        startsAt: '2030-02-01T10:00:00.000Z',
        title: 'Денежный сертификат',
        validityDays: 60,
      },
    );
    assert.equal(moneyCertificateResponse.status, 201);
    const moneyCertificate = await moneyCertificateResponse.json();

    const serviceCertificateResponse = await post(
      'admin',
      `/clients/${clientA.id}/certificates`,
      {
        certificateType: 'service',
        code: 'MANUAL-SERVICE-3',
        comment: 'Три гостевых занятия',
        paymentMethod: 'mixed',
        saleAmount: 2700,
        serviceName: 'Гостевое занятие',
        serviceType: 'training',
        startsAt: '2030-03-01T11:00:00.000Z',
        title: 'Сервисный сертификат',
        unitsTotal: 3,
        validityDays: 90,
      },
    );
    assert.equal(serviceCertificateResponse.status, 201);
    const serviceCertificate = await serviceCertificateResponse.json();

    const storedMoneyCertificate = await db.Certificate.findByPk(moneyCertificate.id);
    assert.equal(storedMoneyCertificate.createdByAccountId, sessions.manager.account.id);
    assert.equal(storedMoneyCertificate.organizationId, organizationA.id);
    assert.equal(storedMoneyCertificate.clubId, clubA.id);
    assert.equal(storedMoneyCertificate.source, 'manual');
    assert.equal(storedMoneyCertificate.certificateType, 'money');
    assert.equal(Number(storedMoneyCertificate.amountTotal), 5000);
    assert.equal(Number(storedMoneyCertificate.saleAmount), 4500);
    const moneyCertificateMetadata = jsonValue(storedMoneyCertificate.metadata);
    assert.equal(moneyCertificateMetadata.comment, 'Подарок клиенту');
    assert.equal(moneyCertificateMetadata.paymentMethod, 'cash');
    assert.equal(storedMoneyCertificate.expiresAt.toISOString(), '2030-04-02T10:00:00.000Z');

    const storedServiceCertificate = await db.Certificate.findByPk(serviceCertificate.id);
    assert.equal(storedServiceCertificate.createdByAccountId, sessions.admin.account.id);
    assert.equal(storedServiceCertificate.source, 'manual');
    assert.equal(storedServiceCertificate.certificateType, 'service');
    assert.equal(storedServiceCertificate.serviceName, 'Гостевое занятие');
    assert.equal(storedServiceCertificate.serviceType, 'training');
    assert.equal(storedServiceCertificate.unitsTotal, 3);
    assert.equal(Number(storedServiceCertificate.saleAmount), 2700);
    const serviceCertificateMetadata = jsonValue(storedServiceCertificate.metadata);
    assert.equal(serviceCertificateMetadata.comment, 'Три гостевых занятия');
    assert.equal(serviceCertificateMetadata.paymentMethod, 'mixed');
    assert.equal(storedServiceCertificate.expiresAt.toISOString(), '2030-05-30T11:00:00.000Z');

    const subscriptionCount = await db.ClientSubscription.count();
    const certificateCount = await db.Certificate.count();
    const archivedResponse = await post(
      'owner',
      `/clients/${clientA.id}/subscriptions`,
      { saleAmount: 1000, subscriptionTypeId: archivedType.id },
    );
    assert.equal(archivedResponse.status, 409);
    const foreignTypeResponse = await post(
      'owner',
      `/clients/${clientA.id}/subscriptions`,
      { saleAmount: 4000, subscriptionTypeId: foreignType.id },
    );
    assert.equal(foreignTypeResponse.status, 404);
    const foreignClientResponse = await post(
      'admin',
      `/clients/${clientB.id}/certificates`,
      {
        amountTotal: 1000,
        certificateType: 'money',
        saleAmount: 1000,
        title: 'Foreign client refusal',
        validityDays: 30,
      },
    );
    assert.equal(foreignClientResponse.status, 404);

    const forbiddenRequests = [
      post('accountant', `/clients/${clientA.id}/subscriptions`, {
        saleAmount: 3000,
        subscriptionTypeId: activeType.id,
      }),
      post('trainer', `/clients/${clientA.id}/certificates`, {
        amountTotal: 1000,
        certificateType: 'money',
        saleAmount: 1000,
        title: 'Trainer forbidden',
        validityDays: 30,
      }),
      post('viewer', `/clients/${clientA.id}/subscriptions`, {
        saleAmount: 3000,
        subscriptionTypeId: activeType.id,
      }),
    ];
    for (const response of await Promise.all(forbiddenRequests)) {
      assert.equal(response.status, 403);
    }
    assert.equal(await db.ClientSubscription.count(), subscriptionCount);
    assert.equal(await db.Certificate.count(), certificateCount);

    const auditRows = await waitFor(async () => {
      const rows = await db.AuditLog.findAll({
        order: [['id', 'ASC']],
        where: { organizationId: organizationA.id },
      });
      return rows.length >= 9 ? rows : null;
    });
    const successfulAudits = auditRows.filter((row) => row.statusCode === 201);
    const forbiddenAudits = auditRows.filter((row) => row.statusCode === 403);
    assert.equal(successfulAudits.length, 3);
    assert.equal(forbiddenAudits.length, 3);
    assert.deepEqual(
      successfulAudits.map((row) => row.accountId).sort((left, right) => left - right),
      [
        sessions.owner.account.id,
        sessions.manager.account.id,
        sessions.admin.account.id,
      ].sort((left, right) => left - right),
    );
    assert.deepEqual(
      forbiddenAudits.map((row) => row.role).sort(),
      ['accountant', 'trainer', 'viewer'],
    );
    assert.equal(
      auditRows.some((row) => row.statusCode === 409 && row.path.includes('/subscriptions')),
      true,
    );
    assert.equal(
      auditRows.filter((row) => row.statusCode === 404).length,
      2,
    );
  } finally {
    await close(server);
    if (db?.sequelize) await db.sequelize.close();
    await adminConnection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await adminConnection.end();
    restoreEnv(previous);
  }
});
