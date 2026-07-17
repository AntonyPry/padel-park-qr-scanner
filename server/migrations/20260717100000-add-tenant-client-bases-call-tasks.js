'use strict';

const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../src/tenant-foundation/constants');

const MIGRATION_NAME = '20260717100000-add-tenant-client-bases-call-tasks.js';

const NEW_COLUMNS = Object.freeze({
  ClientSavedViews: ['organizationId', 'clubId', 'membershipId'],
  ClientBases: [
    'organizationId',
    'clubId',
    'originOrganizationId',
    'originClubId',
  ],
  CallTasks: ['organizationId', 'clubId'],
});

const INDEXES = Object.freeze([
  ['ClientSavedViews', 'uq_client_saved_views_tenant_id'],
  ['ClientSavedViews', 'uq_client_saved_views_membership_club_name'],
  ['ClientSavedViews', 'idx_client_saved_views_tenant_membership'],
  ['ClientBases', 'uq_client_bases_tenant_id'],
  ['ClientBases', 'idx_client_bases_tenant_status_updated'],
  ['ClientBases', 'idx_client_bases_tenant_recurring_due'],
  ['ClientBases', 'idx_client_bases_tenant_origin'],
  ['CallTasks', 'uq_call_tasks_tenant_id'],
  ['CallTasks', 'idx_call_tasks_tenant_status_due'],
  ['CallTasks', 'idx_call_tasks_tenant_assignee_status'],
  ['CallTasks', 'idx_call_tasks_tenant_base'],
]);

const CONSTRAINTS = Object.freeze([
  ['ClientSavedViews', 'fk_client_saved_views_org_club'],
  ['ClientSavedViews', 'fk_client_saved_views_membership'],
  ['ClientBases', 'fk_client_bases_org_club'],
  ['ClientBases', 'fk_client_bases_origin_club'],
  ['CallTasks', 'fk_call_tasks_org_club'],
  ['CallTasks', 'fk_call_tasks_client_base_tenant'],
  ['TelephonyCalls', 'fk_telephony_calls_follow_up_task_tenant'],
]);

const TRIGGERS = Object.freeze([
  'trg_client_saved_views_tenant_insert',
  'trg_client_saved_views_tenant_update',
  'trg_client_bases_tenant_insert',
  'trg_client_bases_tenant_update',
  'trg_call_tasks_tenant_insert',
  'trg_call_tasks_tenant_update',
  'trg_call_task_clients_tenant_insert',
  'trg_call_task_clients_tenant_update',
  'trg_call_task_attempts_tenant_insert',
  'trg_call_task_attempts_tenant_update',
]);

function migrationError(message, code = 'TENANT_CLIENT_BASES_MIGRATION_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function forcedFailure(step) {
  if (process.env.TENANT_CLIENT_BASES_CALL_TASKS_MIGRATION_FAIL_STEP === step) {
    throw migrationError(
      `Forced Feature 5.4 migration failure after ${step}`,
      'TENANT_CLIENT_BASES_MIGRATION_FORCED_FAILURE',
    );
  }
}

async function queryRows(queryInterface, sql, replacements = {}) {
  const [rows] = await queryInterface.sequelize.query(sql, { replacements });
  return rows;
}

async function getDefaultTenant(queryInterface) {
  const organizations = await queryRows(
    queryInterface,
    'SELECT id, slug, status FROM Organizations ORDER BY id',
  );
  const clubs = await queryRows(
    queryInterface,
    'SELECT id, organizationId, slug, status FROM Clubs ORDER BY id',
  );
  if (
    organizations.length !== 1 ||
    clubs.length !== 1 ||
    organizations[0].slug !== DEFAULT_ORGANIZATION_SLUG ||
    organizations[0].status !== 'active' ||
    clubs[0].slug !== DEFAULT_CLUB_SLUG ||
    clubs[0].status !== 'active' ||
    Number(clubs[0].organizationId) !== Number(organizations[0].id)
  ) {
    throw migrationError(
      'Feature 5.4 requires the exact active single default Organization and Club',
      'TENANT_SINGLE_DEFAULT_REQUIRED',
    );
  }
  return {
    clubId: Number(clubs[0].id),
    organizationId: Number(organizations[0].id),
  };
}

async function tableColumns(queryInterface, table) {
  return queryInterface.describeTable(table);
}

async function indexNames(queryInterface, table) {
  const indexes = await queryInterface.showIndex(table);
  return new Set(indexes.map((index) => index.name));
}

