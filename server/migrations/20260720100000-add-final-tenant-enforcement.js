'use strict';

const {
  FINAL_ENFORCEMENT_DEFINITIONS,
  FOREIGN_KEY_DEFINITIONS,
  INDEX_DEFINITIONS,
  TRIGGER_DEFINITIONS,
  artifactKey,
  classifyFinalEnforcementDefinition,
  triggerCreateSql,
} = require('../src/tenant-enforcement/final-enforcement-definition');

const CONSTRAINTS = Object.freeze(Object.fromEntries(
  FOREIGN_KEY_DEFINITIONS.map((definition) => [definition.name, definition.name]),
));
const INDEXES = Object.freeze(Object.fromEntries(
  INDEX_DEFINITIONS.map((definition) => [definition.name, definition.name]),
));
const TRIGGERS = Object.freeze(Object.fromEntries(
  TRIGGER_DEFINITIONS.map((definition) => [definition.name, definition.name]),
));

function migrationError(message, details = [], code = 'TENANT_ENFORCEMENT_MIGRATION_BLOCKED') {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function definitionDetails(classification) {
  return classification.artifacts
    .filter((artifact) => artifact.state !== (
      classification.state === 'ready' ? 'exact' : 'absent'
    ))
    .map((artifact) => ({
      actual: artifact.actual,
      equivalents: artifact.equivalents,
      expected: artifact.expected,
      key: artifact.key,
      state: artifact.state,
    }));
}

async function runDataPreflight(queryInterface) {
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
    throw migrationError('Final tenant enforcement data preflight failed', failures);
  }
}

async function runDefinitionPreflight(queryInterface, allowedStates) {
  const classification = await classifyFinalEnforcementDefinition(queryInterface.sequelize);
  if (!allowedStates.includes(classification.state)) {
    throw migrationError(
      'Final tenant enforcement definition is partial or contains a lookalike',
      definitionDetails(classification),
    );
  }
  return classification;
}

async function createArtifact(queryInterface, definition) {
  if (definition.kind === 'index') {
    await queryInterface.addIndex(definition.table, [...definition.columns], {
      name: definition.name,
      unique: definition.unique,
      using: definition.indexType,
    });
    return;
  }
  if (definition.kind === 'foreignKey') {
    await queryInterface.addConstraint(definition.table, {
      fields: [...definition.columns],
      name: definition.name,
      onDelete: definition.deleteRule,
      onUpdate: definition.updateRule,
      references: {
        fields: [...definition.referencedColumns],
        table: definition.referencedTable,
      },
      type: 'foreign key',
    });
    return;
  }
  await queryInterface.sequelize.query(triggerCreateSql(definition));
}

