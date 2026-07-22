'use strict';

const TABLE = 'NormalUserSessions';
const TRIGGERS = Object.freeze([
  {
    event: 'INSERT',
    name: 'trg_normal_user_sessions_bi',
    table: TABLE,
    timing: 'BEFORE',
    body: `BEGIN
      IF NEW.tokenDigest NOT REGEXP BINARY '^[a-f0-9]{64}$' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Normal user session digest is invalid';
      END IF;
      IF NEW.expiresAt <= NEW.createdAt THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Normal user session expiry is invalid';
      END IF;
      IF NEW.revokedAt IS NOT NULL OR NEW.revokedReason IS NOT NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Normal user session must start active';
      END IF;
    END`,
  },
  {
    event: 'UPDATE',
    name: 'trg_normal_user_sessions_bu',
    table: TABLE,
    timing: 'BEFORE',
    body: `BEGIN
      IF NOT (NEW.id <=> OLD.id)
         OR NOT (NEW.accountId <=> OLD.accountId)
         OR NOT (NEW.tokenDigest <=> OLD.tokenDigest)
         OR NOT (NEW.expiresAt <=> OLD.expiresAt)
         OR NOT (NEW.createdAt <=> OLD.createdAt) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Normal user session identity is immutable';
      END IF;
      IF (NEW.revokedAt IS NULL) <> (NEW.revokedReason IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Normal user session revocation metadata is incomplete';
      END IF;
      IF OLD.revokedAt IS NOT NULL AND (
        NOT (NEW.revokedAt <=> OLD.revokedAt)
        OR NOT (NEW.revokedReason <=> OLD.revokedReason)
      ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Normal user session revocation is irreversible';
      END IF;
    END`,
  },
  {
    event: 'DELETE',
    name: 'trg_normal_user_sessions_bd',
    table: TABLE,
    timing: 'BEFORE',
    body: "BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Normal user session history is immutable'; END",
  },
  {
    event: 'UPDATE',
    name: 'trg_accounts_normal_sessions_au',
    table: 'Accounts',
    timing: 'AFTER',
    body: `BEGIN
      IF NEW.status <> OLD.status AND NEW.status <> 'active' THEN
        UPDATE NormalUserSessions
           SET revokedAt = CURRENT_TIMESTAMP,
               revokedReason = 'account_disabled',
               updatedAt = CURRENT_TIMESTAMP
         WHERE accountId = NEW.id AND revokedAt IS NULL;
      ELSEIF NOT (NEW.role <=> OLD.role) OR NOT (NEW.staffId <=> OLD.staffId) THEN
        UPDATE NormalUserSessions
           SET revokedAt = CURRENT_TIMESTAMP,
               revokedReason = 'security_context_changed',
               updatedAt = CURRENT_TIMESTAMP
         WHERE accountId = NEW.id AND revokedAt IS NULL;
      END IF;
    END`,
  },
  {
    event: 'UPDATE',
    name: 'trg_staff_normal_sessions_au',
    table: 'Staffs',
    timing: 'AFTER',
    body: `BEGIN
      IF NEW.status <> OLD.status AND NEW.status <> 'active' THEN
        UPDATE NormalUserSessions
           SET revokedAt = CURRENT_TIMESTAMP,
               revokedReason = 'staff_disabled',
               updatedAt = CURRENT_TIMESTAMP
         WHERE revokedAt IS NULL
           AND accountId IN (SELECT id FROM Accounts WHERE staffId = NEW.id);
      END IF;
    END`,
  },
]);

const INDEXES = Object.freeze([
  {
    fields: ['tokenDigest'],
    name: 'uq_normal_user_sessions_token_digest',
    unique: true,
  },
  {
    fields: ['accountId', 'revokedAt', 'expiresAt'],
    name: 'idx_normal_user_sessions_account_active',
    unique: false,
  },
]);

const FOREIGN_KEY = Object.freeze({
  fields: ['accountId'],
  name: 'fk_normal_user_sessions_account',
  onDelete: 'CASCADE',
  onUpdate: 'RESTRICT',
  referencedFields: ['id'],
  referencedTable: 'Accounts',
});

function migrationError(message, code = 'NORMAL_USER_SESSIONS_MIGRATION_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function rowValue(row, key) {
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const match = Object.keys(row).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return match ? row[match] : undefined;
}

