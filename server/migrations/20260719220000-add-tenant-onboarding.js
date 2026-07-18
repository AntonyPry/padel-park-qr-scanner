'use strict';

const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../src/tenant-foundation/constants');
const artifactPlan = require('../src/onboarding/migration-artifact-plan');

const ROOT_COLUMNS = {
  OnboardingProgresses: ['organizationId', 'membershipId', 'clubId'],
  OnboardingTrainingModes: [
    'organizationId',
    'membershipId',
    'clubId',
    'sessionId',
    'expiresAt',
  ],
  OnboardingEvents: [
    'organizationId',
    'membershipId',
    'clubId',
    'trainingSessionId',
    'idempotencyKey',
  ],
};

const TRAINING_TABLES = [
  'Users',
  'Visits',
  'Bookings',
  'BookingSeries',
  'Finances',
  'ClientBases',
  'CallTasks',
  'CallTaskClients',
  'CallTaskAttempts',
  'CorporateClients',
  'CorporateLedgerEntries',
  'TrainingPlans',
  'TrainingNotes',
  'ClientTrainingSkills',
  'ClientTrainingSkillHistories',
  'ShiftCashSessions',
  'ShiftCashExpenses',
];

const INDEXES = [
  ['OnboardingProgresses', ['accountId'], 'onboarding_progress_account_idx', false],
  ['OnboardingProgresses', ['membershipId', 'role', 'taskKey'], 'onboarding_progress_membership_role_task_unique', true],
  ['OnboardingProgresses', ['organizationId', 'status'], 'onboarding_progress_org_status_idx', false],
  ['OnboardingTrainingModes', ['membershipId'], 'onboarding_training_modes_membership_unique', true],
  ['OnboardingTrainingModes', ['accountId'], 'onboarding_training_modes_account_idx', false],
  ['OnboardingTrainingModes', ['organizationId', 'clubId', 'isEnabled'], 'onboarding_training_modes_tenant_enabled_idx', false],
  ['OnboardingTrainingModes', ['sessionId'], 'onboarding_training_modes_session_unique', true],
  ['OnboardingEvents', ['organizationId', 'membershipId', 'idempotencyKey'], 'onboarding_events_tenant_idempotency_unique', true],
  ['OnboardingEvents', ['organizationId', 'clubId', 'createdAt'], 'onboarding_events_tenant_created_idx', false],
];
const TRAINING_SESSION_INDEX = 'training_session_idx';
const ROOT_TABLES = Object.keys(ROOT_COLUMNS);
const TRAINING_SESSION_FKS = Object.fromEntries(TRAINING_TABLES.map(
  (table, index) => [table, `f83_training_session_${index + 1}_fk`],
));

function trainingTriggerName(table, operation) {
  const index = TRAINING_TABLES.indexOf(table) + 1;
  return `trg_f83_training_${index}_${operation}`;
}

const TRAINING_TENANT_PREDICATES = {
  Users: 'NEW.organizationId=mode.organizationId',
  Visits: 'NEW.organizationId=mode.organizationId AND NEW.clubId=mode.clubId',
  Bookings: 'NEW.organizationId=mode.organizationId AND NEW.clubId=mode.clubId',
  BookingSeries: 'NEW.organizationId=mode.organizationId AND NEW.clubId=mode.clubId',
  Finances: 'NEW.organizationId=mode.organizationId AND NEW.clubId=mode.clubId',
  ClientBases: 'NEW.organizationId=mode.organizationId AND NEW.clubId=mode.clubId',
  CallTasks: 'NEW.organizationId=mode.organizationId AND NEW.clubId=mode.clubId',
  CallTaskClients: `EXISTS (SELECT 1 FROM CallTasks parent
    WHERE parent.id=NEW.callTaskId AND parent.organizationId=mode.organizationId
      AND parent.clubId=mode.clubId AND parent.trainingSessionId=NEW.trainingSessionId)`,
  CallTaskAttempts: `EXISTS (SELECT 1 FROM CallTaskClients client
    JOIN CallTasks task ON task.id=client.callTaskId
    WHERE client.id=NEW.callTaskClientId AND task.organizationId=mode.organizationId
      AND task.clubId=mode.clubId AND client.trainingSessionId=NEW.trainingSessionId)`,
  CorporateClients: 'NEW.organizationId=mode.organizationId',
  CorporateLedgerEntries: 'NEW.organizationId=mode.organizationId AND NEW.clubId=mode.clubId',
  TrainingPlans: 'NEW.clubId=mode.clubId',
  TrainingNotes: 'NEW.clubId=mode.clubId',
  ClientTrainingSkills: `EXISTS (SELECT 1 FROM Users parent
    WHERE parent.id=NEW.userId AND parent.organizationId=mode.organizationId
      AND parent.trainingSessionId=NEW.trainingSessionId)`,
  ClientTrainingSkillHistories: `EXISTS (SELECT 1 FROM ClientTrainingSkills parent
    WHERE parent.id=NEW.clientTrainingSkillId
      AND parent.trainingSessionId=NEW.trainingSessionId)`,
  ShiftCashSessions: `EXISTS (SELECT 1 FROM Shifts parent
    WHERE parent.id=NEW.shiftId AND parent.clubId=mode.clubId)`,
  ShiftCashExpenses: `EXISTS (SELECT 1 FROM ShiftCashSessions parent
    WHERE parent.id=NEW.cashSessionId AND parent.trainingSessionId=NEW.trainingSessionId)`,
};

