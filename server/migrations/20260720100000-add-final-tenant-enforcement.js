'use strict';

const CONSTRAINTS = Object.freeze({
  callBooking: 'fk_final_telephony_calls_booking_tenant',
  callClient: 'fk_final_telephony_calls_client_tenant',
  callStaff: 'fk_final_telephony_calls_staff_tenant',
  jobCall: 'fk_final_transcription_jobs_call_tenant',
  rawEventCall: 'fk_final_telephony_raw_events_call_tenant',
  segmentJobCall: 'fk_final_transcript_segments_job_call',
});

const INDEXES = Object.freeze({
  callTenantIdentity: 'uq_final_telephony_calls_tenant_identity',
  jobCallIdentity: 'uq_final_transcription_jobs_call_identity',
});

const TRIGGERS = Object.freeze({
  clubs: 'trg_final_clubs_tenant_immutable',
  membershipAccesses: 'trg_final_accesses_tenant_immutable',
  memberships: 'trg_final_memberships_authority_immutable',
  staffs: 'trg_final_staffs_tenant_immutable',
  transcriptSegments: 'trg_final_transcript_segments_link_immutable',
  transcriptionJobs: 'trg_final_transcription_jobs_tenant_immutable',
});

function migrationError(message, details = []) {
  const error = new Error(message);
  error.code = 'TENANT_ENFORCEMENT_MIGRATION_BLOCKED';
  error.details = details;
  return error;
}

async function objectNames(queryInterface, type) {
  const [rows] = await queryInterface.sequelize.query(
    type === 'constraint'
      ? `SELECT CONSTRAINT_NAME AS name
           FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
          WHERE TABLE_SCHEMA = DATABASE()`
      : `SELECT DISTINCT INDEX_NAME AS name
           FROM INFORMATION_SCHEMA.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()`,
  );
  return new Set(rows.map((row) => row.name));
}

async function runPreflight(queryInterface) {
  const checks = [
    {
      code: 'MEMBERSHIP_STAFF_ORGANIZATION_MISMATCH',
      sql: `SELECT m.id
              FROM Memberships AS m
              JOIN Staffs AS s ON s.id = m.staffId
             WHERE m.staffId IS NOT NULL
               AND m.organizationId <> s.organizationId`,
    },
    {
      code: 'RAW_EVENT_CALL_TENANT_MISMATCH',
      sql: `SELECT e.id
              FROM TelephonyRawEvents AS e
              JOIN TelephonyCalls AS c ON c.id = e.telephonyCallId
             WHERE e.telephonyCallId IS NOT NULL
               AND (NOT (e.organizationId <=> c.organizationId)
                 OR NOT (e.clubId <=> c.clubId))`,
    },
    {
      code: 'TRANSCRIPTION_JOB_CALL_TENANT_MISMATCH',
      sql: `SELECT j.id
              FROM TelephonyTranscriptionJobs AS j
              JOIN TelephonyCalls AS c ON c.id = j.telephonyCallId
             WHERE NOT (j.organizationId <=> c.organizationId)
                OR NOT (j.clubId <=> c.clubId)`,
    },
    {
      code: 'TRANSCRIPT_SEGMENT_CALL_MISMATCH',
      sql: `SELECT s.id
              FROM TelephonyTranscriptSegments AS s
              JOIN TelephonyTranscriptionJobs AS j ON j.id = s.transcriptionJobId
             WHERE s.telephonyCallId <> j.telephonyCallId`,
    },
    {
      code: 'TELEPHONY_CALL_CLIENT_TENANT_MISMATCH',
      sql: `SELECT c.id
              FROM TelephonyCalls AS c
              JOIN Users AS u ON u.id = c.userId
             WHERE c.userId IS NOT NULL
               AND c.organizationId <> u.organizationId`,
    },
    {
      code: 'TELEPHONY_CALL_STAFF_TENANT_MISMATCH',
      sql: `SELECT c.id
              FROM TelephonyCalls AS c
              JOIN Staffs AS s ON s.id = c.staffId
             WHERE c.staffId IS NOT NULL
               AND c.organizationId <> s.organizationId`,
    },
    {
      code: 'TELEPHONY_CALL_BOOKING_TENANT_MISMATCH',
      sql: `SELECT c.id
              FROM TelephonyCalls AS c
              JOIN Bookings AS b ON b.id = c.linkedBookingId
             WHERE c.linkedBookingId IS NOT NULL
               AND (c.organizationId <> b.organizationId OR c.clubId <> b.clubId)`,
    },
  ];
  const failures = [];
  for (const check of checks) {
    const [rows] = await queryInterface.sequelize.query(`${check.sql} LIMIT 10`);
    if (rows.length > 0) failures.push({
      code: check.code,
      sampleIds: rows.map((row) => Number(row.id)),
    });
  }
  if (failures.length > 0) {
    throw migrationError('Final tenant enforcement preflight failed', failures);
  }
}