async function dropArtifact(queryInterface, definition) {
  if (definition.kind === 'trigger') {
    await queryInterface.sequelize.query(`DROP TRIGGER ${definition.name}`);
  } else if (definition.kind === 'foreignKey') {
    await queryInterface.removeConstraint(definition.table, definition.name);
  } else {
    await queryInterface.removeIndex(definition.table, definition.name);
  }
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function preflightOwnedCleanup(queryInterface, ownedKeys) {
  const classification = await classifyFinalEnforcementDefinition(queryInterface.sequelize);
  const ownershipFailures = [];
  for (const artifact of classification.artifacts) {
    const owned = ownedKeys.has(artifact.key);
    if (owned && artifact.state !== 'exact') {
      ownershipFailures.push({ key: artifact.key, reason: 'owned-artifact-definition-changed' });
    } else if (!owned && artifact.state !== 'absent') {
      ownershipFailures.push({ key: artifact.key, reason: 'unowned-artifact-appeared' });
    }
  }

  for (const index of INDEX_DEFINITIONS) {
    if (!ownedKeys.has(artifactKey(index))) continue;
    const allowedDependencies = new Set(FOREIGN_KEY_DEFINITIONS
      .filter((foreignKey) => ownedKeys.has(artifactKey(foreignKey)))
      .map(artifactKey));
    for (const foreignKey of classification.loaded.foreignKeys) {
      const parentDependency =
        foreignKey.referencedTable === index.table &&
        sameArray(foreignKey.referencedColumns, index.columns);
      const childDependency =
        foreignKey.table === index.table &&
        foreignKey.columns.length <= index.columns.length &&
        sameArray(foreignKey.columns, index.columns.slice(0, foreignKey.columns.length));
      if ((parentDependency || childDependency) &&
        !allowedDependencies.has(artifactKey(foreignKey))) {
        ownershipFailures.push({
          dependency: artifactKey(foreignKey),
          key: artifactKey(index),
          reason: 'unexpected-index-dependent-foreign-key',
        });
      }
    }
  }
  if (ownershipFailures.length > 0) {
    throw migrationError(
      'Final tenant enforcement cleanup ownership was lost; operator repair is required',
      ownershipFailures,
      'TENANT_ENFORCEMENT_OPERATOR_REPAIR_REQUIRED',
    );
  }
  return classification;
}

async function cleanupOwnedArtifacts(queryInterface, ownedKeys) {
  // All ownership and dependency checks complete before the first irreversible
  // DDL cleanup statement. If any artifact drifted, preserve the whole graph.
  await preflightOwnedCleanup(queryInterface, ownedKeys);
  const ordered = [
    ...TRIGGER_DEFINITIONS,
    ...[...FOREIGN_KEY_DEFINITIONS].reverse(),
    ...[...INDEX_DEFINITIONS].reverse(),
  ];
  for (const definition of ordered) {
    if (ownedKeys.has(artifactKey(definition))) {
      await dropArtifact(queryInterface, definition);
    }
  }
  const after = await classifyFinalEnforcementDefinition(queryInterface.sequelize);
  if (after.state !== 'legacy') {
    throw migrationError(
      'Final tenant enforcement cleanup did not restore the exact legacy definition',
      definitionDetails(after),
      'TENANT_ENFORCEMENT_OPERATOR_REPAIR_REQUIRED',
    );
  }
}

function configuredFailureStage(options) {
  if (options.failAfter) return options.failAfter;
  if (process.env.NODE_ENV === 'test') {
    return process.env.TENANT_ENFORCEMENT_MIGRATION_FAIL_AFTER || null;
  }
  return null;
}

async function runUp(queryInterface, options = {}) {
  // Both definition and data checks are complete before the first DDL.
  const definition = await runDefinitionPreflight(queryInterface, ['legacy', 'ready']);
  await runDataPreflight(queryInterface);
  if (definition.state === 'ready') return { state: 'ready' };

  const created = new Set();
  const failureStage = configuredFailureStage(options);
  try {
    for (const [stage, definitions] of [
      ['indexes', INDEX_DEFINITIONS],
      ['foreignKeys', FOREIGN_KEY_DEFINITIONS],
      ['triggers', TRIGGER_DEFINITIONS],
    ]) {
      for (const artifact of definitions) {
        await createArtifact(queryInterface, artifact);
        created.add(artifactKey(artifact));
      }
      const staged = await classifyFinalEnforcementDefinition(queryInterface.sequelize);
      for (const key of created) {
        const artifact = staged.artifacts.find((item) => item.key === key);
        if (artifact?.state !== 'exact') {
          throw migrationError('Created final enforcement artifact has definition drift', [
            { key, state: artifact?.state || 'missing' },
          ]);
        }
      }
      if (failureStage === stage) throw new Error(`forced failure after ${stage}`);
    }
    const ready = await classifyFinalEnforcementDefinition(queryInterface.sequelize);
    if (ready.state !== 'ready') {
      throw migrationError('Final tenant enforcement did not reach exact ready state',
        definitionDetails(ready));
    }
    return { state: 'created' };
  } catch (originalError) {
    if (options.beforeCleanup) await options.beforeCleanup();
    try {
      await cleanupOwnedArtifacts(queryInterface, created);
    } catch (cleanupError) {
      cleanupError.cause = originalError;
      throw cleanupError;
    }
    throw originalError;
  }
}

async function assertRollbackSafe(queryInterface) {
  const [[counts]] = await queryInterface.sequelize.query(
    `SELECT
       (SELECT COUNT(*) FROM Organizations) AS organizations,
       (SELECT COUNT(*) FROM Clubs) AS clubs,
       (SELECT COUNT(*) FROM Staffs) AS staffs,
       (SELECT COUNT(*) FROM Memberships) AS memberships,
       (SELECT COUNT(*) FROM MembershipClubAccesses) AS accesses,
       (SELECT COUNT(*) FROM TelephonyCalls) AS calls,
       (SELECT COUNT(*) FROM TelephonyRawEvents) AS rawEvents,
       (SELECT COUNT(*) FROM TelephonyTranscriptionJobs) AS jobs,
       (SELECT COUNT(*) FROM TelephonyTranscriptSegments) AS segments`,
  );
  if (
    Number(counts.organizations) > 1 ||
    Number(counts.clubs) > 1 ||
    Number(counts.staffs) > 0 ||
    Number(counts.memberships) > 0 ||
    Number(counts.accesses) > 0 ||
    Number(counts.calls) > 0 ||
    Number(counts.rawEvents) > 0 ||
    Number(counts.jobs) > 0 ||
    Number(counts.segments) > 0
  ) {
    throw migrationError(
      'Rollback would remove accepted multi-tenant enforcement from owned data',
      [counts],
      'TENANT_ENFORCEMENT_ROLLBACK_REFUSED',
    );
  }
  return counts;
}

async function runDown(queryInterface) {
  // Definition and data refusal checks both finish before the first DROP.
  const definition = await runDefinitionPreflight(queryInterface, ['ready']);
  await assertRollbackSafe(queryInterface);
  const ownedKeys = new Set(definition.artifacts.map((artifact) => artifact.key));
  await cleanupOwnedArtifacts(queryInterface, ownedKeys);
}

module.exports = {
  async up(queryInterface) {
    await runUp(queryInterface);
  },

  async down(queryInterface) {
    await runDown(queryInterface);
  },

  __testing: {
    CONSTRAINTS,
    INDEXES,
    TRIGGERS,
    assertRollbackSafe,
    cleanupOwnedArtifacts,
    createArtifact,
    preflightOwnedCleanup,
    runDataPreflight,
    runDefinitionPreflight,
    runDown,
    runUp,
  },
};
