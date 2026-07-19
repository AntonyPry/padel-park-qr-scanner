'use strict';

const TABLES = Object.freeze({
  activation: 'OwnerActivationTokens',
  operation: 'InstallationProvisioningOperations',
});

const INDEXES = Object.freeze([
  { table: TABLES.activation, name: 'uq_owner_activation_token_hash', unique: true, fields: ['tokenHash'] },
  { table: TABLES.activation, name: 'idx_owner_activation_org_account_created', unique: false, fields: ['organizationId', 'accountId', 'createdAt'] },
  { table: TABLES.operation, name: 'uq_installation_provisioning_idempotency_hash', unique: true, fields: ['idempotencyKeyHash'] },
  { table: TABLES.operation, name: 'uq_installation_provisioning_organization', unique: true, fields: ['organizationId'] },
  { table: TABLES.operation, name: 'idx_installation_provisioning_org_created', unique: false, fields: ['organizationId', 'createdAt'] },
]);

const FOREIGN_KEYS = Object.freeze([
  { table: TABLES.activation, name: 'fk_owner_activation_org', fields: ['organizationId'], referencedTable: 'Organizations', referencedFields: ['id'] },
  { table: TABLES.activation, name: 'fk_owner_activation_account', fields: ['accountId'], referencedTable: 'Accounts', referencedFields: ['id'] },
  { table: TABLES.operation, name: 'fk_installation_provisioning_org', fields: ['organizationId'], referencedTable: 'Organizations', referencedFields: ['id'] },
  { table: TABLES.operation, name: 'fk_installation_provisioning_owner', fields: ['ownerAccountId'], referencedTable: 'Accounts', referencedFields: ['id'] },
  { table: TABLES.operation, name: 'fk_installation_provisioning_activation', fields: ['activationTokenId'], referencedTable: TABLES.activation, referencedFields: ['id'] },
  { table: TABLES.operation, name: 'fk_installation_provisioning_audit', fields: ['auditLogId'], referencedTable: 'AuditLogs', referencedFields: ['id'] },
].map((item) => Object.freeze({ ...item, onDelete: 'RESTRICT', onUpdate: 'RESTRICT' })));

const OWNER_GRAPH_SQL = `(SELECT 1
    FROM Organizations o
    JOIN Accounts a ON a.id = NEW.accountId
    JOIN Memberships m
      ON m.accountId = a.id
     AND m.organizationId = NEW.organizationId
     AND m.role = 'owner'
     AND m.status = 'active'
    JOIN Staffs s
      ON s.id = a.staffId
     AND s.id = m.staffId
     AND s.organizationId = NEW.organizationId
     AND s.status = 'active'
   WHERE o.id = NEW.organizationId
     AND o.status = 'active'
     AND a.status = 'active'
     AND a.role = 'owner')`;

const OPERATION_OWNER_GRAPH_SQL = `(SELECT 1
    FROM Organizations o
    JOIN Accounts a ON a.id = NEW.ownerAccountId
    JOIN Memberships m
      ON m.accountId = a.id
     AND m.organizationId = NEW.organizationId
     AND m.role = 'owner'
     AND m.status = 'active'
    JOIN Staffs s
      ON s.id = a.staffId
     AND s.id = m.staffId
     AND s.organizationId = NEW.organizationId
     AND s.status = 'active'
   WHERE o.id = NEW.organizationId
     AND o.status = 'active'
     AND a.status = 'active'
     AND a.role = 'owner')`;