function trainingTriggerBody(table, operation) {
  const ownershipChanged = operation === 'update'
    ? `IF OLD.isTraining<>NEW.isTraining
      OR NOT (OLD.trainingAccountId <=> NEW.trainingAccountId)
      OR NOT (OLD.trainingRole <=> NEW.trainingRole)
      OR NOT (OLD.trainingSessionId <=> NEW.trainingSessionId)
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Training artifact ownership is immutable'; END IF;`
    : '';
  return `BEGIN
    ${ownershipChanged}
    IF NEW.isTraining=1 AND (
      NEW.trainingAccountId IS NULL OR NEW.trainingRole IS NULL OR NEW.trainingSessionId IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM OnboardingTrainingModes mode
        WHERE mode.accountId=NEW.trainingAccountId AND mode.role=NEW.trainingRole
          AND mode.sessionId=NEW.trainingSessionId AND mode.isEnabled=1
          AND mode.expiresAt>NOW() AND (${TRAINING_TENANT_PREDICATES[table]})
      )
    ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Training artifact session mismatch'; END IF;
    IF NEW.isTraining<>1 AND (
      NEW.trainingAccountId IS NOT NULL OR NEW.trainingRole IS NOT NULL
      OR NEW.trainingSessionId IS NOT NULL
    ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Production artifact has training ownership'; END IF;
  END`;
}

const TRAINING_TRIGGERS = Object.fromEntries(TRAINING_TABLES.flatMap((table) => [
  [trainingTriggerName(table, 'insert'), {
    body: trainingTriggerBody(table, 'insert'), event: 'INSERT', table,
  }],
  [trainingTriggerName(table, 'update'), {
    body: trainingTriggerBody(table, 'update'), event: 'UPDATE', table,
  }],
]));

