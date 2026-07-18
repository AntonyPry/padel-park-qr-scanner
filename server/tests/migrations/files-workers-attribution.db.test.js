'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const db = require('../../models');
const migration = require('../../migrations/20260715120000-add-tenant-transcription-job-attribution');
const finalEnforcementMigration = require('../../migrations/20260720100000-add-final-tenant-enforcement');

test('transcription tenant attribution migration fails closed, backfills, rolls back and reapplies without data loss', async () => {
  assert.ok(process.env.DB_USER, 'DB_USER is required for DB-backed migration tests');
  await db.sequelize.authenticate();
  const queryInterface = db.sequelize.getQueryInterface();
  const sequelizeTypes = db.Sequelize;
  let callId = null;
  let finalEnforcementRemoved = false;

  try {
    await db.TelephonyTranscriptSegment.destroy({ where: {} });
    await db.TelephonyTranscriptionJob.destroy({ where: {} });
    await finalEnforcementMigration.down(queryInterface, sequelizeTypes);
    finalEnforcementRemoved = true;
    await migration.down(queryInterface, sequelizeTypes);

    const [organization] = await db.sequelize.query(
      `INSERT INTO Organizations(slug, name, status, createdAt, updatedAt)
       VALUES ('migration-ambiguous', 'Migration Ambiguous', 'active', NOW(), NOW())`,
    );
    const otherOrganizationId = Number(organization);
    await db.sequelize.query(
      `INSERT INTO Clubs(organizationId, slug, name, timezone, status, createdAt, updatedAt)
       VALUES (:organizationId, 'migration-ambiguous', 'Migration Ambiguous', 'Europe/Moscow', 'active', NOW(), NOW())`,
      { replacements: { organizationId: otherOrganizationId } },
    );
    await assert.rejects(
      migration.up(queryInterface, sequelizeTypes),
      /exact active default tenant/,
    );
    assert.equal(
      Boolean((await queryInterface.describeTable('TelephonyTranscriptionJobs')).organizationId),
      false,
    );
    await db.sequelize.query(
      'DELETE FROM Clubs WHERE organizationId = :organizationId',
      { replacements: { organizationId: otherOrganizationId } },
    );
    await db.sequelize.query(
      'DELETE FROM Organizations WHERE id = :organizationId',
      { replacements: { organizationId: otherOrganizationId } },
    );

    const [callResult] = await db.sequelize.query(
      `INSERT INTO TelephonyCalls(externalCallId, recordingStatus, createdAt, updatedAt)
       VALUES ('feature-4-2-migration', 'available', NOW(), NOW())`,
    );
    callId = Number(callResult);
    await db.sequelize.query(
      `INSERT INTO TelephonyTranscriptionJobs(
         telephonyCallId, status, transcriptText, attemptCount, createdAt, updatedAt
       ) VALUES (:callId, 'failed', 'preserve-me', 4, NOW(), NOW())`,
      { replacements: { callId } },
    );

    await migration.up(queryInterface, sequelizeTypes);
    const [[attributed]] = await db.sequelize.query(
      `SELECT j.organizationId, j.clubId, j.transcriptText, j.attemptCount,
              o.slug organizationSlug, c.slug clubSlug
       FROM TelephonyTranscriptionJobs j
       JOIN Organizations o ON o.id = j.organizationId
       JOIN Clubs c ON c.id = j.clubId AND c.organizationId = j.organizationId
       WHERE j.telephonyCallId = :callId`,
      { replacements: { callId } },
    );
    assert.equal(attributed.organizationSlug, 'padel-park');
    assert.equal(attributed.clubSlug, 'padel-park');
    assert.equal(attributed.transcriptText, 'preserve-me');
    assert.equal(Number(attributed.attemptCount), 4);

    await migration.down(queryInterface, sequelizeTypes);
    const [[rolledBack]] = await db.sequelize.query(
      `SELECT transcriptText, attemptCount
       FROM TelephonyTranscriptionJobs WHERE telephonyCallId = :callId`,
      { replacements: { callId } },
    );
    assert.equal(rolledBack.transcriptText, 'preserve-me');
    assert.equal(Number(rolledBack.attemptCount), 4);

    await migration.up(queryInterface, sequelizeTypes);
    const [[reapplied]] = await db.sequelize.query(
      `SELECT organizationId, clubId, transcriptText, attemptCount
       FROM TelephonyTranscriptionJobs WHERE telephonyCallId = :callId`,
      { replacements: { callId } },
    );
    assert.ok(Number(reapplied.organizationId) > 0);
    assert.ok(Number(reapplied.clubId) > 0);
    assert.equal(reapplied.transcriptText, 'preserve-me');
    assert.equal(Number(reapplied.attemptCount), 4);

    await db.sequelize.query(
      'DELETE FROM TelephonyTranscriptionJobs WHERE telephonyCallId = :callId',
      { replacements: { callId } },
    );
    await db.sequelize.query(
      'DELETE FROM TelephonyCalls WHERE id = :callId',
      { replacements: { callId } },
    );
    callId = null;
    await finalEnforcementMigration.up(queryInterface, sequelizeTypes);
    finalEnforcementRemoved = false;
  } finally {
    if (callId) {
      await db.sequelize.query(
        'DELETE FROM TelephonyTranscriptionJobs WHERE telephonyCallId = :callId',
        { replacements: { callId } },
      ).catch(() => {});
      await db.sequelize.query(
        'DELETE FROM TelephonyCalls WHERE id = :callId',
        { replacements: { callId } },
      ).catch(() => {});
    }
    await db.sequelize.query(
      `DELETE c FROM Clubs c
        JOIN Organizations o ON o.id = c.organizationId
       WHERE o.slug = 'migration-ambiguous'`,
    ).catch(() => {});
    await db.sequelize.query(
      "DELETE FROM Organizations WHERE slug = 'migration-ambiguous'",
    ).catch(() => {});
    if (finalEnforcementRemoved) {
      await migration.up(queryInterface, sequelizeTypes);
      await finalEnforcementMigration.up(queryInterface, sequelizeTypes);
    }
  }
});
