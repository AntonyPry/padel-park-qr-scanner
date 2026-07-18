'use strict';

const {
  DEFAULT_ORGANIZATION_SLUG,
} = require('../src/tenant-foundation/constants');

const COLUMNS = Object.freeze({
  clubId: { allowNull: true, table: 'AuditLogs' },
  organizationId: { allowNull: false, table: 'AuditLogs' },
});

const INDEXES = Object.freeze({
  audit_logs_org_account_created_idx: {
    columns: ['organizationId', 'accountId', 'createdAt', 'id'],
    table: 'AuditLogs',
    unique: false,
  },
  audit_logs_org_action_created_idx: {
    columns: ['organizationId', 'action', 'createdAt', 'id'],
    table: 'AuditLogs',
    unique: false,
  },
  audit_logs_club_idx: {
    columns: ['clubId'],
    table: 'AuditLogs',
    unique: false,
  },
  audit_logs_org_created_idx: {
    columns: ['organizationId', 'createdAt', 'id'],
    table: 'AuditLogs',
    unique: false,
  },
  audit_logs_org_entity_created_idx: {
    columns: ['organizationId', 'entityType', 'entityId', 'createdAt', 'id'],
    table: 'AuditLogs',
    unique: false,
  },
});

const FOREIGN_KEYS = Object.freeze({
  audit_logs_club_fk: {
    column: 'clubId',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    referencedColumn: 'id',
    referencedTable: 'Clubs',
    table: 'AuditLogs',
  },
  audit_logs_org_fk: {
    column: 'organizationId',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    referencedColumn: 'id',
    referencedTable: 'Organizations',
    table: 'AuditLogs',
  },
});

const INSERT_TRIGGER_BODY = `BEGIN
  IF NEW.organizationId IS NULL OR NOT EXISTS (
    SELECT 1 FROM Organizations o
    WHERE o.id = NEW.organizationId AND o.status = 'active'
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog organization is invalid';
  END IF;
  IF NEW.clubId IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM Clubs c
    WHERE c.id = NEW.clubId
      AND c.organizationId = NEW.organizationId
      AND c.status = 'active'
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog club provenance is invalid';
  END IF;
  IF (NEW.accountId IS NULL AND NEW.role IS NOT NULL)
     OR (NEW.accountId IS NOT NULL AND NEW.role IS NULL) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog actor snapshot is incomplete';
  END IF;
  IF NEW.accountId IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM Accounts a
    JOIN Memberships m
      ON m.accountId = a.id
     AND m.organizationId = NEW.organizationId
     AND m.status = 'active'
    WHERE a.id = NEW.accountId
      AND a.status = 'active'
      AND (
        (NEW.clubId IS NULL AND NEW.role = m.role)
        OR (
          NEW.clubId IS NOT NULL
          AND (
            (m.role = 'owner' AND NEW.role = 'owner')
            OR (
              m.role <> 'owner'
              AND EXISTS (
                SELECT 1 FROM MembershipClubAccesses mca
                WHERE mca.membershipId = m.id
                  AND mca.organizationId = NEW.organizationId
                  AND mca.clubId = NEW.clubId
                  AND mca.status = 'active'
                  AND (mca.roleOverride IS NULL OR mca.roleOverride <> 'owner')
                  AND NEW.role = COALESCE(mca.roleOverride, m.role)
              )
            )
          )
        )
      )
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog actor tenant authority mismatch';
  END IF;
END`;

const TRIGGERS = Object.freeze({
  audit_logs_immutable_bd: {
    body: "BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog rows are immutable'; END",
    event: 'DELETE',
    table: 'AuditLogs',
  },
  audit_logs_immutable_bu: {
    body: "BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog rows are immutable'; END",
    event: 'UPDATE',
    table: 'AuditLogs',
  },
  audit_logs_tenant_bi: {
    body: INSERT_TRIGGER_BODY,
    event: 'INSERT',
    table: 'AuditLogs',
  },
});

