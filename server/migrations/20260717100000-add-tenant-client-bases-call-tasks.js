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

const COLUMN_DEFINITIONS = Object.freeze(
  Object.entries(NEW_COLUMNS).flatMap(([table, columns]) =>
    columns.map((name) => Object.freeze({
      characterMaximumLength: null,
      columnType: 'int',
      dataType: 'int',
      defaultValue: null,
      extra: '',
      name,
      nullable: table === 'ClientBases' && name.startsWith('origin'),
      numericPrecision: 10,
      numericScale: 0,
      table,
    })),
  ),
);

const INDEX_DEFINITIONS = Object.freeze([
  { table: 'ClientSavedViews', name: 'uq_client_saved_views_tenant_id', unique: true, columns: ['organizationId', 'clubId', 'id'] },
  { table: 'ClientSavedViews', name: 'uq_client_saved_views_membership_club_name', unique: true, columns: ['membershipId', 'clubId', 'name'] },
  { table: 'ClientSavedViews', name: 'idx_client_saved_views_tenant_membership', unique: false, columns: ['organizationId', 'clubId', 'membershipId', 'updatedAt'] },
  { table: 'ClientBases', name: 'uq_client_bases_tenant_id', unique: true, columns: ['organizationId', 'clubId', 'id'] },
  { table: 'ClientBases', name: 'idx_client_bases_tenant_status_updated', unique: false, columns: ['organizationId', 'clubId', 'status', 'updatedAt'] },
  { table: 'ClientBases', name: 'idx_client_bases_tenant_recurring_due', unique: false, columns: ['organizationId', 'clubId', 'recurringEnabled', 'recurringNextRunAt'] },
  { table: 'ClientBases', name: 'idx_client_bases_tenant_origin', unique: false, columns: ['organizationId', 'clubId', 'origin'] },
  { table: 'CallTasks', name: 'uq_call_tasks_tenant_id', unique: true, columns: ['organizationId', 'clubId', 'id'] },
  { table: 'CallTasks', name: 'idx_call_tasks_tenant_status_due', unique: false, columns: ['organizationId', 'clubId', 'status', 'dueAt'] },
  { table: 'CallTasks', name: 'idx_call_tasks_tenant_assignee_status', unique: false, columns: ['organizationId', 'clubId', 'assignedToAccountId', 'status'] },
  { table: 'CallTasks', name: 'idx_call_tasks_tenant_base', unique: false, columns: ['organizationId', 'clubId', 'clientBaseId'] },
  { table: 'TelephonyCalls', name: 'idx_telephony_calls_follow_up_task_tenant', unique: false, columns: ['organizationId', 'clubId', 'followUpCallTaskId'] },
].map((definition) => Object.freeze({
  ...definition,
  columns: Object.freeze(definition.columns.map((name) => Object.freeze({
    direction: 'A',
    name,
    prefix: null,
  }))),
  type: 'BTREE',
})));

const INDEXES = Object.freeze(
  INDEX_DEFINITIONS.map(({ name, table }) => Object.freeze([table, name])),
);