async function addIndexes(queryInterface) {
  const existing = await objectNames(queryInterface, 'index');
  if (!existing.has(INDEXES.callTenantIdentity)) {
    await queryInterface.addIndex(
      'TelephonyCalls',
      ['id', 'organizationId', 'clubId'],
      { name: INDEXES.callTenantIdentity, unique: true },
    );
  }
  if (!existing.has(INDEXES.jobCallIdentity)) {
    await queryInterface.addIndex(
      'TelephonyTranscriptionJobs',
      ['id', 'telephonyCallId'],
      { name: INDEXES.jobCallIdentity, unique: true },
    );
  }
}

async function addConstraints(queryInterface) {
  const existing = await objectNames(queryInterface, 'constraint');
  const definitions = [
    {
      fields: ['telephonyCallId', 'organizationId', 'clubId'],
      name: CONSTRAINTS.jobCall,
      references: {
        fields: ['id', 'organizationId', 'clubId'],
        table: 'TelephonyCalls',
      },
      table: 'TelephonyTranscriptionJobs',
    },
    {
      fields: ['telephonyCallId', 'organizationId', 'clubId'],
      name: CONSTRAINTS.rawEventCall,
      references: {
        fields: ['id', 'organizationId', 'clubId'],
        table: 'TelephonyCalls',
      },
      table: 'TelephonyRawEvents',
    },
    {
      fields: ['transcriptionJobId', 'telephonyCallId'],
      name: CONSTRAINTS.segmentJobCall,
      references: {
        fields: ['id', 'telephonyCallId'],
        table: 'TelephonyTranscriptionJobs',
      },
      table: 'TelephonyTranscriptSegments',
    },
    {
      fields: ['organizationId', 'userId'],
      name: CONSTRAINTS.callClient,
      references: { fields: ['organizationId', 'id'], table: 'Users' },
      table: 'TelephonyCalls',
    },
    {
      fields: ['organizationId', 'staffId'],
      name: CONSTRAINTS.callStaff,
      references: { fields: ['organizationId', 'id'], table: 'Staffs' },
      table: 'TelephonyCalls',
    },
    {
      fields: ['organizationId', 'clubId', 'linkedBookingId'],
      name: CONSTRAINTS.callBooking,
      references: {
        fields: ['organizationId', 'clubId', 'id'],
        table: 'Bookings',
      },
      table: 'TelephonyCalls',
    },
  ];
  for (const definition of definitions) {
    if (existing.has(definition.name)) continue;
    await queryInterface.addConstraint(definition.table, {
      fields: definition.fields,
      name: definition.name,
      onDelete: 'RESTRICT',
      onUpdate: 'RESTRICT',
      references: definition.references,
      type: 'foreign key',
    });
  }
}