const TRIGGERS = Object.freeze([
  {
    table: TABLES.activation,
    name: 'trg_owner_activation_tokens_bi',
    event: 'INSERT',
    body: `BEGIN
      IF NEW.consumedAt IS NOT NULL OR NEW.invalidatedAt IS NOT NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Owner activation token must start pending';
      END IF;
      IF NOT EXISTS ${OWNER_GRAPH_SQL} THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Owner activation authority mismatch';
      END IF;
    END`,
  },
  {
    table: TABLES.activation,
    name: 'trg_owner_activation_tokens_bu',
    event: 'UPDATE',
    body: `BEGIN
      IF NOT (NEW.organizationId <=> OLD.organizationId)
         OR NOT (NEW.accountId <=> OLD.accountId)
         OR NOT (NEW.tokenHash <=> OLD.tokenHash)
         OR NOT (NEW.expiresAt <=> OLD.expiresAt)
         OR NOT (NEW.createdAt <=> OLD.createdAt) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Owner activation authority is immutable';
      END IF;
      IF NEW.consumedAt IS NOT NULL AND NEW.invalidatedAt IS NOT NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Owner activation state is impossible';
      END IF;
      IF OLD.consumedAt IS NOT NULL AND NOT (NEW.consumedAt <=> OLD.consumedAt) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Owner activation consumption is irreversible';
      END IF;
      IF OLD.invalidatedAt IS NOT NULL AND NOT (NEW.invalidatedAt <=> OLD.invalidatedAt) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Owner activation invalidation is irreversible';
      END IF;
      IF NOT EXISTS ${OWNER_GRAPH_SQL} THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Owner activation authority mismatch';
      END IF;
    END`,
  },
  {
    table: TABLES.activation,
    name: 'trg_owner_activation_tokens_bd',
    event: 'DELETE',
    body: "BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Owner activation history is immutable'; END",
  },
  {
    table: TABLES.operation,
    name: 'trg_installation_provisioning_operations_bi',
    event: 'INSERT',
    body: `BEGIN
      IF NOT EXISTS ${OPERATION_OWNER_GRAPH_SQL} THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provisioning owner authority mismatch';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM OwnerActivationTokens token
        WHERE token.id = NEW.activationTokenId
          AND token.organizationId = NEW.organizationId
          AND token.accountId = NEW.ownerAccountId
      ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provisioning activation authority mismatch';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM AuditLogs audit
        WHERE audit.id = NEW.auditLogId
          AND audit.organizationId = NEW.organizationId
      ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provisioning audit authority mismatch';
      END IF;
    END`,
  },
  {
    table: TABLES.operation,
    name: 'trg_installation_provisioning_operations_bu',
    event: 'UPDATE',
    body: `BEGIN
      IF NOT (NEW.idempotencyKeyHash <=> OLD.idempotencyKeyHash)
         OR NOT (NEW.payloadHash <=> OLD.payloadHash)
         OR NOT (NEW.organizationId <=> OLD.organizationId)
         OR NOT (NEW.ownerAccountId <=> OLD.ownerAccountId)
         OR NOT (NEW.auditLogId <=> OLD.auditLogId)
         OR NOT (NEW.createdAt <=> OLD.createdAt) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provisioning operation authority is immutable';
      END IF;
      IF NOT EXISTS ${OPERATION_OWNER_GRAPH_SQL} THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provisioning owner authority mismatch';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM OwnerActivationTokens token
        WHERE token.id = NEW.activationTokenId
          AND token.organizationId = NEW.organizationId
          AND token.accountId = NEW.ownerAccountId
          AND token.consumedAt IS NULL
          AND token.invalidatedAt IS NULL
          AND token.expiresAt > CURRENT_TIMESTAMP
      ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provisioning activation authority mismatch';
      END IF;
      IF NEW.activationTokenId <> OLD.activationTokenId AND NOT EXISTS (
        SELECT 1 FROM OwnerActivationTokens previous
        WHERE previous.id = OLD.activationTokenId
          AND previous.organizationId = OLD.organizationId
          AND previous.accountId = OLD.ownerAccountId
          AND previous.consumedAt IS NULL
          AND previous.invalidatedAt IS NOT NULL
      ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Previous activation must be invalidated before reissue';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM AuditLogs audit
        WHERE audit.id = NEW.auditLogId
          AND audit.organizationId = NEW.organizationId
      ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provisioning audit authority mismatch';
      END IF;
    END`,
  },
  {
    table: TABLES.operation,
    name: 'trg_installation_provisioning_operations_bd',
    event: 'DELETE',
    body: "BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Provisioning operation history is immutable'; END",
  },
]);

const COLUMN_DEFINITIONS = Object.freeze({
  [TABLES.activation]: Object.freeze([
    ['id', 'int', false, null, 'auto_increment'],
    ['organizationId', 'int', false, null, ''],
    ['accountId', 'int', false, null, ''],
    ['tokenHash', 'varchar(64)', false, 64, ''],
    ['expiresAt', 'datetime', false, null, ''],
    ['consumedAt', 'datetime', true, null, ''],
    ['invalidatedAt', 'datetime', true, null, ''],
    ['createdAt', 'datetime', false, null, ''],
    ['updatedAt', 'datetime', false, null, ''],
  ]),
  [TABLES.operation]: Object.freeze([
    ['id', 'int', false, null, 'auto_increment'],
    ['idempotencyKeyHash', 'varchar(64)', false, 64, ''],
    ['payloadHash', 'varchar(64)', false, 64, ''],
    ['organizationId', 'int', false, null, ''],
    ['ownerAccountId', 'int', false, null, ''],
    ['activationTokenId', 'int', false, null, ''],
    ['auditLogId', 'int', false, null, ''],
    ['createdAt', 'datetime', false, null, ''],
    ['updatedAt', 'datetime', false, null, ''],
  ]),
});

