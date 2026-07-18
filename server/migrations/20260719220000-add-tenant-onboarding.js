'use strict';

const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../src/tenant-foundation/constants');

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

const TRIGGERS = {
  trg_onboarding_progress_insert_tenant: `BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM Memberships m JOIN Accounts a ON a.id=m.accountId
      JOIN Organizations o ON o.id=m.organizationId
      WHERE m.id=NEW.membershipId AND m.organizationId=NEW.organizationId
        AND m.accountId=NEW.accountId AND m.status='active' AND a.status='active'
        AND o.status='active' AND (m.role='owner' OR m.role=NEW.role)
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
        AND o.status='active' AND (m.role='owner' OR m.role=NEW.role)
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
      OLD.clubId<>NEW.clubId OR NOT (OLD.role <=> NEW.role)
      OR (NEW.sessionId IS NOT NULL AND OLD.sessionId<>NEW.sessionId)
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
        AND o.status='active' AND (m.role='owner' OR m.role=NEW.role)
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
  for (const [table, fields, name, unique] of INDEXES) {
    const definition = (await indexDefinitions(queryInterface, table, transaction)).get(name);
    if (!definition || definition.unique !== unique || definition.fields.join('|') !== fields.join('|')) {
      return false;
    }
  }
  for (const table of TRAINING_TABLES) {
    const definition = (await indexDefinitions(queryInterface, table, transaction)).get(TRAINING_SESSION_INDEX);
    if (!definition || definition.unique || definition.fields.join('|') !== 'trainingSessionId') return false;
  }
  const progressIndexes = await indexDefinitions(queryInterface, 'OnboardingProgresses', transaction);
  const modeIndexes = await indexDefinitions(queryInterface, 'OnboardingTrainingModes', transaction);
  if (progressIndexes.has('onboarding_progress_account_role_task_unique')) return false;
  if ([...modeIndexes.values()].some((definition) => definition.unique
    && definition.fields.join('|') === 'accountId')) return false;
  const [constraints] = await queryInterface.sequelize.query(
    `SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,
            r.UPDATE_RULE,r.DELETE_RULE
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
        AND k.TABLE_NAME IN ('OnboardingProgresses','OnboardingTrainingModes','OnboardingEvents')`,
    { transaction },
  );
  for (const table of ROOT_TABLES) {
    for (const [suffix, column, referenced] of [
      ['organization', 'organizationId', 'Organizations'],
      ['membership', 'membershipId', 'Memberships'],
      ['club', 'clubId', 'Clubs'],
    ]) {
      const name = `${table.toLowerCase()}_${suffix}_fk`;
      if (!constraints.some((row) => row.TABLE_NAME === table && row.CONSTRAINT_NAME === name
        && row.COLUMN_NAME === column && row.REFERENCED_TABLE_NAME === referenced
        && row.UPDATE_RULE === 'CASCADE'
        && row.DELETE_RULE === (suffix === 'membership' ? 'CASCADE' : 'RESTRICT'))) return false;
    }
  }
  const [triggers] = await queryInterface.sequelize.query(
    `SELECT TRIGGER_NAME,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_STATEMENT
       FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()`,
    { transaction },
  );
  for (const name of Object.keys(TRIGGERS)) {
    const event = triggerEvent(name);
    const table = name.includes('_progress_') ? 'OnboardingProgresses'
      : name.includes('_mode_') ? 'OnboardingTrainingModes' : 'OnboardingEvents';
    const normalize = (value) => String(value || '').replace(/`/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!triggers.some((row) => row.TRIGGER_NAME === name
      && row.EVENT_MANIPULATION === event && row.EVENT_OBJECT_TABLE === table
      && normalize(row.ACTION_STATEMENT) === normalize(TRIGGERS[name]))) return false;
  }
  return true;
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
        triggers: Object.keys(TRIGGERS),
      },
      transaction,
    },
  );
  return Number(row.triggerCount) > 0 || Number(row.constraintCount) > 0;
}