const TRIGGERS = {
  trg_onboarding_progress_insert_tenant: `BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM Memberships m JOIN Accounts a ON a.id=m.accountId
      JOIN Organizations o ON o.id=m.organizationId
      WHERE m.id=NEW.membershipId AND m.organizationId=NEW.organizationId
        AND m.accountId=NEW.accountId AND m.status='active' AND a.status='active'
        AND o.status='active' AND (
          (NEW.clubId IS NULL AND (m.role='owner' OR m.role=NEW.role))
          OR (NEW.clubId IS NOT NULL AND (m.role='owner' OR EXISTS (
            SELECT 1 FROM MembershipClubAccesses access
            WHERE access.organizationId=NEW.organizationId
              AND access.membershipId=NEW.membershipId AND access.clubId=NEW.clubId
              AND access.status='active' AND COALESCE(access.roleOverride,m.role)=NEW.role
          )))
        )
    ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingProgress tenant authority mismatch'; END IF;
    IF NEW.clubId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM Clubs c JOIN Memberships m ON m.id=NEW.membershipId
      WHERE c.id=NEW.clubId AND c.organizationId=NEW.organizationId AND c.status='active'
        AND (m.role='owner' OR EXISTS (
          SELECT 1 FROM MembershipClubAccesses access
          WHERE access.organizationId=NEW.organizationId AND access.membershipId=NEW.membershipId
            AND access.clubId=NEW.clubId AND access.status='active'
            AND COALESCE(access.roleOverride,m.role)=NEW.role
        ))
    ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingProgress club mismatch'; END IF;
  END`,
  trg_onboarding_progress_update_tenant: `BEGIN
    IF OLD.organizationId<>NEW.organizationId OR OLD.membershipId<>NEW.membershipId
      OR OLD.accountId<>NEW.accountId OR NOT (OLD.clubId <=> NEW.clubId)
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingProgress ownership is immutable'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM Memberships m JOIN Accounts a ON a.id=m.accountId
      JOIN Organizations o ON o.id=m.organizationId
      WHERE m.id=NEW.membershipId AND m.organizationId=NEW.organizationId
        AND m.accountId=NEW.accountId AND m.status='active' AND a.status='active'
        AND o.status='active' AND (
          (NEW.clubId IS NULL AND (m.role='owner' OR m.role=NEW.role))
          OR (NEW.clubId IS NOT NULL AND (m.role='owner' OR EXISTS (
            SELECT 1 FROM MembershipClubAccesses access
            WHERE access.organizationId=NEW.organizationId
              AND access.membershipId=NEW.membershipId AND access.clubId=NEW.clubId
              AND access.status='active' AND COALESCE(access.roleOverride,m.role)=NEW.role
          )))
        )
    ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingProgress tenant authority mismatch'; END IF;
    IF NEW.clubId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM Clubs c JOIN Memberships m ON m.id=NEW.membershipId
      WHERE c.id=NEW.clubId AND c.organizationId=NEW.organizationId AND c.status='active'
        AND (m.role='owner' OR EXISTS (
          SELECT 1 FROM MembershipClubAccesses access
          WHERE access.organizationId=NEW.organizationId AND access.membershipId=NEW.membershipId
            AND access.clubId=NEW.clubId AND access.status='active'
            AND COALESCE(access.roleOverride,m.role)=NEW.role
        ))
    ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingProgress club mismatch'; END IF;
  END`,
  trg_onboarding_mode_insert_tenant: `BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM Memberships m JOIN Accounts a ON a.id=m.accountId
      JOIN Clubs c ON c.id=NEW.clubId AND c.organizationId=m.organizationId
      JOIN Organizations o ON o.id=m.organizationId
      WHERE m.id=NEW.membershipId AND m.organizationId=NEW.organizationId
        AND m.accountId=NEW.accountId AND m.status='active' AND a.status='active'
        AND c.status='active' AND o.status='active'
        AND (m.role='owner' OR EXISTS (
          SELECT 1 FROM MembershipClubAccesses access
          WHERE access.organizationId=NEW.organizationId AND access.membershipId=NEW.membershipId
            AND access.clubId=NEW.clubId AND access.status='active'
            AND COALESCE(access.roleOverride,m.role)=NEW.role
        ))
    ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingTrainingMode tenant authority mismatch'; END IF;
  END`,
  trg_onboarding_mode_update_tenant: `BEGIN
    IF OLD.organizationId<>NEW.organizationId OR OLD.membershipId<>NEW.membershipId OR OLD.accountId<>NEW.accountId
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingTrainingMode ownership is immutable'; END IF;
    IF OLD.sessionId IS NOT NULL AND (
      OLD.clubId<>NEW.clubId OR (NEW.sessionId IS NOT NULL AND (
        NOT (OLD.role <=> NEW.role) OR OLD.sessionId<>NEW.sessionId
      ))
    ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Retained onboarding session ownership is immutable'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM Memberships m JOIN Accounts a ON a.id=m.accountId
      JOIN Clubs c ON c.id=NEW.clubId AND c.organizationId=m.organizationId
      JOIN Organizations o ON o.id=m.organizationId
      WHERE m.id=NEW.membershipId AND m.organizationId=NEW.organizationId
        AND m.accountId=NEW.accountId AND m.status='active' AND a.status='active'
        AND c.status='active' AND o.status='active'
        AND (m.role='owner' OR EXISTS (
          SELECT 1 FROM MembershipClubAccesses access
          WHERE access.organizationId=NEW.organizationId AND access.membershipId=NEW.membershipId
            AND access.clubId=NEW.clubId AND access.status='active'
            AND COALESCE(access.roleOverride,m.role)=NEW.role
        ))
    ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingTrainingMode tenant authority mismatch'; END IF;
  END`,
  trg_onboarding_event_insert_tenant: `BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM Memberships m JOIN Accounts a ON a.id=m.accountId
      JOIN Organizations o ON o.id=m.organizationId
      WHERE m.id=NEW.membershipId AND m.organizationId=NEW.organizationId
        AND m.accountId=NEW.accountId AND m.status='active' AND a.status='active'
        AND o.status='active' AND (
          (NEW.clubId IS NULL AND (m.role='owner' OR m.role=NEW.role))
          OR (NEW.clubId IS NOT NULL AND (m.role='owner' OR EXISTS (
            SELECT 1 FROM MembershipClubAccesses access
            WHERE access.organizationId=NEW.organizationId
              AND access.membershipId=NEW.membershipId AND access.clubId=NEW.clubId
              AND access.status='active' AND COALESCE(access.roleOverride,m.role)=NEW.role
          )))
        )
    ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingEvent tenant authority mismatch'; END IF;
    IF NEW.clubId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM Clubs c JOIN Memberships m ON m.id=NEW.membershipId
      WHERE c.id=NEW.clubId AND c.organizationId=NEW.organizationId AND c.status='active'
        AND (m.role='owner' OR EXISTS (
          SELECT 1 FROM MembershipClubAccesses access
          WHERE access.organizationId=NEW.organizationId AND access.membershipId=NEW.membershipId
            AND access.clubId=NEW.clubId AND access.status='active'
            AND COALESCE(access.roleOverride,m.role)=NEW.role
        ))
    ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingEvent club mismatch'; END IF;
    IF (NEW.isTraining=1 AND (
      NEW.trainingSessionId IS NULL OR NEW.clubId IS NULL OR NOT EXISTS (
        SELECT 1 FROM OnboardingTrainingModes mode
        WHERE mode.accountId=NEW.accountId AND mode.organizationId=NEW.organizationId
          AND mode.membershipId=NEW.membershipId AND mode.clubId=NEW.clubId
          AND mode.role=NEW.role AND mode.sessionId=NEW.trainingSessionId
          AND mode.isEnabled=1 AND mode.expiresAt>NOW()
      )
    )) OR (NEW.isTraining<>1 AND NEW.trainingSessionId IS NOT NULL)
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingEvent training session mismatch'; END IF;
  END`,
  trg_onboarding_event_update_immutable: `BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='OnboardingEvent rows are immutable'; END`,
  trg_onboarding_event_delete_training_only: `BEGIN
    IF OLD.isTraining<>1 OR OLD.trainingSessionId IS NULL
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Production OnboardingEvent rows are immutable'; END IF;
  END`,
};

