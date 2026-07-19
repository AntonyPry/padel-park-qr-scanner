'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const SequelizePackage = require('sequelize');
const {
  connect,
  createDisposableDatabase,
  dropDisposableDatabase,
  migrateAll,
  seedTwoTenantFixture,
} = require('../helpers/final-tenant-rc-fixture');
const {
  ACCEPTED_TENANT_CAPABILITY_ENV,
} = require('../helpers/accepted-tenant-schema');

const CAPABILITY_ENV = [
  ...ACCEPTED_TENANT_CAPABILITY_ENV,
  'TENANT_ENFORCEMENT_ENABLED',
];
const FEATURE_MIGRATION = require('../../migrations/20260720120000-add-installation-provisioning');

function payload(suffix, idempotencyKey = crypto.randomUUID()) {
  return {
    clubs: [
      { name: `Клуб ${suffix} Центр`, timezone: 'Europe/Moscow' },
      { name: `Клуб ${suffix} Север`, timezone: 'Europe/Moscow' },
    ],
    idempotencyKey,
    organization: { name: `Организация ${suffix}` },
    owner: {
      email: `owner-${suffix}@provisioning.test`,
      name: `Владелец ${suffix}`,
      phone: '+79991112233',
    },
  };
}

function tokenFromLink(link) {
  return new URLSearchParams(new URL(link).hash.replace(/^#/u, '')).get('token');
}

async function counts(db, suffix) {
  const [organizations, clubs, accounts, operations, activations] = await Promise.all([
    db.Organization.count({ where: { name: `Организация ${suffix}` } }),
    db.Club.count({
      where: {
        name: {
          [db.Sequelize.Op.in]: [`Клуб ${suffix} Центр`, `Клуб ${suffix} Север`],
        },
      },
    }),
    db.Account.count({ where: { email: `owner-${suffix}@provisioning.test` } }),
    db.InstallationProvisioningOperation.count(),
    db.OwnerActivationToken.count(),
  ]);
  return { accounts, activations, clubs, operations, organizations };
}

test('Feature 10.2 atomic provisioning and secure owner activation', async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for provisioning DB tests');
  const database = process.env.INSTALLATION_PROVISIONING_TEST_DB_NAME ||
    `setly_f9_rc_provisioning_${process.pid}_${Date.now()}`;
  const previous = Object.fromEntries([
    ...CAPABILITY_ENV,
    'DB_NAME',
    'NODE_ENV',
    'INSTALLATION_ACTIVATION_BASE_URL',
  ].map((name) => [name, process.env[name]]));
  let schema;
  let db;

  await createDisposableDatabase(database);
  process.env.DB_NAME = database;
  process.env.NODE_ENV = 'test';
  process.env.INSTALLATION_ACTIVATION_BASE_URL = 'http://127.0.0.1:5182';
  for (const name of CAPABILITY_ENV) process.env[name] = 'false';

  try {
    schema = connect(database);
    await migrateAll(schema);
    const queryInterface = schema.getQueryInterface();
    await FEATURE_MIGRATION.down(queryInterface);
    await t.test('migration rolls down and reapplies on a fresh schema', async () => {
      const tablesAfterDown = new Set(
        (await queryInterface.showAllTables()).map((table) =>
          typeof table === 'string' ? table : table.tableName,
        ),
      );
      assert.equal(tablesAfterDown.has('OwnerActivationTokens'), false);
      assert.equal(tablesAfterDown.has('InstallationProvisioningOperations'), false);
      await FEATURE_MIGRATION.up(queryInterface, SequelizePackage);
      const tablesAfterUp = new Set(
        (await queryInterface.showAllTables()).map((table) =>
          typeof table === 'string' ? table : table.tableName,
        ),
      );
      assert.equal(tablesAfterUp.has('OwnerActivationTokens'), true);
      assert.equal(tablesAfterUp.has('InstallationProvisioningOperations'), true);
    });

    await seedTwoTenantFixture(schema);
    for (const name of CAPABILITY_ENV) process.env[name] = 'true';
    db = require('../../models');
    const provisioning = require('../../src/services/installation-provisioning.service');
    const auth = require('../../src/services/auth.service');
    const tenantContext = require('../../src/services/tenant-context.service');
    const operator = { username: 'db-test-operator' };

    let created;
    let rawToken;
    await t.test('one transaction creates exact Clubs, owner graph, hash-only activation and audit', async () => {
      created = await provisioning.provisionOrganization(payload('alpha'), operator);
      assert.equal(created.idempotency.replayed, false);
      assert.equal(created.clubs.length, 2);
      assert.equal(created.organization.slug, 'organizatsiya-alpha');
      assert.deepEqual(
        created.clubs.map((club) => club.slug),
        ['klub-alpha-tsentr', 'klub-alpha-sever'],
      );
      assert.equal(created.activation.state, 'pending');
      assert.match(created.activation.link, /^http:\/\/127\.0\.0\.1:5182\/activate-owner#token=/u);
      rawToken = tokenFromLink(created.activation.link);
      assert.equal(rawToken.length, 43);
      const stored = await db.OwnerActivationToken.findOne({
        where: { organizationId: created.organization.id },
      });
      assert.equal(stored.tokenHash, provisioning._private.sha256(rawToken));
      assert.equal(JSON.stringify(stored.toJSON()).includes(rawToken), false);
      const membership = await db.Membership.findOne({
        where: { accountId: created.owner.accountId, organizationId: created.organization.id },
      });
      assert.equal(membership.role, 'owner');
      const ownerStaff = await db.Staff.findByPk(membership.staffId);
      assert.equal(ownerStaff.phone, '+79991112233');
      assert.equal(await db.MembershipClubAccess.count({ where: { membershipId: membership.id } }), 0);
      const audit = await db.AuditLog.findByPk(created.audit.id);
      assert.equal(audit.action, 'installation.provisioning.create');
      const auditMetadata = typeof audit.metadata === 'string'
        ? JSON.parse(audit.metadata)
        : audit.metadata;
      assert.deepEqual(
        auditMetadata.clubSlugs,
        ['klub-alpha-tsentr', 'klub-alpha-sever'],
      );
      const snapshot = await provisioning.getInstallationSnapshot();
      assert.equal(
        snapshot.organizations.find((item) => item.id === created.organization.id).ownerState,
        'pending_activation',
      );
      assert.equal(
        snapshot.organizations.find((item) => item.id !== created.organization.id).ownerState,
        'active',
      );
    });

    await t.test('same key is idempotent and a changed payload is rejected without duplicate graph', async () => {
      const original = payload('retry');
      const first = await provisioning.provisionOrganization(original, operator);
      const before = await counts(db, 'retry');
      const replay = await provisioning.provisionOrganization(original, operator);
      assert.equal(replay.idempotency.operationId, first.idempotency.operationId);
      assert.equal(replay.idempotency.replayed, true);
      assert.equal(replay.activation.link, null);
      assert.deepEqual(await counts(db, 'retry'), before);
      const changed = { ...original, organization: { ...original.organization, name: 'Другое имя' } };
      await assert.rejects(
        provisioning.provisionOrganization(changed, operator),
        (error) => error.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH',
      );
      assert.deepEqual(await counts(db, 'retry'), before);
    });

    await t.test('forced mid-graph failure rolls back every row and is safely retryable', async () => {
      const input = payload('rollback');
      const before = await counts(db, 'rollback');
      await assert.rejects(
        provisioning.provisionOrganization(input, operator, { failAfter: 'owner' }),
        /Forced failure after owner graph/u,
      );
      assert.deepEqual(await counts(db, 'rollback'), before);
      const retry = await provisioning.provisionOrganization(input, operator);
      assert.equal(retry.organization.slug, 'organizatsiya-rollback');
      assert.equal(retry.clubs.length, 2);
    });

    await t.test('duplicate organization name and email leave no partial tenant graph', async () => {
      const nameDuplicate = payload('duplicate-name');
      nameDuplicate.organization.name = created.organization.name;
      await assert.rejects(
        provisioning.provisionOrganization(nameDuplicate, operator),
        (error) => error.code === 'ORGANIZATION_NAME_EXISTS',
      );
      assert.equal(
        await db.Account.count({ where: { email: nameDuplicate.owner.email } }),
        0,
      );

      const emailDuplicate = payload('duplicate-email');
      emailDuplicate.owner.email = created.owner.email;
      await assert.rejects(
        provisioning.provisionOrganization(emailDuplicate, operator),
        (error) => error.code === 'OWNER_EMAIL_EXISTS',
      );
      assert.equal(
        await db.Organization.count({ where: { name: emailDuplicate.organization.name } }),
        0,
      );
    });

    await t.test('internal organization and club slugs resolve collisions deterministically', async () => {
      const firstInput = payload('slug-collision-a');
      firstInput.organization.name = 'A B';
      firstInput.clubs = [
        { name: 'Центральный клуб', timezone: 'Europe/Moscow' },
        { name: 'Центральный клуб', timezone: 'Europe/Samara' },
      ];
      const first = await provisioning.provisionOrganization(firstInput, operator);
      assert.equal(first.organization.slug, 'a-b');
      assert.deepEqual(first.clubs.map((club) => club.slug), [
        'tsentralnyy-klub',
        'tsentralnyy-klub-2',
      ]);

      const secondInput = payload('slug-collision-b');
      secondInput.organization.name = 'A-B';
      const second = await provisioning.provisionOrganization(secondInput, operator);
      assert.equal(second.organization.slug, 'a-b-2');
    });

    await t.test('activation is single-use and enables ordinary login plus exact membership discovery', async () => {
      const status = await provisioning.inspectActivation(rawToken);
      assert.equal(status.state, 'pending');
      assert.equal(status.owner.email, created.owner.email);
      await provisioning.activateOwner(rawToken, 'OwnerSecure123!');
      assert.deepEqual(await provisioning.inspectActivation(rawToken), { state: 'consumed' });
      const snapshot = await provisioning.getInstallationSnapshot();
      assert.equal(
        snapshot.organizations.find((item) => item.id === created.organization.id).ownerState,
        'active',
      );
      await assert.rejects(
        provisioning.activateOwner(rawToken, 'AnotherSecure123!'),
        (error) => error.code === 'OWNER_ACTIVATION_UNAVAILABLE',
      );
      await assert.rejects(
        provisioning.reissueActivation(created.organization.id, operator),
        (error) => error.code === 'OWNER_ALREADY_ACTIVATED',
      );
      const session = await auth.login({ email: created.owner.email, password: 'OwnerSecure123!' });
      const discovery = await tenantContext.discoverMemberships(session.account.id);
      const membership = discovery.memberships.find(
        (item) => item.organization.id === created.organization.id,
      );
      assert.equal(membership.role, 'owner');
      assert.deepEqual(
        membership.clubs.map((club) => club.slug),
        ['klub-alpha-tsentr', 'klub-alpha-sever'],
      );
      assert.equal(discovery.recommendedContext.organizationId > 0, true);
    });

    await t.test('reissue invalidates the lost link and only the new link remains usable', async () => {
      const input = payload('reissue');
      const provisioned = await provisioning.provisionOrganization(input, operator);
      const previousToken = tokenFromLink(provisioned.activation.link);
      const reissued = await provisioning.reissueActivation(provisioned.organization.id, operator);
      const nextToken = tokenFromLink(reissued.activation.link);
      assert.notEqual(nextToken, previousToken);
      assert.deepEqual(await provisioning.inspectActivation(previousToken), { state: 'invalidated' });
      assert.equal((await provisioning.inspectActivation(nextToken)).state, 'pending');
      assert.equal(
        await db.OwnerActivationToken.count({
          where: { accountId: provisioned.owner.accountId, invalidatedAt: null, consumedAt: null },
        }),
        1,
      );
      const reissueAudit = await db.AuditLog.findByPk(reissued.audit.id);
      assert.equal(reissueAudit.action, 'installation.owner_activation.reissue');
    });
  } finally {
    if (db) await db.sequelize.close();
    if (schema) await schema.close();
    await dropDisposableDatabase(database);
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