async function classify(queryInterface, transaction) {
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
  if (present === total) {
    return (await columnDefinitionsReady(queryInterface, transaction)) &&
      (await featureArtifactsReady(queryInterface, transaction)) ? 'ready' : 'partial';
  }
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

async function addRootColumns(queryInterface, Sequelize, transaction) {
  const integer = { allowNull: true, type: Sequelize.INTEGER };
  await queryInterface.addColumn('OnboardingProgresses', 'organizationId', integer, { transaction });
  await queryInterface.addColumn('OnboardingProgresses', 'membershipId', integer, { transaction });
  await queryInterface.addColumn('OnboardingProgresses', 'clubId', integer, { transaction });
  await queryInterface.addColumn('OnboardingTrainingModes', 'organizationId', integer, { transaction });
  await queryInterface.addColumn('OnboardingTrainingModes', 'membershipId', integer, { transaction });
  await queryInterface.addColumn('OnboardingTrainingModes', 'clubId', integer, { transaction });
  await queryInterface.addColumn('OnboardingTrainingModes', 'sessionId', { allowNull: true, type: Sequelize.UUID }, { transaction });
  await queryInterface.addColumn('OnboardingTrainingModes', 'expiresAt', { allowNull: true, type: Sequelize.DATE }, { transaction });
  await queryInterface.addColumn('OnboardingEvents', 'organizationId', integer, { transaction });
  await queryInterface.addColumn('OnboardingEvents', 'membershipId', integer, { transaction });
  await queryInterface.addColumn('OnboardingEvents', 'clubId', integer, { transaction });
  await queryInterface.addColumn('OnboardingEvents', 'trainingSessionId', { allowNull: true, type: Sequelize.UUID }, { transaction });
  await queryInterface.addColumn('OnboardingEvents', 'idempotencyKey', { allowNull: true, type: Sequelize.STRING(64) }, { transaction });
  for (const table of TRAINING_TABLES) {
    await queryInterface.addColumn(table, 'trainingSessionId', { allowNull: true, type: Sequelize.UUID }, { transaction });
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

async function addConstraints(queryInterface, Sequelize, transaction) {
  for (const table of ['OnboardingProgresses', 'OnboardingTrainingModes', 'OnboardingEvents']) {
    await queryInterface.changeColumn(table, 'organizationId', { allowNull: false, type: Sequelize.INTEGER }, { transaction });
    await queryInterface.changeColumn(table, 'membershipId', { allowNull: false, type: Sequelize.INTEGER }, { transaction });
  }
  await queryInterface.changeColumn('OnboardingTrainingModes', 'clubId', { allowNull: false, type: Sequelize.INTEGER }, { transaction });
  await queryInterface.changeColumn('OnboardingEvents', 'idempotencyKey', { allowNull: false, type: Sequelize.STRING(64) }, { transaction });
  for (const [table, fields, name, unique] of INDEXES) {
    await queryInterface.addIndex(table, fields, { name, transaction, unique });
  }
  for (const table of TRAINING_TABLES) {
    await queryInterface.addIndex(table, ['trainingSessionId'], {
      name: TRAINING_SESSION_INDEX,
      transaction,
    });
  }
  await queryInterface.removeIndex('OnboardingProgresses', 'onboarding_progress_account_role_task_unique', { transaction });
  const [modeIndexes] = await queryInterface.sequelize.query('SHOW INDEX FROM OnboardingTrainingModes', { transaction });
  const uniqueAccountIndex = modeIndexes.find((index) =>
    Number(index.Non_unique) === 0 && index.Column_name === 'accountId' && index.Key_name !== 'PRIMARY');
  if (uniqueAccountIndex) {
    await queryInterface.removeIndex('OnboardingTrainingModes', uniqueAccountIndex.Key_name, { transaction });
  }
  for (const table of ['OnboardingProgresses', 'OnboardingTrainingModes', 'OnboardingEvents']) {
    await queryInterface.addConstraint(table, {
      fields: ['organizationId'],
      name: `${table.toLowerCase()}_organization_fk`,
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      references: { fields: ['id'], table: 'Organizations' },
      transaction,
      type: 'foreign key',
    });
    await queryInterface.addConstraint(table, {
      fields: ['membershipId'],
      name: `${table.toLowerCase()}_membership_fk`,
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      references: { fields: ['id'], table: 'Memberships' },
      transaction,
      type: 'foreign key',
    });
    await queryInterface.addConstraint(table, {
      fields: ['clubId'],
      name: `${table.toLowerCase()}_club_fk`,
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
      references: { fields: ['id'], table: 'Clubs' },
      transaction,
      type: 'foreign key',
    });
  }
  for (const [name, body] of Object.entries(TRIGGERS)) {
    const timing = triggerEvent(name);
    const table = name.includes('_progress_') ? 'OnboardingProgresses'
      : name.includes('_mode_') ? 'OnboardingTrainingModes' : 'OnboardingEvents';
    await queryInterface.sequelize.query(
      `CREATE TRIGGER \`${name}\` BEFORE ${timing} ON \`${table}\` FOR EACH ROW ${body}`,
      { transaction },
    );
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

function cleanupOwnershipError(message) {
  const error = migrationError(message);
  error.code = 'TENANT_ONBOARDING_CLEANUP_OWNERSHIP_LOST';
  error.operatorRepair = true;
  return error;
}

async function assertCleanupOwnership(queryInterface, transaction) {
  for (const [table, fields, name, unique] of INDEXES) {
    const definition = (await indexDefinitions(queryInterface, table, transaction)).get(name);
    if (definition && (definition.unique !== unique || definition.fields.join('|') !== fields.join('|'))) {
      throw cleanupOwnershipError(`Onboarding cleanup index ownership lost: ${table}.${name}`);
    }
  }
  for (const table of TRAINING_TABLES) {
    const definition = (await indexDefinitions(queryInterface, table, transaction)).get(TRAINING_SESSION_INDEX);
    if (definition && (definition.unique || definition.fields.join('|') !== 'trainingSessionId')) {
      throw cleanupOwnershipError(`Onboarding cleanup index ownership lost: ${table}.${TRAINING_SESSION_INDEX}`);
    }
  }
  const [columns] = await queryInterface.sequelize.query(
    `SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,CHARACTER_MAXIMUM_LENGTH
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()`,
    { transaction },
  );
  const expectedColumns = new Map(expectedColumnDefinitions()
    .map((item) => [`${item.table}.${item.column}`, item]));
  for (const row of columns) {
    const expected = expectedColumns.get(`${row.TABLE_NAME}.${row.COLUMN_NAME}`);
    if (!expected) continue;
    if (row.DATA_TYPE !== expected.type ||
      (expected.length !== null && Number(row.CHARACTER_MAXIMUM_LENGTH) !== expected.length)) {
      throw cleanupOwnershipError(
        `Onboarding cleanup column ownership lost: ${row.TABLE_NAME}.${row.COLUMN_NAME}`,
      );
    }
  }
  const expectedConstraints = new Map();
  for (const table of ROOT_TABLES) {
    for (const [suffix, column, referenced] of [
      ['organization', 'organizationId', 'Organizations'],
      ['membership', 'membershipId', 'Memberships'],
      ['club', 'clubId', 'Clubs'],
    ]) {
      expectedConstraints.set(`${table.toLowerCase()}_${suffix}_fk`, { column, referenced, table });
    }
  }
  const [constraints] = await queryInterface.sequelize.query(
    `SELECT TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE CONSTRAINT_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL`,
    { transaction },
  );
  for (const row of constraints) {
    const expected = expectedConstraints.get(row.CONSTRAINT_NAME);
    if (!expected) continue;
    if (row.TABLE_NAME !== expected.table || row.COLUMN_NAME !== expected.column ||
      row.REFERENCED_TABLE_NAME !== expected.referenced) {
      throw cleanupOwnershipError(`Onboarding cleanup FK ownership lost: ${row.CONSTRAINT_NAME}`);
    }
  }
  const [triggers] = await queryInterface.sequelize.query(
    `SELECT TRIGGER_NAME,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_STATEMENT
       FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()`,
    { transaction },
  );
  const normalize = (value) => String(value || '').replace(/`/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const row of triggers) {
    const body = TRIGGERS[row.TRIGGER_NAME];
    if (!body) continue;
    const event = triggerEvent(row.TRIGGER_NAME);
    const table = row.TRIGGER_NAME.includes('_progress_') ? 'OnboardingProgresses'
      : row.TRIGGER_NAME.includes('_mode_') ? 'OnboardingTrainingModes' : 'OnboardingEvents';
    if (row.EVENT_MANIPULATION !== event || row.EVENT_OBJECT_TABLE !== table ||
      normalize(row.ACTION_STATEMENT) !== normalize(body)) {
      throw cleanupOwnershipError(`Onboarding cleanup trigger ownership lost: ${row.TRIGGER_NAME}`);
    }
  }
}

async function cleanupOwnedPartialMigration(queryInterface, transaction) {
  await assertCleanupOwnership(queryInterface, transaction);
  for (const name of Object.keys(TRIGGERS)) {
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS \`${name}\``, { transaction });
  }
  for (const table of ROOT_TABLES) {
    for (const suffix of ['club', 'membership', 'organization']) {
      const constraintName = `${table.toLowerCase()}_${suffix}_fk`;
      await removeConstraintIfPresent(
        queryInterface,
        table,
        constraintName,
        transaction,
      );
      await removeIndexIfPresent(queryInterface, table, constraintName, transaction);
    }
  }
  const progressIndexes = await indexDefinitions(queryInterface, 'OnboardingProgresses', transaction);
  if (!progressIndexes.has('onboarding_progress_account_role_task_unique')) {
    await queryInterface.addIndex('OnboardingProgresses', ['accountId', 'role', 'taskKey'], {
      name: 'onboarding_progress_account_role_task_unique', transaction, unique: true,
    });
  }
  const modeIndexes = await indexDefinitions(queryInterface, 'OnboardingTrainingModes', transaction);
  if (![...modeIndexes.values()].some((definition) => definition.unique
    && definition.fields.join('|') === 'accountId')) {
    await queryInterface.addIndex('OnboardingTrainingModes', ['accountId'], {
      name: 'onboarding_training_modes_account_unique', transaction, unique: true,
    });
  }
  for (const [table, , name] of [...INDEXES].reverse()) {
    await removeIndexIfPresent(queryInterface, table, name, transaction);
  }
  for (const table of TRAINING_TABLES) {
    await removeIndexIfPresent(queryInterface, table, TRAINING_SESSION_INDEX, transaction);
  }
  for (const table of TRAINING_TABLES) {
    const columns = await columnSet(queryInterface, table);
    if (columns.has('trainingSessionId')) {
      await queryInterface.removeColumn(table, 'trainingSessionId', { transaction });
    }
  }
  for (const [table, names] of Object.entries(ROOT_COLUMNS)) {
    const columns = await columnSet(queryInterface, table);
    for (const name of [...names].reverse()) {
      if (columns.has(name)) await queryInterface.removeColumn(table, name, { transaction });
    }
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const state = await classify(queryInterface);
    if (state === 'ready') return;
    if (state !== 'legacy') throw migrationError('Tenant onboarding migration refused partial schema');
    try {
      await queryInterface.sequelize.transaction(async (transaction) => {
        const tenant = await getDefaultTenant(queryInterface, transaction);
        await assertLegacyData(queryInterface, transaction);
        await addRootColumns(queryInterface, Sequelize, transaction);
        maybeForceFailure('after_columns');
        await backfill(queryInterface, tenant, transaction);
        maybeForceFailure('after_backfill');
        await addConstraints(queryInterface, Sequelize, transaction);
        maybeForceFailure('after_constraints');
      });
    } catch (error) {
      try {
        await queryInterface.sequelize.transaction(async (transaction) => {
          await cleanupOwnedPartialMigration(queryInterface, transaction);
        });
      } catch (cleanupError) {
        error.cleanupError = cleanupError;
      }
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const state = await classify(queryInterface);
    if (state === 'legacy') return;
    if (state !== 'ready') throw migrationError('Tenant onboarding rollback refused partial schema');
    await queryInterface.sequelize.transaction(async (transaction) => {
      await getDefaultTenant(queryInterface, transaction);
      for (const name of Object.keys(TRIGGERS)) {
        await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS \`${name}\``, { transaction });
      }
      for (const table of ['OnboardingProgresses', 'OnboardingTrainingModes', 'OnboardingEvents']) {
        for (const suffix of ['club', 'membership', 'organization']) {
          await queryInterface.removeConstraint(table, `${table.toLowerCase()}_${suffix}_fk`, { transaction });
        }
      }
      await queryInterface.addIndex('OnboardingProgresses', ['accountId', 'role', 'taskKey'], {
        name: 'onboarding_progress_account_role_task_unique', transaction, unique: true,
      });
      await queryInterface.addIndex('OnboardingTrainingModes', ['accountId'], {
        name: 'onboarding_training_modes_account_unique', transaction, unique: true,
      });
      for (const [table, , name] of [...INDEXES].reverse()) {
        await queryInterface.removeIndex(table, name, { transaction });
      }
      for (const table of TRAINING_TABLES) {
        await queryInterface.removeIndex(table, TRAINING_SESSION_INDEX, { transaction });
      }
      for (const table of TRAINING_TABLES) {
        await queryInterface.removeColumn(table, 'trainingSessionId', { transaction });
      }
      for (const [table, names] of Object.entries(ROOT_COLUMNS)) {
        for (const name of [...names].reverse()) {
          await queryInterface.removeColumn(table, name, { transaction });
        }
      }
    });
  },
  _private: {
    assertLegacyData,
    classify,
    cleanupOwnedPartialMigration,
    assertCleanupOwnership,
    featureArtifactsReady,
    getDefaultTenant,
  },
};