function normalizeSql(value) {
  return String(value || '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function rows(queryInterface, sql, replacements = {}) {
  const [result] = await queryInterface.sequelize.query(sql, { replacements });
  return result;
}

async function classifyState(queryInterface) {
  const tableRows = await rows(
    queryInterface,
    `SELECT TABLE_NAME
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table`,
    { table: TABLE },
  );
  const triggerRows = await rows(
    queryInterface,
    `SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING,
            EVENT_MANIPULATION, ACTION_STATEMENT
       FROM INFORMATION_SCHEMA.TRIGGERS
      WHERE TRIGGER_SCHEMA=DATABASE()
        AND TRIGGER_NAME IN (:triggerNames)`,
    { triggerNames: TRIGGERS.map((trigger) => trigger.name) },
  );
  if (tableRows.length === 0) {
    return triggerRows.length === 0
      ? { reasons: [], state: 'absent' }
      : { reasons: ['named triggers exist without the session table'], state: 'partial' };
  }

  const reasons = [];
  const columnRows = await rows(
    queryInterface,
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA, COLLATION_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table
      ORDER BY ORDINAL_POSITION`,
    { table: TABLE },
  );
  const expectedColumns = new Map([
    ['id', { key: 'PRI', nullable: 'NO', type: 'char(36)' }],
    ['accountId', { key: '', nullable: 'NO', type: 'int' }],
    ['tokenDigest', { key: 'UNI', nullable: 'NO', type: 'char(64)' }],
    ['expiresAt', { key: '', nullable: 'NO', type: 'datetime' }],
    ['revokedAt', { key: '', nullable: 'YES', type: 'datetime' }],
    ['revokedReason', { key: '', nullable: 'YES', type: 'varchar(64)' }],
    ['createdAt', { key: '', nullable: 'NO', type: 'datetime' }],
    ['updatedAt', { key: '', nullable: 'NO', type: 'datetime' }],
  ]);
  if (columnRows.length !== expectedColumns.size) reasons.push('column count mismatch');
  for (const row of columnRows) {
    const name = rowValue(row, 'COLUMN_NAME');
    const expected = expectedColumns.get(name);
    if (!expected) {
      reasons.push(`unexpected column ${name}`);
      continue;
    }
    const actualType = String(rowValue(row, 'COLUMN_TYPE')).toLowerCase();
    if (!actualType.startsWith(expected.type)) reasons.push(`${name} type mismatch`);
    if (rowValue(row, 'IS_NULLABLE') !== expected.nullable) reasons.push(`${name} nullability mismatch`);
    if (expected.key && rowValue(row, 'COLUMN_KEY') !== expected.key) reasons.push(`${name} key mismatch`);
    if (String(rowValue(row, 'EXTRA') || '') !== '') reasons.push(`${name} extra mismatch`);
    if (name === 'tokenDigest' && !String(rowValue(row, 'COLLATION_NAME') || '').endsWith('_bin')) {
      reasons.push('tokenDigest collation must be binary');
    }
  }
  for (const name of expectedColumns.keys()) {
    if (!columnRows.some((row) => rowValue(row, 'COLUMN_NAME') === name)) {
      reasons.push(`missing column ${name}`);
    }
  }

  const indexRows = await rows(
    queryInterface,
    `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table
      ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    { table: TABLE },
  );
  for (const index of INDEXES) {
    const matching = indexRows.filter((row) => rowValue(row, 'INDEX_NAME') === index.name);
    const fields = matching.map((row) => rowValue(row, 'COLUMN_NAME'));
    if (
      matching.length !== index.fields.length ||
      fields.join(',') !== index.fields.join(',') ||
      matching.some((row) => Number(rowValue(row, 'NON_UNIQUE')) !== (index.unique ? 0 : 1))
    ) {
      reasons.push(`index ${index.name} mismatch`);
    }
  }

  const fkRows = await rows(
    queryInterface,
    `SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,
            k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
       JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
        AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA=DATABASE()
        AND k.TABLE_NAME=:table
        AND k.CONSTRAINT_NAME=:constraint`,
    { constraint: FOREIGN_KEY.name, table: TABLE },
  );
  if (
    fkRows.length !== 1 ||
    rowValue(fkRows[0] || {}, 'COLUMN_NAME') !== 'accountId' ||
    rowValue(fkRows[0] || {}, 'REFERENCED_TABLE_NAME') !== 'Accounts' ||
    rowValue(fkRows[0] || {}, 'REFERENCED_COLUMN_NAME') !== 'id' ||
    rowValue(fkRows[0] || {}, 'UPDATE_RULE') !== 'RESTRICT' ||
    rowValue(fkRows[0] || {}, 'DELETE_RULE') !== 'CASCADE'
  ) {
    reasons.push(`foreign key ${FOREIGN_KEY.name} mismatch`);
  }

  for (const expected of TRIGGERS) {
    const actual = triggerRows.find((row) => rowValue(row, 'TRIGGER_NAME') === expected.name);
    if (
      !actual ||
      rowValue(actual, 'EVENT_OBJECT_TABLE') !== expected.table ||
      rowValue(actual, 'ACTION_TIMING') !== expected.timing ||
      rowValue(actual, 'EVENT_MANIPULATION') !== expected.event ||
      normalizeSql(rowValue(actual, 'ACTION_STATEMENT')) !== normalizeSql(expected.body)
    ) {
      reasons.push(`trigger ${expected.name} mismatch`);
    }
  }
  return { reasons, state: reasons.length === 0 ? 'ready' : 'partial' };
}

async function createTrigger(queryInterface, trigger) {
  await queryInterface.sequelize.query(
    `CREATE TRIGGER \`${trigger.name}\` ${trigger.timing} ${trigger.event} ON \`${trigger.table}\` FOR EACH ROW ${trigger.body}`,
  );
}

async function dropTriggerIfExists(queryInterface, name) {
  await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS \`${name}\``);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const classification = await classifyState(queryInterface);
    if (classification.state === 'ready') return;
    if (classification.state !== 'absent') {
      throw migrationError(
        `Normal user sessions migration refused partial/lookalike state: ${classification.reasons.join('; ')}`,
        'NORMAL_USER_SESSIONS_REPAIR_REQUIRED',
      );
    }

    const createdTriggers = [];
    let createdTable = false;
    try {
      await queryInterface.createTable(TABLE, {
        id: { allowNull: false, primaryKey: true, type: Sequelize.UUID },
        accountId: { allowNull: false, type: Sequelize.INTEGER },
        tokenDigest: { allowNull: false, type: Sequelize.CHAR(64).BINARY },
        expiresAt: { allowNull: false, type: Sequelize.DATE },
        revokedAt: { allowNull: true, type: Sequelize.DATE },
        revokedReason: { allowNull: true, type: Sequelize.STRING(64) },
        createdAt: { allowNull: false, type: Sequelize.DATE },
        updatedAt: { allowNull: false, type: Sequelize.DATE },
      });
      createdTable = true;
      for (const index of INDEXES) {
        await queryInterface.addIndex(TABLE, index.fields, {
          name: index.name,
          unique: index.unique,
        });
      }
      await queryInterface.addConstraint(TABLE, {
        fields: FOREIGN_KEY.fields,
        name: FOREIGN_KEY.name,
        onDelete: FOREIGN_KEY.onDelete,
        onUpdate: FOREIGN_KEY.onUpdate,
        references: {
          fields: FOREIGN_KEY.referencedFields,
          table: FOREIGN_KEY.referencedTable,
        },
        type: 'foreign key',
      });
      for (const trigger of TRIGGERS) {
        await createTrigger(queryInterface, trigger);
        createdTriggers.push(trigger.name);
      }
      const ready = await classifyState(queryInterface);
      if (ready.state !== 'ready') {
        throw migrationError(`Migration did not reach ready state: ${ready.reasons.join('; ')}`);
      }
    } catch (error) {
      for (const name of createdTriggers.reverse()) await dropTriggerIfExists(queryInterface, name);
      if (createdTable) await queryInterface.dropTable(TABLE);
      throw error;
    }
  },

  async down(queryInterface) {
    const classification = await classifyState(queryInterface);
    if (classification.state === 'absent') return;
    if (classification.state !== 'ready') {
      throw migrationError(
        `Normal user sessions rollback refused partial/lookalike state: ${classification.reasons.join('; ')}`,
        'NORMAL_USER_SESSIONS_REPAIR_REQUIRED',
      );
    }
    const countRows = await rows(queryInterface, `SELECT COUNT(*) AS count FROM ${TABLE}`);
    if (Number(rowValue(countRows[0], 'count')) > 0) {
      throw migrationError(
        'Normal user sessions rollback refused while session history exists',
        'NORMAL_USER_SESSIONS_ROLLBACK_HISTORY_PRESENT',
      );
    }
    for (const trigger of [...TRIGGERS].reverse()) {
      await dropTriggerIfExists(queryInterface, trigger.name);
    }
    await queryInterface.dropTable(TABLE);
    const absent = await classifyState(queryInterface);
    if (absent.state !== 'absent') {
      throw migrationError(`Rollback did not reach absent state: ${absent.reasons.join('; ')}`);
    }
  },

  __testing: {
    FOREIGN_KEY,
    INDEXES,
    TABLE,
    TRIGGERS,
    classifyState,
    normalizeSql,
  },
};