function migrationError(message, code = 'TENANT_AUDIT_LOG_MIGRATION_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeSql(value) {
  const literals = [];
  let protectedSql = '';
  const source = String(value || '');
  for (let index = 0; index < source.length; index += 1) {
    const quote = source[index];
    if (quote !== "'" && quote !== '"') {
      protectedSql += quote;
      continue;
    }
    let literal = quote;
    for (index += 1; index < source.length; index += 1) {
      const character = source[index];
      literal += character;
      if (character === '\\' && index + 1 < source.length) {
        index += 1;
        literal += source[index];
        continue;
      }
      if (character !== quote) continue;
      if (source[index + 1] === quote) {
        index += 1;
        literal += source[index];
        continue;
      }
      break;
    }
    const marker = `__tenant_audit_literal_${literals.length}__`;
    literals.push(literal);
    protectedSql += marker;
  }
  return protectedSql
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;])\s*/g, '$1')
    .replace(/\s*(<=>|<>|!=|<=|>=|=|<|>)\s*/g, '$1')
    .trim()
    .toLowerCase()
    .replace(/__tenant_audit_literal_(\d+)__/g, (_marker, index) => literals[Number(index)]);
}

async function selectRows(queryInterface, sql, replacements = {}) {
  const [rows] = await queryInterface.sequelize.query(sql, { replacements });
  return rows;
}

function rowValue(row, key) {
  return row?.[key] ?? row?.[key.toLowerCase()] ?? null;
}