async function constraintNames(queryInterface) {
  if (queryInterface.sequelize.getDialect() !== 'mysql') return new Set();
  const rows = await queryRows(
    queryInterface,
    `SELECT CONSTRAINT_NAME
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
  );
  return new Set(rows.map((row) => row.CONSTRAINT_NAME || row.constraint_name));
}

async function triggerNames(queryInterface) {
  if (queryInterface.sequelize.getDialect() !== 'mysql') return new Set();
  const rows = await queryRows(
    queryInterface,
    `SELECT TRIGGER_NAME
       FROM INFORMATION_SCHEMA.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()`,
  );
  return new Set(rows.map((row) => row.TRIGGER_NAME || row.trigger_name));
}

async function classifySchema(queryInterface) {
  const descriptions = {};
  const indexesByTable = {};
  for (const table of Object.keys(NEW_COLUMNS)) {
    descriptions[table] = await tableColumns(queryInterface, table);
    indexesByTable[table] = await indexNames(queryInterface, table);
  }
  const constraints = await constraintNames(queryInterface);
  const triggers = await triggerNames(queryInterface);
  const expectedTriggers = queryInterface.sequelize.getDialect() === 'mysql'
    ? TRIGGERS
    : [];

  const columnChecks = Object.entries(NEW_COLUMNS).flatMap(([table, columns]) =>
    columns.map((column) => Boolean(descriptions[table][column])),
  );
  const indexChecks = INDEXES.map(([table, name]) => indexesByTable[table].has(name));
  const constraintChecks = queryInterface.sequelize.getDialect() === 'mysql'
    ? CONSTRAINTS.map(([, name]) => constraints.has(name))
    : [];
  const triggerChecks = expectedTriggers.map((name) => triggers.has(name));
  const checks = [
    ...columnChecks,
    ...indexChecks,
    ...constraintChecks,
    ...triggerChecks,
  ];
  if (checks.every(Boolean)) return 'ready';
  if (checks.every((value) => !value)) return 'legacy';
  return 'partial';
}

async function preflightLegacyGraph(queryInterface, tenant) {
  const checks = await Promise.all([
    queryRows(
      queryInterface,
      `SELECT COUNT(*) AS count
         FROM ClientSavedViews saved
         LEFT JOIN Memberships membership
           ON membership.accountId = saved.accountId
          AND membership.organizationId = :organizationId
        WHERE membership.id IS NULL`,
      tenant,
    ),
    queryRows(
      queryInterface,
      `SELECT COUNT(*) AS count
         FROM CallTasks task
         LEFT JOIN ClientBases base ON base.id = task.clientBaseId
        WHERE task.clientBaseId IS NOT NULL AND base.id IS NULL`,
    ),
    queryRows(
      queryInterface,
      `SELECT COUNT(*) AS count
         FROM CallTaskClients item
         JOIN Users client ON client.id = item.userId
        WHERE item.userId IS NOT NULL
          AND client.organizationId <> :organizationId`,
      tenant,
    ),
    queryRows(
      queryInterface,
      `SELECT COUNT(*) AS count
         FROM TelephonyCalls callRow
         LEFT JOIN CallTasks task ON task.id = callRow.followUpCallTaskId
        WHERE callRow.followUpCallTaskId IS NOT NULL AND task.id IS NULL`,
    ),
  ]);
  const labels = [
    'saved view without default Membership',
    'call task without client base',
    'call task client outside default Organization',
    'telephony follow-up link without call task',
  ];
  checks.forEach((rows, index) => {
    if (Number(rows[0]?.count || 0) > 0) {
      throw migrationError(`Feature 5.4 preflight failed: ${labels[index]}`);
    }
  });
}

async function validateBackfill(queryInterface) {
  const rows = await queryRows(
    queryInterface,
    `SELECT
       (SELECT COUNT(*) FROM ClientSavedViews
         WHERE organizationId IS NULL OR clubId IS NULL OR membershipId IS NULL) AS savedNulls,
       (SELECT COUNT(*) FROM ClientBases
         WHERE organizationId IS NULL OR clubId IS NULL) AS baseNulls,
       (SELECT COUNT(*) FROM CallTasks
         WHERE organizationId IS NULL OR clubId IS NULL) AS taskNulls,
       (SELECT COUNT(*)
          FROM ClientSavedViews saved
          JOIN Memberships membership ON membership.id = saved.membershipId
         WHERE saved.organizationId <> membership.organizationId
            OR saved.accountId <> membership.accountId
            OR membership.status <> 'active'
            OR (membership.role <> 'owner' AND NOT EXISTS (
              SELECT 1 FROM MembershipClubAccesses accessRow
               WHERE accessRow.membershipId = membership.id
                 AND accessRow.organizationId = saved.organizationId
                 AND accessRow.clubId = saved.clubId
                 AND accessRow.status = 'active'
            ))) AS savedMismatch,
       (SELECT COUNT(*)
          FROM CallTasks task
          JOIN ClientBases base ON base.id = task.clientBaseId
         WHERE task.clientBaseId IS NOT NULL
           AND (task.organizationId <> base.organizationId OR task.clubId <> base.clubId)) AS baseMismatch,
       (SELECT COUNT(*)
          FROM CallTaskClients item
          JOIN CallTasks task ON task.id = item.callTaskId
          JOIN Users client ON client.id = item.userId
         WHERE item.userId IS NOT NULL AND client.organizationId <> task.organizationId) AS clientMismatch,
       (SELECT COUNT(*)
          FROM ClientBases base
         WHERE (base.createdByAccountId IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM Accounts accountRow
                  JOIN Memberships membership
                    ON membership.accountId = accountRow.id
                   AND membership.organizationId = base.organizationId
                   AND membership.status = 'active'
                  LEFT JOIN MembershipClubAccesses accessRow
                    ON accessRow.membershipId = membership.id
                   AND accessRow.organizationId = base.organizationId
                   AND accessRow.clubId = base.clubId
                   AND accessRow.status = 'active'
                 WHERE accountRow.id = base.createdByAccountId
                   AND accountRow.status = 'active'
                   AND (membership.role = 'owner' OR accessRow.membershipId IS NOT NULL)
                   AND COALESCE(accessRow.roleOverride, membership.role) IN ('owner', 'manager', 'admin')
               ))
            OR (base.recurringAssignedToAccountId IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM Accounts accountRow
                  JOIN Memberships membership
                    ON membership.accountId = accountRow.id
                   AND membership.organizationId = base.organizationId
                   AND membership.status = 'active'
                  LEFT JOIN MembershipClubAccesses accessRow
                    ON accessRow.membershipId = membership.id
                   AND accessRow.organizationId = base.organizationId
                   AND accessRow.clubId = base.clubId
                   AND accessRow.status = 'active'
                 WHERE accountRow.id = base.recurringAssignedToAccountId
                   AND accountRow.status = 'active'
                   AND (membership.role = 'owner' OR accessRow.membershipId IS NOT NULL)
                   AND COALESCE(accessRow.roleOverride, membership.role) IN ('owner', 'manager', 'admin')
               ))) AS baseActorMismatch,
       (SELECT COUNT(*)
          FROM CallTasks task
         WHERE (task.createdByAccountId IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM Accounts accountRow
                  JOIN Memberships membership
                    ON membership.accountId = accountRow.id
                   AND membership.organizationId = task.organizationId
                   AND membership.status = 'active'
                  LEFT JOIN MembershipClubAccesses accessRow
                    ON accessRow.membershipId = membership.id
                   AND accessRow.organizationId = task.organizationId
                   AND accessRow.clubId = task.clubId
                   AND accessRow.status = 'active'
                 WHERE accountRow.id = task.createdByAccountId
                   AND accountRow.status = 'active'
                   AND (membership.role = 'owner' OR accessRow.membershipId IS NOT NULL)
                   AND COALESCE(accessRow.roleOverride, membership.role) IN ('owner', 'manager', 'admin')
               ))
            OR (task.assignedToAccountId IS NOT NULL AND NOT EXISTS (
                  SELECT 1 FROM Accounts accountRow
                  JOIN Memberships membership
                    ON membership.accountId = accountRow.id
                   AND membership.organizationId = task.organizationId
                   AND membership.status = 'active'
                  LEFT JOIN MembershipClubAccesses accessRow
                    ON accessRow.membershipId = membership.id
                   AND accessRow.organizationId = task.organizationId
                   AND accessRow.clubId = task.clubId
                   AND accessRow.status = 'active'
                 WHERE accountRow.id = task.assignedToAccountId
                   AND accountRow.status = 'active'
                   AND (membership.role = 'owner' OR accessRow.membershipId IS NOT NULL)
                   AND COALESCE(accessRow.roleOverride, membership.role) IN ('owner', 'manager', 'admin')
               ))) AS taskActorMismatch,
       (SELECT COUNT(*)
          FROM CallTaskAttempts attemptRow
          JOIN CallTaskClients item ON item.id = attemptRow.callTaskClientId
          JOIN CallTasks task ON task.id = item.callTaskId
         WHERE attemptRow.actorAccountId IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM Accounts accountRow
           JOIN Memberships membership
             ON membership.accountId = accountRow.id
            AND membership.organizationId = task.organizationId
            AND membership.status = 'active'
           LEFT JOIN MembershipClubAccesses accessRow
             ON accessRow.membershipId = membership.id
            AND accessRow.organizationId = task.organizationId
            AND accessRow.clubId = task.clubId
            AND accessRow.status = 'active'
          WHERE accountRow.id = attemptRow.actorAccountId
            AND accountRow.status = 'active'
            AND (membership.role = 'owner' OR accessRow.membershipId IS NOT NULL)
            AND COALESCE(accessRow.roleOverride, membership.role) IN ('owner', 'manager', 'admin')
         )) AS attemptActorMismatch,
       (SELECT COUNT(*)
          FROM TelephonyCalls callRow
          JOIN CallTasks task ON task.id = callRow.followUpCallTaskId
         WHERE callRow.followUpCallTaskId IS NOT NULL
           AND (callRow.organizationId IS NULL OR callRow.clubId IS NULL OR
                callRow.organizationId <> task.organizationId OR callRow.clubId <> task.clubId)) AS telephonyMismatch,
       (SELECT COUNT(*)
          FROM ClientBases base
         WHERE (base.origin = 'visits_analytics' AND (
                  base.originOrganizationId IS NULL OR base.originClubId IS NULL OR
                  base.originOrganizationId <> base.organizationId OR
                  base.originClubId <> base.clubId))
            OR (COALESCE(base.origin, '') <> 'visits_analytics' AND (
                  base.originOrganizationId IS NOT NULL OR base.originClubId IS NOT NULL))) AS originMismatch`,
  );
  const result = rows[0] || {};
  for (const [key, value] of Object.entries(result)) {
    if (Number(value || 0) > 0) {
      throw migrationError(`Feature 5.4 backfill validation failed: ${key}`);
    }
  }
}

async function foreignKeysForColumn(queryInterface, table, column) {
  if (queryInterface.sequelize.getDialect() !== 'mysql') return [];
  return queryRows(
    queryInterface,
    `SELECT CONSTRAINT_NAME
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = :table
        AND COLUMN_NAME = :column
        AND REFERENCED_TABLE_NAME IS NOT NULL`,
    { column, table },
  );
}

async function dropForeignKeysForColumn(queryInterface, table, column) {
  const rows = await foreignKeysForColumn(queryInterface, table, column);
  for (const row of rows) {
    const name = row.CONSTRAINT_NAME || row.constraint_name;
    if (name) await queryInterface.removeConstraint(table, name);
  }
  return rows.length > 0;
}

async function addIndexes(queryInterface) {
  await queryInterface.addIndex(
    'ClientSavedViews',
    ['organizationId', 'clubId', 'id'],
    { name: 'uq_client_saved_views_tenant_id', unique: true },
  );
  await queryInterface.addIndex(
    'ClientSavedViews',
    ['membershipId', 'clubId', 'name'],
    { name: 'uq_client_saved_views_membership_club_name', unique: true },
  );
  await queryInterface.addIndex(
    'ClientSavedViews',
    ['organizationId', 'clubId', 'membershipId', 'updatedAt'],
    { name: 'idx_client_saved_views_tenant_membership' },
  );
  await queryInterface.addIndex(
    'ClientBases',
    ['organizationId', 'clubId', 'id'],
    { name: 'uq_client_bases_tenant_id', unique: true },
  );
  await queryInterface.addIndex(
    'ClientBases',
    ['organizationId', 'clubId', 'status', 'updatedAt'],
    { name: 'idx_client_bases_tenant_status_updated' },
  );
  await queryInterface.addIndex(
    'ClientBases',
    ['organizationId', 'clubId', 'recurringEnabled', 'recurringNextRunAt'],
    { name: 'idx_client_bases_tenant_recurring_due' },
  );
  await queryInterface.addIndex(
    'ClientBases',
    ['organizationId', 'clubId', 'origin'],
    { name: 'idx_client_bases_tenant_origin' },
  );
  await queryInterface.addIndex(
    'CallTasks',
    ['organizationId', 'clubId', 'id'],
    { name: 'uq_call_tasks_tenant_id', unique: true },
  );
  await queryInterface.addIndex(
    'CallTasks',
    ['organizationId', 'clubId', 'status', 'dueAt'],
    { name: 'idx_call_tasks_tenant_status_due' },
  );
  await queryInterface.addIndex(
    'CallTasks',
    ['organizationId', 'clubId', 'assignedToAccountId', 'status'],
    { name: 'idx_call_tasks_tenant_assignee_status' },
  );
  await queryInterface.addIndex(
    'CallTasks',
    ['organizationId', 'clubId', 'clientBaseId'],
    { name: 'idx_call_tasks_tenant_base' },
  );
}

async function addConstraints(queryInterface) {
  await queryInterface.addConstraint('ClientSavedViews', {
    fields: ['organizationId', 'clubId'],
    name: 'fk_client_saved_views_org_club',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    references: { table: 'Clubs', fields: ['organizationId', 'id'] },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('ClientSavedViews', {
    fields: ['organizationId', 'membershipId'],
    name: 'fk_client_saved_views_membership',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    references: { table: 'Memberships', fields: ['organizationId', 'id'] },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('ClientBases', {
    fields: ['organizationId', 'clubId'],
    name: 'fk_client_bases_org_club',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    references: { table: 'Clubs', fields: ['organizationId', 'id'] },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('ClientBases', {
    fields: ['originOrganizationId', 'originClubId'],
    name: 'fk_client_bases_origin_club',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    references: { table: 'Clubs', fields: ['organizationId', 'id'] },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('CallTasks', {
    fields: ['organizationId', 'clubId'],
    name: 'fk_call_tasks_org_club',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    references: { table: 'Clubs', fields: ['organizationId', 'id'] },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('CallTasks', {
    fields: ['organizationId', 'clubId', 'clientBaseId'],
    name: 'fk_call_tasks_client_base_tenant',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    references: {
      table: 'ClientBases',
      fields: ['organizationId', 'clubId', 'id'],
    },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('TelephonyCalls', {
    fields: ['organizationId', 'clubId', 'followUpCallTaskId'],
    name: 'fk_telephony_calls_follow_up_task_tenant',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    references: {
      table: 'CallTasks',
      fields: ['organizationId', 'clubId', 'id'],
    },
    type: 'foreign key',
  });
}

function tenantAccountPredicate(prefix, accountExpression, roles = null) {
  const rolePredicate = roles
    ? `AND COALESCE(accessRow.roleOverride, membership.role) IN (${roles.map((role) => `'${role}'`).join(', ')})`
    : '';
  return `EXISTS (
    SELECT 1
      FROM Accounts accountRow
      JOIN Memberships membership
        ON membership.accountId = accountRow.id
       AND membership.organizationId = NEW.organizationId
       AND membership.status = 'active'
      LEFT JOIN MembershipClubAccesses accessRow
        ON accessRow.membershipId = membership.id
       AND accessRow.organizationId = membership.organizationId
       AND accessRow.clubId = NEW.clubId
       AND accessRow.status = 'active'
     WHERE accountRow.id = ${accountExpression}
       AND accountRow.status = 'active'
       AND (accountRow.staffId IS NULL OR membership.staffId IS NULL OR
            accountRow.staffId = membership.staffId)
       AND (membership.staffId IS NULL OR EXISTS (
         SELECT 1 FROM Staffs staffRow
          WHERE staffRow.id = membership.staffId
            AND staffRow.organizationId = NEW.organizationId
            AND staffRow.status = 'active'
       ))
       AND (membership.role = 'owner' OR accessRow.membershipId IS NOT NULL)
       ${rolePredicate}
  )`;
}

async function createTriggers(queryInterface) {
  if (queryInterface.sequelize.getDialect() !== 'mysql') return;
  const signal = (message) => `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${message}'`;
  const workerRoles = ['owner', 'manager', 'admin'];
  const sameTenantAccount = tenantAccountPredicate('', 'NEW.accountId');
  const recurringAssignee = tenantAccountPredicate(
    '',
    'NEW.recurringAssignedToAccountId',
    workerRoles,
  );
  const taskAssignee = tenantAccountPredicate('', 'NEW.assignedToAccountId', workerRoles);
  const taskCreator = tenantAccountPredicate('', 'NEW.createdByAccountId', workerRoles);
  const baseCreator = tenantAccountPredicate('', 'NEW.createdByAccountId', workerRoles);
  const baseTrainingAccount = tenantAccountPredicate('', 'NEW.trainingAccountId');
  const taskTrainingAccount = tenantAccountPredicate('', 'NEW.trainingAccountId');

  const statements = [
    `CREATE TRIGGER trg_client_saved_views_tenant_insert
      BEFORE INSERT ON ClientSavedViews FOR EACH ROW
      BEGIN
        IF NOT ${sameTenantAccount} OR NOT EXISTS (
          SELECT 1 FROM Memberships membership
           WHERE membership.id = NEW.membershipId
             AND membership.organizationId = NEW.organizationId
             AND membership.accountId = NEW.accountId
        ) THEN ${signal('Client saved view tenant graph mismatch')}; END IF;
      END`,
    `CREATE TRIGGER trg_client_saved_views_tenant_update
      BEFORE UPDATE ON ClientSavedViews FOR EACH ROW
      BEGIN
        IF OLD.organizationId <> NEW.organizationId OR OLD.clubId <> NEW.clubId
           OR OLD.membershipId <> NEW.membershipId OR OLD.accountId <> NEW.accountId
        THEN ${signal('Client saved view tenant attribution is immutable')}; END IF;
      END`,
    `CREATE TRIGGER trg_client_bases_tenant_insert
      BEFORE INSERT ON ClientBases FOR EACH ROW
      BEGIN
        IF NEW.createdByAccountId IS NOT NULL AND NOT ${baseCreator}
        THEN ${signal('Client base creator tenant mismatch')}; END IF;
        IF NEW.recurringAssignedToAccountId IS NOT NULL AND NOT ${recurringAssignee}
        THEN ${signal('Client base recurring assignee tenant mismatch')}; END IF;
        IF NEW.trainingAccountId IS NOT NULL AND NOT ${baseTrainingAccount}
        THEN ${signal('Client base training account tenant mismatch')}; END IF;
        IF NEW.origin = 'visits_analytics' AND (
          NEW.originOrganizationId IS NULL OR NEW.originClubId IS NULL OR
          NEW.originOrganizationId <> NEW.organizationId OR NEW.originClubId <> NEW.clubId OR
          NEW.originMetadata IS NULL OR JSON_EXTRACT(NEW.filters, '$.visitsAnalytics') IS NULL
        ) THEN ${signal('Analytics client base provenance mismatch')}; END IF;
        IF COALESCE(NEW.origin, '') <> 'visits_analytics' AND
          (NEW.originOrganizationId IS NOT NULL OR NEW.originClubId IS NOT NULL)
        THEN ${signal('Generic client base cannot own analytics source tenant')}; END IF;
      END`,
    `CREATE TRIGGER trg_client_bases_tenant_update
      BEFORE UPDATE ON ClientBases FOR EACH ROW
      BEGIN
        IF OLD.organizationId <> NEW.organizationId OR OLD.clubId <> NEW.clubId
           OR NOT (OLD.createdByAccountId <=> NEW.createdByAccountId)
        THEN ${signal('Client base tenant attribution is immutable')}; END IF;
        IF NOT (OLD.origin <=> NEW.origin) OR
           NOT (OLD.originMetadata <=> NEW.originMetadata) OR
           NOT (OLD.originOrganizationId <=> NEW.originOrganizationId) OR
           NOT (OLD.originClubId <=> NEW.originClubId)
        THEN ${signal('Client base provenance is immutable')}; END IF;
        IF OLD.origin = 'visits_analytics' AND NOT (OLD.filters <=> NEW.filters)
        THEN ${signal('Analytics client base filters are immutable')}; END IF;
        IF NEW.recurringAssignedToAccountId IS NOT NULL AND
           NOT (OLD.recurringAssignedToAccountId <=> NEW.recurringAssignedToAccountId) AND
           NOT ${recurringAssignee}
        THEN ${signal('Client base recurring assignee tenant mismatch')}; END IF;
        IF NEW.trainingAccountId IS NOT NULL AND
           NOT (OLD.trainingAccountId <=> NEW.trainingAccountId) AND
           NOT ${baseTrainingAccount}
        THEN ${signal('Client base training account tenant mismatch')}; END IF;
      END`,
    `CREATE TRIGGER trg_call_tasks_tenant_insert
      BEFORE INSERT ON CallTasks FOR EACH ROW
      BEGIN
        IF NEW.assignedToAccountId IS NOT NULL AND NOT ${taskAssignee}
        THEN ${signal('Call task assignee tenant mismatch')}; END IF;
        IF NEW.createdByAccountId IS NOT NULL AND NOT ${taskCreator}
        THEN ${signal('Call task creator tenant mismatch')}; END IF;
        IF NEW.trainingAccountId IS NOT NULL AND NOT ${taskTrainingAccount}
        THEN ${signal('Call task training account tenant mismatch')}; END IF;
      END`,
    `CREATE TRIGGER trg_call_tasks_tenant_update
      BEFORE UPDATE ON CallTasks FOR EACH ROW
      BEGIN
        IF OLD.organizationId <> NEW.organizationId OR OLD.clubId <> NEW.clubId
           OR NOT (OLD.clientBaseId <=> NEW.clientBaseId)
           OR NOT (OLD.createdByAccountId <=> NEW.createdByAccountId)
        THEN ${signal('Call task tenant attribution is immutable')}; END IF;
        IF NEW.assignedToAccountId IS NOT NULL AND
           NOT (OLD.assignedToAccountId <=> NEW.assignedToAccountId) AND
           NOT ${taskAssignee}
        THEN ${signal('Call task assignee tenant mismatch')}; END IF;
        IF NEW.trainingAccountId IS NOT NULL AND
           NOT (OLD.trainingAccountId <=> NEW.trainingAccountId) AND
           NOT ${taskTrainingAccount}
        THEN ${signal('Call task training account tenant mismatch')}; END IF;
      END`,
    `CREATE TRIGGER trg_call_task_clients_tenant_insert
      BEFORE INSERT ON CallTaskClients FOR EACH ROW
      BEGIN
        IF NEW.userId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM CallTasks task JOIN Users client ON client.id = NEW.userId
           WHERE task.id = NEW.callTaskId AND client.organizationId = task.organizationId
        ) THEN ${signal('Call task client organization mismatch')}; END IF;
        IF NEW.trainingAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM CallTasks task
          JOIN Memberships membership
            ON membership.accountId = NEW.trainingAccountId
           AND membership.organizationId = task.organizationId
           AND membership.status = 'active'
          LEFT JOIN MembershipClubAccesses accessRow
            ON accessRow.membershipId = membership.id
           AND accessRow.organizationId = task.organizationId
           AND accessRow.clubId = task.clubId
           AND accessRow.status = 'active'
          WHERE task.id = NEW.callTaskId
            AND (membership.role = 'owner' OR accessRow.membershipId IS NOT NULL)
        ) THEN ${signal('Call task client training account mismatch')}; END IF;
      END`,
    `CREATE TRIGGER trg_call_task_clients_tenant_update
      BEFORE UPDATE ON CallTaskClients FOR EACH ROW
      BEGIN
        IF OLD.callTaskId <> NEW.callTaskId
        THEN ${signal('Call task client parent is immutable')}; END IF;
        IF NEW.userId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM CallTasks task JOIN Users client ON client.id = NEW.userId
           WHERE task.id = NEW.callTaskId AND client.organizationId = task.organizationId
        ) THEN ${signal('Call task client organization mismatch')}; END IF;
        IF NEW.trainingAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM CallTasks task
          JOIN Memberships membership
            ON membership.accountId = NEW.trainingAccountId
           AND membership.organizationId = task.organizationId
           AND membership.status = 'active'
          LEFT JOIN MembershipClubAccesses accessRow
            ON accessRow.membershipId = membership.id
           AND accessRow.organizationId = task.organizationId
           AND accessRow.clubId = task.clubId
           AND accessRow.status = 'active'
          WHERE task.id = NEW.callTaskId
            AND (membership.role = 'owner' OR accessRow.membershipId IS NOT NULL)
        ) THEN ${signal('Call task client training account mismatch')}; END IF;
      END`,
    `CREATE TRIGGER trg_call_task_attempts_tenant_insert
      BEFORE INSERT ON CallTaskAttempts FOR EACH ROW
      BEGIN
        IF NEW.actorAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1
            FROM CallTaskClients item
            JOIN CallTasks task ON task.id = item.callTaskId
            JOIN Accounts accountRow
              ON accountRow.id = NEW.actorAccountId
             AND accountRow.status = 'active'
            JOIN Memberships membership
              ON membership.accountId = NEW.actorAccountId
             AND membership.organizationId = task.organizationId
             AND membership.status = 'active'
            LEFT JOIN MembershipClubAccesses accessRow
              ON accessRow.membershipId = membership.id
             AND accessRow.organizationId = task.organizationId
             AND accessRow.clubId = task.clubId
             AND accessRow.status = 'active'
           WHERE item.id = NEW.callTaskClientId
             AND (membership.role = 'owner' OR accessRow.membershipId IS NOT NULL)
             AND COALESCE(accessRow.roleOverride, membership.role) IN ('owner', 'manager', 'admin')
             AND (accountRow.staffId IS NULL OR membership.staffId IS NULL OR
                  accountRow.staffId = membership.staffId)
             AND (membership.staffId IS NULL OR EXISTS (
               SELECT 1 FROM Staffs staffRow
                WHERE staffRow.id = membership.staffId
                  AND staffRow.organizationId = task.organizationId
                  AND staffRow.status = 'active'
             ))
        ) THEN ${signal('Call task attempt actor tenant mismatch')}; END IF;
        IF NEW.trainingAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM CallTaskClients item
          JOIN CallTasks task ON task.id = item.callTaskId
          JOIN Memberships membership
            ON membership.accountId = NEW.trainingAccountId
           AND membership.organizationId = task.organizationId
           AND membership.status = 'active'
          LEFT JOIN MembershipClubAccesses accessRow
            ON accessRow.membershipId = membership.id
           AND accessRow.organizationId = task.organizationId
           AND accessRow.clubId = task.clubId
           AND accessRow.status = 'active'
          WHERE item.id = NEW.callTaskClientId
            AND (membership.role = 'owner' OR accessRow.membershipId IS NOT NULL)
        ) THEN ${signal('Call task attempt training account mismatch')}; END IF;
      END`,
    `CREATE TRIGGER trg_call_task_attempts_tenant_update
      BEFORE UPDATE ON CallTaskAttempts FOR EACH ROW
      BEGIN
        IF NOT EXISTS (
          SELECT 1
            FROM CallTaskClients oldItem
            JOIN CallTaskClients newItem ON newItem.id = NEW.callTaskClientId
           WHERE oldItem.id = OLD.callTaskClientId
             AND oldItem.callTaskId = newItem.callTaskId
        ) THEN ${signal('Call task attempt parent task is immutable')}; END IF;
        IF NOT (OLD.actorAccountId <=> NEW.actorAccountId) OR
           OLD.status <> NEW.status OR
           NOT (OLD.summary <=> NEW.summary) OR
           NOT (OLD.deadlineAt <=> NEW.deadlineAt) OR
           OLD.isTraining <> NEW.isTraining OR
           NOT (OLD.trainingAccountId <=> NEW.trainingAccountId) OR
           NOT (OLD.trainingRole <=> NEW.trainingRole) OR
           OLD.createdAt <> NEW.createdAt
        THEN ${signal('Call task attempt history is immutable')}; END IF;
        IF NEW.actorAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1
            FROM CallTaskClients item
            JOIN CallTasks task ON task.id = item.callTaskId
            JOIN Accounts accountRow
              ON accountRow.id = NEW.actorAccountId
             AND accountRow.status = 'active'
            JOIN Memberships membership
              ON membership.accountId = NEW.actorAccountId
             AND membership.organizationId = task.organizationId
             AND membership.status = 'active'
            LEFT JOIN MembershipClubAccesses accessRow
              ON accessRow.membershipId = membership.id
             AND accessRow.organizationId = task.organizationId
             AND accessRow.clubId = task.clubId
             AND accessRow.status = 'active'
           WHERE item.id = NEW.callTaskClientId
             AND (membership.role = 'owner' OR accessRow.membershipId IS NOT NULL)
             AND COALESCE(accessRow.roleOverride, membership.role) IN ('owner', 'manager', 'admin')
             AND (accountRow.staffId IS NULL OR membership.staffId IS NULL OR
                  accountRow.staffId = membership.staffId)
             AND (membership.staffId IS NULL OR EXISTS (
               SELECT 1 FROM Staffs staffRow
                WHERE staffRow.id = membership.staffId
                  AND staffRow.organizationId = task.organizationId
                  AND staffRow.status = 'active'
             ))
        ) THEN ${signal('Call task attempt tenant mismatch')}; END IF;
        IF NEW.trainingAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM CallTaskClients item
          JOIN CallTasks task ON task.id = item.callTaskId
          JOIN Memberships membership
            ON membership.accountId = NEW.trainingAccountId
           AND membership.organizationId = task.organizationId
           AND membership.status = 'active'
          LEFT JOIN MembershipClubAccesses accessRow
            ON accessRow.membershipId = membership.id
           AND accessRow.organizationId = task.organizationId
           AND accessRow.clubId = task.clubId
           AND accessRow.status = 'active'
          WHERE item.id = NEW.callTaskClientId
            AND (membership.role = 'owner' OR accessRow.membershipId IS NOT NULL)
        ) THEN ${signal('Call task attempt training account mismatch')}; END IF;
      END`,
  ];
  for (const statement of statements) {
    await queryInterface.sequelize.query(statement);
  }
}

