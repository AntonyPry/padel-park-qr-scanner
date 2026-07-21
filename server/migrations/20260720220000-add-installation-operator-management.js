'use strict';

const provisioningArtifacts = require('./20260720120000-add-installation-provisioning').__testing;

const LOWER_CASE_TABLE_NAMES = new WeakMap();
const INDEX_VISIBILITY_SUPPORT = new WeakMap();

const SESSION_TABLE = 'InstallationOperatorSessions';
const OPERATION_TABLE = 'InstallationMutationOperations';
const CONNECTION_TABLE = 'IntegrationConnections';
const TARGET_CONNECTION_COLUMNS = Object.freeze([
  ['credentialFingerprint', 'varchar(64)', true, 64, ''],
  ['providerIdentityFingerprint', 'varchar(64)', true, 64, ''],
  ['fingerprintKeyVersion', 'varchar(32)', true, 32, ''],
]);

const TABLE_COLUMNS = Object.freeze({
  [SESSION_TABLE]: Object.freeze([
    ['id', 'int', false, null, 'auto_increment'],
    ['sessionId', 'varchar(32)', false, 32, ''],
    ['username', 'varchar(120)', false, 120, ''],
    ['expiresAt', 'datetime', false, null, ''],
    ['revokedAt', 'datetime', true, null, ''],
    ['createdAt', 'datetime', false, null, ''],
    ['updatedAt', 'datetime', false, null, ''],
  ]),
  [OPERATION_TABLE]: Object.freeze([
    ['id', 'int', false, null, 'auto_increment'],
    ['idempotencyKeyHash', 'varchar(64)', false, 64, ''],
    ['payloadHash', 'varchar(64)', false, 64, ''],
    ['organizationId', 'int', false, null, ''],
    ['clubId', 'int', true, null, ''],
    ['action', 'varchar(96)', false, 96, ''],
    ['response', 'longtext', false, 4294967295, ''],
    ['auditLogId', 'int', false, null, ''],
    ['createdAt', 'datetime', false, null, ''],
    ['updatedAt', 'datetime', false, null, ''],
  ]),
});

const INDEXES = Object.freeze([
  { table: SESSION_TABLE, name: 'uq_installation_operator_session_id', unique: true, fields: ['sessionId'] },
  { table: SESSION_TABLE, name: 'idx_installation_operator_session_expiry', unique: false, fields: ['username', 'expiresAt'] },
  { table: OPERATION_TABLE, name: 'uq_installation_mutation_idempotency_hash', unique: true, fields: ['idempotencyKeyHash'] },
  { table: OPERATION_TABLE, name: 'idx_installation_mutation_scope_created', unique: false, fields: ['organizationId', 'clubId', 'createdAt'] },
  { table: OPERATION_TABLE, name: 'idx_installation_mutation_club', unique: false, fields: ['clubId'] },
  { table: OPERATION_TABLE, name: 'idx_installation_mutation_audit', unique: false, fields: ['auditLogId'] },
  { table: CONNECTION_TABLE, name: 'uq_integration_provider_credential_fingerprint', unique: true, fields: ['provider', 'credentialFingerprint'] },
  { table: CONNECTION_TABLE, name: 'uq_integration_provider_identity_fingerprint', unique: true, fields: ['provider', 'providerIdentityFingerprint'] },
]);

