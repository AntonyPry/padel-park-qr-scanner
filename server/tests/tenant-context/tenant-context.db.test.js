'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');

const SERVER_ROOT = path.resolve(__dirname, '../..');

function databaseName() {
  return process.env.TENANT_CONTEXT_TEST_DB_NAME || `setly_tenant_f3_${process.pid}_${Date.now()}`;
}

async function createSchema(database) {
  const sequelize = new SequelizePackage.Sequelize(
    database,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      dialect: 'mysql',
      host: process.env.DB_HOST || '127.0.0.1',
      logging: false,
    },
  );
  const queryInterface = sequelize.getQueryInterface();
  await queryInterface.createTable('SequelizeMeta', {
    name: {
      allowNull: false,
      primaryKey: true,
      type: SequelizePackage.STRING,
      unique: true,
    },
  });
  const migrations = fs
    .readdirSync(path.join(SERVER_ROOT, 'migrations'))
    .filter((file) => file.endsWith('.js'))
    .sort();
  for (const file of migrations) {
    const migration = require(path.join(SERVER_ROOT, 'migrations', file));
    await migration.up(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
  }
  return sequelize;
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

test('Feature 3 tenant context DB-backed API and authorization gate', async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    password: process.env.DB_PASSWORD,
    user: process.env.DB_USER,
  });
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(
    `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );

  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  process.env.TENANT_CONTEXT_ENABLED = 'true';
  let schema;
  let db;
  let server;
  try {
    schema = await createSchema(database);
    db = require('../../models');
    const createApp = require('../../src/app');
    const authService = require('../../src/services/auth.service');
    const accountLifecycle = require('../../src/services/account-lifecycle.service');
    const tenantFoundation = require('../../src/services/tenant-foundation.service');
    const { hashPassword } = authService;

    server = await listen(createApp());
    const api = (route, options = {}) =>
      fetch(`http://127.0.0.1:${server.address().port}/api${route}`, options);

    await t.test('Feature 2 bootstrap gate remains before discovery and all business routes', async () => {
      const discoveryBeforeBootstrap = await api('/auth/me/memberships');
      assert.equal(discoveryBeforeBootstrap.status, 503);
      assert.equal((await discoveryBeforeBootstrap.json()).code, 'BOOTSTRAP_REQUIRED');
      const status = await api('/auth/status');
      const payload = await status.json();
      assert.equal(payload.bootstrapPending, true);
      assert.deepEqual(payload.capabilities, {
        tenantCacheRealtime: false,
        tenantContext: true,
      });
    });

    const ownerSession = await authService.bootstrapOwner({
      email: 'owner@tenant-context.test',
      name: 'Tenant Owner',
      password: 'TenantOwner123!',
    });
    const manager = await accountLifecycle.createAccount({
      email: 'manager@tenant-context.test',
      passwordHash: hashPassword('TenantManager123!'),
      role: 'manager',
      status: 'active',
    });
    const managerSession = await authService.login({
      email: manager.email,
      password: 'TenantManager123!',
    });
    const organization = await db.Organization.findOne({ where: { slug: 'padel-park' } });
    const club = await db.Club.findOne({ where: { slug: 'padel-park' } });
    const managerMembership = await db.Membership.findOne({
      where: { accountId: manager.id, organizationId: organization.id },
    });
    const ownerMembership = await db.Membership.findOne({
      where: { accountId: ownerSession.account.id, organizationId: organization.id },
    });
    const managerAccess = await db.MembershipClubAccess.findOne({
      where: { clubId: club.id, membershipId: managerMembership.id },
    });
    const authHeaders = (token, extra = {}) => ({
      Authorization: `Bearer ${token}`,
      ...extra,
    });
    const ownerOrgHeaders = authHeaders(ownerSession.token, {
      'X-Organization-Id': String(organization.id),
    });
    const ownerClubHeaders = {
      ...ownerOrgHeaders,
      'X-Club-Id': String(club.id),
    };
    const managerOrgHeaders = authHeaders(managerSession.token, {
      'X-Organization-Id': String(organization.id),
    });
    await t.test('owner and non-owner discovery is global, minimal and deterministic', async () => {
      assert.equal(
        await db.MembershipClubAccess.count({ where: { membershipId: ownerMembership.id } }),
        0,
      );
      const ownerResponse = await api('/auth/me/memberships', {
        headers: authHeaders(ownerSession.token),
      });
      assert.equal(ownerResponse.status, 200);
      const ownerDiscovery = await ownerResponse.json();
      assert.equal(ownerDiscovery.memberships.length, 1);
      assert.equal(ownerDiscovery.memberships[0].clubs.length, 1);
      assert.equal(ownerDiscovery.memberships[0].clubs[0].effectiveRole, 'owner');
      assert.equal(ownerDiscovery.recommendedContext.clubId, club.id);
      assert.equal('status' in ownerDiscovery.memberships[0].organization, false);

      const managerResponse = await api('/auth/me/memberships', {
        headers: authHeaders(managerSession.token),
      });
      assert.equal(managerResponse.status, 200);
      const managerDiscovery = await managerResponse.json();
      assert.equal(managerDiscovery.memberships[0].clubs.length, 1);
      assert.equal(managerDiscovery.memberships[0].clubs[0].effectiveRole, 'manager');
    });

    await t.test('missing and malformed headers fail before controller queries', async () => {
      const missingOrganization = await api('/accounts', {
        headers: authHeaders(ownerSession.token),
      });
      const missingOrganizationBody = await missingOrganization.json();
      assert.equal(missingOrganization.status, 400, JSON.stringify(missingOrganizationBody));
      assert.equal(missingOrganizationBody.code, 'TENANT_CONTEXT_REQUIRED');

      const malformedOrganization = await api('/accounts', {
        headers: authHeaders(ownerSession.token, { 'X-Organization-Id': '-1' }),
      });
      assert.equal(malformedOrganization.status, 400);
      assert.equal((await malformedOrganization.json()).code, 'TENANT_CONTEXT_INVALID');

      const missingClub = await api('/utilization', { headers: ownerOrgHeaders });
      assert.equal(missingClub.status, 400);
      assert.equal((await missingClub.json()).code, 'TENANT_CONTEXT_REQUIRED');
    });

    await t.test('tampered organization or club gets the same safe denial', async () => {
      for (const headers of [
        authHeaders(ownerSession.token, { 'X-Organization-Id': '999999' }),
        authHeaders(ownerSession.token, {
          'X-Club-Id': '999999',
          'X-Organization-Id': String(organization.id),
        }),
      ]) {
        const route = headers['X-Club-Id'] ? '/utilization' : '/accounts';
        const response = await api(route, { headers });
        assert.equal(response.status, 404);
        assert.equal((await response.json()).code, 'TENANT_CONTEXT_NOT_FOUND');
      }
    });

    await t.test('headers are authority while body/query tenant IDs are ignored', async () => {
      const organizationResponse = await api('/accounts?organizationId=999999&clubId=999999', {
        headers: ownerOrgHeaders,
      });
      assert.equal(organizationResponse.status, 200);
      const clubResponse = await api('/utilization?organizationId=999999&clubId=999999', {
        headers: ownerClubHeaders,
      });
      assert.equal(clubResponse.status, 200);
    });

    await t.test('organization role uses Membership and DB resolver applies effective override', async () => {
      const tenantContextService = require('../../src/services/tenant-context.service');
      const organizationResponse = await api('/accounts', { headers: managerOrgHeaders });
      assert.equal(organizationResponse.status, 200);

      await managerAccess.update({ roleOverride: 'trainer' });
      const trainerContext = await tenantContextService.resolveTenantContext({
        accountId: manager.id,
        clubId: club.id,
        organizationId: organization.id,
        scope: 'club',
      });
      assert.equal(trainerContext.membershipRole, 'manager');
      assert.equal(trainerContext.effectiveRole, 'trainer');
      await managerAccess.update({ roleOverride: null });
    });

    await t.test('every inactive DB chain component fails closed and owner remains access-row independent', async () => {
      const tenantContextService = require('../../src/services/tenant-context.service');
      const assertTenantDenied = (input) =>
        assert.rejects(
          tenantContextService.resolveTenantContext(input),
          (error) => error.statusCode === 404 && error.code === 'TENANT_CONTEXT_NOT_FOUND',
        );

      await accountLifecycle.updateAccount(manager.id, { status: 'inactive' });
      const inactiveAccountResponse = await api('/auth/me/memberships', {
        headers: authHeaders(managerSession.token),
      });
      assert.equal(inactiveAccountResponse.status, 401);
      await accountLifecycle.updateAccount(manager.id, { status: 'active' });

      await organization.update({ status: 'inactive' });
      await assertTenantDenied({
        accountId: ownerSession.account.id,
        organizationId: organization.id,
        scope: 'organization',
      });
      await organization.update({ status: 'active' });

      await managerMembership.update({ status: 'inactive' });
      await assertTenantDenied({
        accountId: manager.id,
        organizationId: organization.id,
        scope: 'organization',
      });
      await managerMembership.update({ status: 'active' });

      await club.update({ status: 'inactive' });
      await assertTenantDenied({
        accountId: ownerSession.account.id,
        clubId: club.id,
        organizationId: organization.id,
        scope: 'club',
      });
      await club.update({ status: 'active' });

      await managerAccess.update({ status: 'inactive' });
      await assertTenantDenied({
        accountId: manager.id,
        clubId: club.id,
        organizationId: organization.id,
        scope: 'club',
      });
      const ownerContext = await tenantContextService.resolveTenantContext({
        accountId: ownerSession.account.id,
        clubId: club.id,
        organizationId: organization.id,
        scope: 'club',
      });
      assert.equal(ownerContext.effectiveRole, 'owner');
      await managerAccess.update({ status: 'active' });
    });

    await t.test('flag off restores the Account-based transport and role path', async () => {
      process.env.TENANT_CONTEXT_ENABLED = 'false';
      const accountResponse = await api('/accounts', {
        headers: authHeaders(managerSession.token),
      });
      assert.equal(accountResponse.status, 200);
      const clubResponse = await api('/utilization', {
        headers: authHeaders(managerSession.token),
      });
      assert.equal(clubResponse.status, 200);
      const status = await api('/auth/status');
      assert.deepEqual((await status.json()).capabilities, {
        tenantCacheRealtime: false,
        tenantContext: false,
      });
      process.env.TENANT_CONTEXT_ENABLED = 'true';
    });

    await t.test('Feature 3 exposes no organization or club provisioning API', () => {
      const { endpointContracts } = require('../../src/contracts/openapi');
      assert.equal(
        endpointContracts.some((endpoint) =>
          /^\/(organizations|clubs)(?:\/|$)/.test(endpoint.path),
        ),
        false,
      );
    });

    await tenantFoundation.assertTenantFoundationInitialized();
  } finally {
    await closeServer(server);
    if (db?.sequelize) await db.sequelize.close();
    if (schema) await schema.close();
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.end();
  }
});