async function removeNamedArtifacts(queryInterface) {
  if (queryInterface.sequelize.getDialect() === 'mysql') {
    for (const trigger of [...TRIGGERS].reverse()) {
      await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS \`${trigger}\``);
    }
  }
  const existingConstraints = await constraintNames(queryInterface);
  for (const [table, name] of [...CONSTRAINTS].reverse()) {
    if (existingConstraints.has(name)) await queryInterface.removeConstraint(table, name);
  }
  for (const [table, name] of [...INDEXES].reverse()) {
    const names = await indexNames(queryInterface, table);
    if (names.has(name)) await queryInterface.removeIndex(table, name);
  }
}

async function ensureLegacyIndexesAndForeignKeys(queryInterface) {
  const savedIndexes = await indexNames(queryInterface, 'ClientSavedViews');
  if (!savedIndexes.has('client_saved_views_account_name_unique')) {
    await queryInterface.addIndex('ClientSavedViews', ['accountId', 'name'], {
      name: 'client_saved_views_account_name_unique',
      unique: true,
    });
  }
  if ((await foreignKeysForColumn(queryInterface, 'CallTasks', 'clientBaseId')).length === 0) {
    await queryInterface.addConstraint('CallTasks', {
      fields: ['clientBaseId'],
      name: 'fk_call_tasks_client_base_legacy',
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
      references: { table: 'ClientBases', field: 'id' },
      type: 'foreign key',
    });
  }
  if ((await foreignKeysForColumn(queryInterface, 'TelephonyCalls', 'followUpCallTaskId')).length === 0) {
    await queryInterface.addConstraint('TelephonyCalls', {
      fields: ['followUpCallTaskId'],
      name: 'fk_telephony_calls_follow_up_task_legacy',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      references: { table: 'CallTasks', field: 'id' },
      type: 'foreign key',
    });
  }
}