function triggerEvent(name) {
  if (name.includes('_insert_')) return 'INSERT';
  if (name.includes('_delete_')) return 'DELETE';
  return 'UPDATE';
}

function migrationError(message) {
  const error = new Error(message);
  error.code = 'TENANT_ONBOARDING_MIGRATION_INVALID';
  return error;
}

function maybeForceFailure(step) {
  if (process.env.TENANT_ONBOARDING_MIGRATION_FAIL_STEP !== step) return;
  const error = new Error(`Forced tenant onboarding migration failure: ${step}`);
  error.code = 'TENANT_ONBOARDING_FORCED_FAILURE';
  throw error;
}

async function columnSet(queryInterface, table) {
  const columns = await queryInterface.describeTable(table);
  return new Set(Object.keys(columns));
}

async function indexDefinitions(queryInterface, table, transaction) {
  const [rows] = await queryInterface.sequelize.query(`SHOW INDEX FROM \`${table}\``, {
    transaction,
  });
  const definitions = new Map();
  for (const row of rows) {
    if (!definitions.has(row.Key_name)) {
      definitions.set(row.Key_name, {
        fields: [],
        unique: Number(row.Non_unique) === 0,
      });
    }
    definitions.get(row.Key_name).fields[Number(row.Seq_in_index) - 1] = row.Column_name;
  }
  return definitions;
}

async function featureArtifactsReady(queryInterface, transaction) {
  try {
    const plan = await artifactPlan.loadPlan(queryInterface, transaction);
    if (!plan || plan.status !== 'ready' || plan.legacy.some((item) => !item.removed)) return false;
    await artifactPlan.assertPlanOwnership(queryInterface, plan, transaction);
    await artifactPlan.assertLegacyRestorable(queryInterface, plan, transaction);
    return true;
  } catch {
    return false;
  }
}

function expectedColumnDefinitions() {
  const expected = [];
  for (const table of ROOT_TABLES) {
    for (const column of ROOT_COLUMNS[table]) {
      const session = ['sessionId', 'trainingSessionId'].includes(column);
      const integer = ['organizationId', 'membershipId', 'clubId'].includes(column);
      expected.push({
        allowNull: column === 'clubId' ? table !== 'OnboardingTrainingModes' :
          ['expiresAt', 'sessionId', 'trainingSessionId'].includes(column),
        column,
        length: column === 'idempotencyKey' ? 64 : session ? 36 : null,
        table,
        type: integer ? 'int' : session ? 'char' : column === 'expiresAt' ? 'datetime' : 'varchar',
      });
    }
  }
  for (const table of TRAINING_TABLES) {
    expected.push({ allowNull: true, column: 'trainingSessionId', length: 36, table, type: 'char' });
  }
  return expected;
}

