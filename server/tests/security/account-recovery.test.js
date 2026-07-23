'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const recovery = require('../../src/services/account-recovery.service');
const migration = require('../../migrations/20260722110000-create-account-recovery');
const { apiSchemas } = require('../../src/contracts/api-schemas');
const { getOpenApiDocument } = require('../../src/contracts/openapi');

test('recovery tokens are canonical, opaque and digest-only', () => {
  const raw = recovery._private.issueRawToken();
  assert.match(raw, recovery.TOKEN_PATTERN);
  assert.equal(recovery.digestToken(raw).length, 64);
  assert.notEqual(recovery.digestToken(raw), raw);
  assert.equal(recovery._private.issueRawToken().length, raw.length);
});

test('migration contains only request/token history and immutable token triggers', () => {
  assert.deepEqual(migration.__testing.TABLES, ['AccountRecoveryRequests', 'AccountRecoveryTokens']);
  assert.deepEqual(migration.__testing.TRIGGERS.map((trigger) => trigger.name), [
    'trg_account_recovery_tokens_bi',
    'trg_account_recovery_tokens_bu',
    'trg_account_recovery_tokens_bd',
  ]);
  assert.match(migration.__testing.TRIGGERS[0].body, /tokenDigest NOT REGEXP/u);
  assert.match(migration.__testing.TRIGGERS[1].body, /NEW\.issuedBy/u);
  assert.match(migration.__testing.TRIGGERS[2].body, /history is immutable/u);
});

test('public token inspection is neutral for malformed values', async () => {
  assert.deepEqual(await recovery.inspectToken('not-a-recovery-token'), { available: false });
});

test('synthetic fixture addresses are never exposed in operator serialization', () => {
  assert.equal(recovery._private.safeEmail({ email: 'o***@f9-rc.test', role: 'owner' }), 'owner@example.test');
  assert.equal(recovery._private.safeEmail({ email: 'owner@example.test', role: 'owner' }), 'owner@example.test');
});

test('public reset accepts only token and new password', async () => {
  await assert.rejects(
    () => recovery.resetPassword('not-a-recovery-token', 'password'),
    (error) => error.code === 'ACCOUNT_RECOVERY_TOKEN_INVALID',
  );
});

test('recovery API contracts reject user-entered reasons', () => {
  const token = 'setly_r1_' + 'A'.repeat(43);
  assert.equal(apiSchemas.auth.recoveryReset.body.safeParse({ token, password: 'password' }).success, true);
  assert.equal(apiSchemas.auth.recoveryStatus.body.safeParse({ token: ` ${token}` }).success, false);
  assert.equal(apiSchemas.auth.recoveryStatus.body.safeParse({ token: `${token} ` }).success, false);
  assert.equal(apiSchemas.auth.recoveryReset.body.safeParse({ token: ` ${token}`, password: 'password' }).success, false);
  assert.equal(apiSchemas.auth.recoveryReset.body.safeParse({ token: `${token} `, password: 'password' }).success, false);
  assert.equal(apiSchemas.auth.recoveryReset.body.safeParse({ token, password: 'password', reason: 'legacy' }).success, false);
  assert.equal(apiSchemas.installationProvisioning.recoveryProfile.body.safeParse({ email: 'user@example.test', displayName: 'User' }).success, true);
  assert.equal(apiSchemas.installationProvisioning.recoveryProfile.body.safeParse({ email: 'user@example.test', displayName: 'User', reason: 'legacy' }).success, false);
  assert.equal(apiSchemas.installationProvisioning.recoveryIssue.body.safeParse({}).success, true);
  assert.equal(apiSchemas.installationProvisioning.recoveryIssue.body.safeParse({ reason: 'legacy' }).success, false);
});

test('existing-account update contracts reject direct passwords for owner and manager callers', () => {
  for (const role of ['owner', 'manager']) {
    const parsed = apiSchemas.accounts.body.partial().safeParse({
      password: 'DirectBypass123!',
      role,
    });
    assert.equal(parsed.success, false, role);
  }
  assert.equal(apiSchemas.accounts.createBody.safeParse({
    email: 'new@example.test',
    password: 'CreateOnly123!',
  }).success, true);
});

test('installation recovery OpenAPI contract has exact path params and safe response shapes', () => {
  const document = getOpenApiDocument();
  const expected = {
    '/installation/provisioning/organizations/{organizationId}/clubs/{clubId}/recovery/accounts': ['organizationId', 'clubId'],
    '/installation/provisioning/organizations/{organizationId}/clubs/{clubId}/recovery/accounts/{accountId}': ['organizationId', 'clubId', 'accountId'],
    '/installation/provisioning/organizations/{organizationId}/clubs/{clubId}/recovery/requests': ['organizationId', 'clubId'],
    '/installation/provisioning/organizations/{organizationId}/clubs/{clubId}/recovery/requests/{requestId}/issue': ['organizationId', 'clubId', 'requestId'],
    '/installation/provisioning/organizations/{organizationId}/clubs/{clubId}/recovery/requests/{requestId}/revoke': ['organizationId', 'clubId', 'requestId'],
  };
  for (const [path, names] of Object.entries(expected)) {
    for (const method of Object.keys(document.paths[path] || {})) {
      if (!['get', 'put', 'post'].includes(method)) continue;
      const operation = document.paths[path][method];
      const pathParams = (operation.parameters || []).filter((parameter) => parameter.in === 'path');
      assert.deepEqual(pathParams.map((parameter) => parameter.name), names);
      assert.ok(operation.responses?.['200']?.content?.['application/json']?.schema);
    }
  }
  const accountList = document.paths[Object.keys(expected)[0]].get.responses['200'].content['application/json'].schema;
  assert.ok(accountList.properties.accounts.items.properties.staffId);
  const requestList = document.paths[Object.keys(expected)[2]].get.responses['200'].content['application/json'].schema;
  assert.ok(requestList.properties.requests.items.properties.status);
  const requestListOperation = document.paths[Object.keys(expected)[2]].get;
  assert.deepEqual(requestListOperation.parameters.filter((parameter) => parameter.in === 'query').map((parameter) => parameter.name), ['accountId']);
  assert.equal(apiSchemas.installationProvisioning.recoveryRequestsQuery.safeParse({}).success, true);
  assert.equal(apiSchemas.installationProvisioning.recoveryRequestsQuery.safeParse({ accountId: 42 }).success, true);
  assert.equal(apiSchemas.installationProvisioning.recoveryRequestsQuery.safeParse({ accountId: 'invalid' }).success, false);
  const generated = fs.readFileSync(
    path.join(__dirname, '../../../client/src/api/generated.ts'),
    'utf8',
  );
  assert.match(generated, /export type InstallationProvisioningRecoveryRequestsQuery = \{\n  accountId\?: number \| string;\n\}/u);
  assert.match(generated, /"installationProvisioning\.recoveryRequests": ApiEndpointRequest<InstallationProvisioningRecoveryRequestsParams, InstallationProvisioningRecoveryRequestsQuery, undefined>/u);
});