const EXPECTED_INDEXES = Object.freeze({
  [TABLES.activation]: Object.freeze([
    ['PRIMARY', true, ['id']],
    ['fk_owner_activation_account', false, ['accountId']],
    ['idx_owner_activation_org_account_created', false, ['organizationId', 'accountId', 'createdAt']],
    ['uq_owner_activation_token_hash', true, ['tokenHash']],
  ]),
  [TABLES.operation]: Object.freeze([
    ['PRIMARY', true, ['id']],
    ['fk_installation_provisioning_activation', false, ['activationTokenId']],
    ['fk_installation_provisioning_audit', false, ['auditLogId']],
    ['fk_installation_provisioning_owner', false, ['ownerAccountId']],
    ['idx_installation_provisioning_org_created', false, ['organizationId', 'createdAt']],
    ['uq_installation_provisioning_idempotency_hash', true, ['idempotencyKeyHash']],
    ['uq_installation_provisioning_organization', true, ['organizationId']],
  ]),
});

const DDL_STEPS = Object.freeze([
  'activation_table',
  ...INDEXES.filter((item) => item.table === TABLES.activation).map((item) => `index_${item.name}`),
  ...FOREIGN_KEYS.filter((item) => item.table === TABLES.activation).map((item) => `foreign_key_${item.name}`),
  ...TRIGGERS.filter((item) => item.table === TABLES.activation).map((item) => `trigger_${item.name}`),
  'operation_table',
  ...INDEXES.filter((item) => item.table === TABLES.operation).map((item) => `index_${item.name}`),
  ...FOREIGN_KEYS.filter((item) => item.table === TABLES.operation).map((item) => `foreign_key_${item.name}`),
  ...TRIGGERS.filter((item) => item.table === TABLES.operation).map((item) => `trigger_${item.name}`),
]);