async function columnDefinitionsReady(queryInterface, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,IS_NULLABLE,CHARACTER_MAXIMUM_LENGTH
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE()`,
    { transaction },
  );
  const byKey = new Map(rows.map((row) => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row]));
  const expected = expectedColumnDefinitions();
  return expected.every((item) => {
    const row = byKey.get(`${item.table}.${item.column}`);
    return row && row.DATA_TYPE === item.type &&
      (row.IS_NULLABLE === 'YES') === item.allowNull &&
      (item.length === null || Number(row.CHARACTER_MAXIMUM_LENGTH) === item.length);
  });
}

async function hasFeatureArtifacts(queryInterface, transaction) {
  if (await artifactPlan.tableExists(queryInterface, artifactPlan.PLAN_TABLE, transaction)) return true;
  for (const [table, , name] of INDEXES) {
    if ((await indexDefinitions(queryInterface, table, transaction)).has(name)) return true;
  }
  for (const table of TRAINING_TABLES) {
    if ((await indexDefinitions(queryInterface, table, transaction)).has(TRAINING_SESSION_INDEX)) return true;
  }
  const [[row]] = await queryInterface.sequelize.query(
    `SELECT
       (SELECT COUNT(*) FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN (:triggers)) triggerCount,
       (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
         WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN (:constraints)) constraintCount`,
    {
      replacements: {
        constraints: ROOT_TABLES.flatMap((table) => ['organization', 'membership', 'club']
          .map((suffix) => `${table.toLowerCase()}_${suffix}_fk`)),
        triggers: [...Object.keys(TRIGGERS), ...Object.keys(TRAINING_TRIGGERS)],
      },
      transaction,
    },
  );
  return Number(row.triggerCount) > 0 || Number(row.constraintCount) > 0;
}

async function classify(queryInterface, transaction) {
  if (await artifactPlan.tableExists(queryInterface, artifactPlan.PLAN_TABLE, transaction)) {
    return (await featureArtifactsReady(queryInterface, transaction)) ? 'ready' : 'partial';
  }
  let present = 0;
  let total = 0;
  for (const [table, names] of Object.entries(ROOT_COLUMNS)) {
    const columns = await columnSet(queryInterface, table);
    for (const name of names) {
      total += 1;
      if (columns.has(name)) present += 1;
    }
  }
  for (const table of TRAINING_TABLES) {
    const columns = await columnSet(queryInterface, table);
    total += 1;
    if (columns.has('trainingSessionId')) present += 1;
  }
  if (present === 0) {
    return (await hasFeatureArtifacts(queryInterface, transaction)) ? 'partial' : 'legacy';
  }
  if (present === total) return 'partial';
  return 'partial';
}

async function getDefaultTenant(queryInterface, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT o.id organizationId,c.id clubId
       FROM Organizations o JOIN Clubs c ON c.organizationId=o.id
      WHERE o.slug=:organizationSlug AND c.slug=:clubSlug
        AND o.status='active' AND c.status='active'`,
    {
      replacements: {
        clubSlug: DEFAULT_CLUB_SLUG,
        organizationSlug: DEFAULT_ORGANIZATION_SLUG,
      },
      transaction,
    },
  );
  const [[counts]] = await queryInterface.sequelize.query(
    'SELECT (SELECT COUNT(*) FROM Organizations) organizations,(SELECT COUNT(*) FROM Clubs) clubs',
    { transaction },
  );
  if (rows.length !== 1 || Number(counts.organizations) !== 1 || Number(counts.clubs) !== 1) {
    throw migrationError('Tenant onboarding migration requires exact active default Organization and Club');
  }
  return rows[0];
}

async function assertLegacyData(queryInterface, transaction) {
  const [ambiguous] = await queryInterface.sequelize.query(
    `SELECT source.accountId
       FROM (
         SELECT accountId FROM OnboardingProgresses
         UNION SELECT accountId FROM OnboardingTrainingModes
         UNION SELECT accountId FROM OnboardingEvents
       ) source
       LEFT JOIN Memberships m ON m.accountId=source.accountId
      GROUP BY source.accountId HAVING COUNT(m.id)<>1 LIMIT 1`,
    { transaction },
  );
  if (ambiguous.length) throw migrationError('Legacy onboarding Account has ambiguous Membership ownership');

  for (const table of TRAINING_TABLES) {
    const [orphans] = await queryInterface.sequelize.query(
      `SELECT t.id FROM \`${table}\` t
       LEFT JOIN OnboardingTrainingModes mode
         ON mode.accountId=t.trainingAccountId AND mode.role=t.trainingRole
       WHERE t.isTraining=1 AND (t.trainingAccountId IS NULL OR mode.id IS NULL) LIMIT 1`,
      { transaction },
    );
    if (orphans.length) {
      throw migrationError(`Training artifacts in ${table} have no owning onboarding session`);
    }
  }
}

async function addColumnCaptured(queryInterface, table, name, definition, transaction, plan) {
  await queryInterface.addColumn(table, name, definition, { transaction });
  await artifactPlan.recordArtifact(queryInterface, plan, { kind: 'column', name, table });
}

async function changeColumnCaptured(queryInterface, table, name, definition, transaction, plan) {
  await queryInterface.changeColumn(table, name, definition, { transaction });
  await artifactPlan.recordArtifact(queryInterface, plan, { kind: 'column', name, table });
}

async function addIndexCaptured(
  queryInterface,
  table,
  fields,
  options,
  transaction,
  plan,
) {
  await queryInterface.addIndex(table, fields, { ...options, transaction });
  await artifactPlan.recordArtifact(queryInterface, plan, {
    kind: 'index', name: options.name, table,
  });
}

