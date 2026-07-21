'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  auditRepository,
  auditSource,
} = require('../../scripts/audit-installation-operator-writes');

test('installation operator direct-write audit accepts only canonical writers', () => {
  assert.deepEqual(auditSource(`
    const db = require('../../models');
    db.InstallationOperatorSession.create(payload);
    const session = await db.InstallationOperatorSession.findOne({ where });
    await session.update({ revokedAt: new Date() });
  `, 'src/services/installation-operator-auth.service.js'), []);
  assert.deepEqual(auditSource(`
    const db = require('../../models');
    db.InstallationMutationOperation.create(payload);
  `, 'src/services/installation-management.service.js'), []);
  assert.deepEqual(auditRepository(), []);
});

test('installation operator direct-write audit resolves model, instance and bound aliases', () => {
  const findings = auditSource(`
    const { InstallationOperatorSession: Sessions } = db;
    const findSession = Sessions.findOne.bind(Sessions);
    const session = await findSession({ where });
    const { update: mutateSession } = session;
    mutateSession({ revokedAt: null });
    const Operations = db['InstallationMutationOperation'];
    const writeOperation = Operations.upsert.bind(Operations);
    writeOperation(payload);
  `, 'src/services/unsafe.js');
  assert.equal(findings.some((item) => item.type.includes('InstallationOperatorSession')), true);
  assert.equal(findings.some((item) => item.type.includes('InstallationMutationOperation')), true);
});

test('installation operator direct-write audit catches query-interface and raw SQL aliases', () => {
  const findings = auditSource(`
    const sessions = 'InstallationOperator' + 'Sessions';
    const operations = { tableName: 'InstallationMutationOperations' };
    const { bulkDelete: removeRows } = queryInterface;
    removeRows(sessions, {});
    queryInterface.bulkUpdate(operations, {}, {});
    const run = sequelize.query.bind(sequelize);
    const prefix = 'DELETE FROM ';
    run(prefix + '\\x60InstallationMutationOperations\\x60 WHERE id=1');
  `, 'scripts/unsafe.js');
  assert.equal(findings.filter((item) => item.type.includes('query-interface')).length, 2);
  assert.equal(findings.some((item) => item.type.includes('raw SQL')), true);
});