function sameIdentifier(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

async function getColumn(queryInterface, table, column) {
  const rows = await selectRows(queryInterface, `
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
           COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME, COLLATION_NAME,
           COLUMN_COMMENT, GENERATION_EXPRESSION
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column
  `, { column, table });
  return rows[0] || null;
}

async function getIndex(queryInterface, name) {
  return selectRows(queryInterface, `
    SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
           SUB_PART, COLLATION, INDEX_TYPE
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME = :name
    ORDER BY TABLE_NAME, SEQ_IN_INDEX
  `, { name });
}

async function getForeignKey(queryInterface, name) {
  const rows = await selectRows(queryInterface, `
    SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME,
           k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
           r.UPDATE_RULE, r.DELETE_RULE
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
    JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
     AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE() AND k.CONSTRAINT_NAME = :name
    ORDER BY k.ORDINAL_POSITION
  `, { name });
  return rows;
}

async function getAccountForeignKeys(queryInterface) {
  return selectRows(queryInterface, `
    SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME,
           k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
           r.UPDATE_RULE, r.DELETE_RULE
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
    JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
     AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE()
      AND k.TABLE_NAME = 'AuditLogs'
      AND k.COLUMN_NAME = 'accountId'
    ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION
  `);
}

async function getTrigger(queryInterface, name) {
  const rows = await selectRows(queryInterface, `
    SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, EVENT_MANIPULATION,
           ACTION_TIMING, ACTION_STATEMENT
    FROM INFORMATION_SCHEMA.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = :name
  `, { name });
  return rows[0] || null;
}

function columnIsCanonical(column, expected) {
  return Boolean(
    column &&
      String(rowValue(column, 'DATA_TYPE')).toLowerCase() === 'int' &&
      /^int(?:\(\d+\))?$/.test(String(rowValue(column, 'COLUMN_TYPE')).toLowerCase()) &&
      rowValue(column, 'IS_NULLABLE') === (expected.allowNull ? 'YES' : 'NO') &&
      (expected.allowNull
        ? [null, 'NULL'].includes(rowValue(column, 'COLUMN_DEFAULT'))
        : rowValue(column, 'COLUMN_DEFAULT') === null) &&
      String(rowValue(column, 'EXTRA') || '') === '' &&
      rowValue(column, 'CHARACTER_SET_NAME') === null &&
      rowValue(column, 'COLLATION_NAME') === null &&
      String(rowValue(column, 'COLUMN_COMMENT') || '') === '' &&
      String(rowValue(column, 'GENERATION_EXPRESSION') || '') === '',
  );
}

function indexIsCanonical(rows, expected) {
  return rows.length === expected.columns.length && rows.every((row, index) =>
    sameIdentifier(rowValue(row, 'TABLE_NAME'), expected.table) &&
    Number(rowValue(row, 'NON_UNIQUE')) === (expected.unique ? 0 : 1) &&
    Number(rowValue(row, 'SEQ_IN_INDEX')) === index + 1 &&
    rowValue(row, 'COLUMN_NAME') === expected.columns[index] &&
    rowValue(row, 'SUB_PART') === null &&
    ['A', null].includes(rowValue(row, 'COLLATION')) &&
    String(rowValue(row, 'INDEX_TYPE')).toUpperCase() === 'BTREE');
}

function foreignKeyIsCanonical(rows, expected) {
  return rows.length === 1 && Boolean(
    sameIdentifier(rowValue(rows[0], 'TABLE_NAME'), expected.table) &&
      rowValue(rows[0], 'COLUMN_NAME') === expected.column &&
      sameIdentifier(rowValue(rows[0], 'REFERENCED_TABLE_NAME'), expected.referencedTable) &&
      rowValue(rows[0], 'REFERENCED_COLUMN_NAME') === expected.referencedColumn &&
      rowValue(rows[0], 'UPDATE_RULE') === expected.onUpdate &&
      rowValue(rows[0], 'DELETE_RULE') === expected.onDelete,
  );
}

function legacyAccountForeignKeyIsCanonical(rows) {
  return rows.length === 1 && foreignKeyIsCanonical(rows, {
    column: 'accountId',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
    referencedColumn: 'id',
    referencedTable: 'Accounts',
    table: 'AuditLogs',
  });
}

function triggerIsCanonical(row, expected) {
  return Boolean(
    row && sameIdentifier(rowValue(row, 'EVENT_OBJECT_TABLE'), expected.table) &&
      rowValue(row, 'EVENT_MANIPULATION') === expected.event &&
      rowValue(row, 'ACTION_TIMING') === 'BEFORE' &&
      normalizeSql(rowValue(row, 'ACTION_STATEMENT')) === normalizeSql(expected.body),
  );
}

function signature(kind, rows) {
  const normalized = rows.map((row) => Object.fromEntries(
    Object.entries(row).sort(([left], [right]) => left.localeCompare(right)),
  ));
  if (kind === 'trigger') {
    normalized.forEach((row) => {
      if (row.ACTION_STATEMENT !== undefined) row.ACTION_STATEMENT = normalizeSql(row.ACTION_STATEMENT);
    });
  }
  return JSON.stringify(normalized);
}

async function readArtifact(queryInterface, kind, item) {
  if (kind === 'column') {
    const row = await getColumn(queryInterface, item.table, item.name);
    return row ? [row] : [];
  }
  if (kind === 'index') {
    return (await getIndex(queryInterface, item.name))
      .filter((row) => sameIdentifier(rowValue(row, 'TABLE_NAME'), item.table));
  }
  if (kind === 'foreignKey') {
    return (await getForeignKey(queryInterface, item.name))
      .filter((row) => sameIdentifier(rowValue(row, 'TABLE_NAME'), item.table));
  }
  if (kind === 'trigger') {
    const row = await getTrigger(queryInterface, item.name);
    return row && sameIdentifier(rowValue(row, 'EVENT_OBJECT_TABLE'), item.table) ? [row] : [];
  }
  throw migrationError(`Unknown artifact kind ${kind}`);
}

async function track(queryInterface, created, kind, item) {
  const rows = await readArtifact(queryInterface, kind, item);
  if (rows.length === 0) throw migrationError(`Cannot inventory ${kind} ${item.name}`);
  created[kind].push({ ...item, signature: signature(kind, rows) });
}

async function refresh(queryInterface, created, kind, item) {
  const tracked = created[kind].find((candidate) =>
    candidate.table === item.table && candidate.name === item.name);
  if (!tracked) throw migrationError(`Lost tracked ${kind} ${item.name}`);
  const rows = await readArtifact(queryInterface, kind, item);
  if (rows.length === 0) throw migrationError(`Cannot refresh ${kind} ${item.name}`);
  tracked.signature = signature(kind, rows);
}

async function classifyState(queryInterface) {
  const columns = await Promise.all(Object.entries(COLUMNS).map(([name, expected]) =>
    getColumn(queryInterface, expected.table, name)));
  const indexes = await Promise.all(Object.keys(INDEXES).map((name) => getIndex(queryInterface, name)));
  const foreignKeys = await Promise.all(Object.keys(FOREIGN_KEYS).map((name) => getForeignKey(queryInterface, name)));
  const triggers = await Promise.all(Object.keys(TRIGGERS).map((name) => getTrigger(queryInterface, name)));
  const accountForeignKeys = await getAccountForeignKeys(queryInterface);
  const anyReserved = columns.some(Boolean) || indexes.some((rows) => rows.length) ||
    foreignKeys.some((rows) => rows.length) || triggers.some(Boolean);
  if (!anyReserved && legacyAccountForeignKeyIsCanonical(accountForeignKeys)) {
    return { reasons: [], state: 'legacy' };
  }

  const reasons = [];
  Object.entries(COLUMNS).forEach(([name, expected], index) => {
    if (!columnIsCanonical(columns[index], expected)) reasons.push(`column AuditLogs.${name} is not canonical`);
  });
  Object.entries(INDEXES).forEach(([name, expected], index) => {
    if (!indexIsCanonical(indexes[index], expected)) reasons.push(`index ${name} is not canonical`);
  });
  Object.entries(FOREIGN_KEYS).forEach(([name, expected], index) => {
    if (!foreignKeyIsCanonical(foreignKeys[index], expected)) reasons.push(`foreign key ${name} is not canonical`);
  });
  Object.entries(TRIGGERS).forEach(([name, expected], index) => {
    if (!triggerIsCanonical(triggers[index], expected)) reasons.push(`trigger ${name} is not canonical`);
  });
  if (accountForeignKeys.length > 0) reasons.push('legacy accountId foreign key still exists');
  return { reasons, state: reasons.length === 0 ? 'ready' : 'partial' };
}

async function getDefaultOrganization(queryInterface) {
  const rows = await selectRows(queryInterface, `
    SELECT id FROM Organizations
    WHERE slug = :slug AND status = 'active'
    ORDER BY id
  `, { slug: DEFAULT_ORGANIZATION_SLUG });
  if (rows.length !== 1) throw migrationError('Exact active default Organization is required');
  return { organizationId: Number(rowValue(rows[0], 'id')) };
}

function maybeFail(step) {
  if (process.env.TENANT_AUDIT_LOG_MIGRATION_FAIL_STEP === step) {
    throw migrationError(
      `Forced AuditLog migration failure at ${step}`,
      'TENANT_AUDIT_LOG_FORCED_FAILURE',
    );
  }
}

async function createTrigger(queryInterface, name, expected) {
  await queryInterface.sequelize.query(
    `CREATE TRIGGER \`${name}\` BEFORE ${expected.event} ON \`${expected.table}\` FOR EACH ROW ${expected.body}`,
  );
}

async function preflightCleanupInvocation(queryInterface, plan) {
  const items = [
    ...plan.column.map((item) => ['column', item]),
    ...plan.index.map((item) => ['index', item]),
    ...plan.foreignKey.map((item) => ['foreignKey', item]),
    ...plan.trigger.map((item) => ['trigger', item]),
  ];
  for (const [kind, item] of items) {
    const rows = await readArtifact(queryInterface, kind, item);
    if (rows.length === 0 || signature(kind, rows) !== item.signature) {
      const error = migrationError(
        `AuditLog cleanup ownership lost for ${kind} ${item.table}.${item.name}; operator repair required`,
        'TENANT_AUDIT_LOG_CLEANUP_OWNERSHIP_LOST',
      );
      error.operatorRepair = true;
      throw error;
    }
  }
  const currentAccountForeignKeys = await getAccountForeignKeys(queryInterface);
  if (plan.removedAccountForeignKeys.length > 0 && currentAccountForeignKeys.length > 0) {
    const error = migrationError(
      'AuditLog cleanup ownership lost because accountId foreign key reappeared',
      'TENANT_AUDIT_LOG_CLEANUP_OWNERSHIP_LOST',
    );
    error.operatorRepair = true;
    throw error;
  }
}

async function restoreAccountForeignKey(queryInterface, row) {
  await queryInterface.addConstraint('AuditLogs', {
    fields: ['accountId'],
    name: rowValue(row, 'CONSTRAINT_NAME'),
    onDelete: rowValue(row, 'DELETE_RULE'),
    onUpdate: rowValue(row, 'UPDATE_RULE'),
    references: {
      field: rowValue(row, 'REFERENCED_COLUMN_NAME'),
      table: rowValue(row, 'REFERENCED_TABLE_NAME'),
    },
    type: 'foreign key',
  });
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
  for (const row of plan.removedAccountForeignKeys) {
    await restoreAccountForeignKey(queryInterface, row);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const classification = await classifyState(queryInterface);
    if (classification.state === 'ready') return;
    if (classification.state !== 'legacy') {
      throw migrationError(
        `AuditLog migration refused partial schema: ${classification.reasons.join('; ')}`,
      );
    }
    const tenant = await getDefaultOrganization(queryInterface);
    const plan = {
      column: [],
      foreignKey: [],
      index: [],
      removedAccountForeignKeys: [],
      trigger: [],
    };
    try {
      for (const [name, expected] of Object.entries(COLUMNS)) {
        await queryInterface.addColumn(expected.table, name, {
          allowNull: true,
          type: Sequelize.INTEGER,
        });
        await track(queryInterface, plan, 'column', { name, table: expected.table });
      }
      maybeFail('after_columns');
      await queryInterface.sequelize.query(`
        UPDATE AuditLogs
        SET organizationId = :organizationId
        WHERE organizationId IS NULL
      `, { replacements: tenant });
      await queryInterface.changeColumn('AuditLogs', 'organizationId', {
        allowNull: false,
        type: Sequelize.INTEGER,
      });
      await refresh(queryInterface, plan, 'column', {
        name: 'organizationId',
        table: 'AuditLogs',
      });
      maybeFail('after_backfill');

      const accountForeignKeys = await getAccountForeignKeys(queryInterface);
      if (!legacyAccountForeignKeyIsCanonical(accountForeignKeys)) {
        throw migrationError('Legacy AuditLog accountId foreign key changed during migration');
      }
      plan.removedAccountForeignKeys.push(...accountForeignKeys);
      await queryInterface.removeConstraint(
        'AuditLogs',
        rowValue(accountForeignKeys[0], 'CONSTRAINT_NAME'),
      );
      maybeFail('after_account_fk');

      for (const [name, expected] of Object.entries(INDEXES)) {
        await queryInterface.addIndex(expected.table, expected.columns, {
          name,
          unique: expected.unique,
        });
        await track(queryInterface, plan, 'index', { name, table: expected.table });
      }
      for (const [name, expected] of Object.entries(FOREIGN_KEYS)) {
        await queryInterface.addConstraint(expected.table, {
          fields: [expected.column],
          name,
          onDelete: expected.onDelete,
          onUpdate: expected.onUpdate,
          references: {
            field: expected.referencedColumn,
            table: expected.referencedTable,
          },
          type: 'foreign key',
        });
        await track(queryInterface, plan, 'foreignKey', { name, table: expected.table });
      }
      maybeFail('after_constraints');

      for (const [name, expected] of Object.entries(TRIGGERS)) {
        await createTrigger(queryInterface, name, expected);
        await track(queryInterface, plan, 'trigger', { name, table: expected.table });
      }
      maybeFail('after_triggers');
      const ready = await classifyState(queryInterface);
      if (ready.state !== 'ready') {
        throw migrationError(`AuditLog migration did not reach ready state: ${ready.reasons.join('; ')}`);
      }
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
    if (classification.state === 'legacy') return;
    if (classification.state !== 'ready') {
      throw migrationError(
        `AuditLog rollback refused partial schema: ${classification.reasons.join('; ')}`,
      );
    }
    const organizations = await selectRows(
      queryInterface,
      'SELECT id FROM Organizations ORDER BY id LIMIT 2',
    );
    if (organizations.length > 1) {
      throw migrationError(
        'AuditLog rollback refused while a second Organization exists',
        'TENANT_AUDIT_LOG_ROLLBACK_SECOND_ORGANIZATION',
      );
    }
    const tenant = await getDefaultOrganization(queryInterface);
    const ownershipRows = await selectRows(queryInterface, `
      SELECT COUNT(*) AS count FROM AuditLogs
      WHERE organizationId <> :organizationId
    `, tenant);
    if (Number(rowValue(ownershipRows[0], 'count') || 0) > 0) {
      throw migrationError(
        'AuditLog rollback refused because Organization ownership would be lost',
        'TENANT_AUDIT_LOG_ROLLBACK_OWNERSHIP_LOSS',
      );
    }
    const orphanRows = await selectRows(queryInterface, `
      SELECT COUNT(*) AS count
      FROM AuditLogs l
      LEFT JOIN Accounts a ON a.id = l.accountId
      WHERE l.accountId IS NOT NULL AND a.id IS NULL
    `);
    if (Number(rowValue(orphanRows[0], 'count') || 0) > 0) {
      throw migrationError(
        'AuditLog rollback refused because deleted actor snapshots cannot restore the legacy FK',
        'TENANT_AUDIT_LOG_ROLLBACK_ORPHAN_ACTOR',
      );
    }
    if ((await getForeignKey(queryInterface, 'audit_logs_account_fk')).length > 0) {
      throw migrationError(
        'AuditLog rollback refused because audit_logs_account_fk is already owned',
        'TENANT_AUDIT_LOG_ROLLBACK_CONSTRAINT_COLLISION',
      );
    }

    for (const name of Object.keys(TRIGGERS).reverse()) {
      await queryInterface.sequelize.query(`DROP TRIGGER \`${name}\``);
    }
    for (const [name, expected] of Object.entries(FOREIGN_KEYS).reverse()) {
      await queryInterface.removeConstraint(expected.table, name);
    }
    for (const [name, expected] of Object.entries(INDEXES).reverse()) {
      await queryInterface.removeIndex(expected.table, name);
    }
    for (const [name, expected] of Object.entries(COLUMNS).reverse()) {
      await queryInterface.removeColumn(expected.table, name);
    }
    await queryInterface.addConstraint('AuditLogs', {
      fields: ['accountId'],
      name: 'audit_logs_account_fk',
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      references: { field: 'id', table: 'Accounts' },
      type: 'foreign key',
    });
    const legacy = await classifyState(queryInterface);
    if (legacy.state !== 'legacy') {
      throw migrationError(`AuditLog rollback did not reach legacy state: ${legacy.reasons.join('; ')}`);
    }
  },

  __testing: {
    COLUMNS,
    FOREIGN_KEYS,
    INDEXES,
    TRIGGERS,
    classifyState,
    cleanupInvocation,
    normalizeSql,
    preflightCleanupInvocation,
    readArtifact,
    signature,
  },
};