async function indexNames(queryInterface, table, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table`,
    { replacements: { table }, transaction },
  );
  return new Set(rows.map((row) => row.INDEX_NAME));
}

async function addConstraintCaptured(queryInterface, table, options, transaction, plan) {
  const before = await indexNames(queryInterface, table, transaction);
  await queryInterface.addConstraint(table, { ...options, transaction });
  const after = await indexNames(queryInterface, table, transaction);
  for (const name of after) {
    if (!before.has(name)) {
      await artifactPlan.recordArtifact(queryInterface, plan, { kind: 'index', name, table });
    }
  }
  await artifactPlan.recordArtifact(queryInterface, plan, {
    kind: 'foreignKey', name: options.name, table,
  });
}

async function createTriggerCaptured(
  queryInterface,
  { body, event, name, table },
  transaction,
  plan,
) {
  await queryInterface.sequelize.query(
    `CREATE TRIGGER \`${name}\` BEFORE ${event} ON \`${table}\` FOR EACH ROW ${body}`,
    { transaction },
  );
  await artifactPlan.recordArtifact(queryInterface, plan, { kind: 'trigger', name, table });
}

async function addRootColumns(queryInterface, Sequelize, transaction, plan) {
  const integer = { allowNull: true, type: Sequelize.INTEGER };
  await addColumnCaptured(queryInterface, 'OnboardingProgresses', 'organizationId', integer, transaction, plan);
  await addColumnCaptured(queryInterface, 'OnboardingProgresses', 'membershipId', integer, transaction, plan);
  await addColumnCaptured(queryInterface, 'OnboardingProgresses', 'clubId', integer, transaction, plan);
  await addColumnCaptured(queryInterface, 'OnboardingTrainingModes', 'organizationId', integer, transaction, plan);
  await addColumnCaptured(queryInterface, 'OnboardingTrainingModes', 'membershipId', integer, transaction, plan);
  await addColumnCaptured(queryInterface, 'OnboardingTrainingModes', 'clubId', integer, transaction, plan);
  await addColumnCaptured(queryInterface, 'OnboardingTrainingModes', 'sessionId', { allowNull: true, type: Sequelize.UUID }, transaction, plan);
  await addColumnCaptured(queryInterface, 'OnboardingTrainingModes', 'expiresAt', { allowNull: true, type: Sequelize.DATE }, transaction, plan);
  await addColumnCaptured(queryInterface, 'OnboardingEvents', 'organizationId', integer, transaction, plan);
  await addColumnCaptured(queryInterface, 'OnboardingEvents', 'membershipId', integer, transaction, plan);
  await addColumnCaptured(queryInterface, 'OnboardingEvents', 'clubId', integer, transaction, plan);
  await addColumnCaptured(queryInterface, 'OnboardingEvents', 'trainingSessionId', { allowNull: true, type: Sequelize.UUID }, transaction, plan);
  await addColumnCaptured(queryInterface, 'OnboardingEvents', 'idempotencyKey', { allowNull: true, type: Sequelize.STRING(64) }, transaction, plan);
  for (const table of TRAINING_TABLES) {
    await addColumnCaptured(queryInterface, table, 'trainingSessionId', {
      allowNull: true, type: Sequelize.UUID,
    }, transaction, plan);
  }
}

async function backfill(queryInterface, tenant, transaction) {
  for (const table of ['OnboardingProgresses', 'OnboardingTrainingModes', 'OnboardingEvents']) {
    await queryInterface.sequelize.query(
      `UPDATE \`${table}\` root JOIN Memberships m ON m.accountId=root.accountId
       SET root.organizationId=m.organizationId,root.membershipId=m.id`,
      { transaction },
    );
  }
  await queryInterface.sequelize.query(
    `UPDATE OnboardingTrainingModes SET clubId=:clubId,
       sessionId=UUID(),expiresAt=CASE WHEN isEnabled=1 THEN DATE_ADD(COALESCE(enabledAt,NOW()),INTERVAL 24 HOUR) ELSE NULL END`,
    { replacements: tenant, transaction },
  );
  await queryInterface.sequelize.query(
    `UPDATE OnboardingEvents e LEFT JOIN OnboardingTrainingModes mode
       ON mode.membershipId=e.membershipId AND mode.role=e.role
       SET e.clubId=:clubId,e.trainingSessionId=CASE WHEN e.isTraining=1 THEN mode.sessionId ELSE NULL END,
           e.idempotencyKey=SHA2(CONCAT_WS('|',e.organizationId,e.membershipId,:clubId,e.eventKey,COALESCE(e.entityType,''),COALESCE(e.entityId,''),e.id),256)`,
    { replacements: tenant, transaction },
  );
  for (const table of TRAINING_TABLES) {
    await queryInterface.sequelize.query(
      `UPDATE \`${table}\` t JOIN OnboardingTrainingModes mode
         ON mode.accountId=t.trainingAccountId AND mode.role=t.trainingRole
       SET t.trainingSessionId=mode.sessionId WHERE t.isTraining=1`,
      { transaction },
    );
  }
}

