'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const {
  connect,
  createDisposableDatabase,
  dropDisposableDatabase,
  migrateAll,
  seedTwoTenantFixture,
} = require('../helpers/final-tenant-rc-fixture');

function rawFromLink(link) {
  return String(link).match(/[#&]token=(setly_r1_[A-Za-z0-9_-]{43})$/u)?.[1] || null;
}

test('A12 recovery DB/API lifecycle is scoped, single-use, digest-only and session-bound', async (t) => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for account recovery lifecycle DB test');
  const database = process.env.ACCOUNT_RECOVERY_LIFECYCLE_TEST_DB_NAME ||
    `setly_f9_rc_recovery_${process.pid}_${Date.now()}`;
  const previousDbName = process.env.DB_NAME;
  let schema;
  let db;
  let recovery;
  let normalSessions;
  let accountRecoveryController;
  let passwordHashing;

  await createDisposableDatabase(database);
  process.env.DB_NAME = database;
  try {
    schema = connect(database);
    await migrateAll(schema);
    const fixture = await seedTwoTenantFixture(schema);
    db = require('../../models');
    recovery = require('../../src/services/account-recovery.service');
    normalSessions = require('../../src/services/normal-user-session.service');
    accountRecoveryController = require('../../src/controllers/account-recovery.controller');
    passwordHashing = require('../../src/services/password-hashing.service');
    const organizationA = fixture.organizations.A;
    const clubA = fixture.clubs.A[0];
    const clubA2 = fixture.clubs.A[1];
    const organizationB = fixture.organizations.B;
    const clubB = fixture.clubs.B[0];
    const ownerA = fixture.identities.A.owner;
    const managerA = fixture.identities.A.manager;
    const managerB = fixture.identities.B.manager;
    const ownerB = fixture.identities.B.owner;
    const operator = { type: 'operator', username: 'db-test-operator' };
    const ownerActor = { type: 'owner', accountId: ownerA.accountId };
    const managerActor = { type: 'manager', accountId: managerA.accountId };

    await t.test('operator and owner scope decisions reject inactive/cross-club/self/other-owner/manager targets', async () => {
      const operatorRequest = await recovery.createRequest(
        organizationA,
        clubA,
        { accountId: managerA.accountId },
        operator,
      );
      assert.equal(operatorRequest.status, 'created');
      const ownerRequest = await recovery.createRequest(
        organizationA,
        clubA,
        { accountId: managerA.accountId },
        ownerActor,
      );
      assert.equal(ownerRequest.status, 'created');
      await assert.rejects(
        () => recovery.createRequest(organizationA, clubA, { accountId: ownerA.accountId }, ownerActor),
        (error) => error.code === 'ACCOUNT_RECOVERY_OWNER_SCOPE',
      );
      await assert.rejects(
        () => recovery.createRequest(organizationA, clubA, { accountId: managerA.accountId }, managerActor),
        (error) => error.code === 'ACCOUNT_RECOVERY_OWNER_SCOPE',
      );
      await assert.rejects(
        () => recovery.createRequest(organizationB, clubB, { accountId: managerB.accountId }, ownerActor),
        (error) => error.code === 'ACCOUNT_RECOVERY_OWNER_REQUIRED',
      );
      await assert.rejects(
        () => recovery.createRequest(organizationA, clubA, { accountId: ownerB.accountId }, operator),
        (error) => error.code === 'ACCOUNT_RECOVERY_ACCOUNT_NOT_FOUND',
      );
      await db.Account.update({ status: 'inactive' }, { where: { id: managerA.accountId } });
      await assert.rejects(
        () => recovery.createRequest(organizationA, clubA, { accountId: managerA.accountId }, ownerActor),
        (error) => error.code === 'ACCOUNT_RECOVERY_ACCOUNT_NOT_FOUND',
      );
      await db.Account.update({ status: 'active' }, { where: { id: managerA.accountId } });
      assert.equal((await recovery.createRequest(organizationA, clubA2, { accountId: managerA.accountId }, operator)).status, 'created');
    });

    await t.test('sequential and concurrent issuance supersede older requests', async () => {
      const first = await recovery.createRequest(organizationA, clubA, { accountId: managerA.accountId }, operator);
      const firstLink = await recovery.issueToken(first.id, operator, organizationA, clubA);
      assert.match(firstLink.resetLink, /setly_r1_[A-Za-z0-9_-]{43}$/u);
      const second = await recovery.createRequest(organizationA, clubA, { accountId: managerA.accountId }, operator);
      const secondLink = await recovery.issueToken(second.id, operator, organizationA, clubA);
      assert.notEqual(firstLink.resetLink, secondLink.resetLink);
      const sequentialRows = await recovery.listRequests(organizationA, clubA, managerA.accountId);
      assert.equal(sequentialRows.find((row) => row.id === first.id).status, 'revoked');
      assert.equal(sequentialRows.find((row) => row.id === second.id).status, 'issued');
      const concurrentA = await recovery.createRequest(organizationA, clubA, { accountId: managerA.accountId }, operator);
      const concurrentB = await recovery.createRequest(organizationA, clubA, { accountId: managerA.accountId }, operator);
      const results = await Promise.allSettled([
        recovery.issueToken(concurrentA.id, operator, organizationA, clubA),
        recovery.issueToken(concurrentB.id, operator, organizationA, clubA),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
      const concurrentRows = await recovery.listRequests(organizationA, clubA, managerA.accountId);
      assert.equal(concurrentRows.filter((row) => [concurrentA.id, concurrentB.id].includes(row.id)).filter((row) => row.status === 'issued').length, 1);
      assert.equal(concurrentRows.filter((row) => [concurrentA.id, concurrentB.id].includes(row.id)).filter((row) => row.status === 'revoked').length, 1);
    });

    await t.test('double reset has one winner, revokes sessions and disconnects realtime sockets', async () => {
      const request = await recovery.createRequest(organizationA, clubA, { accountId: managerA.accountId }, operator);
      const issued = await recovery.issueToken(request.id, operator, organizationA, clubA);
      const rawToken = rawFromLink(issued.resetLink);
      const sessionToken = `setly_s1_${crypto.randomBytes(32).toString('base64url')}`;
      await db.NormalUserSession.create({
        accountId: managerA.accountId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        tokenDigest: normalSessions._private.digestToken(sessionToken),
      });
      const originalHash = passwordHashing.hashPassword;
      t.after(() => { passwordHashing.hashPassword = originalHash; });
      passwordHashing.hashPassword = async () => 'argon2id$test-recovery-hash';
      const outcomes = await Promise.allSettled([
        recovery.resetPassword(rawToken, 'RecoveryPassword123!'),
        recovery.resetPassword(rawToken, 'RecoveryPassword456!'),
      ]);
      assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
      assert.equal(outcomes.filter((item) => item.status === 'rejected').length, 1);
      const session = await db.NormalUserSession.findOne({ where: { tokenDigest: normalSessions._private.digestToken(sessionToken) } });
      assert.ok(session.revokedAt);
      const tokenRow = await db.AccountRecoveryToken.unscoped().findOne({ where: { tokenDigest: recovery.digestToken(rawToken) } });
      assert.ok(tokenRow.consumedAt);
      assert.notEqual(tokenRow.tokenDigest, rawToken);
      const auditRows = await db.AuditLog.findAll({ where: { entityType: 'account_recovery' }, raw: true });
      assert.equal(JSON.stringify(auditRows).includes(rawToken), false);

      const nextRequest = await recovery.createRequest(organizationA, clubA, { accountId: managerA.accountId }, operator);
      const nextIssued = await recovery.issueToken(nextRequest.id, operator, organizationA, clubA);
      const nextRaw = rawFromLink(nextIssued.resetLink);
      const socket = { data: { account: { id: managerA.accountId } }, disconnected: false, disconnect(force) { this.disconnected = force; } };
      const headers = {};
      const response = {
        body: null,
        getHeader(name) { return headers[name]; },
        set(name, value) { headers[name] = value; return this; },
        setHeader(name, value) { headers[name] = value; },
        json(value) { this.body = value; return this; },
      };
      await accountRecoveryController.reset({
        body: { token: nextRaw, password: 'RecoveryPassword789!' },
        app: { get(name) { return name === 'io' ? { sockets: { sockets: new Map([['socket', socket]]) } } : null; } },
      }, response);
      assert.deepEqual(response.body, { success: true });
      assert.equal(socket.disconnected, true);
      assert.equal((headers['Set-Cookie'] || []).length, 2);
    });
  } finally {
    if (db?.sequelize) await db.sequelize.close();
    if (schema) await schema.close();
    if (previousDbName === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = previousDbName;
    await dropDisposableDatabase(database);
  }
});
