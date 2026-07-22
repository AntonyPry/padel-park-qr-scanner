'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ACCEPTED_TENANT_CAPABILITY_ENV,
} = require('../helpers/accepted-tenant-schema');
const {
  connect,
  createFreshDisposableDatabase,
  dropDisposableDatabase,
  migrateAll,
} = require('../helpers/final-tenant-rc-fixture');

const CAPABILITY_ENV = [
  ...ACCEPTED_TENANT_CAPABILITY_ENV,
  'TENANT_ENFORCEMENT_ENABLED',
];

function restoreEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('organization client lookup aggregates only authorized Club instruments', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed lookup test');
  const database = process.env.CLIENT_LOOKUP_SUMMARY_TEST_DB_NAME ||
    `setly_f9_rc_lookup_${process.pid}_${Date.now()}`;
  const previous = Object.fromEntries([
    ...CAPABILITY_ENV,
    'AUTH_SECRET',
    'BACKGROUND_RUNNERS_ENABLED',
    'BOTS_ENABLED',
    'CLIENT_LOOKUP_SUMMARY_TEST_DB_NAME',
    'DB_NAME',
    'INTEGRATION_SECRETS_KEY_VERSION',
    'INTEGRATION_SECRETS_MASTER_KEY',
    'NODE_ENV',
    'SETLY_ROLLOUT_MAINTENANCE_MODE',
    'TENANT_FOUNDATION_GATE_CACHE_MS',
  ].map((name) => [name, process.env[name]]));

  let db;
  let schema;
  let server;
  await createFreshDisposableDatabase(database);
  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  process.env.AUTH_SECRET = 'lookup-summary-test-auth-secret';
  process.env.BACKGROUND_RUNNERS_ENABLED = 'false';
  process.env.BOTS_ENABLED = 'false';
  process.env.INTEGRATION_SECRETS_KEY_VERSION = 'v1';
  process.env.INTEGRATION_SECRETS_MASTER_KEY = Buffer.alloc(32, 73).toString(
    'base64',
  );
  process.env.SETLY_ROLLOUT_MAINTENANCE_MODE = 'off';
  process.env.TENANT_FOUNDATION_GATE_CACHE_MS = '0';
  for (const name of CAPABILITY_ENV) process.env[name] = 'false';

  try {
    schema = connect(database);
    await migrateAll(schema);
    const expiredModeMigration = require(
      '../../migrations/20260721220000-allow-expired-onboarding-mode-disable'
    );
    await expiredModeMigration.down(schema.getQueryInterface());
    expiredModeMigration.__testing.failNextCreate();
    await assert.rejects(
      expiredModeMigration.up(schema.getQueryInterface()),
      (error) => error?.code === 'ONBOARDING_TRIGGER_CREATE_FORCED_FAILURE',
    );
    await expiredModeMigration.up(schema.getQueryInterface());
    expiredModeMigration.__testing.failNextCreate();
    await assert.rejects(
      expiredModeMigration.down(schema.getQueryInterface()),
      (error) => error?.code === 'ONBOARDING_TRIGGER_CREATE_FORCED_FAILURE',
    );
    await expiredModeMigration.down(schema.getQueryInterface());
    await expiredModeMigration.up(schema.getQueryInterface());
    db = require('../../models');
    const createApp = require('../../src/app');
    const authService = require('../../src/services/auth.service');
    const {
      getOrganizationLookupPrepaymentSummary,
    } = require('../../src/services/client-lookup-prepayment-summary.service');
    const onboardingService = require('../../src/services/onboarding.service');
    const tenantContextService = require('../../src/services/tenant-context.service');

    const organizationA = await db.Organization.findOne({
      where: { slug: 'padel-park' },
    });
    const clubA1 = await db.Club.findOne({
      where: { organizationId: organizationA.id, slug: 'padel-park' },
    });
    const clubA2 = await db.Club.create({
      name: 'Lookup sibling Club',
      organizationId: organizationA.id,
      slug: 'lookup-sibling-club',
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const trainingClub = await db.Club.create({
      name: 'Lookup training Club',
      organizationId: organizationA.id,
      slug: 'lookup-training-club',
      status: 'active',
      timezone: 'Europe/Moscow',
    });
    const organizationB = await db.Organization.create({
      name: 'Lookup foreign Organization',
      slug: 'lookup-foreign-organization',
      status: 'active',
    });
    const clubB = await db.Club.create({
      name: 'Lookup foreign Club',
      organizationId: organizationB.id,
      slug: 'lookup-foreign-club',
      status: 'active',
      timezone: 'Europe/Moscow',
    });

    const password = 'LookupTenant123!';
    const ownerA = await db.Account.create({
      email: 'lookup-owner-a@example.test',
      passwordHash: await authService.hashPassword(password),
      role: 'owner',
      staffId: null,
      status: 'active',
    });
    const ownerAMembership = await db.Membership.create({
      accountId: ownerA.id,
      organizationId: organizationA.id,
      role: 'owner',
      staffId: null,
      status: 'active',
    });
    const ownerB = await db.Account.create({
      email: 'lookup-owner-b@example.test',
      passwordHash: await authService.hashPassword(password),
      role: 'owner',
      staffId: null,
      status: 'active',
    });
    await db.Membership.create({
      accountId: ownerB.id,
      organizationId: organizationB.id,
      role: 'owner',
      staffId: null,
      status: 'active',
    });
    const managerStaff = await db.Staff.create({
      name: 'Lookup Manager',
      organizationId: organizationA.id,
      role: 'Администратор',
      status: 'active',
    });
    const manager = await db.Account.create({
      email: 'lookup-manager@example.test',
      passwordHash: await authService.hashPassword(password),
      role: 'manager',
      staffId: managerStaff.id,
      status: 'active',
    });
    const managerMembership = await db.Membership.create({
      accountId: manager.id,
      organizationId: organizationA.id,
      role: 'manager',
      staffId: managerStaff.id,
      status: 'active',
    });
    let managerAccess = await db.MembershipClubAccess.create({
      clubId: clubA1.id,
      membershipId: managerMembership.id,
      organizationId: organizationA.id,
      roleOverride: null,
      status: 'active',
    });
    await db.MembershipClubAccess.create({
      clubId: trainingClub.id,
      membershipId: managerMembership.id,
      organizationId: organizationA.id,
      roleOverride: null,
      status: 'active',
    });

    const sharedPhone = '+7 (999) 555-44-33';
    const clientA = await db.User.create({
      name: 'Lookup Client A',
      organizationId: organizationA.id,
      phone: sharedPhone,
      phoneNormalized: '9995554433',
      source: 'lookup-test',
      status: 'active',
      webId: 'lookup-client-a',
    });
    const clientB = await db.User.create({
      name: 'Lookup Client B',
      organizationId: organizationB.id,
      phone: sharedPhone,
      phoneNormalized: '9995554433',
      source: 'lookup-test',
      status: 'active',
      webId: 'lookup-client-b',
    });
    const startsAt = new Date('2026-07-01T00:00:00.000Z');
    const expiredAt = new Date('2026-07-02T00:00:00.000Z');

    const createSubscription = (values) => db.ClientSubscription.create({
      isUnlimited: false,
      pricePaid: 1000,
      saleAmount: 1000,
      serviceType: 'training',
      sessionsTotal: 4,
      sessionsUsed: 0,
      source: 'lookup-test',
      startsAt,
      status: 'active',
      ...values,
    });
    await createSubscription({
      clientId: clientA.id,
      clubId: clubA1.id,
      organizationId: organizationA.id,
      typeName: 'Accessible subscription',
    });
    await createSubscription({
      clientId: clientA.id,
      clubId: clubA2.id,
      expiresAt: expiredAt,
      organizationId: organizationA.id,
      typeName: 'Sibling subscription',
    });
    await createSubscription({
      clientId: clientB.id,
      clubId: clubB.id,
      organizationId: organizationB.id,
      typeName: 'Foreign subscription',
    });

    const createCertificate = (values) => db.Certificate.create({
      amountTotal: 1000,
      amountUsed: 0,
      certificateType: 'money',
      saleAmount: 1000,
      source: 'lookup-test',
      startsAt,
      status: 'active',
      title: 'Lookup certificate',
      unitsTotal: null,
      unitsUsed: 0,
      ...values,
    });
    await createCertificate({
      clientId: clientA.id,
      clubId: clubA1.id,
      code: 'LOOKUP-A1',
      organizationId: organizationA.id,
    });
    await createCertificate({
      clientId: clientA.id,
      clubId: clubA2.id,
      code: 'LOOKUP-A2',
      organizationId: organizationA.id,
      status: 'canceled',
    });
    await createCertificate({
      clientId: clientB.id,
      clubId: clubB.id,
      code: 'LOOKUP-B',
      organizationId: organizationB.id,
    });

    for (const name of CAPABILITY_ENV) process.env[name] = 'true';
    const [ownerSession, managerSession] = await Promise.all([
      authService.login({ email: ownerA.email, password }),
      authService.login({ email: manager.email, password }),
    ]);
    server = await listen(createApp());
    const activeSource = await db.ClientSource.findOne({
      where: { organizationId: organizationA.id, status: 'active' },
    });
    assert.ok(activeSource, 'an active Organization client source is required');
    const ownerClubTenant = await tenantContextService.resolveTenantContext({
      accountId: ownerA.id,
      clubId: trainingClub.id,
      organizationId: organizationA.id,
      scope: 'club',
    });
    await onboardingService.setTrainingMode(
      ownerA,
      { isEnabled: true, role: 'owner' },
      ownerClubTenant,
    );
    const expectedTrainingMarker = await onboardingService.getTrainingDataMarker(
      ownerA,
      ownerClubTenant,
    );
    const createClient = (token, phone, name) => fetch(
      `http://127.0.0.1:${server.address().port}/api/clients`,
      {
        body: JSON.stringify({ name, phone, sourceId: activeSource.id }),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Organization-Id': String(organizationA.id),
        },
        method: 'POST',
      },
    );
    const createPhone = '+7 (999) 555-44-34';
    const createResponse = await createClient(
      ownerSession.token,
      createPhone,
      'Organization HTTP Create',
    );
    const createPayload = await createResponse.json();
    assert.equal(
      createResponse.status,
      201,
      JSON.stringify({
        code: createPayload.code || null,
        message: createPayload.message || createPayload.error || null,
        status: createResponse.status,
      }),
    );
    assert.ok(createPayload.client?.id);
    const createdClient = await db.User.findByPk(createPayload.client.id);
    assert.equal(createdClient.isTraining, true);
    assert.equal(
      createdClient.trainingSessionId,
      expectedTrainingMarker.trainingSessionId,
    );
    assert.equal(
      await db.User.count({
        where: {
          organizationId: organizationA.id,
          phoneNormalized: '9995554434',
        },
      }),
      1,
    );

    const ownerMode = await db.OnboardingTrainingMode.findOne({
      where: { membershipId: ownerAMembership.id },
    });
    assert.ok(ownerMode);
    await ownerMode.update({ expiresAt: new Date(Date.now() - 60_000) });
    await trainingClub.update({ status: 'archived' });
    const expiredArchivedClubResponse = await createClient(
      ownerSession.token,
      '+7 (999) 555-44-35',
      'Expired Archived Club Create',
    );
    assert.equal(expiredArchivedClubResponse.status, 201);
    await ownerMode.reload();
    assert.equal(ownerMode.isEnabled, false);
    assert.ok(ownerMode.disabledAt);
    await trainingClub.update({ status: 'active' });

    await onboardingService.setTrainingMode(
      ownerA,
      { isEnabled: true, role: 'owner' },
      ownerClubTenant,
    );
    await trainingClub.update({ status: 'archived' });
    const activeArchivedClubResponse = await createClient(
      ownerSession.token,
      '+7 (999) 555-44-36',
      'Active Archived Club Create',
    );
    assert.equal(activeArchivedClubResponse.status, 404);
    assert.equal(
      await db.User.count({
        where: {
          organizationId: organizationA.id,
          phoneNormalized: '9995554436',
        },
      }),
      0,
    );
    await trainingClub.update({ status: 'active' });
    await onboardingService.setTrainingMode(
      ownerA,
      { isEnabled: false, role: 'owner' },
      ownerClubTenant,
    );

    const managerClubTenant = await tenantContextService.resolveTenantContext({
      accountId: manager.id,
      clubId: clubA1.id,
      organizationId: organizationA.id,
      scope: 'club',
    });
    await onboardingService.setTrainingMode(
      manager,
      { isEnabled: true, role: 'manager' },
      managerClubTenant,
    );
    const managerMode = await db.OnboardingTrainingMode.findOne({
      where: { membershipId: managerMembership.id },
    });
    assert.ok(managerMode);
    await managerMode.update({ expiresAt: new Date(Date.now() - 60_000) });
    await managerAccess.destroy();
    const expiredRevokedAccessResponse = await createClient(
      managerSession.token,
      '+7 (999) 555-44-37',
      'Expired Revoked Access Create',
    );
    assert.equal(expiredRevokedAccessResponse.status, 201);
    await managerMode.reload();
    assert.equal(managerMode.isEnabled, false);
    managerAccess = await db.MembershipClubAccess.create({
      clubId: clubA1.id,
      membershipId: managerMembership.id,
      organizationId: organizationA.id,
      roleOverride: null,
      status: 'active',
    });

    await onboardingService.setTrainingMode(
      manager,
      { isEnabled: true, role: 'manager' },
      managerClubTenant,
    );
    await managerMode.update({ expiresAt: new Date(Date.now() - 60_000) });
    await managerAccess.update({ roleOverride: 'admin' });
    const expiredRoleDriftResponse = await createClient(
      managerSession.token,
      '+7 (999) 555-44-38',
      'Expired Role Drift Create',
    );
    assert.equal(expiredRoleDriftResponse.status, 201);
    await managerMode.reload();
    assert.equal(managerMode.isEnabled, false);
    await managerAccess.update({ roleOverride: null });

    const disabledModeResponse = await createClient(
      managerSession.token,
      '+7 (999) 555-44-39',
      'Disabled Mode Create',
    );
    assert.equal(disabledModeResponse.status, 201);

    await onboardingService.setTrainingMode(
      manager,
      { isEnabled: true, role: 'manager' },
      managerClubTenant,
    );
    await managerAccess.update({ roleOverride: 'admin' });
    const activeRoleDriftResponse = await createClient(
      managerSession.token,
      '+7 (999) 555-44-40',
      'Active Role Drift Create',
    );
    assert.equal(activeRoleDriftResponse.status, 404);
    await managerAccess.update({ roleOverride: null });
    await onboardingService.setTrainingMode(
      manager,
      { isEnabled: false, role: 'manager' },
      managerClubTenant,
    );

    const api = (token, organizationId, phone = sharedPhone) => fetch(
      `http://127.0.0.1:${server.address().port}/api/clients/lookup?` +
        `phone=${encodeURIComponent(phone)}&includeArchived=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(organizationId
            ? { 'X-Organization-Id': String(organizationId) }
            : {}),
        },
      },
    );

    const ownerResponse = await api(ownerSession.token, organizationA.id);
    const ownerPayload = await ownerResponse.json();
    assert.equal(
      ownerResponse.status,
      200,
      JSON.stringify({
        code: ownerPayload.code || null,
        message: ownerPayload.message || ownerPayload.error || null,
        status: ownerResponse.status,
      }),
    );
    assert.equal(ownerPayload.client.id, clientA.id);
    const ownerSummary = ownerPayload.client.prepaymentSummary;
    assert.equal(ownerSummary.activeCertificatesCount, 1);
    assert.equal(ownerSummary.activeSubscriptionsCount, 1);
    assert.equal(ownerSummary.hasActiveCertificate, true);
    assert.equal(ownerSummary.hasActiveSubscription, true);
    assert.deepEqual(
      ownerSummary.certificateWarnings.map(({ level, text, type }) => ({
        level,
        text,
        type,
      })),
      [{
        level: 'muted',
        text: 'Сертификат LOOKUP-A2 отменен',
        type: 'canceled',
      }],
    );
    assert.deepEqual(
      ownerSummary.subscriptionWarnings.map(({ level, text, type }) => ({
        level,
        text,
        type,
      })),
      [{
        level: 'danger',
        text: 'Sibling subscription истек 02.07.2026',
        type: 'expired',
      }],
    );
    assert.equal(JSON.stringify(ownerSummary).includes('Foreign'), false);

    const managerResponse = await api(managerSession.token, organizationA.id);
    assert.equal(managerResponse.status, 200);
    const managerPayload = await managerResponse.json();
    assert.equal(managerPayload.client.id, clientA.id);
    assert.deepEqual(managerPayload.client.prepaymentSummary, {
      activeCertificatesCount: 1,
      activeSubscriptionsCount: 1,
      certificateWarnings: [],
      hasActiveCertificate: true,
      hasActiveSubscription: true,
      subscriptionWarnings: [],
    });

    const unknown = await api(
      ownerSession.token,
      organizationA.id,
      '+7 (999) 000-00-00',
    );
    assert.equal(unknown.status, 200);
    assert.deepEqual(await unknown.json(), { client: null });

    const wrongOrganization = await api(ownerSession.token, organizationB.id);
    assert.equal(wrongOrganization.status, 404);
    assert.equal(
      (await wrongOrganization.json()).code,
      'TENANT_CONTEXT_NOT_FOUND',
    );
    const missingOrganization = await api(ownerSession.token, null);
    assert.equal(missingOrganization.status, 400);
    assert.equal(
      (await missingOrganization.json()).code,
      'TENANT_CONTEXT_REQUIRED',
    );

    await managerAccess.update({ status: 'archived' });
    const staleAccessResponse = await api(
      managerSession.token,
      organizationA.id,
    );
    assert.equal(staleAccessResponse.status, 503);
    assert.equal(
      (await staleAccessResponse.json()).code,
      'TENANT_FOUNDATION_INVALID',
    );

    const noClubTenant = await tenantContextService.resolveTenantContext({
      accountId: manager.id,
      organizationId: organizationA.id,
      scope: 'organization',
    });
    assert.deepEqual(await getOrganizationLookupPrepaymentSummary({
      account: manager,
      clientId: clientA.id,
      tenant: noClubTenant,
    }), {
      activeCertificatesCount: 0,
      activeSubscriptionsCount: 0,
      certificateWarnings: [],
      hasActiveCertificate: false,
      hasActiveSubscription: false,
      subscriptionWarnings: [],
    });
    await managerAccess.update({ status: 'active' });

    await managerMembership.update({ status: 'archived' });
    await assert.rejects(
      getOrganizationLookupPrepaymentSummary({
        account: manager,
        clientId: clientA.id,
        tenant: noClubTenant,
      }),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    const staleMembership = await api(managerSession.token, organizationA.id);
    assert.equal(staleMembership.status, 503);
    assert.equal(
      (await staleMembership.json()).code,
      'TENANT_FOUNDATION_INVALID',
    );
    await managerMembership.update({ status: 'active' });

    const ownerTenant = await tenantContextService.resolveTenantContext({
      accountId: ownerA.id,
      organizationId: organizationA.id,
      scope: 'organization',
    });
    await organizationA.update({ status: 'archived' });
    await assert.rejects(
      getOrganizationLookupPrepaymentSummary({
        account: ownerA,
        clientId: clientA.id,
        tenant: ownerTenant,
      }),
      (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
    );
    const staleOrganization = await api(ownerSession.token, organizationA.id);
    assert.equal(staleOrganization.status, 503);
    assert.equal(
      (await staleOrganization.json()).code,
      'TENANT_FOUNDATION_INVALID',
    );
    await organizationA.update({ status: 'active' });

    assert.equal(ownerAMembership.status, 'active');
  } finally {
    await closeServer(server).catch(() => {});
    if (db?.sequelize) await db.sequelize.close().catch(() => {});
    if (schema) await schema.close().catch(() => {});
    restoreEnv(previous);
    await dropDisposableDatabase(database).catch(() => {});
  }
});
