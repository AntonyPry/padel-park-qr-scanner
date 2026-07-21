'use strict';

const provisioningArtifacts = require('./20260720120000-add-installation-provisioning').__testing;

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

async function tableRows(queryInterface, table) {
  return rows(queryInterface, `
    SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
      FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table
  `, { table });
}

async function columnRows(queryInterface, table, name = null) {
  return rows(queryInterface, `
    SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, COLUMN_TYPE,
           IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH, CHARACTER_SET_NAME,
           COLLATION_NAME, DATETIME_PRECISION, NUMERIC_PRECISION, NUMERIC_SCALE,
           COLUMN_DEFAULT, EXTRA
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table
       ${name ? 'AND COLUMN_NAME=:name' : ''}
     ORDER BY ORDINAL_POSITION
  `, { name, table });
}

async function indexRows(queryInterface, table) {
  return rows(queryInterface, `
    SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
           SUB_PART, COLLATION, INDEX_TYPE
      FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table
     ORDER BY INDEX_NAME, SEQ_IN_INDEX
  `, { table });
}

async function foreignKeyRows(queryInterface, table) {
  return rows(queryInterface, `
    SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
           k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
           r.UPDATE_RULE, r.DELETE_RULE
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
      JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
       AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
       AND r.TABLE_NAME=k.TABLE_NAME
     WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME=:table
     ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION
  `, { table });
}

async function triggerRows(queryInterface, table) {
  return rows(queryInterface, `
    SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING,
           EVENT_MANIPULATION, ACTION_STATEMENT
      FROM INFORMATION_SCHEMA.TRIGGERS
     WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE=:table
     ORDER BY TRIGGER_NAME
  `, { table });
}

function normalizeIndexes(rawRows) {
  const grouped = new Map();
  for (const row of rawRows) {
    const name = value(row, 'INDEX_NAME');
    if (!grouped.has(name)) {
      grouped.set(name, {
        fields: [],
        name,
        unique: Number(value(row, 'NON_UNIQUE')) === 0,
      });
    }
    grouped.get(name).fields.push(value(row, 'COLUMN_NAME'));
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
        referencedTable: String(value(row, 'REFERENCED_TABLE_NAME')).toLowerCase(),
        table: String(value(row, 'TABLE_NAME')).toLowerCase(),
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
    table: String(value(row, 'EVENT_OBJECT_TABLE')).toLowerCase(),
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
  return provisioningArtifacts.readArtifact(queryInterface, kind, item);
}

function artifactSignature(kind, rawRows) {
  return kind === 'column'
    ? columnSignature(rawRows)
    : provisioningArtifacts.artifactSignature(kind, rawRows);
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
    .map(({ fields, name, unique }) => ({ fields: [...fields], name, unique }));
  if ([SESSION_TABLE, OPERATION_TABLE].includes(table)) {
    expected.push({ fields: ['id'], name: 'PRIMARY', unique: true });
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
    referencedTable: item.referencedTable.toLowerCase(),
    table: item.table.toLowerCase(),
  })).sort((left, right) => left.name.localeCompare(right.name));
}

function expectedTriggers(table) {
  return TRIGGERS.filter((item) => item.table === table).map((item) => ({
    body: provisioningArtifacts.normalizeSql(item.body),
    event: item.event,
    name: item.name,
    table: item.table.toLowerCase(),
    timing: 'BEFORE',
  })).sort((left, right) => left.name.localeCompare(right.name));
}

async function reservedArtifactCount(queryInterface) {
  const tableNames = [SESSION_TABLE, OPERATION_TABLE];
  const triggerNames = TRIGGERS.map((item) => item.name);
  const foreignKeyNames = FOREIGN_KEYS.map((item) => item.name);
  const indexNames = INDEXES.map((item) => item.name);
  const columnNames = TARGET_CONNECTION_COLUMNS.map(([name]) => name);
  const result = await rows(queryInterface, `
    SELECT
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (:tableNames)) AS tablesCount,
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TRIGGERS
        WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN (:triggerNames)) AS triggersCount,
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN (:foreignKeyNames)) AS foreignKeysCount,
      (SELECT COUNT(DISTINCT CONCAT(TABLE_NAME, ':', INDEX_NAME))
         FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE() AND INDEX_NAME IN (:indexNames)) AS indexesCount,
      (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:connectionTable
          AND COLUMN_NAME IN (:columnNames)) AS columnsCount
  `, { columnNames, connectionTable: CONNECTION_TABLE, foreignKeyNames, indexNames, tableNames, triggerNames });
  return Object.values(result[0] || {}).reduce((sum, item) => sum + Number(item || 0), 0);
}

async function connectionArtifactReasons(queryInterface) {
  const reasons = [];
  for (const expected of TARGET_CONNECTION_COLUMNS) {
    reasons.push(...columnReasons(
      CONNECTION_TABLE,
      await columnRows(queryInterface, CONNECTION_TABLE, expected[0]),
      [expected],
    ));
  }
  const targetNames = new Set(TARGET_CONNECTION_COLUMNS.map(([name]) => name));
  const relevantIndexes = normalizeIndexes(await indexRows(queryInterface, CONNECTION_TABLE))
    .filter((index) => INDEXES.some((item) => item.name === index.name) ||
      index.fields.some((field) => targetNames.has(field)));
  if (JSON.stringify(relevantIndexes) !== JSON.stringify(expectedIndexes(CONNECTION_TABLE))) {
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
    if (JSON.stringify(normalizeIndexes(await indexRows(queryInterface, table))) !==
        JSON.stringify(expectedIndexes(table))) reasons.push(`indexes on ${table} differ`);
    if (JSON.stringify(normalizeForeignKeys(await foreignKeyRows(queryInterface, table))) !==
        JSON.stringify(expectedForeignKeys(table))) reasons.push(`foreign keys on ${table} differ`);
    if (JSON.stringify(normalizeTriggers(await triggerRows(queryInterface, table))) !==
        JSON.stringify(expectedTriggers(table))) reasons.push(`triggers on ${table} differ`);
  }
  reasons.push(...await connectionArtifactReasons(queryInterface));
  const reservedIndexes = await rows(queryInterface, `
    SELECT DISTINCT TABLE_NAME, INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND INDEX_NAME IN (:names)
  `, { names: INDEXES.map((item) => item.name) });
  for (const row of reservedIndexes) {
    const expected = INDEXES.find((item) => item.name === value(row, 'INDEX_NAME'));
    if (!expected || value(row, 'TABLE_NAME') !== expected.table) {
      reasons.push(`reserved index ${value(row, 'INDEX_NAME')} is attached to another table`);
    }
  }
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
    preflightCleanupInvocation,
    readArtifact,
    validateDataIntegrity,
  },
};