async function dropNewColumns(queryInterface) {
  for (const [table, columns] of Object.entries(NEW_COLUMNS).reverse()) {
    const description = await tableColumns(queryInterface, table);
    for (const column of [...columns].reverse()) {
      if (description[column]) await queryInterface.removeColumn(table, column);
    }
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const state = await classifySchema(queryInterface);
    if (state === 'ready') return;
    if (state === 'partial') {
      throw migrationError(
        'Feature 5.4 found a pre-existing partial schema; operator recovery is required',
        'TENANT_CLIENT_BASES_PARTIAL_SCHEMA',
      );
    }

    const tenant = await getDefaultTenant(queryInterface);
    await preflightLegacyGraph(queryInterface, tenant);
    let touchedLegacyForeignKeys = false;
    let droppedLegacySavedUnique = false;
    try {
      await queryInterface.addColumn('ClientSavedViews', 'organizationId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await queryInterface.addColumn('ClientSavedViews', 'clubId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await queryInterface.addColumn('ClientSavedViews', 'membershipId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await queryInterface.addColumn('ClientBases', 'organizationId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await queryInterface.addColumn('ClientBases', 'clubId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await queryInterface.addColumn('ClientBases', 'originOrganizationId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await queryInterface.addColumn('ClientBases', 'originClubId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await queryInterface.addColumn('CallTasks', 'organizationId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await queryInterface.addColumn('CallTasks', 'clubId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      forcedFailure('columns');

      await queryInterface.sequelize.query(
        `UPDATE ClientSavedViews saved
          JOIN Memberships membership
            ON membership.accountId = saved.accountId
           AND membership.organizationId = :organizationId
           SET saved.organizationId = :organizationId,
               saved.clubId = :clubId,
               saved.membershipId = membership.id`,
        { replacements: tenant },
      );
      await queryInterface.sequelize.query(
        `UPDATE ClientBases
            SET organizationId = :organizationId,
                clubId = :clubId,
                originOrganizationId = CASE WHEN origin = 'visits_analytics' THEN :organizationId ELSE NULL END,
                originClubId = CASE WHEN origin = 'visits_analytics' THEN :clubId ELSE NULL END`,
        { replacements: tenant },
      );
      await queryInterface.sequelize.query(
        `UPDATE CallTasks
            SET organizationId = :organizationId,
                clubId = :clubId`,
        { replacements: tenant },
      );
      await validateBackfill(queryInterface);
      forcedFailure('backfill');

      await queryInterface.changeColumn('ClientSavedViews', 'organizationId', {
        allowNull: false,
        type: Sequelize.INTEGER,
      });
      await queryInterface.changeColumn('ClientSavedViews', 'clubId', {
        allowNull: false,
        type: Sequelize.INTEGER,
      });
      await queryInterface.changeColumn('ClientSavedViews', 'membershipId', {
        allowNull: false,
        type: Sequelize.INTEGER,
      });
      await queryInterface.changeColumn('ClientBases', 'organizationId', {
        allowNull: false,
        type: Sequelize.INTEGER,
      });
      await queryInterface.changeColumn('ClientBases', 'clubId', {
        allowNull: false,
        type: Sequelize.INTEGER,
      });
      await queryInterface.changeColumn('CallTasks', 'organizationId', {
        allowNull: false,
        type: Sequelize.INTEGER,
      });
      await queryInterface.changeColumn('CallTasks', 'clubId', {
        allowNull: false,
        type: Sequelize.INTEGER,
      });

      const savedIndexes = await indexNames(queryInterface, 'ClientSavedViews');
      if (savedIndexes.has('client_saved_views_account_name_unique')) {
        await queryInterface.removeIndex(
          'ClientSavedViews',
          'client_saved_views_account_name_unique',
        );
        droppedLegacySavedUnique = true;
      }
      touchedLegacyForeignKeys = (
        await dropForeignKeysForColumn(queryInterface, 'CallTasks', 'clientBaseId')
      ) || touchedLegacyForeignKeys;
      touchedLegacyForeignKeys = (
        await dropForeignKeysForColumn(
          queryInterface,
          'TelephonyCalls',
          'followUpCallTaskId',
        )
      ) || touchedLegacyForeignKeys;

      await addIndexes(queryInterface);
      forcedFailure('indexes');
      await addConstraints(queryInterface);
      forcedFailure('constraints');
      await createTriggers(queryInterface);
      forcedFailure('triggers');
      await validateBackfill(queryInterface);
    } catch (error) {
      await removeNamedArtifacts(queryInterface);
      if (touchedLegacyForeignKeys || droppedLegacySavedUnique) {
        await ensureLegacyIndexesAndForeignKeys(queryInterface);
      }
      await dropNewColumns(queryInterface);
      throw error;
    }
  },

  async down(queryInterface) {
    const state = await classifySchema(queryInterface);
    if (state === 'legacy') return;
    if (state !== 'ready') {
      throw migrationError(
        'Feature 5.4 rollback refuses a partial schema',
        'TENANT_CLIENT_BASES_PARTIAL_SCHEMA',
      );
    }
    const tenant = await getDefaultTenant(queryInterface);
    await validateBackfill(queryInterface);
    const later = await queryRows(
      queryInterface,
      'SELECT name FROM SequelizeMeta WHERE name > :name ORDER BY name',
      { name: MIGRATION_NAME },
    );
    if (later.length > 0) {
      throw migrationError('Feature 5.4 rollback refuses later migrations');
    }
    const foreignRows = queryInterface.sequelize.getDialect() === 'mysql'
      ? await queryRows(
        queryInterface,
        `SELECT TABLE_NAME, CONSTRAINT_NAME
           FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE()
            AND REFERENCED_TABLE_NAME IN ('ClientSavedViews', 'ClientBases', 'CallTasks')
            AND CONSTRAINT_NAME NOT IN (
              'fk_call_tasks_client_base_tenant',
              'fk_telephony_calls_follow_up_task_tenant'
            )
            AND NOT (TABLE_NAME = 'CallTaskClients' AND REFERENCED_TABLE_NAME = 'CallTasks')`,
      )
      : [];
    if (foreignRows.length > 0) {
      throw migrationError('Feature 5.4 rollback refuses unknown external references');
    }

    await removeNamedArtifacts(queryInterface);
    await ensureLegacyIndexesAndForeignKeys(queryInterface);
    await dropNewColumns(queryInterface);
    void tenant;
  },
};