function migrationError(message, code = 'INSTALLATION_PROVISIONING_MIGRATION_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function maybeFail(step) {
  if (process.env.INSTALLATION_PROVISIONING_MIGRATION_FAIL_STEP === step) {
    throw migrationError(
      `Forced installation provisioning migration failure after ${step}`,
      'INSTALLATION_PROVISIONING_MIGRATION_FORCED_FAILURE',
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

function normalizeSql(sql) {
  return String(sql || '')
    .replace(/`/gu, '')
    .replace(/\s+/gu, ' ')
    .replace(/\s*([(),;])\s*/gu, '$1')
    .replace(/\s*(<=>|<>|!=|<=|>=|=|<|>)\s*/gu, '$1')
    .trim()
    .toLowerCase();
}

async function tableRows(queryInterface, table) {
  return rows(queryInterface, `
    SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
      FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table
  `, { table });
}

async function columnRows(queryInterface, table) {
  return rows(queryInterface, `
    SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, COLUMN_TYPE,
           IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH, CHARACTER_SET_NAME,
           COLLATION_NAME, DATETIME_PRECISION, NUMERIC_PRECISION, NUMERIC_SCALE,
           COLUMN_DEFAULT, EXTRA
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table
     ORDER BY ORDINAL_POSITION
  `, { table });
}

async function indexRows(queryInterface, table, name) {
  return rows(queryInterface, `
    SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
           SUB_PART, COLLATION, INDEX_TYPE
      FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table
       ${name ? 'AND INDEX_NAME = :name' : ''}
     ORDER BY INDEX_NAME, SEQ_IN_INDEX
  `, { name, table });
}

async function foreignKeyRows(queryInterface, name) {
  return rows(queryInterface, `
    SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
           k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
           r.UPDATE_RULE, r.DELETE_RULE
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
      JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
       AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
       AND r.TABLE_NAME = k.TABLE_NAME
     WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND k.CONSTRAINT_NAME = :name
     ORDER BY k.TABLE_NAME, k.ORDINAL_POSITION
  `, { name });
}

async function allForeignKeyRows(queryInterface, table) {
  return rows(queryInterface, `
    SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
           k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
           r.UPDATE_RULE, r.DELETE_RULE
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
      JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
       AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
       AND r.TABLE_NAME = k.TABLE_NAME
     WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND k.TABLE_NAME = :table
     ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION
  `, { table });
}

async function triggerRows(queryInterface, name) {
  return rows(queryInterface, `
    SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING,
           EVENT_MANIPULATION, ACTION_STATEMENT
      FROM INFORMATION_SCHEMA.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = :name
  `, { name });
}

async function allTriggerRows(queryInterface, table) {
  return rows(queryInterface, `
    SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING,
           EVENT_MANIPULATION, ACTION_STATEMENT
      FROM INFORMATION_SCHEMA.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = :table
     ORDER BY TRIGGER_NAME
  `, { table });
}

function normalizeIndexes(rawRows) {
  const grouped = new Map();
  for (const row of rawRows) {
    const name = value(row, 'INDEX_NAME');
    if (!grouped.has(name)) grouped.set(name, { fields: [], name, unique: Number(value(row, 'NON_UNIQUE')) === 0 });
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

function artifactSignature(kind, rawRows) {
  if (kind === 'table') {
    return JSON.stringify(rawRows.map((row) => ({
      collation: value(row, 'TABLE_COLLATION'),
      columns: (row.__columns || []).map((column) => ({
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
        type: value(column, 'COLUMN_TYPE'),
      })),
      engine: String(value(row, 'ENGINE')).toUpperCase(),
      foreignKeys: normalizeForeignKeys(row.__foreignKeys || []),
      indexes: normalizeIndexes(row.__indexes || []),
      name: value(row, 'TABLE_NAME'),
      triggers: (row.__triggers || []).map((trigger) => ({
        body: normalizeSql(value(trigger, 'ACTION_STATEMENT')),
        event: String(value(trigger, 'EVENT_MANIPULATION')).toUpperCase(),
        name: value(trigger, 'TRIGGER_NAME'),
        table: value(trigger, 'EVENT_OBJECT_TABLE'),
        timing: String(value(trigger, 'ACTION_TIMING')).toUpperCase(),
      })),
    })));
  }
  if (kind === 'index') return JSON.stringify(normalizeIndexes(rawRows));
  if (kind === 'foreignKey') return JSON.stringify(normalizeForeignKeys(rawRows));
  if (kind === 'trigger') {
    return JSON.stringify(rawRows.map((row) => ({
      body: normalizeSql(value(row, 'ACTION_STATEMENT')),
      event: String(value(row, 'EVENT_MANIPULATION')).toUpperCase(),
      name: value(row, 'TRIGGER_NAME'),
      table: value(row, 'EVENT_OBJECT_TABLE'),
      timing: String(value(row, 'ACTION_TIMING')).toUpperCase(),
    })));
  }
  throw migrationError(`Unknown provisioning artifact kind ${kind}`);
}

async function readArtifact(queryInterface, kind, item) {
  if (kind === 'table') {
    const definition = await tableRows(queryInterface, item.table);
    if (definition.length === 0) return [];
    definition[0].__columns = await columnRows(queryInterface, item.table);
    definition[0].__foreignKeys = await allForeignKeyRows(queryInterface, item.table);
    definition[0].__indexes = await indexRows(queryInterface, item.table);
    definition[0].__triggers = await allTriggerRows(queryInterface, item.table);
    return definition;
  }
  if (kind === 'index') return indexRows(queryInterface, item.table, item.name);
  if (kind === 'foreignKey') return foreignKeyRows(queryInterface, item.name);
  if (kind === 'trigger') return triggerRows(queryInterface, item.name);
  throw migrationError(`Unknown provisioning artifact kind ${kind}`);
}

async function track(queryInterface, plan, kind, item) {
  const rawRows = await readArtifact(queryInterface, kind, item);
  if (rawRows.length === 0) throw migrationError(`Cannot inventory created ${kind} ${item.name || item.table}`);
  plan[kind].push({ ...item, signature: artifactSignature(kind, rawRows) });
  if (kind !== 'table') {
    const table = plan.table.find((candidate) => candidate.table === item.table);
    if (table) {
      table.signature = artifactSignature(
        'table',
        await readArtifact(queryInterface, 'table', table),
      );
    }
  }
}

function columnReasons(table, rawRows) {
  const expected = COLUMN_DEFINITIONS[table];
  if (rawRows.length !== expected.length) return [`table ${table} column count differs`];
  const reasons = [];
  expected.forEach(([name, type, nullable, length, extra], index) => {
    const row = rawRows[index];
    const actualType = String(value(row, 'COLUMN_TYPE') || '').toLowerCase();
    const typeMatches = type === 'int' ? /^int(?:\(\d+\))?$/u.test(actualType) : actualType === type;
    if (
      value(row, 'COLUMN_NAME') !== name || !typeMatches ||
      (String(value(row, 'IS_NULLABLE')).toUpperCase() === 'YES') !== nullable ||
      (length === null ? value(row, 'CHARACTER_MAXIMUM_LENGTH') !== null : Number(value(row, 'CHARACTER_MAXIMUM_LENGTH')) !== length) ||
      String(value(row, 'EXTRA') || '').toLowerCase() !== extra ||
      ![null, 'NULL'].includes(value(row, 'COLUMN_DEFAULT'))
    ) reasons.push(`column ${table}.${name} differs`);
  });
  return reasons;
}

function expectedIndexShape(table) {
  return EXPECTED_INDEXES[table]
    .map(([name, unique, fields]) => ({ fields: [...fields], name, unique }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function expectedForeignKeyShape(table) {
  return FOREIGN_KEYS.filter((item) => item.table === table)
    .map((item) => ({
      fields: [...item.fields],
      name: item.name,
      onDelete: item.onDelete,
      onUpdate: item.onUpdate,
      referencedFields: [...item.referencedFields],
      referencedTable: item.referencedTable.toLowerCase(),
      table: item.table.toLowerCase(),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function expectedTriggerShape(table) {
  return TRIGGERS.filter((item) => item.table === table)
    .map((item) => ({
      body: normalizeSql(item.body),
      event: item.event,
      name: item.name,
      table: item.table.toLowerCase(),
      timing: 'BEFORE',
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function reservedArtifacts(queryInterface) {
  const tableNames = Object.values(TABLES);
  const triggerNames = TRIGGERS.map((item) => item.name);
  const constraintNames = FOREIGN_KEYS.map((item) => item.name);
  const indexNames = INDEXES.map((item) => item.name);
  return Promise.all([
    rows(queryInterface, `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (:tableNames)`, { tableNames }),
    rows(queryInterface, `SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN (:triggerNames)`, { triggerNames }),
    rows(queryInterface, `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN (:constraintNames)`, { constraintNames }),
    rows(queryInterface, `SELECT TABLE_NAME, INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND INDEX_NAME IN (:indexNames)`, { indexNames }),
  ]);
}

async function validateDataIntegrity(queryInterface) {
  const checks = [
    `SELECT COUNT(*) AS count FROM OwnerActivationTokens token
      LEFT JOIN Organizations o ON o.id=token.organizationId AND o.status='active'
      LEFT JOIN Accounts a ON a.id=token.accountId AND a.status='active' AND a.role='owner'
      LEFT JOIN Memberships m ON m.accountId=token.accountId AND m.organizationId=token.organizationId AND m.role='owner' AND m.status='active'
      LEFT JOIN Staffs s ON s.id=a.staffId AND s.id=m.staffId AND s.organizationId=token.organizationId AND s.status='active'
     WHERE o.id IS NULL OR a.id IS NULL OR m.id IS NULL OR s.id IS NULL
        OR (token.consumedAt IS NOT NULL AND token.invalidatedAt IS NOT NULL)`,
    `SELECT COUNT(*) AS count FROM InstallationProvisioningOperations operationRow
      LEFT JOIN OwnerActivationTokens token ON token.id=operationRow.activationTokenId AND token.organizationId=operationRow.organizationId AND token.accountId=operationRow.ownerAccountId
      LEFT JOIN AuditLogs audit ON audit.id=operationRow.auditLogId AND audit.organizationId=operationRow.organizationId
      LEFT JOIN Organizations o ON o.id=operationRow.organizationId AND o.status='active'
      LEFT JOIN Accounts a ON a.id=operationRow.ownerAccountId AND a.status='active' AND a.role='owner'
      LEFT JOIN Memberships m ON m.accountId=operationRow.ownerAccountId AND m.organizationId=operationRow.organizationId AND m.role='owner' AND m.status='active'
      LEFT JOIN Staffs s ON s.id=a.staffId AND s.id=m.staffId AND s.organizationId=operationRow.organizationId AND s.status='active'
     WHERE token.id IS NULL OR audit.id IS NULL OR o.id IS NULL OR a.id IS NULL OR m.id IS NULL OR s.id IS NULL`,
  ];
  for (const sql of checks) {
    const result = await rows(queryInterface, sql);
    if (Number(value(result[0], 'count') || 0) > 0) {
      throw migrationError(
        'Installation provisioning migration found invalid tenant authority data',
        'INSTALLATION_PROVISIONING_DATA_INVALID',
      );
    }
  }
}

async function classifyState(queryInterface) {
  if (queryInterface.sequelize.getDialect() !== 'mysql') {
    throw migrationError('Installation provisioning requires MySQL definition guards');
  }
  const [tables, triggers, constraints, indexes] = await reservedArtifacts(queryInterface);
  if (tables.length === 0 && triggers.length === 0 && constraints.length === 0 && indexes.length === 0) {
    return { reasons: [], state: 'absent' };
  }
  const reasons = [];
  for (const table of Object.values(TABLES)) {
    const definition = await tableRows(queryInterface, table);
    if (definition.length !== 1 || String(value(definition[0], 'ENGINE')).toUpperCase() !== 'INNODB') {
      reasons.push(`table ${table} is missing or differs`);
      continue;
    }
    reasons.push(...columnReasons(table, await columnRows(queryInterface, table)));
    const actualIndexes = normalizeIndexes(await indexRows(queryInterface, table));
    if (JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexShape(table))) {
      reasons.push(`indexes on ${table} differ: ${JSON.stringify(actualIndexes)}`);
    }
    const actualForeignKeys = normalizeForeignKeys(await allForeignKeyRows(queryInterface, table));
    if (JSON.stringify(actualForeignKeys) !== JSON.stringify(expectedForeignKeyShape(table))) {
      reasons.push(`foreign keys on ${table} differ: ${JSON.stringify(actualForeignKeys)}`);
    }
    const actualTriggers = (await allTriggerRows(queryInterface, table)).map((row) => ({
      body: normalizeSql(value(row, 'ACTION_STATEMENT')),
      event: String(value(row, 'EVENT_MANIPULATION')).toUpperCase(),
      name: value(row, 'TRIGGER_NAME'),
      table: String(value(row, 'EVENT_OBJECT_TABLE')).toLowerCase(),
      timing: String(value(row, 'ACTION_TIMING')).toUpperCase(),
    })).sort((left, right) => left.name.localeCompare(right.name));
    if (JSON.stringify(actualTriggers) !== JSON.stringify(expectedTriggerShape(table))) {
      reasons.push(`triggers on ${table} differ: ${JSON.stringify(actualTriggers)}`);
    }
  }
  return { reasons, state: reasons.length === 0 ? 'ready' : 'partial' };
}

async function preflightCleanupInvocation(queryInterface, plan) {
  for (const kind of ['table', 'index', 'foreignKey', 'trigger']) {
    for (const item of plan[kind]) {
      const current = await readArtifact(queryInterface, kind, item);
      if (current.length === 0 || artifactSignature(kind, current) !== item.signature) {
        throw migrationError(
          `Installation provisioning cleanup ownership lost for ${kind} ${item.name || item.table}`,
          'INSTALLATION_PROVISIONING_CLEANUP_OWNERSHIP_LOST',
        );
      }
    }
  }
}

async function cleanupInvocation(queryInterface, plan) {
  await preflightCleanupInvocation(queryInterface, plan);
  for (const item of [...plan.trigger].reverse()) await queryInterface.sequelize.query(`DROP TRIGGER \`${item.name}\``);
  for (const item of [...plan.foreignKey].reverse()) await queryInterface.removeConstraint(item.table, item.name);
  for (const item of [...plan.index].reverse()) await queryInterface.removeIndex(item.table, item.name);
  for (const item of [...plan.table].reverse()) await queryInterface.dropTable(item.table);
}

function activationColumns(Sequelize) {
  return {
    id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
    organizationId: { allowNull: false, type: Sequelize.INTEGER },
    accountId: { allowNull: false, type: Sequelize.INTEGER },
    tokenHash: { allowNull: false, type: Sequelize.STRING(64) },
    expiresAt: { allowNull: false, type: Sequelize.DATE },
    consumedAt: { allowNull: true, type: Sequelize.DATE },
    invalidatedAt: { allowNull: true, type: Sequelize.DATE },
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
    ownerAccountId: { allowNull: false, type: Sequelize.INTEGER },
    activationTokenId: { allowNull: false, type: Sequelize.INTEGER },
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

module.exports = {
  async up(queryInterface, Sequelize) {
    const classification = await classifyState(queryInterface);
    if (classification.state === 'ready') {
      await validateDataIntegrity(queryInterface);
      return;
    }
    if (classification.state !== 'absent') {
      throw migrationError(
        `Installation provisioning migration refused partial/lookalike state: ${classification.reasons.join('; ')}`,
        'INSTALLATION_PROVISIONING_REPAIR_REQUIRED',
      );
    }
    const plan = { foreignKey: [], index: [], table: [], trigger: [] };
    try {
      await queryInterface.createTable(TABLES.activation, activationColumns(Sequelize));
      await track(queryInterface, plan, 'table', { table: TABLES.activation });
      maybeFail('activation_table');
      for (const item of INDEXES.filter((candidate) => candidate.table === TABLES.activation)) {
        await queryInterface.addIndex(item.table, item.fields, { name: item.name, unique: item.unique });
        await track(queryInterface, plan, 'index', item);
        maybeFail(`index_${item.name}`);
      }
      for (const item of FOREIGN_KEYS.filter((candidate) => candidate.table === TABLES.activation)) {
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
      for (const item of TRIGGERS.filter((candidate) => candidate.table === TABLES.activation)) {
        await createTrigger(queryInterface, item);
        await track(queryInterface, plan, 'trigger', item);
        maybeFail(`trigger_${item.name}`);
      }

      await queryInterface.createTable(TABLES.operation, operationColumns(Sequelize));
      await track(queryInterface, plan, 'table', { table: TABLES.operation });
      maybeFail('operation_table');
      for (const item of INDEXES.filter((candidate) => candidate.table === TABLES.operation)) {
        await queryInterface.addIndex(item.table, item.fields, { name: item.name, unique: item.unique });
        await track(queryInterface, plan, 'index', item);
        maybeFail(`index_${item.name}`);
      }
      for (const item of FOREIGN_KEYS.filter((candidate) => candidate.table === TABLES.operation)) {
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
      for (const item of TRIGGERS.filter((candidate) => candidate.table === TABLES.operation)) {
        await createTrigger(queryInterface, item);
        await track(queryInterface, plan, 'trigger', item);
        maybeFail(`trigger_${item.name}`);
      }
      const ready = await classifyState(queryInterface);
      if (ready.state !== 'ready') throw migrationError(`Migration did not reach ready state: ${ready.reasons.join('; ')}`);
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
        `Installation provisioning rollback refused partial/lookalike state: ${classification.reasons.join('; ')}`,
        'INSTALLATION_PROVISIONING_REPAIR_REQUIRED',
      );
    }
    await validateDataIntegrity(queryInterface);
    const data = await rows(queryInterface, `
      SELECT
        (SELECT COUNT(*) FROM InstallationProvisioningOperations) AS operations,
        (SELECT COUNT(*) FROM OwnerActivationTokens) AS activations
    `);
    if (Number(value(data[0], 'operations')) > 0 || Number(value(data[0], 'activations')) > 0) {
      throw migrationError(
        'Installation provisioning rollback refused while activation/provisioning history exists',
        'INSTALLATION_PROVISIONING_ROLLBACK_DATA_PRESENT',
      );
    }
    for (const item of [...TRIGGERS].reverse()) await queryInterface.sequelize.query(`DROP TRIGGER \`${item.name}\``);
    await queryInterface.dropTable(TABLES.operation);
    await queryInterface.dropTable(TABLES.activation);
    const absent = await classifyState(queryInterface);
    if (absent.state !== 'absent') throw migrationError(`Rollback did not reach absent state: ${absent.reasons.join('; ')}`);
  },

  __testing: {
    COLUMN_DEFINITIONS,
    DDL_STEPS,
    FOREIGN_KEYS,
    INDEXES,
    TABLES,
    TRIGGERS,
    artifactSignature,
    classifyState,
    cleanupInvocation,
    normalizeSql,
    preflightCleanupInvocation,
    readArtifact,
    validateDataIntegrity,
  },
};