async function addConstraints(queryInterface, Sequelize, transaction, plan) {
  for (const table of ['OnboardingProgresses', 'OnboardingTrainingModes', 'OnboardingEvents']) {
    await changeColumnCaptured(queryInterface, table, 'organizationId', {
      allowNull: false, type: Sequelize.INTEGER,
    }, transaction, plan);
    await changeColumnCaptured(queryInterface, table, 'membershipId', {
      allowNull: false, type: Sequelize.INTEGER,
    }, transaction, plan);
  }
  await changeColumnCaptured(queryInterface, 'OnboardingTrainingModes', 'clubId', {
    allowNull: false, type: Sequelize.INTEGER,
  }, transaction, plan);
  await changeColumnCaptured(queryInterface, 'OnboardingEvents', 'idempotencyKey', {
    allowNull: false, type: Sequelize.STRING(64),
  }, transaction, plan);
  for (const [table, fields, name, unique] of INDEXES) {
    await addIndexCaptured(queryInterface, table, fields, { name, unique }, transaction, plan);
  }
  for (const table of TRAINING_TABLES) {
    await addIndexCaptured(
      queryInterface,
      table,
      ['trainingSessionId'],
      { name: TRAINING_SESSION_INDEX },
      transaction,
      plan,
    );
  }
  for (const legacy of plan.legacy) {
    await queryInterface.removeIndex(legacy.table, legacy.name, { transaction });
    legacy.removed = true;
    await artifactPlan.persistPlan(queryInterface, plan);
  }
  for (const table of ['OnboardingProgresses', 'OnboardingTrainingModes', 'OnboardingEvents']) {
    await addConstraintCaptured(queryInterface, table, {
      fields: ['organizationId'],
      name: `${table.toLowerCase()}_organization_fk`,
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      references: { fields: ['id'], table: 'Organizations' },
      type: 'foreign key',
    }, transaction, plan);
    await addConstraintCaptured(queryInterface, table, {
      fields: ['membershipId'],
      name: `${table.toLowerCase()}_membership_fk`,
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      references: { fields: ['id'], table: 'Memberships' },
      type: 'foreign key',
    }, transaction, plan);
    await addConstraintCaptured(queryInterface, table, {
      fields: ['clubId'],
      name: `${table.toLowerCase()}_club_fk`,
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      references: { fields: ['id'], table: 'Clubs' },
      type: 'foreign key',
    }, transaction, plan);
  }
  for (const table of TRAINING_TABLES) {
    await addConstraintCaptured(queryInterface, table, {
      fields: ['trainingSessionId'],
      name: TRAINING_SESSION_FKS[table],
      onDelete: 'CASCADE',
      onUpdate: 'RESTRICT',
      references: { fields: ['sessionId'], table: 'OnboardingTrainingModes' },
      type: 'foreign key',
    }, transaction, plan);
  }
  for (const [name, body] of Object.entries(TRIGGERS)) {
    const event = triggerEvent(name);
    const table = name.includes('_progress_') ? 'OnboardingProgresses'
      : name.includes('_mode_') ? 'OnboardingTrainingModes' : 'OnboardingEvents';
    await createTriggerCaptured(queryInterface, {
      body, event, name, table,
    }, transaction, plan);
  }
  for (const [name, definition] of Object.entries(TRAINING_TRIGGERS)) {
    await createTriggerCaptured(queryInterface, {
      ...definition,
      name,
    }, transaction, plan);
  }
}

async function removeIndexIfPresent(queryInterface, table, name, transaction) {
  const indexes = await indexDefinitions(queryInterface, table, transaction);
  if (indexes.has(name)) await queryInterface.removeIndex(table, name, { transaction });
}