const FOREIGN_KEY_DEFINITIONS = Object.freeze([
  { table: 'ClientSavedViews', name: 'fk_client_saved_views_org_club', columns: ['organizationId', 'clubId'], referencedTable: 'Clubs', referencedColumns: ['organizationId', 'id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
  { table: 'ClientSavedViews', name: 'fk_client_saved_views_membership', columns: ['organizationId', 'membershipId'], referencedTable: 'Memberships', referencedColumns: ['organizationId', 'id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
  { table: 'ClientBases', name: 'fk_client_bases_org_club', columns: ['organizationId', 'clubId'], referencedTable: 'Clubs', referencedColumns: ['organizationId', 'id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
  { table: 'ClientBases', name: 'fk_client_bases_origin_club', columns: ['originOrganizationId', 'originClubId'], referencedTable: 'Clubs', referencedColumns: ['organizationId', 'id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
  { table: 'CallTasks', name: 'fk_call_tasks_org_club', columns: ['organizationId', 'clubId'], referencedTable: 'Clubs', referencedColumns: ['organizationId', 'id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
  { table: 'CallTasks', name: 'fk_call_tasks_client_base_tenant', columns: ['organizationId', 'clubId', 'clientBaseId'], referencedTable: 'ClientBases', referencedColumns: ['organizationId', 'clubId', 'id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
  { table: 'TelephonyCalls', name: 'fk_telephony_calls_follow_up_task_tenant', columns: ['organizationId', 'clubId', 'followUpCallTaskId'], referencedTable: 'CallTasks', referencedColumns: ['organizationId', 'clubId', 'id'], onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
].map((definition) => Object.freeze({
  ...definition,
  columns: Object.freeze(definition.columns),
  referencedColumns: Object.freeze(definition.referencedColumns),
})));

const CONSTRAINTS = Object.freeze(
  FOREIGN_KEY_DEFINITIONS.map(({ name, table }) => Object.freeze([table, name])),
);

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
  'trg_telephony_calls_follow_up_task_tenant_insert',
  'trg_telephony_calls_follow_up_task_tenant_update',
]);

const RESERVED_INDEX_PREFIXES = Object.freeze([
  'uq_client_saved_views_tenant_',
  'uq_client_saved_views_membership_club_',
  'idx_client_saved_views_tenant_',
  'uq_client_bases_tenant_',
  'idx_client_bases_tenant_',
  'uq_call_tasks_tenant_',
  'idx_call_tasks_tenant_',
  'idx_telephony_calls_follow_up_task_tenant',
]);
const RESERVED_CONSTRAINT_PREFIXES = Object.freeze([
  'fk_client_saved_views_org_club',
  'fk_client_saved_views_membership',
  'fk_client_bases_org_club',
  'fk_client_bases_origin_club',
  'fk_call_tasks_org_club',
  'fk_call_tasks_client_base_tenant',
  'fk_telephony_calls_follow_up_task_tenant',
]);
const RESERVED_TRIGGER_PREFIXES = Object.freeze([
  'trg_client_saved_views_tenant_',
  'trg_client_bases_tenant_',
  'trg_call_tasks_tenant_',
  'trg_call_task_clients_tenant_',
  'trg_call_task_attempts_tenant_',
  'trg_telephony_calls_follow_up_task_tenant_',
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

function rowValue(row, name) {
  return row[name] ?? row[name.toLowerCase()] ?? null;
}

function normalizeColumnType(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\((?:\d+)(?:,\d+)?\)/g, '');
}

function normalizeDefault(value) {
  return value === null || value === undefined || String(value).toUpperCase() === 'NULL'
    ? null
    : String(value);
}

function normalizeSql(value) {
  return String(value || '')
    .replace(/`/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;])\s*/g, '$1')
    .replace(/\s*(<=>|<>|!=|<=|>=|=|<|>)\s*/g, '$1')
    .trim()
    .toLowerCase();
}

function hasReservedPrefix(value, prefixes) {
  const normalized = String(value || '').toLowerCase();
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

function parseTriggerStatement(statement) {
  const match = String(statement).match(
    /^CREATE\s+TRIGGER\s+`?([^`\s]+)`?\s+(BEFORE|AFTER)\s+(INSERT|UPDATE|DELETE)\s+ON\s+`?([^`\s]+)`?\s+FOR\s+EACH\s+ROW\s+([\s\S]+)$/i,
  );
  if (!match) throw migrationError('Feature 5.4 contains an invalid trigger definition');
  return Object.freeze({
    action: normalizeSql(match[5]),
    event: match[3].toUpperCase(),
    name: match[1],
    statement,
    table: match[4],
    timing: match[2].toUpperCase(),
  });
}

function expectedTriggerDefinitions() {
  return triggerStatements().map(parseTriggerStatement);
}

async function readFeatureArtifactInventory(queryInterface) {
  if (queryInterface.sequelize.getDialect() !== 'mysql') {
    throw migrationError('Feature 5.4 tenant schema requires MySQL/MariaDB');
  }
  const [columns, allIndexes, allForeignKeys, allTriggers] = await Promise.all([
    queryRows(
      queryInterface,
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
              COLUMN_DEFAULT, EXTRA, NUMERIC_PRECISION, NUMERIC_SCALE,
              CHARACTER_MAXIMUM_LENGTH
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('ClientSavedViews', 'ClientBases', 'CallTasks')
          AND COLUMN_NAME IN (
            'organizationId', 'clubId', 'membershipId',
            'originOrganizationId', 'originClubId'
          )
        ORDER BY TABLE_NAME, COLUMN_NAME`,
    ),
    queryRows(
      queryInterface,
      `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, INDEX_TYPE, SEQ_IN_INDEX,
              COLUMN_NAME, SUB_PART, COLLATION
         FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
    ),
    queryRows(
      queryInterface,
      `SELECT keyRow.TABLE_NAME, keyRow.CONSTRAINT_NAME,
              keyRow.ORDINAL_POSITION, keyRow.COLUMN_NAME,
              keyRow.REFERENCED_TABLE_NAME, keyRow.REFERENCED_COLUMN_NAME,
              ruleRow.UPDATE_RULE, ruleRow.DELETE_RULE
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE keyRow
         JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS ruleRow
           ON ruleRow.CONSTRAINT_SCHEMA = keyRow.CONSTRAINT_SCHEMA
          AND ruleRow.TABLE_NAME = keyRow.TABLE_NAME
          AND ruleRow.CONSTRAINT_NAME = keyRow.CONSTRAINT_NAME
        WHERE keyRow.CONSTRAINT_SCHEMA = DATABASE()
          AND keyRow.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY keyRow.TABLE_NAME, keyRow.CONSTRAINT_NAME,
                 keyRow.ORDINAL_POSITION`,
    ),
    queryRows(
      queryInterface,
      `SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING,
              EVENT_MANIPULATION, ACTION_STATEMENT
         FROM INFORMATION_SCHEMA.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE()
        ORDER BY TRIGGER_NAME`,
    ),
  ]);
  return {
    columns,
    foreignKeys: allForeignKeys.filter((row) =>
      hasReservedPrefix(
        rowValue(row, 'CONSTRAINT_NAME'),
        RESERVED_CONSTRAINT_PREFIXES,
      )),
    indexes: allIndexes.filter((row) =>
      hasReservedPrefix(rowValue(row, 'INDEX_NAME'), RESERVED_INDEX_PREFIXES)),
    triggers: allTriggers.filter((row) =>
      hasReservedPrefix(rowValue(row, 'TRIGGER_NAME'), RESERVED_TRIGGER_PREFIXES)),
  };
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function columnMatches(row, expected) {
  return Boolean(row) &&
    rowValue(row, 'TABLE_NAME') === expected.table &&
    rowValue(row, 'COLUMN_NAME') === expected.name &&
    String(rowValue(row, 'DATA_TYPE')).toLowerCase() === expected.dataType &&
    normalizeColumnType(rowValue(row, 'COLUMN_TYPE')) === expected.columnType &&
    (rowValue(row, 'IS_NULLABLE') === 'YES') === expected.nullable &&
    normalizeDefault(rowValue(row, 'COLUMN_DEFAULT')) === expected.defaultValue &&
    String(rowValue(row, 'EXTRA') || '').trim().toLowerCase() === expected.extra &&
    Number(rowValue(row, 'NUMERIC_PRECISION')) === expected.numericPrecision &&
    Number(rowValue(row, 'NUMERIC_SCALE')) === expected.numericScale &&
    rowValue(row, 'CHARACTER_MAXIMUM_LENGTH') === expected.characterMaximumLength;
}

function indexMatches(rows, expected) {
  if (rows.length !== expected.columns.length) return false;
  if (rows.some((row) =>
    rowValue(row, 'TABLE_NAME') !== expected.table ||
    Number(rowValue(row, 'NON_UNIQUE')) !== (expected.unique ? 0 : 1) ||
    String(rowValue(row, 'INDEX_TYPE')).toUpperCase() !== expected.type)) {
    return false;
  }
  const actualColumns = [...rows]
    .sort((left, right) =>
      Number(rowValue(left, 'SEQ_IN_INDEX')) - Number(rowValue(right, 'SEQ_IN_INDEX')))
    .map((row) => ({
      direction: rowValue(row, 'COLLATION'),
      name: rowValue(row, 'COLUMN_NAME'),
      prefix: rowValue(row, 'SUB_PART') === null
        ? null
        : Number(rowValue(row, 'SUB_PART')),
    }));
  return sameArray(actualColumns, expected.columns);
}

function foreignKeyMatches(rows, expected) {
  if (rows.length !== expected.columns.length) return false;
  const sorted = [...rows].sort((left, right) =>
    Number(rowValue(left, 'ORDINAL_POSITION')) -
      Number(rowValue(right, 'ORDINAL_POSITION')));
  return sorted.every((row) =>
    rowValue(row, 'TABLE_NAME') === expected.table &&
    rowValue(row, 'REFERENCED_TABLE_NAME') === expected.referencedTable &&
    String(rowValue(row, 'UPDATE_RULE')).toUpperCase() === expected.onUpdate &&
    String(rowValue(row, 'DELETE_RULE')).toUpperCase() === expected.onDelete) &&
    sameArray(
      sorted.map((row) => rowValue(row, 'COLUMN_NAME')),
      expected.columns,
    ) &&
    sameArray(
      sorted.map((row) => rowValue(row, 'REFERENCED_COLUMN_NAME')),
      expected.referencedColumns,
    );
}

function triggerMatches(row, expected) {
  return Boolean(row) &&
    rowValue(row, 'EVENT_OBJECT_TABLE') === expected.table &&
    String(rowValue(row, 'ACTION_TIMING')).toUpperCase() === expected.timing &&
    String(rowValue(row, 'EVENT_MANIPULATION')).toUpperCase() === expected.event &&
    normalizeSql(rowValue(row, 'ACTION_STATEMENT')) === expected.action;
}

function inventoryHasOnlyExpectedNames(inventory) {
  const indexNamesExpected = new Set(INDEX_DEFINITIONS.map(({ name }) => name));
  const foreignKeyNamesExpected = new Set(
    FOREIGN_KEY_DEFINITIONS.map(({ name }) => name),
  );
  const triggerNamesExpected = new Set(TRIGGERS);
  return inventory.indexes.every((row) =>
    indexNamesExpected.has(rowValue(row, 'INDEX_NAME'))) &&
    inventory.foreignKeys.every((row) =>
      foreignKeyNamesExpected.has(rowValue(row, 'CONSTRAINT_NAME'))) &&
    inventory.triggers.every((row) =>
      triggerNamesExpected.has(rowValue(row, 'TRIGGER_NAME')));
}

async function classifySchema(queryInterface) {
  const inventory = await readFeatureArtifactInventory(queryInterface);
  const artifactCount = inventory.columns.length + inventory.indexes.length +
    inventory.foreignKeys.length + inventory.triggers.length;
  if (artifactCount === 0) return 'legacy';
  if (!inventoryHasOnlyExpectedNames(inventory)) return 'partial';

  const columnsReady = COLUMN_DEFINITIONS.every((expected) =>
    columnMatches(
      inventory.columns.find((row) =>
        rowValue(row, 'TABLE_NAME') === expected.table &&
        rowValue(row, 'COLUMN_NAME') === expected.name),
      expected,
    ));
  const indexesReady = INDEX_DEFINITIONS.every((expected) =>
    indexMatches(
      inventory.indexes.filter((row) =>
        rowValue(row, 'INDEX_NAME') === expected.name),
      expected,
    ));
  const foreignKeysReady = FOREIGN_KEY_DEFINITIONS.every((expected) =>
    foreignKeyMatches(
      inventory.foreignKeys.filter((row) =>
        rowValue(row, 'CONSTRAINT_NAME') === expected.name),
      expected,
    ));
  const triggersReady = expectedTriggerDefinitions().every((expected) =>
    triggerMatches(
      inventory.triggers.find((row) =>
        rowValue(row, 'TRIGGER_NAME') === expected.name),
      expected,
    ));
  return columnsReady && indexesReady && foreignKeysReady && triggersReady
    ? 'ready'
    : 'partial';
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
  const workerRoles = ['owner', 'manager', 'admin'];
  const accountPredicate = (accountExpression, organizationExpression,
    clubExpression, roles = null) => tenantAccountPredicate({
    accountExpression,
    clubExpression,
    organizationExpression,
    roles,
  });
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
         WHERE NOT ${accountPredicate(
    'saved.accountId',
    'saved.organizationId',
    'saved.clubId',
  )}
            OR NOT EXISTS (
              SELECT 1 FROM Memberships membership
               WHERE membership.id = saved.membershipId
                 AND membership.organizationId = saved.organizationId
                 AND membership.accountId = saved.accountId
                 AND membership.status = 'active'
            )) AS savedMismatch,
       ((SELECT COUNT(*)
           FROM ClientSavedViews saved
           LEFT JOIN Organizations organizationRow
             ON organizationRow.id = saved.organizationId
            AND organizationRow.status = 'active'
           LEFT JOIN Clubs clubRow
             ON clubRow.id = saved.clubId
            AND clubRow.organizationId = saved.organizationId
            AND clubRow.status = 'active'
          WHERE organizationRow.id IS NULL OR clubRow.id IS NULL)
        + (SELECT COUNT(*)
             FROM ClientBases base
             LEFT JOIN Organizations organizationRow
               ON organizationRow.id = base.organizationId
              AND organizationRow.status = 'active'
             LEFT JOIN Clubs clubRow
               ON clubRow.id = base.clubId
              AND clubRow.organizationId = base.organizationId
              AND clubRow.status = 'active'
            WHERE organizationRow.id IS NULL OR clubRow.id IS NULL)
        + (SELECT COUNT(*)
             FROM CallTasks task
             LEFT JOIN Organizations organizationRow
               ON organizationRow.id = task.organizationId
              AND organizationRow.status = 'active'
             LEFT JOIN Clubs clubRow
               ON clubRow.id = task.clubId
              AND clubRow.organizationId = task.organizationId
              AND clubRow.status = 'active'
            WHERE organizationRow.id IS NULL OR clubRow.id IS NULL)) AS rootMismatch,
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
         WHERE (base.createdByAccountId IS NOT NULL AND NOT ${accountPredicate(
    'base.createdByAccountId',
    'base.organizationId',
    'base.clubId',
    workerRoles,
  )})
            OR (base.recurringAssignedToAccountId IS NOT NULL AND NOT ${accountPredicate(
    'base.recurringAssignedToAccountId',
    'base.organizationId',
    'base.clubId',
    workerRoles,
  )})) AS baseActorMismatch,
       (SELECT COUNT(*)
          FROM CallTasks task
         WHERE (task.createdByAccountId IS NOT NULL AND NOT ${accountPredicate(
    'task.createdByAccountId',
    'task.organizationId',
    'task.clubId',
    workerRoles,
  )})
            OR (task.assignedToAccountId IS NOT NULL AND NOT ${accountPredicate(
    'task.assignedToAccountId',
    'task.organizationId',
    'task.clubId',
    workerRoles,
  )})) AS taskActorMismatch,
       (SELECT COUNT(*)
          FROM CallTaskAttempts attemptRow
          JOIN CallTaskClients item ON item.id = attemptRow.callTaskClientId
          JOIN CallTasks task ON task.id = item.callTaskId
         WHERE attemptRow.actorAccountId IS NOT NULL AND NOT ${accountPredicate(
    'attemptRow.actorAccountId',
    'task.organizationId',
    'task.clubId',
    workerRoles,
  )}) AS attemptActorMismatch,
       ((SELECT COUNT(*) FROM ClientBases base
          WHERE base.trainingAccountId IS NOT NULL AND NOT ${accountPredicate(
    'base.trainingAccountId',
    'base.organizationId',
    'base.clubId',
  )})
        + (SELECT COUNT(*) FROM CallTasks task
            WHERE task.trainingAccountId IS NOT NULL AND NOT ${accountPredicate(
    'task.trainingAccountId',
    'task.organizationId',
    'task.clubId',
  )})
        + (SELECT COUNT(*)
             FROM CallTaskClients item
             JOIN CallTasks task ON task.id = item.callTaskId
            WHERE item.trainingAccountId IS NOT NULL AND NOT ${accountPredicate(
    'item.trainingAccountId',
    'task.organizationId',
    'task.clubId',
  )})
        + (SELECT COUNT(*)
             FROM CallTaskAttempts attemptRow
             JOIN CallTaskClients item ON item.id = attemptRow.callTaskClientId
             JOIN CallTasks task ON task.id = item.callTaskId
            WHERE attemptRow.trainingAccountId IS NOT NULL AND NOT ${accountPredicate(
    'attemptRow.trainingAccountId',
    'task.organizationId',
    'task.clubId',
  )})) AS trainingActorMismatch,
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
  const rows = await queryRows(
    queryInterface,
    `SELECT keyRow.TABLE_NAME, keyRow.CONSTRAINT_NAME,
            keyRow.ORDINAL_POSITION, keyRow.COLUMN_NAME,
            keyRow.REFERENCED_TABLE_NAME, keyRow.REFERENCED_COLUMN_NAME,
            ruleRow.UPDATE_RULE, ruleRow.DELETE_RULE
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE keyRow
       JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS ruleRow
         ON ruleRow.CONSTRAINT_SCHEMA = keyRow.CONSTRAINT_SCHEMA
        AND ruleRow.TABLE_NAME = keyRow.TABLE_NAME
        AND ruleRow.CONSTRAINT_NAME = keyRow.CONSTRAINT_NAME
      WHERE keyRow.CONSTRAINT_SCHEMA = DATABASE()
        AND keyRow.TABLE_NAME = :table
        AND keyRow.CONSTRAINT_NAME IN (
          SELECT matching.CONSTRAINT_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE matching
           WHERE matching.CONSTRAINT_SCHEMA = DATABASE()
             AND matching.TABLE_NAME = :table
             AND matching.COLUMN_NAME = :column
             AND matching.REFERENCED_TABLE_NAME IS NOT NULL
        )
      ORDER BY keyRow.CONSTRAINT_NAME, keyRow.ORDINAL_POSITION`,
    { column, table },
  );
  const grouped = new Map();
  for (const row of rows) {
    const name = rowValue(row, 'CONSTRAINT_NAME');
    const definition = grouped.get(name) || {
      columns: [],
      name,
      onDelete: String(rowValue(row, 'DELETE_RULE')).toUpperCase(),
      onUpdate: String(rowValue(row, 'UPDATE_RULE')).toUpperCase(),
      referencedColumns: [],
      referencedTable: rowValue(row, 'REFERENCED_TABLE_NAME'),
      table: rowValue(row, 'TABLE_NAME'),
    };
    definition.columns.push(rowValue(row, 'COLUMN_NAME'));
    definition.referencedColumns.push(rowValue(row, 'REFERENCED_COLUMN_NAME'));
    grouped.set(name, definition);
  }
  return [...grouped.values()];
}

async function addIndexes(queryInterface, onCreated = () => {}) {
  for (const definition of INDEX_DEFINITIONS) {
    await queryInterface.addIndex(
      definition.table,
      definition.columns.map(({ name }) => name),
      { name: definition.name, unique: definition.unique },
    );
    onCreated({ name: definition.name, table: definition.table });
  }
}

async function addConstraints(queryInterface, onCreated = () => {}) {
  for (const definition of FOREIGN_KEY_DEFINITIONS) {
    await queryInterface.addConstraint(definition.table, {
      fields: definition.columns,
      name: definition.name,
      onDelete: definition.onDelete,
      onUpdate: definition.onUpdate,
      references: {
        table: definition.referencedTable,
        fields: definition.referencedColumns,
      },
      type: 'foreign key',
    });
    onCreated({ name: definition.name, table: definition.table });
  }
}

function tenantAccountPredicate({
  accountExpression,
  clubExpression,
  organizationExpression,
  roles = null,
}) {
  const rolePredicate = roles
    ? `AND CASE
             WHEN membership.role = 'owner' THEN 'owner'
             ELSE COALESCE(accessRow.roleOverride, membership.role)
           END IN (${roles.map((role) => `'${role}'`).join(', ')})`
    : '';
  return `EXISTS (
    SELECT 1
      FROM Accounts accountRow
      JOIN Memberships membership
        ON membership.accountId = accountRow.id
       AND membership.organizationId = ${organizationExpression}
       AND membership.status = 'active'
      JOIN Organizations organizationRow
        ON organizationRow.id = membership.organizationId
       AND organizationRow.status = 'active'
      JOIN Clubs clubRow
        ON clubRow.id = ${clubExpression}
       AND clubRow.organizationId = membership.organizationId
       AND clubRow.status = 'active'
      LEFT JOIN MembershipClubAccesses accessRow
        ON accessRow.membershipId = membership.id
       AND accessRow.organizationId = membership.organizationId
       AND accessRow.clubId = clubRow.id
       AND accessRow.status = 'active'
     WHERE accountRow.id = ${accountExpression}
       AND accountRow.status = 'active'
       AND (
         (accountRow.staffId IS NULL AND membership.staffId IS NULL)
         OR (
           accountRow.staffId IS NOT NULL
           AND membership.staffId IS NOT NULL
           AND accountRow.staffId = membership.staffId
           AND EXISTS (
             SELECT 1 FROM Staffs staffRow
              WHERE staffRow.id = membership.staffId
                AND staffRow.organizationId = ${organizationExpression}
                AND staffRow.status = 'active'
           )
         )
       )
       AND (
         membership.role = 'owner'
         OR (
           accessRow.membershipId IS NOT NULL
           AND COALESCE(accessRow.roleOverride, '') <> 'owner'
         )
       )
       ${rolePredicate}
  )`;
}

function triggerStatements() {
  const signal = (message) => `SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${message}'`;
  const workerRoles = ['owner', 'manager', 'admin'];
  const rootAccount = (accountExpression, roles = null) => tenantAccountPredicate({
    accountExpression,
    clubExpression: 'NEW.clubId',
    organizationExpression: 'NEW.organizationId',
    roles,
  });
  const sameTenantAccount = rootAccount('NEW.accountId');
  const recurringAssignee = rootAccount(
    'NEW.recurringAssignedToAccountId',
    workerRoles,
  );
  const taskAssignee = rootAccount('NEW.assignedToAccountId', workerRoles);
  const taskCreator = rootAccount('NEW.createdByAccountId', workerRoles);
  const baseCreator = rootAccount('NEW.createdByAccountId', workerRoles);
  const baseTrainingAccount = rootAccount('NEW.trainingAccountId');
  const taskTrainingAccount = rootAccount('NEW.trainingAccountId');
  const nestedTaskAccount = (accountExpression, roles = null) =>
    tenantAccountPredicate({
      accountExpression,
      clubExpression: 'task.clubId',
      organizationExpression: 'task.organizationId',
      roles,
    });
  const attemptActor = nestedTaskAccount('NEW.actorAccountId', workerRoles);
  const nestedTrainingAccount = nestedTaskAccount('NEW.trainingAccountId');

  return [
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
        IF NOT ${sameTenantAccount} OR NOT EXISTS (
          SELECT 1 FROM Memberships membership
           WHERE membership.id = NEW.membershipId
             AND membership.organizationId = NEW.organizationId
             AND membership.accountId = NEW.accountId
        ) THEN ${signal('Client saved view tenant graph mismatch')}; END IF;
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
        IF NEW.createdByAccountId IS NOT NULL AND NOT ${baseCreator}
        THEN ${signal('Client base creator tenant mismatch')}; END IF;
        IF NEW.recurringAssignedToAccountId IS NOT NULL AND NOT ${recurringAssignee}
        THEN ${signal('Client base recurring assignee tenant mismatch')}; END IF;
        IF NEW.trainingAccountId IS NOT NULL AND NOT ${baseTrainingAccount}
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
        IF NEW.createdByAccountId IS NOT NULL AND NOT ${taskCreator}
        THEN ${signal('Call task creator tenant mismatch')}; END IF;
        IF NEW.assignedToAccountId IS NOT NULL AND NOT ${taskAssignee}
        THEN ${signal('Call task assignee tenant mismatch')}; END IF;
        IF NEW.trainingAccountId IS NOT NULL AND NOT ${taskTrainingAccount}
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
           WHERE task.id = NEW.callTaskId
             AND ${nestedTrainingAccount}
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
           WHERE task.id = NEW.callTaskId
             AND ${nestedTrainingAccount}
        ) THEN ${signal('Call task client training account mismatch')}; END IF;
      END`,
    `CREATE TRIGGER trg_call_task_attempts_tenant_insert
      BEFORE INSERT ON CallTaskAttempts FOR EACH ROW
      BEGIN
        IF NEW.actorAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM CallTaskClients item
          JOIN CallTasks task ON task.id = item.callTaskId
          WHERE item.id = NEW.callTaskClientId
            AND ${attemptActor}
        ) THEN ${signal('Call task attempt actor tenant mismatch')}; END IF;
        IF NEW.trainingAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM CallTaskClients item
          JOIN CallTasks task ON task.id = item.callTaskId
          WHERE item.id = NEW.callTaskClientId
            AND ${nestedTrainingAccount}
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
          SELECT 1 FROM CallTaskClients item
          JOIN CallTasks task ON task.id = item.callTaskId
          WHERE item.id = NEW.callTaskClientId
            AND ${attemptActor}
        ) THEN ${signal('Call task attempt tenant mismatch')}; END IF;
        IF NEW.trainingAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM CallTaskClients item
          JOIN CallTasks task ON task.id = item.callTaskId
          WHERE item.id = NEW.callTaskClientId
            AND ${nestedTrainingAccount}
        ) THEN ${signal('Call task attempt training account mismatch')}; END IF;
      END`,
    `CREATE TRIGGER trg_telephony_calls_follow_up_task_tenant_insert
      BEFORE INSERT ON TelephonyCalls FOR EACH ROW
      BEGIN
        IF NEW.followUpCallTaskId IS NOT NULL AND (
          NEW.organizationId IS NULL OR NEW.clubId IS NULL OR NOT EXISTS (
            SELECT 1 FROM CallTasks task
             WHERE task.id = NEW.followUpCallTaskId
               AND task.organizationId = NEW.organizationId
               AND task.clubId = NEW.clubId
          )
        ) THEN ${signal('Telephony follow-up task tenant mismatch')}; END IF;
      END`,
    `CREATE TRIGGER trg_telephony_calls_follow_up_task_tenant_update
      BEFORE UPDATE ON TelephonyCalls FOR EACH ROW
      BEGIN
        IF OLD.followUpCallTaskId IS NOT NULL AND NEW.followUpCallTaskId IS NOT NULL
           AND (
             NOT (OLD.organizationId <=> NEW.organizationId) OR
             NOT (OLD.clubId <=> NEW.clubId)
           )
        THEN ${signal('Telephony follow-up tenant attribution is immutable while linked')}; END IF;
        IF NEW.followUpCallTaskId IS NOT NULL AND (
          NEW.organizationId IS NULL OR NEW.clubId IS NULL OR NOT EXISTS (
            SELECT 1 FROM CallTasks task
             WHERE task.id = NEW.followUpCallTaskId
               AND task.organizationId = NEW.organizationId
               AND task.clubId = NEW.clubId
          )
        ) THEN ${signal('Telephony follow-up task tenant mismatch')}; END IF;
      END`,
  ];
}

async function createTriggers(queryInterface, onCreated = () => {}) {
  if (queryInterface.sequelize.getDialect() !== 'mysql') return;
  for (const statement of triggerStatements()) {
    await queryInterface.sequelize.query(statement);
    onCreated(parseTriggerStatement(statement).name);
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

function createArtifactTracker() {
  return {
    columns: [],
    constraints: [],
    indexes: [],
    triggers: [],
  };
}

async function removeCreatedArtifacts(queryInterface, created) {
  const inventory = await readFeatureArtifactInventory(queryInterface);
  const expectedTriggers = new Map(
    expectedTriggerDefinitions().map((definition) => [definition.name, definition]),
  );
  for (const name of [...created.triggers].reverse()) {
    const expected = expectedTriggers.get(name);
    const row = inventory.triggers.find((candidate) =>
      rowValue(candidate, 'TRIGGER_NAME') === name);
    if (expected && triggerMatches(row, expected)) {
      await queryInterface.sequelize.query(`DROP TRIGGER \`${name}\``);
    }
  }
  for (const { name, table } of [...created.constraints].reverse()) {
    const expected = FOREIGN_KEY_DEFINITIONS.find((definition) =>
      definition.name === name && definition.table === table);
    const rows = inventory.foreignKeys.filter((row) =>
      rowValue(row, 'CONSTRAINT_NAME') === name);
    if (expected && foreignKeyMatches(rows, expected)) {
      await queryInterface.removeConstraint(table, name);
    }
  }
  for (const { name, table } of [...created.indexes].reverse()) {
    const expected = INDEX_DEFINITIONS.find((definition) =>
      definition.name === name && definition.table === table);
    const rows = inventory.indexes.filter((row) =>
      rowValue(row, 'INDEX_NAME') === name);
    if (expected && indexMatches(rows, expected)) {
      await queryInterface.removeIndex(table, name);
    }
  }
  for (const { name, table } of [...created.columns].reverse()) {
    const expected = COLUMN_DEFINITIONS.find((definition) =>
      definition.name === name && definition.table === table);
    const row = inventory.columns.find((candidate) =>
      rowValue(candidate, 'TABLE_NAME') === table &&
      rowValue(candidate, 'COLUMN_NAME') === name);
    const matchesInvocationDefinition = expected && (
      columnMatches(row, expected) ||
      columnMatches(row, { ...expected, nullable: true })
    );
    if (matchesInvocationDefinition) await queryInterface.removeColumn(table, name);
  }
}

async function restoreForeignKeyDefinitions(queryInterface, definitions) {
  for (const definition of definitions) {
    await queryInterface.addConstraint(definition.table, {
      fields: definition.columns,
      name: definition.name,
      onDelete: definition.onDelete,
      onUpdate: definition.onUpdate,
      references: {
        table: definition.referencedTable,
        fields: definition.referencedColumns,
      },
      type: 'foreign key',
    });
  }
}

async function restoreInvocationLegacyArtifacts(queryInterface, removed) {
  if (removed.savedViewUnique) {
    const existing = await indexNames(queryInterface, 'ClientSavedViews');
    if (!existing.has('client_saved_views_account_name_unique')) {
      await queryInterface.addIndex('ClientSavedViews', ['accountId', 'name'], {
        name: 'client_saved_views_account_name_unique',
        unique: true,
      });
    }
  }
  await restoreForeignKeyDefinitions(queryInterface, removed.foreignKeys);
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
    const description = await queryInterface.describeTable(table);
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
    const legacySavedIndexes = await indexNames(queryInterface, 'ClientSavedViews');
    const legacyForeignKeys = [
      ...await foreignKeysForColumn(queryInterface, 'CallTasks', 'clientBaseId'),
      ...await foreignKeysForColumn(
        queryInterface,
        'TelephonyCalls',
        'followUpCallTaskId',
      ),
    ];
    const created = createArtifactTracker();
    const removed = { foreignKeys: [], savedViewUnique: false };
    const addTrackedColumn = async (table, name, definition) => {
      await queryInterface.addColumn(table, name, definition);
      created.columns.push({ name, table });
    };
    try {
      await addTrackedColumn('ClientSavedViews', 'organizationId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await addTrackedColumn('ClientSavedViews', 'clubId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await addTrackedColumn('ClientSavedViews', 'membershipId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await addTrackedColumn('ClientBases', 'organizationId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await addTrackedColumn('ClientBases', 'clubId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await addTrackedColumn('ClientBases', 'originOrganizationId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await addTrackedColumn('ClientBases', 'originClubId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await addTrackedColumn('CallTasks', 'organizationId', {
        allowNull: true,
        type: Sequelize.INTEGER,
      });
      await addTrackedColumn('CallTasks', 'clubId', {
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

      await addIndexes(queryInterface, (artifact) => created.indexes.push(artifact));
      forcedFailure('indexes');
      await addConstraints(
        queryInterface,
        (artifact) => created.constraints.push(artifact),
      );
      forcedFailure('constraints');
      await createTriggers(queryInterface, (name) => created.triggers.push(name));
      forcedFailure('triggers');
      if (legacySavedIndexes.has('client_saved_views_account_name_unique')) {
        await queryInterface.removeIndex(
          'ClientSavedViews',
          'client_saved_views_account_name_unique',
        );
        removed.savedViewUnique = true;
      }
      for (const definition of legacyForeignKeys) {
        await queryInterface.removeConstraint(definition.table, definition.name);
        removed.foreignKeys.push(definition);
      }
      await validateBackfill(queryInterface);
    } catch (error) {
      await removeCreatedArtifacts(queryInterface, created);
      await restoreInvocationLegacyArtifacts(queryInterface, removed);
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