async function dropTriggers(queryInterface) {
  for (const triggerName of Object.values(TRIGGERS)) {
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS ${triggerName}`);
  }
}

function immutableTriggerSql(name, table, comparisons, message) {
  return `CREATE TRIGGER ${name}
          BEFORE UPDATE ON ${table}
          FOR EACH ROW
          BEGIN
            IF ${comparisons.map(
    (column) => `NOT (OLD.${column} <=> NEW.${column})`,
  ).join(' OR ')} THEN
              SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${message}';
            END IF;
          END`;
}

async function createTriggers(queryInterface) {
  const definitions = [
    [TRIGGERS.clubs, 'Clubs', ['organizationId'], 'Club tenant attribution is immutable'],
    [
      TRIGGERS.memberships,
      'Memberships',
      ['organizationId', 'accountId'],
      'Membership tenant authority is immutable',
    ],
    [
      TRIGGERS.membershipAccesses,
      'MembershipClubAccesses',
      ['organizationId', 'membershipId', 'clubId'],
      'Membership Club access authority is immutable',
    ],
    [TRIGGERS.staffs, 'Staffs', ['organizationId'], 'Staff tenant attribution is immutable'],
    [
      TRIGGERS.transcriptionJobs,
      'TelephonyTranscriptionJobs',
      ['organizationId', 'clubId', 'telephonyCallId'],
      'Transcription job tenant attribution is immutable',
    ],
    [
      TRIGGERS.transcriptSegments,
      'TelephonyTranscriptSegments',
      ['transcriptionJobId', 'telephonyCallId'],
      'Transcript segment ownership links are immutable',
    ],
  ];
  for (const definition of definitions) {
    await queryInterface.sequelize.query(immutableTriggerSql(...definition));
  }
}

async function assertRollbackSafe(queryInterface) {
  const [[counts]] = await queryInterface.sequelize.query(
    `SELECT
       (SELECT COUNT(*) FROM Organizations) AS organizations,
       (SELECT COUNT(*) FROM Clubs) AS clubs,
       (SELECT COUNT(*) FROM TelephonyRawEvents) AS rawEvents,
       (SELECT COUNT(*) FROM TelephonyTranscriptionJobs) AS jobs,
       (SELECT COUNT(*) FROM TelephonyTranscriptSegments) AS segments`,
  );
  if (
    Number(counts.organizations) > 1 ||
    Number(counts.clubs) > 1 ||
    Number(counts.rawEvents) > 0 ||
    Number(counts.jobs) > 0 ||
    Number(counts.segments) > 0
  ) {
    const error = migrationError(
      'Rollback would remove accepted multi-tenant enforcement from owned data',
      [counts],
    );
    error.code = 'TENANT_ENFORCEMENT_ROLLBACK_REFUSED';
    throw error;
  }
}

async function removeConstraintIfPresent(queryInterface, table, name) {
  const existing = await objectNames(queryInterface, 'constraint');
  if (existing.has(name)) await queryInterface.removeConstraint(table, name);
}

async function removeIndexIfPresent(queryInterface, table, name) {
  const existing = await objectNames(queryInterface, 'index');
  if (existing.has(name)) await queryInterface.removeIndex(table, name);
}

module.exports = {
  async up(queryInterface) {
    await runPreflight(queryInterface);
    await addIndexes(queryInterface);
    await addConstraints(queryInterface);
    await dropTriggers(queryInterface);
    await createTriggers(queryInterface);
  },

  async down(queryInterface) {
    await assertRollbackSafe(queryInterface);
    await dropTriggers(queryInterface);
    for (const [table, name] of [
      ['TelephonyTranscriptSegments', CONSTRAINTS.segmentJobCall],
      ['TelephonyRawEvents', CONSTRAINTS.rawEventCall],
      ['TelephonyTranscriptionJobs', CONSTRAINTS.jobCall],
      ['TelephonyCalls', CONSTRAINTS.callBooking],
      ['TelephonyCalls', CONSTRAINTS.callStaff],
      ['TelephonyCalls', CONSTRAINTS.callClient],
    ]) {
      await removeConstraintIfPresent(queryInterface, table, name);
    }
    await removeIndexIfPresent(
      queryInterface,
      'TelephonyTranscriptionJobs',
      INDEXES.jobCallIdentity,
    );
    await removeIndexIfPresent(
      queryInterface,
      'TelephonyCalls',
      INDEXES.callTenantIdentity,
    );
  },

  __testing: {
    CONSTRAINTS,
    INDEXES,
    TRIGGERS,
    assertRollbackSafe,
    runPreflight,
  },
};