async function removeConstraintIfPresent(queryInterface, table, name, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=:table AND CONSTRAINT_NAME=:name`,
    { replacements: { name, table }, transaction },
  );
  if (rows.length) await queryInterface.removeConstraint(table, name, { transaction });
}

async function assertCleanupOwnership(queryInterface, transaction) {
  const plan = await artifactPlan.loadPlan(queryInterface, transaction);
  if (!plan) throw artifactPlan.cleanupOwnershipError('Onboarding artifact plan is missing');
  await artifactPlan.assertPlanOwnership(queryInterface, plan, transaction);
  await artifactPlan.assertLegacyRestorable(queryInterface, plan, transaction);
  return plan;
}

async function cleanupOwnedPartialMigration(queryInterface, transaction) {
  const plan = await assertCleanupOwnership(queryInterface, transaction);
  await artifactPlan.restoreLegacyIndexes(queryInterface, plan, transaction);
  await artifactPlan.removeRecordedArtifacts(queryInterface, plan, transaction);
  await artifactPlan.dropPlanStore(queryInterface, transaction);
}

async function assertFeatureArtifactNamesFree(queryInterface, transaction) {
  if (await artifactPlan.tableExists(queryInterface, artifactPlan.PLAN_TABLE, transaction)) {
    throw artifactPlan.cleanupOwnershipError('Onboarding migration plan table name collision');
  }
  for (const [table, , name] of INDEXES) {
    if (await artifactPlan.captureIndex(queryInterface, table, name, transaction)) {
      throw artifactPlan.cleanupOwnershipError(`Onboarding index name collision: ${table}.${name}`);
    }
  }
  for (const table of TRAINING_TABLES) {
    if (await artifactPlan.captureIndex(queryInterface, table, TRAINING_SESSION_INDEX, transaction)) {
      throw artifactPlan.cleanupOwnershipError(
        `Onboarding index name collision: ${table}.${TRAINING_SESSION_INDEX}`,
      );
    }
    const name = TRAINING_SESSION_FKS[table];
    if (await artifactPlan.captureForeignKey(queryInterface, table, name, transaction)) {
      throw artifactPlan.cleanupOwnershipError(`Onboarding FK name collision: ${table}.${name}`);
    }
  }
  for (const table of ROOT_TABLES) {
    for (const suffix of ['organization', 'membership', 'club']) {
      const name = `${table.toLowerCase()}_${suffix}_fk`;
      if (await artifactPlan.captureForeignKey(queryInterface, table, name, transaction)) {
        throw artifactPlan.cleanupOwnershipError(`Onboarding FK name collision: ${table}.${name}`);
      }
    }
  }
  for (const name of [...Object.keys(TRIGGERS), ...Object.keys(TRAINING_TRIGGERS)]) {
    if (await artifactPlan.captureTrigger(queryInterface, name, transaction)) {
      throw artifactPlan.cleanupOwnershipError(`Onboarding trigger name collision: ${name}`);
    }
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const state = await classify(queryInterface);
    if (state === 'ready') return;
    if (state !== 'legacy') throw migrationError('Tenant onboarding migration refused partial schema');
    let plan = null;
    try {
      await queryInterface.sequelize.transaction(async (transaction) => {
        const tenant = await getDefaultTenant(queryInterface, transaction);
        await assertLegacyData(queryInterface, transaction);
        await assertFeatureArtifactNamesFree(queryInterface, transaction);
        const legacy = await artifactPlan.captureLegacyUniqueIndexes(
          queryInterface,
          transaction,
        );
        plan = await artifactPlan.createPlanStore(queryInterface, Sequelize, legacy);
        await addRootColumns(queryInterface, Sequelize, transaction, plan);
        maybeForceFailure('after_columns');
        await backfill(queryInterface, tenant, transaction);
        maybeForceFailure('after_backfill');
        await addConstraints(queryInterface, Sequelize, transaction, plan);
        maybeForceFailure('after_constraints');
        plan.status = 'ready';
        await artifactPlan.persistPlan(queryInterface, plan);
      });
    } catch (error) {
      if (plan || await artifactPlan.tableExists(queryInterface, artifactPlan.PLAN_TABLE)) {
        try {
          await queryInterface.sequelize.transaction(async (transaction) => {
            await cleanupOwnedPartialMigration(queryInterface, transaction);
          });
        } catch (cleanupError) {
          cleanupError.cause = error;
          throw cleanupError;
        }
      }
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    if (!(await artifactPlan.tableExists(queryInterface, artifactPlan.PLAN_TABLE))) {
      const state = await classify(queryInterface);
      if (state === 'legacy') return;
      throw migrationError('Tenant onboarding rollback refused partial schema');
    }
    await queryInterface.sequelize.transaction(async (transaction) => {
      await getDefaultTenant(queryInterface, transaction);
      const plan = await assertCleanupOwnership(queryInterface, transaction);
      if (plan.status !== 'ready' || plan.legacy.some((item) => !item.removed)) {
        throw artifactPlan.cleanupOwnershipError('Onboarding rollback plan is not ready');
      }
      await artifactPlan.restoreLegacyIndexes(queryInterface, plan, transaction);
      await artifactPlan.removeRecordedArtifacts(queryInterface, plan, transaction);
      await artifactPlan.dropPlanStore(queryInterface, transaction);
    });
  },
  _private: {
    assertLegacyData,
    classify,
    cleanupOwnedPartialMigration,
    assertCleanupOwnership,
    featureArtifactsReady,
    getDefaultTenant,
    TRAINING_SESSION_FKS,
    TRAINING_TRIGGERS,
    TRIGGERS,
  },
};
