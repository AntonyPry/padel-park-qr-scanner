'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const FEATURE_MIGRATION_FILE =
  '20260716140000-add-tenant-staff-access-identity.js';
const CAPABILITY_ENV = [
  'TENANT_CONTEXT_ENABLED',
  'TENANT_CACHE_REALTIME_ENABLED',
  'TENANT_FILES_WORKERS_ENABLED',
  'TENANT_PROVIDER_INTEGRATIONS_ENABLED',
  'TENANT_STAFF_ACCESS_ENABLED',
];

function databaseName() {
  return (
    process.env.STAFF_ACCESS_TEST_DB_NAME ||
    `setly_staff_access_f5_1_${process.pid}_${Date.now()}`
  );
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

function tenantFor(account, membership, organizationId) {
  return Object.freeze({
    accountId: account.id,
    clubId: null,
    effectiveRole: membership.role,
    membershipId: membership.id,
    membershipRole: membership.role,
    organizationId,
    scope: 'organization',
  });
}

test('Feature 5.1 Staff/access identity DB security and lifecycle', async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed tenant tests');
  const database = databaseName();
  const previousCapabilities = Object.fromEntries(
    CAPABILITY_ENV.map((name) => [name, process.env[name]]),
  );
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
  for (const name of CAPABILITY_ENV) process.env[name] = 'true';

  let schema;
  let db;
  try {
    schema = await createSchema(database);
    db = require('../../models');
    const authService = require('../../src/services/auth.service');
    const accountLifecycle = require('../../src/services/account-lifecycle.service');
    const accountMetadata = require('../../src/services/account-metadata.service');
    const accountsService = require('../../src/services/accounts.service');
    const staffService = require('../../src/services/staff.service');
    const tenantContextService = require('../../src/services/tenant-context.service');
    const tenantFoundation = require('../../src/services/tenant-foundation.service');
    const migration = require(`../../migrations/${FEATURE_MIGRATION_FILE}`);
    const queryInterface = schema.getQueryInterface();

    await t.test('fresh pending migration rolls down and reapplies deterministically', async () => {
      const before = await tenantFoundation.classifyTenantFoundation();
      assert.equal(before.state, 'bootstrap-pending');
      await migration.down(queryInterface, SequelizePackage);
      const staffColumns = await queryInterface.describeTable('Staffs');
      const membershipColumns = await queryInterface.describeTable('Memberships');
      assert.equal(staffColumns.organizationId, undefined);
      assert.equal(membershipColumns.staffId, undefined);

      const failingQueryInterface = new Proxy(queryInterface, {
        get(target, property) {
          if (property === 'addColumn') {
            return async (table, column, definition) => {
              if (table === 'Memberships' && column === 'staffId') {
                throw new Error('Forced Staff/access migration failure');
              }
              return target.addColumn(table, column, definition);
            };
          }
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      let forcedMigrationError;
      await assert.rejects(
        migration.up(failingQueryInterface, SequelizePackage),
        (error) => {
          forcedMigrationError = error;
          return /Forced Staff\/access migration failure/.test(error.message);
        },
      );
      assert.equal(
        forcedMigrationError.cleanupError,
        undefined,
        forcedMigrationError.cleanupError?.stack,
      );
      const cleanedStaffColumns = await queryInterface.describeTable('Staffs');
      const cleanedMembershipColumns = await queryInterface.describeTable(
        'Memberships',
      );
      assert.equal(cleanedStaffColumns.organizationId, undefined);
      assert.equal(cleanedMembershipColumns.staffId, undefined);

      await migration.up(queryInterface, SequelizePackage);
      const after = await tenantFoundation.classifyTenantFoundation();
      assert.equal(after.state, 'bootstrap-pending');
      assert.equal(after.checksum, before.checksum);
    });

    const ownerSession = await authService.bootstrapOwner({
      email: 'owner@staff-access.test',
      name: 'Shared Staff Name',
      password: 'StaffOwner123!',
    });
    const owner = await db.Account.findByPk(ownerSession.account.id);
    const defaultOrganization = await db.Organization.findOne({
      where: { slug: 'padel-park' },
    });
    const defaultClub = await db.Club.findOne({
      where: { organizationId: defaultOrganization.id },
    });
    const ownerMembership = await db.Membership.findOne({
      where: {
        accountId: owner.id,
        organizationId: defaultOrganization.id,
      },
    });
    const ownerContext = tenantFor(
      owner,
      ownerMembership,
      defaultOrganization.id,
    );

    await t.test('bootstrap and initialized migration preserve composite link', async () => {
      const ownerStaff = await db.Staff.findByPk(owner.staffId);
      assert.equal(ownerStaff.organizationId, defaultOrganization.id);
      assert.equal(ownerMembership.staffId, owner.staffId);
      const before = await tenantFoundation.assertTenantFoundationInitialized();
      await migration.down(queryInterface, SequelizePackage);
      const [[legacyAccount]] = await schema.query(
        'SELECT staffId FROM Accounts WHERE id = :accountId',
        { replacements: { accountId: owner.id } },
      );
      assert.equal(legacyAccount.staffId, owner.staffId);
      await migration.up(queryInterface, SequelizePackage);
      const restoredMembership = await db.Membership.findByPk(ownerMembership.id);
      assert.equal(restoredMembership.staffId, owner.staffId);
      const after = await tenantFoundation.assertTenantFoundationInitialized();
      assert.equal(after.checksum, before.checksum);
    });

    const createStaff = (suffix) =>
      staffService.create(
        {
          name: `Staff ${suffix}`,
          phone: `+7999${String(Date.now()).slice(-7)}${suffix}`.slice(0, 16),
          position: 'Администратор',
          status: 'active',
        },
        ownerContext,
      );

    await t.test('dual-write is atomic for create, update and forced failures', async () => {
      const linkedStaff = await createStaff('01');
      const account = await accountLifecycle.createAccount(
        {
          email: 'linked@staff-access.test',
          passwordHash: authService.hashPassword('Linked123!'),
          role: 'admin',
          staffId: linkedStaff.id,
          status: 'active',
        },
        { organizationId: defaultOrganization.id },
      );
      let membership = await db.Membership.findOne({
        where: { accountId: account.id },
      });
      assert.equal(account.staffId, linkedStaff.id);
      assert.equal(membership.staffId, linkedStaff.id);

      const nextStaff = await createStaff('02');
      await assert.rejects(
        accountLifecycle.updateAccount(
          account.id,
          { staffId: nextStaff.id },
          { failAfter: 'account', organizationId: defaultOrganization.id },
        ),
        /Forced Account lifecycle failure/,
      );
      assert.equal((await db.Account.findByPk(account.id)).staffId, linkedStaff.id);
      membership = await db.Membership.findOne({ where: { accountId: account.id } });
      assert.equal(membership.staffId, linkedStaff.id);

      await accountLifecycle.updateAccount(
        account.id,
        { staffId: nextStaff.id },
        { organizationId: defaultOrganization.id },
      );
      assert.equal((await db.Account.findByPk(account.id)).staffId, nextStaff.id);
      membership = await db.Membership.findOne({ where: { accountId: account.id } });
      assert.equal(membership.staffId, nextStaff.id);

      const forcedStaff = await createStaff('03');
      await assert.rejects(
        accountLifecycle.createAccount(
          {
            email: 'forced@staff-access.test',
            passwordHash: authService.hashPassword('Forced123!'),
            role: 'admin',
            staffId: forcedStaff.id,
            status: 'active',
          },
          { failAfter: 'membership', organizationId: defaultOrganization.id },
        ),
        /Forced Membership lifecycle failure/,
      );
      assert.equal(
        await db.Account.count({ where: { email: 'forced@staff-access.test' } }),
        0,
      );
      assert.equal(
        await db.Membership.count({ where: { staffId: forcedStaff.id } }),
        0,
      );
      await assert.rejects(
        accountMetadata.updateAccountMetadata(account.id, {
          staffId: forcedStaff.id,
        }),
        (error) => error.code === 'ACCOUNT_LIFECYCLE_REQUIRED',
      );
    });

    await t.test('nullable and concurrent Staff assignment honor unique composite key', async () => {
      const nullableAccounts = [];
      for (const index of [1, 2]) {
        nullableAccounts.push(
          await accountLifecycle.createAccount(
            {
              email: `nullable-${index}@staff-access.test`,
              passwordHash: authService.hashPassword('Nullable123!'),
              role: 'viewer',
              staffId: null,
              status: 'active',
            },
            { organizationId: defaultOrganization.id },
          ),
        );
      }
      assert.equal(
        await db.Membership.count({
          where: {
            accountId: nullableAccounts.map((account) => account.id),
            staffId: null,
          },
        }),
        2,
      );

      const contestedStaff = await createStaff('04');
      const settled = await Promise.allSettled(
        [1, 2].map((index) =>
          accountLifecycle.createAccount(
            {
              email: `concurrent-${index}@staff-access.test`,
              passwordHash: authService.hashPassword('Concurrent123!'),
              role: 'admin',
              staffId: contestedStaff.id,
              status: 'active',
            },
            { organizationId: defaultOrganization.id },
          ),
        ),
      );
      assert.deepEqual(
        settled.map((result) => result.status).sort(),
        ['fulfilled', 'rejected'],
      );
      assert.equal(
        await db.Membership.count({ where: { staffId: contestedStaff.id } }),
        1,
      );
    });

    await t.test('account and Staff lifecycle preserve last-owner and delete invariants', async () => {
      await assert.rejects(
        accountLifecycle.updateAccount(owner.id, { status: 'archived' }),
        (error) => error.code === 'LAST_ACTIVE_OWNER',
      );
      await assert.rejects(
        staffService.remove(owner.staffId, ownerContext),
        (error) => error.code === 'LAST_ACTIVE_OWNER',
      );

      const secondOwner = await accountLifecycle.createAccount(
        {
          email: 'second-owner@staff-access.test',
          passwordHash: authService.hashPassword('SecondOwner123!'),
          role: 'owner',
          staffId: null,
          status: 'active',
        },
        { organizationId: defaultOrganization.id },
      );
      await accountLifecycle.updateAccount(owner.id, { status: 'archived' });
      await accountLifecycle.updateAccount(owner.id, { status: 'active' });
      await staffService.remove(owner.staffId, ownerContext);
      await staffService.restore(owner.staffId, ownerContext);
      assert.equal((await db.Account.findByPk(secondOwner.id)).status, 'active');

      const deletable = await accountLifecycle.createAccount(
        {
          email: 'delete@staff-access.test',
          passwordHash: authService.hashPassword('Delete123!'),
          role: 'viewer',
          staffId: null,
          status: 'archived',
        },
        { organizationId: defaultOrganization.id },
      );
      await accountLifecycle.permanentDeleteAccount(deletable.id, {
        organizationId: defaultOrganization.id,
      });
      assert.equal(await db.Account.count({ where: { id: deletable.id } }), 0);
      assert.equal(await db.Membership.count({ where: { accountId: deletable.id } }), 0);

      const deletableStaff = await createStaff('05');
      await staffService.remove(deletableStaff.id, ownerContext);
      await staffService.removeArchived(deletableStaff.id, ownerContext);
      assert.equal(await db.Staff.count({ where: { id: deletableStaff.id } }), 0);
    });

    let foreignOrganization;
    let foreignMembership;
    let foreignStaff;
    let foreignContext;
    await t.test('two Organizations, three Clubs and scoped IDOR behavior fail closed', async () => {
      foreignOrganization = await db.Organization.create({
        name: 'Foreign Organization',
        slug: 'foreign-organization',
        status: 'active',
      });
      await db.Club.bulkCreate([
        {
          name: 'Foreign Club A',
          organizationId: foreignOrganization.id,
          slug: 'foreign-a',
          status: 'active',
          timezone: 'Europe/Moscow',
        },
        {
          name: 'Foreign Club B',
          organizationId: foreignOrganization.id,
          slug: 'foreign-b',
          status: 'active',
          timezone: 'Europe/Moscow',
        },
      ]);
      assert.equal(await db.Club.count(), 3);
      foreignMembership = await db.Membership.create({
        accountId: owner.id,
        organizationId: foreignOrganization.id,
        role: 'owner',
        staffId: null,
        status: 'active',
      });
      foreignContext = tenantFor(owner, foreignMembership, foreignOrganization.id);
      foreignStaff = await db.Staff.create({
        name: 'Shared Staff Name',
        organizationId: foreignOrganization.id,
        phone: '+78880000001',
        role: 'Владелец',
        status: 'active',
      });

      const defaultList = await staffService.getAll(
        { q: 'Shared Staff Name' },
        ownerContext,
      );
      const foreignList = await staffService.getAll(
        { q: 'Shared Staff Name' },
        foreignContext,
      );
      assert.ok(defaultList.some((staff) => staff.id === owner.staffId));
      assert.equal(defaultList.some((staff) => staff.id === foreignStaff.id), false);
      assert.deepEqual(foreignList.map((staff) => staff.id), [foreignStaff.id]);

      for (const action of [
        () => staffService.getStaffById(foreignStaff.id, ownerContext),
        () =>
          staffService.update(
            foreignStaff.id,
            {
              name: 'Forged update',
              position: 'Владелец',
              status: 'active',
            },
            ownerContext,
          ),
        () => staffService.remove(foreignStaff.id, ownerContext),
      ]) {
        await assert.rejects(action(), (error) => error.statusCode === 404);
      }
      const forgedContext = {
        ...ownerContext,
        membershipId: foreignMembership.id,
      };
      await assert.rejects(
        staffService.getAll({}, forgedContext),
        (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
      );
      await foreignMembership.update({ status: 'inactive' });
      await assert.rejects(
        staffService.getAll({}, foreignContext),
        (error) => error.code === 'TENANT_CONTEXT_NOT_FOUND',
      );
      await foreignMembership.update({ status: 'active' });

      const discovery = await tenantContextService.discoverMemberships(owner.id);
      const foreignDiscovery = discovery.memberships.find(
        (membership) => membership.organization.id === foreignOrganization.id,
      );
      assert.equal(foreignDiscovery.clubs.length, 2);
      assert.ok(
        foreignDiscovery.clubs.every((club) => club.effectiveRole === 'owner'),
      );
      assert.equal(
        await db.MembershipClubAccess.count({
          where: { membershipId: foreignMembership.id },
        }),
        0,
      );
      assert.equal(defaultClub.organizationId, defaultOrganization.id);
    });

    await t.test('service and DB reject foreign or duplicate Staff assignments', async () => {
      await assert.rejects(
        accountsService.create(
          owner,
          {
            email: 'foreign-link@staff-access.test',
            password: 'Foreign123!',
            role: 'admin',
            staffId: owner.staffId,
            status: 'active',
          },
          foreignContext,
        ),
        (error) => error.statusCode === 404,
      );
      await assert.rejects(
        foreignMembership.update({ staffId: owner.staffId }),
        (error) => error.name === 'SequelizeForeignKeyConstraintError',
      );

      const ownerLink = await db.Membership.findByPk(ownerMembership.id);
      const nullableMembership = await db.Membership.findOne({
        where: {
          accountId: { [db.Sequelize.Op.ne]: owner.id },
          organizationId: defaultOrganization.id,
          staffId: null,
        },
      });
      assert.ok(nullableMembership);
      await assert.rejects(
        nullableMembership.update({ staffId: ownerLink.staffId }),
        (error) => error.name === 'SequelizeUniqueConstraintError',
      );
    });

    await t.test('flag-off retains legacy reads while flag-on scopes Account reads', async () => {
      process.env.TENANT_STAFF_ACCESS_ENABLED = 'false';
      const legacyList = await staffService.getAll({ q: 'Shared Staff Name' });
      assert.ok(legacyList.some((staff) => staff.id === owner.staffId));
      assert.ok(legacyList.some((staff) => staff.id === foreignStaff.id));

      process.env.TENANT_STAFF_ACCESS_ENABLED = 'true';
      const foreignOnlyAccount = await db.Account.create({
        email: 'foreign-only@staff-access.test',
        passwordHash: authService.hashPassword('ForeignOnly123!'),
        role: 'admin',
        staffId: foreignStaff.id,
        status: 'active',
      });
      await db.Membership.create({
        accountId: foreignOnlyAccount.id,
        organizationId: foreignOrganization.id,
        role: 'admin',
        staffId: foreignStaff.id,
        status: 'active',
      });
      const defaultAccounts = await accountsService.getAll({}, ownerContext);
      const foreignAccounts = await accountsService.getAll({}, foreignContext);
      assert.equal(
        defaultAccounts.some((account) => account.id === foreignOnlyAccount.id),
        false,
      );
      assert.ok(
        foreignAccounts.some((account) => account.id === foreignOnlyAccount.id),
      );
      await assert.rejects(
        accountsService.update(
          owner,
          foreignOnlyAccount.id,
          { email: 'idor-write@staff-access.test' },
          ownerContext,
        ),
        (error) => error.statusCode === 404,
      );
      assert.equal(
        (await db.Account.findByPk(foreignOnlyAccount.id)).email,
        'foreign-only@staff-access.test',
      );
    });

    await t.test('rollback preflight refuses a second Organization without dropping attribution', async () => {
      await assert.rejects(
        migration.down(queryInterface, SequelizePackage),
        /exactly one active default Organization/,
      );
      const staffColumns = await queryInterface.describeTable('Staffs');
      const membershipColumns = await queryInterface.describeTable('Memberships');
      assert.ok(staffColumns.organizationId);
      assert.ok(membershipColumns.staffId);
    });
  } finally {
    for (const name of CAPABILITY_ENV) {
      if (previousCapabilities[name] === undefined) delete process.env[name];
      else process.env[name] = previousCapabilities[name];
    }
    if (db?.sequelize) await db.sequelize.close().catch(() => {});
    if (schema) await schema.close().catch(() => {});
    if (process.env.KEEP_STAFF_ACCESS_TEST_DB === 'true') {
      console.log(`[tenant-staff-access] kept QA database ${database}`);
    } else {
      await admin.query(`DROP DATABASE IF EXISTS \`${database}\``).catch(() => {});
    }
    await admin.end();
  }
});