const FOREIGN_KEYS = Object.freeze([
  { table: OPERATION_TABLE, name: 'fk_installation_mutation_organization', fields: ['organizationId'], referencedTable: 'Organizations', referencedFields: ['id'] },
  { table: OPERATION_TABLE, name: 'fk_installation_mutation_club', fields: ['clubId'], referencedTable: 'Clubs', referencedFields: ['id'] },
  { table: OPERATION_TABLE, name: 'fk_installation_mutation_audit', fields: ['auditLogId'], referencedTable: 'AuditLogs', referencedFields: ['id'] },
].map((item) => Object.freeze({ ...item, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' })));

const TRIGGERS = Object.freeze([
  {
    table: SESSION_TABLE,
    name: 'trg_installation_operator_sessions_bi',
    event: 'INSERT',
    body: `BEGIN
      IF NEW.revokedAt IS NOT NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Operator session must start active';
      END IF;
    END`,
  },
  {
    table: SESSION_TABLE,
    name: 'trg_installation_operator_sessions_bu',
    event: 'UPDATE',
    body: `BEGIN
      IF NOT (NEW.id <=> OLD.id)
         OR NOT (NEW.sessionId <=> OLD.sessionId)
         OR NOT (NEW.username <=> OLD.username)
         OR NOT (NEW.expiresAt <=> OLD.expiresAt)
         OR NOT (NEW.createdAt <=> OLD.createdAt) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Operator session identity is immutable';
      END IF;
      IF OLD.revokedAt IS NOT NULL AND NOT (NEW.revokedAt <=> OLD.revokedAt) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Operator session revocation is irreversible';
      END IF;
    END`,
  },
  {
    table: SESSION_TABLE,
    name: 'trg_installation_operator_sessions_bd',
    event: 'DELETE',
    body: "BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Operator session history is immutable'; END",
  },
  {
    table: OPERATION_TABLE,
    name: 'trg_installation_mutation_operations_bi',
    event: 'INSERT',
    body: `BEGIN
      IF NEW.clubId IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM Clubs club
         WHERE club.id = NEW.clubId
           AND club.organizationId = NEW.organizationId
      ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Installation operation Club authority mismatch';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM AuditLogs audit
         WHERE audit.id = NEW.auditLogId
           AND audit.organizationId = NEW.organizationId
           AND audit.clubId <=> NEW.clubId
      ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Installation operation audit authority mismatch';
      END IF;
    END`,
  },
  {
    table: OPERATION_TABLE,
    name: 'trg_installation_mutation_operations_bu',
    event: 'UPDATE',
    body: "BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Installation operation history is immutable'; END",
  },
  {
    table: OPERATION_TABLE,
    name: 'trg_installation_mutation_operations_bd',
    event: 'DELETE',
    body: "BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Installation operation history is immutable'; END",
  },
]);

const DDL_STEPS = Object.freeze([
  'session_table',
  ...INDEXES.filter((item) => item.table === SESSION_TABLE).map((item) => `index_${item.name}`),
  ...TRIGGERS.filter((item) => item.table === SESSION_TABLE).map((item) => `trigger_${item.name}`),
  'operation_table',
  ...INDEXES.filter((item) => item.table === OPERATION_TABLE).map((item) => `index_${item.name}`),
  ...FOREIGN_KEYS.map((item) => `foreign_key_${item.name}`),
  ...TRIGGERS.filter((item) => item.table === OPERATION_TABLE).map((item) => `trigger_${item.name}`),
  ...TARGET_CONNECTION_COLUMNS.map(([name]) => `column_${name}`),
  ...INDEXES.filter((item) => item.table === CONNECTION_TABLE).map((item) => `index_${item.name}`),
]);

function migrationError(message, code = 'INSTALLATION_MANAGEMENT_MIGRATION_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function maybeFail(step) {
  if (process.env.INSTALLATION_MANAGEMENT_MIGRATION_FAIL_STEP === step) {
    throw migrationError(
      `Forced installation management migration failure after ${step}`,
      'INSTALLATION_MANAGEMENT_MIGRATION_FORCED_FAILURE',
    );
  }
}

async function rows(queryInterface, sql, replacements = {}) {
  const [result] = await queryInterface.sequelize.query(sql, { replacements });
  return result;
}

function value(row, key) {
  return row?.[key] ?? row?.[key.toLowerCase()] ?? null;
}

function tableIdentifierEquals(left, right, lowerCaseTableNames) {
  if (![0, 1, 2].includes(lowerCaseTableNames)) {
    throw migrationError(`Unsupported lower_case_table_names value: ${lowerCaseTableNames}`);
  }
  const leftIdentifier = String(left || '');
  const rightIdentifier = String(right || '');
  return lowerCaseTableNames === 0
    ? leftIdentifier === rightIdentifier
    : leftIdentifier.toLowerCase() === rightIdentifier.toLowerCase();
}

async function getLowerCaseTableNames(queryInterface) {
  if (LOWER_CASE_TABLE_NAMES.has(queryInterface)) {
    return LOWER_CASE_TABLE_NAMES.get(queryInterface);
  }
  const result = await rows(
    queryInterface,
    'SELECT @@lower_case_table_names AS lowerCaseTableNames',
  );
  const rawSetting = value(result[0], 'lowerCaseTableNames');
  const setting = rawSetting === null || rawSetting === '' ? Number.NaN : Number(rawSetting);
  if (![0, 1, 2].includes(setting)) {
    throw migrationError(`Unsupported lower_case_table_names value: ${setting}`);
  }
  LOWER_CASE_TABLE_NAMES.set(queryInterface, setting);
  return setting;
}

async function supportsIndexVisibility(queryInterface) {
  if (INDEX_VISIBILITY_SUPPORT.has(queryInterface)) {
    return INDEX_VISIBILITY_SUPPORT.get(queryInterface);
  }
  let supported;
  try {
    await queryInterface.sequelize.query(
      'SELECT IS_VISIBLE FROM INFORMATION_SCHEMA.STATISTICS LIMIT 0',
    );
    supported = true;
  } catch (error) {
    const code = error?.parent?.code || error?.original?.code || error?.code;
    if (!['ER_BAD_FIELD_ERROR', 'ER_PARSE_ERROR'].includes(code)) throw error;
    supported = false;
  }
  INDEX_VISIBILITY_SUPPORT.set(queryInterface, supported);
  return supported;
}

async function filterOwnedRows(queryInterface, rawRows, key, table) {
  const lowerCaseTableNames = await getLowerCaseTableNames(queryInterface);
  return rawRows.filter((row) => tableIdentifierEquals(
    value(row, key),
    table,
    lowerCaseTableNames,
  ));
}

async function rawTableRows(queryInterface, table) {
  return rows(queryInterface, `
    SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
      FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table
  `, { table });
}

async function tableRows(queryInterface, table) {
  const result = await rawTableRows(queryInterface, table);
  return filterOwnedRows(queryInterface, result, 'TABLE_NAME', table);
}

async function columnRows(queryInterface, table, name = null) {
  const result = await rows(queryInterface, `
    SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, COLUMN_TYPE,
           IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH, CHARACTER_SET_NAME,
           COLLATION_NAME, DATETIME_PRECISION, NUMERIC_PRECISION, NUMERIC_SCALE,
           COLUMN_DEFAULT, EXTRA
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table
       ${name ? 'AND COLUMN_NAME=:name' : ''}
     ORDER BY ORDINAL_POSITION
  `, { name, table });
  return filterOwnedRows(queryInterface, result, 'TABLE_NAME', table);
}

async function indexRows(queryInterface, table, name = null) {
  const visibility = await supportsIndexVisibility(queryInterface)
    ? 'IS_VISIBLE'
    : "'YES' AS IS_VISIBLE";
  const result = await rows(queryInterface, `
    SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
           SUB_PART, COLLATION, INDEX_TYPE, ${visibility}
      FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table
       ${name ? 'AND INDEX_NAME=:name' : ''}
     ORDER BY INDEX_NAME, SEQ_IN_INDEX
  `, { name, table });
  return filterOwnedRows(queryInterface, result, 'TABLE_NAME', table);
}

async function foreignKeyRows(queryInterface, table, name = null) {
  const result = await rows(queryInterface, `
    SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
           k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
           r.UPDATE_RULE, r.DELETE_RULE
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
      JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
       AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
       AND r.TABLE_NAME=k.TABLE_NAME
     WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME=:table
       ${name ? 'AND k.CONSTRAINT_NAME=:name' : ''}
     ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION
  `, { name, table });
  return filterOwnedRows(queryInterface, result, 'TABLE_NAME', table);
}

async function triggerRows(queryInterface, table, name = null) {
  const result = await rows(queryInterface, `
    SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING,
           EVENT_MANIPULATION, ACTION_STATEMENT
      FROM INFORMATION_SCHEMA.TRIGGERS
     WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE=:table
       ${name ? 'AND TRIGGER_NAME=:name' : ''}
     ORDER BY TRIGGER_NAME
  `, { name, table });
  return filterOwnedRows(queryInterface, result, 'EVENT_OBJECT_TABLE', table);
}

async function foreignKeyNameRows(queryInterface, name) {
  return rows(queryInterface, `
    SELECT TABLE_NAME, CONSTRAINT_NAME
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
     WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME=:name
  `, { name });
}

async function triggerNameRows(queryInterface, name) {
  return rows(queryInterface, `
    SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE
      FROM INFORMATION_SCHEMA.TRIGGERS
     WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=:name
  `, { name });
}

function normalizeIndexes(rawRows) {
  const grouped = new Map();
  for (const row of rawRows) {
    const name = value(row, 'INDEX_NAME');
    if (!grouped.has(name)) {
      grouped.set(name, {
        columns: [],
        indexType: String(value(row, 'INDEX_TYPE') || '').toUpperCase(),
        isVisible: String(value(row, 'IS_VISIBLE') || '').toUpperCase(),
        name,
        table: value(row, 'TABLE_NAME'),
        unique: Number(value(row, 'NON_UNIQUE')) === 0,
      });
    }
    grouped.get(name).columns.push({
      collation: value(row, 'COLLATION'),
      name: value(row, 'COLUMN_NAME'),
      sequence: Number(value(row, 'SEQ_IN_INDEX')),
      subPart: value(row, 'SUB_PART') === null ? null : Number(value(row, 'SUB_PART')),
    });
  }
  return [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeForeignKeys(rawRows) {
  const grouped = new Map();
  for (const row of rawRows) {
    const name = value(row, 'CONSTRAINT_NAME');
    if (!grouped.has(name)) {
      grouped.set(name, {
        fields: [],
        name,
        onDelete: String(value(row, 'DELETE_RULE')).toUpperCase().replace('NO ACTION', 'RESTRICT'),
        onUpdate: String(value(row, 'UPDATE_RULE')).toUpperCase().replace('NO ACTION', 'RESTRICT'),
        referencedFields: [],
        referencedTable: value(row, 'REFERENCED_TABLE_NAME'),
        table: value(row, 'TABLE_NAME'),
      });
    }
    grouped.get(name).fields.push(value(row, 'COLUMN_NAME'));
    grouped.get(name).referencedFields.push(value(row, 'REFERENCED_COLUMN_NAME'));
  }
  return [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeTriggers(rawRows) {
  return rawRows.map((row) => ({
    body: provisioningArtifacts.normalizeSql(value(row, 'ACTION_STATEMENT')),
    event: String(value(row, 'EVENT_MANIPULATION')).toUpperCase(),
    name: value(row, 'TRIGGER_NAME'),
    table: value(row, 'EVENT_OBJECT_TABLE'),
    timing: String(value(row, 'ACTION_TIMING')).toUpperCase(),
  })).sort((left, right) => left.name.localeCompare(right.name));
}

function columnSignature(rawRows) {
  return JSON.stringify(rawRows.map((column) => ({
    characterSet: value(column, 'CHARACTER_SET_NAME'),
    collation: value(column, 'COLLATION_NAME'),
    defaultValue: value(column, 'COLUMN_DEFAULT'),
    extra: value(column, 'EXTRA'),
    length: value(column, 'CHARACTER_MAXIMUM_LENGTH'),
    name: value(column, 'COLUMN_NAME'),
    nullable: value(column, 'IS_NULLABLE'),
    numericPrecision: value(column, 'NUMERIC_PRECISION'),
    numericScale: value(column, 'NUMERIC_SCALE'),
    ordinal: value(column, 'ORDINAL_POSITION'),
    precision: value(column, 'DATETIME_PRECISION'),
    table: value(column, 'TABLE_NAME'),
    type: value(column, 'COLUMN_TYPE'),
  })));
}

async function readArtifact(queryInterface, kind, item) {
  if (kind === 'column') return columnRows(queryInterface, item.table, item.name);
  if (kind === 'index') return indexRows(queryInterface, item.table, item.name);
  if (kind === 'foreignKey') return foreignKeyRows(queryInterface, item.table, item.name);
  if (kind === 'trigger') return triggerRows(queryInterface, item.table, item.name);
  if (kind === 'table') {
    const definition = await tableRows(queryInterface, item.table);
    if (definition.length === 0) return [];
    definition[0].__columns = await columnRows(queryInterface, item.table);
    definition[0].__foreignKeys = await foreignKeyRows(queryInterface, item.table);
    definition[0].__indexes = await indexRows(queryInterface, item.table);
    definition[0].__triggers = await triggerRows(queryInterface, item.table);
    return definition;
  }
  throw migrationError(`Unknown installation management artifact kind ${kind}`);
}

function artifactSignature(kind, rawRows) {
  if (kind === 'column') return columnSignature(rawRows);
  if (kind === 'index') return JSON.stringify(normalizeIndexes(rawRows));
  if (kind === 'foreignKey') return JSON.stringify(normalizeForeignKeys(rawRows));
  if (kind === 'trigger') return JSON.stringify(normalizeTriggers(rawRows));
  if (kind === 'table') {
    return JSON.stringify(rawRows.map((row) => ({
      collation: value(row, 'TABLE_COLLATION'),
      columns: JSON.parse(columnSignature(row.__columns || [])),
      engine: String(value(row, 'ENGINE') || '').toUpperCase(),
      foreignKeys: normalizeForeignKeys(row.__foreignKeys || []),
      indexes: normalizeIndexes(row.__indexes || []),
      name: value(row, 'TABLE_NAME'),
      triggers: normalizeTriggers(row.__triggers || []),
    })));
  }
  throw migrationError(`Unknown installation management artifact kind ${kind}`);
}

async function track(queryInterface, plan, kind, item) {
  const rawRows = await readArtifact(queryInterface, kind, item);
  if (rawRows.length === 0) {
    throw migrationError(`Cannot inventory created ${kind} ${item.name || item.table}`);
  }
  plan[kind].push({ ...item, signature: artifactSignature(kind, rawRows) });
  if (!['table', 'column'].includes(kind)) {
    const table = plan.table.find((candidate) => candidate.table === item.table);
    if (table) {
      table.signature = artifactSignature(
        'table',
        await readArtifact(queryInterface, 'table', table),
      );
    }
  }
}

function columnReasons(table, rawRows, expected) {
  if (rawRows.length !== expected.length) return [`table ${table} column count differs`];
  const reasons = [];
  expected.forEach(([name, type, nullable, length, extra], index) => {
    const row = rawRows[index];
    const actualType = String(value(row, 'COLUMN_TYPE') || '').toLowerCase();
    const typeMatches = type === 'int' ? /^int(?:\(\d+\))?$/u.test(actualType) : actualType === type;
    if (
      value(row, 'COLUMN_NAME') !== name || !typeMatches ||
      (String(value(row, 'IS_NULLABLE')).toUpperCase() === 'YES') !== nullable ||
      (length === null
        ? value(row, 'CHARACTER_MAXIMUM_LENGTH') !== null
        : Number(value(row, 'CHARACTER_MAXIMUM_LENGTH')) !== length) ||
      String(value(row, 'EXTRA') || '').toLowerCase() !== extra ||
      ![null, 'NULL'].includes(value(row, 'COLUMN_DEFAULT'))
    ) reasons.push(`column ${table}.${name} differs`);
  });
  return reasons;
}

function expectedIndexes(table) {
  const expected = INDEXES.filter((item) => item.table === table)
    .map(({ fields, name, unique }) => ({
      columns: fields.map((field, index) => ({
        collation: 'A',
        name: field,
        sequence: index + 1,
        subPart: null,
      })),
      indexType: 'BTREE',
      isVisible: 'YES',
      name,
      table,
      unique,
    }));
  if ([SESSION_TABLE, OPERATION_TABLE].includes(table)) {
    expected.push({
      columns: [{ collation: 'A', name: 'id', sequence: 1, subPart: null }],
      indexType: 'BTREE',
      isVisible: 'YES',
      name: 'PRIMARY',
      table,
      unique: true,
    });
  }
  return expected.sort((left, right) => left.name.localeCompare(right.name));
}

function expectedForeignKeys(table) {
  return FOREIGN_KEYS.filter((item) => item.table === table).map((item) => ({
    fields: [...item.fields],
    name: item.name,
    onDelete: item.onDelete,
    onUpdate: item.onUpdate,
    referencedFields: [...item.referencedFields],
    referencedTable: item.referencedTable,
    table: item.table,
  })).sort((left, right) => left.name.localeCompare(right.name));
}

function expectedTriggers(table) {
  return TRIGGERS.filter((item) => item.table === table).map((item) => ({
    body: provisioningArtifacts.normalizeSql(item.body),
    event: item.event,
    name: item.name,
    table: item.table,
    timing: 'BEFORE',
  })).sort((left, right) => left.name.localeCompare(right.name));
}

function indexIsCanonical(rawRows, expected, lowerCaseTableNames) {
  if (rawRows.length !== expected.columns.length) return false;
  return rawRows.every((row, index) => {
    const expectedColumn = expected.columns[index];
    const rawCollation = value(row, 'COLLATION');
    return tableIdentifierEquals(
      value(row, 'TABLE_NAME'),
      expected.table,
      lowerCaseTableNames,
    ) &&
      value(row, 'INDEX_NAME') === expected.name &&
      Number(value(row, 'NON_UNIQUE')) === (expected.unique ? 0 : 1) &&
      Number(value(row, 'SEQ_IN_INDEX')) === expectedColumn.sequence &&
      value(row, 'COLUMN_NAME') === expectedColumn.name &&
      value(row, 'SUB_PART') === expectedColumn.subPart &&
      rawCollation === expectedColumn.collation &&
      String(value(row, 'INDEX_TYPE') || '').toUpperCase() === expected.indexType &&
      String(value(row, 'IS_VISIBLE') || '').toUpperCase() === expected.isVisible;
  });
}

function foreignKeyIsCanonical(rawRows, expected, lowerCaseTableNames) {
  const rowsToCheck = Array.isArray(rawRows) ? rawRows : rawRows ? [rawRows] : [];
  const fields = expected.fields || [expected.column];
  const referencedFields = expected.referencedFields || [expected.referencedColumn];
  if (rowsToCheck.length !== fields.length) return false;
  return rowsToCheck.every((row, index) =>
    tableIdentifierEquals(value(row, 'TABLE_NAME'), expected.table, lowerCaseTableNames) &&
      value(row, 'CONSTRAINT_NAME') === expected.name &&
      Number(value(row, 'ORDINAL_POSITION')) === index + 1 &&
      value(row, 'COLUMN_NAME') === fields[index] &&
    tableIdentifierEquals(
      value(row, 'REFERENCED_TABLE_NAME'),
      expected.referencedTable,
      lowerCaseTableNames,
    ) &&
    value(row, 'REFERENCED_COLUMN_NAME') === referencedFields[index] &&
    String(value(row, 'UPDATE_RULE') || '').toUpperCase().replace('NO ACTION', 'RESTRICT') ===
      expected.onUpdate &&
    String(value(row, 'DELETE_RULE') || '').toUpperCase().replace('NO ACTION', 'RESTRICT') ===
      expected.onDelete);
}

function triggerIsCanonical(rawRows, expected, lowerCaseTableNames) {
  const rowsToCheck = Array.isArray(rawRows) ? rawRows : rawRows ? [rawRows] : [];
  if (rowsToCheck.length !== 1) return false;
  const row = rowsToCheck[0];
  return value(row, 'TRIGGER_NAME') === expected.name &&
    tableIdentifierEquals(
      value(row, 'EVENT_OBJECT_TABLE'),
      expected.table,
      lowerCaseTableNames,
    ) &&
    String(value(row, 'EVENT_MANIPULATION') || '').toUpperCase() === expected.event &&
    String(value(row, 'ACTION_TIMING') || '').toUpperCase() === 'BEFORE' &&
    provisioningArtifacts.normalizeSql(value(row, 'ACTION_STATEMENT')) ===
      provisioningArtifacts.normalizeSql(expected.body);
}

async function reservedArtifactCount(queryInterface) {
  const columnNames = TARGET_CONNECTION_COLUMNS.map(([name]) => name);
  let count = 0;
  for (const table of [SESSION_TABLE, OPERATION_TABLE]) {
    count += (await rawTableRows(queryInterface, table)).length;
  }
  const connectionColumns = await rows(queryInterface, `
    SELECT TABLE_NAME, COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table AND COLUMN_NAME IN (:columnNames)
  `, { columnNames, table: CONNECTION_TABLE });
  count += connectionColumns.length;
  for (const index of INDEXES) {
    const found = await rows(queryInterface, `
      SELECT TABLE_NAME, INDEX_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table AND INDEX_NAME=:name
       LIMIT 1
    `, index);
    count += found.length;
  }
  for (const foreignKey of FOREIGN_KEYS) {
    count += (await foreignKeyNameRows(queryInterface, foreignKey.name)).length;
  }
  for (const trigger of TRIGGERS) {
    count += (await triggerNameRows(queryInterface, trigger.name)).length;
  }
  return count;
}

async function connectionArtifactReasons(queryInterface) {
  const lowerCaseTableNames = await getLowerCaseTableNames(queryInterface);
  const reasons = [];
  for (const expected of TARGET_CONNECTION_COLUMNS) {
    reasons.push(...columnReasons(
      CONNECTION_TABLE,
      await columnRows(queryInterface, CONNECTION_TABLE, expected[0]),
      [expected],
    ));
  }
  const targetNames = new Set(TARGET_CONNECTION_COLUMNS.map(([name]) => name));
  const allIndexRows = await indexRows(queryInterface, CONNECTION_TABLE);
  const relevantNames = new Set(allIndexRows
    .filter((row) => INDEXES.some((item) => item.name === value(row, 'INDEX_NAME')) ||
      targetNames.has(value(row, 'COLUMN_NAME')))
    .map((row) => value(row, 'INDEX_NAME')));
  const expected = expectedIndexes(CONNECTION_TABLE);
  if (relevantNames.size !== expected.length ||
      expected.some((index) => !indexIsCanonical(
        allIndexRows.filter((row) => value(row, 'INDEX_NAME') === index.name),
        index,
        lowerCaseTableNames,
      ))) {
    reasons.push(`fingerprint indexes on ${CONNECTION_TABLE} differ`);
  }
  const triggerDependencies = await rows(queryInterface, `
    SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS
     WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE=:table
       AND (LOWER(ACTION_STATEMENT) LIKE '%credentialfingerprint%'
         OR LOWER(ACTION_STATEMENT) LIKE '%provideridentityfingerprint%'
         OR LOWER(ACTION_STATEMENT) LIKE '%fingerprintkeyversion%')
  `, { table: CONNECTION_TABLE });
  if (triggerDependencies.length > 0) reasons.push('fingerprint columns have trigger dependencies');
  return reasons;
}

async function classifyState(queryInterface) {
  if (queryInterface.sequelize.getDialect() !== 'mysql') {
    throw migrationError('Installation management requires MySQL definition guards');
  }
  const lowerCaseTableNames = await getLowerCaseTableNames(queryInterface);
  if (await reservedArtifactCount(queryInterface) === 0) {
    return { reasons: [], state: 'absent' };
  }
  const reasons = [];
  for (const table of [SESSION_TABLE, OPERATION_TABLE]) {
    const definition = await tableRows(queryInterface, table);
    if (definition.length !== 1 || String(value(definition[0], 'ENGINE')).toUpperCase() !== 'INNODB') {
      reasons.push(`table ${table} is missing or differs`);
      continue;
    }
    reasons.push(...columnReasons(table, await columnRows(queryInterface, table), TABLE_COLUMNS[table]));
    const actualIndexes = await indexRows(queryInterface, table);
    const expectedIndexDefinitions = expectedIndexes(table);
    const actualIndexNames = new Set(actualIndexes.map((row) => value(row, 'INDEX_NAME')));
    if (actualIndexNames.size !== expectedIndexDefinitions.length ||
        expectedIndexDefinitions.some((expected) => !indexIsCanonical(
          actualIndexes.filter((row) => value(row, 'INDEX_NAME') === expected.name),
          expected,
          lowerCaseTableNames,
        ))) reasons.push(`indexes on ${table} differ`);

    const actualForeignKeys = await foreignKeyRows(queryInterface, table);
    const expectedForeignKeyDefinitions = expectedForeignKeys(table);
    const actualForeignKeyNames = new Set(
      actualForeignKeys.map((row) => value(row, 'CONSTRAINT_NAME')),
    );
    if (actualForeignKeyNames.size !== expectedForeignKeyDefinitions.length ||
        expectedForeignKeyDefinitions.some((expected) => !foreignKeyIsCanonical(
          actualForeignKeys.filter((row) => value(row, 'CONSTRAINT_NAME') === expected.name),
          expected,
          lowerCaseTableNames,
        ))) reasons.push(`foreign keys on ${table} differ`);

    const actualTriggers = await triggerRows(queryInterface, table);
    const expectedTriggerDefinitions = expectedTriggers(table);
    const actualTriggerNames = new Set(actualTriggers.map((row) => value(row, 'TRIGGER_NAME')));
    if (actualTriggerNames.size !== expectedTriggerDefinitions.length ||
        expectedTriggerDefinitions.some((expected) => !triggerIsCanonical(
          actualTriggers.filter((row) => value(row, 'TRIGGER_NAME') === expected.name),
          expected,
          lowerCaseTableNames,
        ))) reasons.push(`triggers on ${table} differ`);
  }
  reasons.push(...await connectionArtifactReasons(queryInterface));
  return { reasons: [...new Set(reasons)], state: reasons.length === 0 ? 'ready' : 'partial' };
}

async function validateDataIntegrity(queryInterface) {
  const checks = [
    `SELECT COUNT(*) AS count FROM InstallationOperatorSessions
      WHERE sessionId='' OR username='' OR expiresAt<=createdAt`,
    `SELECT COUNT(*) AS count FROM InstallationMutationOperations operationRow
      LEFT JOIN Organizations organizationRow ON organizationRow.id=operationRow.organizationId
      LEFT JOIN Clubs club ON club.id=operationRow.clubId AND club.organizationId=operationRow.organizationId
      LEFT JOIN AuditLogs audit ON audit.id=operationRow.auditLogId
        AND audit.organizationId=operationRow.organizationId
        AND audit.clubId <=> operationRow.clubId
     WHERE organizationRow.id IS NULL OR audit.id IS NULL
        OR (operationRow.clubId IS NOT NULL AND club.id IS NULL)`,
    `SELECT COUNT(*) AS count FROM IntegrationConnections
      WHERE (credentialFingerprint IS NOT NULL OR providerIdentityFingerprint IS NOT NULL)
        AND fingerprintKeyVersion IS NULL`,
  ];
  for (const sql of checks) {
    const result = await rows(queryInterface, sql);
    if (Number(value(result[0], 'count') || 0) > 0) {
      throw migrationError(
        'Installation management migration found invalid authority data',
        'INSTALLATION_MANAGEMENT_DATA_INVALID',
      );
    }
  }
}

async function preflightCleanupInvocation(queryInterface, plan) {
  for (const kind of ['table', 'column', 'index', 'foreignKey', 'trigger']) {
    for (const item of plan[kind]) {
      const current = await readArtifact(queryInterface, kind, item);
      if (current.length === 0 || artifactSignature(kind, current) !== item.signature) {
        throw migrationError(
          `Installation management cleanup ownership lost for ${kind} ${item.table}.${item.name || ''}`,
          'INSTALLATION_MANAGEMENT_CLEANUP_OWNERSHIP_LOST',
        );
      }
    }
  }
}

async function cleanupInvocation(queryInterface, plan) {
  await preflightCleanupInvocation(queryInterface, plan);
  for (const item of [...plan.trigger].reverse()) {
    await queryInterface.sequelize.query(`DROP TRIGGER \`${item.name}\``);
  }
  for (const item of [...plan.foreignKey].reverse()) {
    await queryInterface.removeConstraint(item.table, item.name);
  }
  for (const item of [...plan.index].reverse()) {
    await queryInterface.removeIndex(item.table, item.name);
  }
  for (const item of [...plan.column].reverse()) {
    await queryInterface.removeColumn(item.table, item.name);
  }
  for (const item of [...plan.table].reverse()) await queryInterface.dropTable(item.table);
}

function sessionColumns(Sequelize) {
  return {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
    sessionId: { allowNull: false, type: Sequelize.STRING(32) },
    username: { allowNull: false, type: Sequelize.STRING(120) },
    expiresAt: { allowNull: false, type: Sequelize.DATE },
    revokedAt: { allowNull: true, type: Sequelize.DATE },
    createdAt: { allowNull: false, type: Sequelize.DATE },
    updatedAt: { allowNull: false, type: Sequelize.DATE },
  };
}

function operationColumns(Sequelize) {
  return {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
    idempotencyKeyHash: { allowNull: false, type: Sequelize.STRING(64) },
    payloadHash: { allowNull: false, type: Sequelize.STRING(64) },
    organizationId: { allowNull: false, type: Sequelize.INTEGER },
    clubId: { allowNull: true, type: Sequelize.INTEGER },
    action: { allowNull: false, type: Sequelize.STRING(96) },
    response: { allowNull: false, type: Sequelize.JSON },
    auditLogId: { allowNull: false, type: Sequelize.INTEGER },
    createdAt: { allowNull: false, type: Sequelize.DATE },
    updatedAt: { allowNull: false, type: Sequelize.DATE },
  };
}

async function createTrigger(queryInterface, definition) {
  await queryInterface.sequelize.query(
    `CREATE TRIGGER \`${definition.name}\` BEFORE ${definition.event} ON \`${definition.table}\` FOR EACH ROW ${definition.body}`,
  );
}

async function addTableArtifacts(queryInterface, plan, table) {
  for (const item of INDEXES.filter((candidate) => candidate.table === table)) {
    await queryInterface.addIndex(item.table, item.fields, { name: item.name, unique: item.unique });
    await track(queryInterface, plan, 'index', item);
    maybeFail(`index_${item.name}`);
  }
  for (const item of FOREIGN_KEYS.filter((candidate) => candidate.table === table)) {
    await queryInterface.addConstraint(item.table, {
      fields: item.fields,
      name: item.name,
      onDelete: item.onDelete,
      onUpdate: item.onUpdate,
      references: { fields: item.referencedFields, table: item.referencedTable },
      type: 'foreign key',
    });
    await track(queryInterface, plan, 'foreignKey', item);
    maybeFail(`foreign_key_${item.name}`);
  }
  for (const item of TRIGGERS.filter((candidate) => candidate.table === table)) {
    await createTrigger(queryInterface, item);
    await track(queryInterface, plan, 'trigger', item);
    maybeFail(`trigger_${item.name}`);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const classification = await classifyState(queryInterface);
    if (classification.state === 'ready') {
      await validateDataIntegrity(queryInterface);
      return;
    }
    if (classification.state !== 'absent') {
      throw migrationError(
        `Installation management migration refused partial/lookalike state: ${classification.reasons.join('; ')}`,
        'INSTALLATION_MANAGEMENT_REPAIR_REQUIRED',
      );
    }
    const plan = { column: [], foreignKey: [], index: [], table: [], trigger: [] };
    try {
      await queryInterface.createTable(SESSION_TABLE, sessionColumns(Sequelize));
      await track(queryInterface, plan, 'table', { table: SESSION_TABLE });
      maybeFail('session_table');
      await addTableArtifacts(queryInterface, plan, SESSION_TABLE);

      await queryInterface.createTable(OPERATION_TABLE, operationColumns(Sequelize));
      await track(queryInterface, plan, 'table', { table: OPERATION_TABLE });
      maybeFail('operation_table');
      await addTableArtifacts(queryInterface, plan, OPERATION_TABLE);

      for (const [name, , , length] of TARGET_CONNECTION_COLUMNS) {
        await queryInterface.addColumn(CONNECTION_TABLE, name, {
          allowNull: true,
          type: Sequelize.STRING(length),
        });
        await track(queryInterface, plan, 'column', { name, table: CONNECTION_TABLE });
        maybeFail(`column_${name}`);
      }
      await addTableArtifacts(queryInterface, plan, CONNECTION_TABLE);

      const ready = await classifyState(queryInterface);
      if (ready.state !== 'ready') {
        throw migrationError(`Migration did not reach ready state: ${ready.reasons.join('; ')}`);
      }
      await validateDataIntegrity(queryInterface);
    } catch (error) {
      try {
        await cleanupInvocation(queryInterface, plan);
      } catch (cleanupError) {
        cleanupError.migrationError = error;
        throw cleanupError;
      }
      throw error;
    }
  },

  async down(queryInterface) {
    const classification = await classifyState(queryInterface);
    if (classification.state === 'absent') return;
    if (classification.state !== 'ready') {
      throw migrationError(
        `Installation management rollback refused partial/lookalike state: ${classification.reasons.join('; ')}`,
        'INSTALLATION_MANAGEMENT_REPAIR_REQUIRED',
      );
    }
    await validateDataIntegrity(queryInterface);
    const data = await rows(queryInterface, `
      SELECT
        (SELECT COUNT(*) FROM InstallationOperatorSessions) AS sessions,
        (SELECT COUNT(*) FROM InstallationMutationOperations) AS operations,
        (SELECT COUNT(*) FROM IntegrationConnections
          WHERE credentialFingerprint IS NOT NULL
             OR providerIdentityFingerprint IS NOT NULL
             OR fingerprintKeyVersion IS NOT NULL) AS fingerprints
    `);
    if (Number(value(data[0], 'sessions')) > 0 || Number(value(data[0], 'operations')) > 0) {
      throw migrationError(
        'Installation management rollback refused while operator history exists',
        'INSTALLATION_MANAGEMENT_ROLLBACK_HISTORY_PRESENT',
      );
    }
    if (Number(value(data[0], 'fingerprints')) > 0) {
      throw migrationError(
        'Installation management rollback refused while fingerprint data exists',
        'INSTALLATION_MANAGEMENT_ROLLBACK_FINGERPRINTS_PRESENT',
      );
    }
    for (const item of [...TRIGGERS].reverse()) {
      await queryInterface.sequelize.query(`DROP TRIGGER \`${item.name}\``);
    }
    await queryInterface.dropTable(OPERATION_TABLE);
    await queryInterface.dropTable(SESSION_TABLE);
    for (const item of INDEXES.filter((candidate) => candidate.table === CONNECTION_TABLE).reverse()) {
      await queryInterface.removeIndex(item.table, item.name);
    }
    for (const [name] of [...TARGET_CONNECTION_COLUMNS].reverse()) {
      await queryInterface.removeColumn(CONNECTION_TABLE, name);
    }
    const absent = await classifyState(queryInterface);
    if (absent.state !== 'absent') {
      throw migrationError(`Rollback did not reach absent state: ${absent.reasons.join('; ')}`);
    }
  },

  __testing: {
    CONNECTION_TABLE,
    DDL_STEPS,
    FOREIGN_KEYS,
    INDEXES,
    OPERATION_TABLE,
    SESSION_TABLE,
    TABLE_COLUMNS,
    TARGET_CONNECTION_COLUMNS,
    TRIGGERS,
    artifactSignature,
    classifyState,
    cleanupInvocation,
    foreignKeyIsCanonical,
    getLowerCaseTableNames,
    indexIsCanonical,
    preflightCleanupInvocation,
    readArtifact,
    supportsIndexVisibility,
    tableIdentifierEquals,
    triggerIsCanonical,
    validateDataIntegrity,
  },
};
