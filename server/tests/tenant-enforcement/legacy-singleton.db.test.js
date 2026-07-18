'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  connect,
  createDisposableDatabase,
  dropDisposableDatabase,
  migrateAll,
} = require('../helpers/final-tenant-rc-fixture');

const CAPABILITY_ENV = [
  'TENANT_CONTEXT_ENABLED',
  'TENANT_CACHE_REALTIME_ENABLED',
  'TENANT_FILES_WORKERS_ENABLED',
  'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
  'TENANT_STAFF_ACCESS_ENABLED',
  'TENANT_CLIENTS_REFERENCES_ENABLED',
  'TENANT_VISITS_SCANNER_ENABLED',
  'TENANT_CLIENT_BASES_CALL_TASKS_ENABLED',
  'TENANT_BOOKINGS_COURTS_ENABLED',
  'TENANT_METHODOLOGY_SKILL_MAP_ENABLED',
  'TENANT_TRAINING_NOTES_PLANS_ENABLED',
  'TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED',
  'TENANT_SHIFTS_REPORTS_ENABLED',
  'TENANT_AUDIT_LOG_ENABLED',
  'TENANT_ONBOARDING_ENABLED',
  'TENANT_ENFORCEMENT_ENABLED',
];

function restoreEnv(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test('Feature 9 exact singleton snapshot and mixed-provider legacy bridge matrix', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for exact singleton DB gate');
  const database = process.env.TENANT_SINGLETON_TEST_DB_NAME ||
    `setly_f9_rc_singleton_${process.pid}_${Date.now()}`;
  const previous = Object.fromEntries([
    ...CAPABILITY_ENV,
    'DB_NAME',
    'NODE_ENV',
    'TENANT_SINGLETON_TEST_DB_NAME',
  ].map((name) => [name, process.env[name]]));
  let schema;
  let db;
  await createDisposableDatabase(database);
  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  for (const name of CAPABILITY_ENV) process.env[name] = 'false';
  try {
    schema = connect(database);
    await migrateAll(schema);
    db = require('../../models');
    const authService = require('../../src/services/auth.service');
    await authService.bootstrapOwner({
      email: 'singleton-owner@setly.test',
      name: 'Singleton Owner',
      password: 'Singleton123!',
      phone: '+79990000001',
    });
    const { seedDemoAccounts } = require('../../src/services/account-seeder-adapter');
    await seedDemoAccounts([
      {
        email: 'singleton-manager@setly.test',
        name: 'Singleton Manager',
        passwordHash: authService.hashPassword('Singleton123!'),
        phone: '+79990000002',
        role: 'manager',
        staffRole: 'Управляющий',
        status: 'active',
      },
    ]);

    const tenantFoundation = require('../../src/services/tenant-foundation.service');
    const {
      requireExactSingletonDefault,
    } = require('../../src/tenant-enforcement/legacy-singleton');
    const rollout = require('../../src/provider-integrations/rollout');
    const clientAccess = require('../../src/services/client-access-context.service');
    const clientMoney = require('../../src/services/client-money-access-context.service');

    const exact = await requireExactSingletonDefault();
    const organizationOnly = await requireExactSingletonDefault({ requireClub: false });
    assert.ok(exact.organizationId > 0 && exact.clubId > 0);
    assert.deepEqual(organizationOnly, {
      clubId: null,
      organizationId: exact.organizationId,
    });

    process.env.TENANT_CLIENTS_REFERENCES_ENABLED = 'true';
    process.env.TENANT_CLIENT_MONEY_INSTRUMENTS_ENABLED = 'true';
    tenantFoundation.invalidateTenantFoundationGateCache();
    const beeline = await rollout.resolveLegacyProviderContext('beeline');
    const evotor = await rollout.resolveLegacyProviderContext('evotor');
    assert.equal(
      (await clientAccess.resolveClientAccessContext(beeline)).authority,
      'legacy-provider',
    );
    assert.equal(
      (await clientMoney.resolveClientMoneyAccessContext(evotor)).authority,
      'legacy-provider',
    );
    for (const [resolver, reconstructed] of [
      [clientAccess.resolveClientAccessContext, Object.freeze({ ...beeline })],
      [clientMoney.resolveClientMoneyAccessContext, Object.freeze({ ...evotor })],
    ]) {
      await assert.rejects(
        resolver(reconstructed),
        (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
      );
    }

    const expectSingletonFailure = async (mutate, restore) => {
      await mutate();
      tenantFoundation.invalidateTenantFoundationGateCache();
      try {
        await assert.rejects(
          requireExactSingletonDefault({ requireClub: false }),
          (error) => error.code === 'TENANT_SINGLE_DEFAULT_REQUIRED',
        );
        await assert.rejects(
          clientAccess.resolveClientAccessContext(beeline),
          (error) => error.code === 'TENANT_SINGLE_DEFAULT_REQUIRED',
        );
        await assert.rejects(
          clientMoney.resolveClientMoneyAccessContext(evotor),
          (error) => error.code === 'TENANT_SINGLE_DEFAULT_REQUIRED',
        );
      } finally {
        await restore();
        tenantFoundation.invalidateTenantFoundationGateCache();
      }
      assert.ok((await requireExactSingletonDefault()).clubId > 0);
    };

    let insertedClubId;
    await expectSingletonFailure(
      async () => {
        const [result] = await schema.query(
          `INSERT INTO Clubs
             (organizationId,slug,name,timezone,status,createdAt,updatedAt)
           VALUES (:organizationId,'singleton-sibling','Sibling','Europe/Moscow','active',NOW(),NOW())`,
          { replacements: { organizationId: exact.organizationId } },
        );
        insertedClubId = Number(result);
      },
      () => schema.query('DELETE FROM Clubs WHERE id=:id', { replacements: { id: insertedClubId } }),
    );

    let insertedOrganizationId;
    await expectSingletonFailure(
      async () => {
        const [result] = await schema.query(
          `INSERT INTO Organizations(slug,name,status,createdAt,updatedAt)
           VALUES ('singleton-second-org','Second','active',NOW(),NOW())`,
        );
        insertedOrganizationId = Number(result);
      },
      () => schema.query('DELETE FROM Organizations WHERE id=:id', {
        replacements: { id: insertedOrganizationId },
      }),
    );

    const [[defaultClub]] = await schema.query(
      'SELECT id,status FROM Clubs WHERE id=:id',
      { replacements: { id: exact.clubId } },
    );
    const [[defaultOrganization]] = await schema.query(
      'SELECT id,status FROM Organizations WHERE id=:id',
      { replacements: { id: exact.organizationId } },
    );
    await expectSingletonFailure(
      () => schema.query("UPDATE Clubs SET status='archived' WHERE id=:id", {
        replacements: { id: defaultClub.id },
      }),
      () => schema.query('UPDATE Clubs SET status=:status WHERE id=:id', {
        replacements: defaultClub,
      }),
    );
    await expectSingletonFailure(
      () => schema.query("UPDATE Organizations SET status='archived' WHERE id=:id", {
        replacements: { id: defaultOrganization.id },
      }),
      () => schema.query('UPDATE Organizations SET status=:status WHERE id=:id', {
        replacements: defaultOrganization,
      }),
    );

    const [[ownerMembership]] = await schema.query(
      "SELECT id,status FROM Memberships WHERE role='owner' LIMIT 1",
    );
    await expectSingletonFailure(
      () => schema.query("UPDATE Memberships SET status='inactive' WHERE id=:id", {
        replacements: { id: ownerMembership.id },
      }),
      () => schema.query('UPDATE Memberships SET status=:status WHERE id=:id', {
        replacements: ownerMembership,
      }),
    );

    const [[managerMembership]] = await schema.query(
      "SELECT id,staffId,status FROM Memberships WHERE role='manager' LIMIT 1",
    );
    const [[managerAccess]] = await schema.query(
      'SELECT membershipId,clubId,status FROM MembershipClubAccesses WHERE membershipId=:id',
      { replacements: { id: managerMembership.id } },
    );
    await expectSingletonFailure(
      () => schema.query('DELETE FROM MembershipClubAccesses WHERE membershipId=:id', {
        replacements: { id: managerMembership.id },
      }),
      () => schema.query(
        `INSERT INTO MembershipClubAccesses
           (organizationId,membershipId,clubId,roleOverride,status,createdAt,updatedAt)
         VALUES (:organizationId,:membershipId,:clubId,NULL,:status,NOW(),NOW())`,
        { replacements: { ...managerAccess, organizationId: exact.organizationId } },
      ),
    );
    await expectSingletonFailure(
      () => schema.query("UPDATE MembershipClubAccesses SET status='inactive' WHERE membershipId=:id", {
        replacements: { id: managerMembership.id },
      }),
      () => schema.query('UPDATE MembershipClubAccesses SET status=:status WHERE membershipId=:id', {
        replacements: { id: managerMembership.id, status: managerAccess.status },
      }),
    );

    await schema.query('SET FOREIGN_KEY_CHECKS=0');
    try {
      await expectSingletonFailure(
        () => schema.query('UPDATE Memberships SET staffId=999999 WHERE id=:id', {
          replacements: { id: managerMembership.id },
        }),
        () => schema.query('UPDATE Memberships SET staffId=:staffId WHERE id=:id', {
          replacements: { id: managerMembership.id, staffId: managerMembership.staffId },
        }),
      );
    } finally {
      await schema.query('SET FOREIGN_KEY_CHECKS=1');
    }
  } finally {
    await db?.sequelize.close().catch(() => {});
    await schema?.close().catch(() => {});
    restoreEnv(previous);
    await dropDisposableDatabase(database).catch(() => {});
  }
});
