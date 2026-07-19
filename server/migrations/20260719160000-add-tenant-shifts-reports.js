'use strict';

const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../src/tenant-foundation/constants');

const COLUMNS = Object.freeze([
  ['Shifts', 'clubId'],
  ['ShiftReportTemplates', 'clubId'],
  ['ShiftReports', 'clubId'],
]);

const INDEXES = Object.freeze({
  shifts_club_id_unique: {
    columns: ['clubId', 'id'], table: 'Shifts', unique: true,
  },
  shifts_club_status_started_idx: {
    columns: ['clubId', 'status', 'archivedAt', 'startedAt'],
    table: 'Shifts',
    unique: false,
  },
  shifts_club_date_idx: {
    columns: ['clubId', 'date', 'id'], table: 'Shifts', unique: false,
  },
  shift_report_templates_club_id_unique: {
    columns: ['clubId', 'id'], table: 'ShiftReportTemplates', unique: true,
  },
  shift_report_templates_club_status_sort_idx: {
    columns: ['clubId', 'status', 'sortOrder', 'id'],
    table: 'ShiftReportTemplates',
    unique: false,
  },
  shift_reports_club_id_unique: {
    columns: ['clubId', 'id'], table: 'ShiftReports', unique: true,
  },
  shift_reports_club_status_scheduled_idx: {
    columns: ['clubId', 'status', 'scheduledAt', 'id'],
    table: 'ShiftReports',
    unique: false,
  },
  shift_reports_club_shift_scheduled_idx: {
    columns: ['clubId', 'shiftId', 'scheduledAt', 'id'],
    table: 'ShiftReports',
    unique: false,
  },
});

const FOREIGN_KEYS = Object.freeze({
  shifts_club_fk: {
    column: 'clubId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT',
    referencedColumn: 'id', referencedTable: 'Clubs', table: 'Shifts',
  },
  shift_report_templates_club_fk: {
    column: 'clubId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT',
    referencedColumn: 'id', referencedTable: 'Clubs', table: 'ShiftReportTemplates',
  },
  shift_reports_club_fk: {
    column: 'clubId', onDelete: 'RESTRICT', onUpdate: 'RESTRICT',
    referencedColumn: 'id', referencedTable: 'Clubs', table: 'ShiftReports',
  },
});

function accountClubAuthority(field, label) {
  return `
    IF NEW.${field} IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM Accounts a
      JOIN Memberships m
        ON m.accountId = a.id
       AND m.organizationId = v_org
       AND m.status = 'active'
      LEFT JOIN Staffs s
        ON s.id = m.staffId
       AND s.organizationId = v_org
       AND s.status = 'active'
      WHERE a.id = NEW.${field}
        AND a.status = 'active'
        AND (
          (a.staffId IS NULL AND m.staffId IS NULL)
          OR (a.staffId = m.staffId AND s.id = m.staffId)
        )
        AND (
          m.role = 'owner'
          OR EXISTS (
            SELECT 1 FROM MembershipClubAccesses mca
            WHERE mca.membershipId = m.id
              AND mca.organizationId = v_org
              AND mca.clubId = NEW.clubId
              AND mca.status = 'active'
              AND (mca.roleOverride IS NULL OR mca.roleOverride <> 'owner')
          )
        )
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${label}';
    END IF;`;
}

function staffClubAuthority(field, label) {
  return `
    IF NEW.${field} IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM Staffs s
      JOIN Memberships m
        ON m.staffId = s.id
       AND m.organizationId = v_org
       AND m.status = 'active'
      WHERE s.id = NEW.${field}
        AND s.organizationId = v_org
        AND s.status = 'active'
        AND (
          m.role = 'owner'
          OR EXISTS (
            SELECT 1 FROM MembershipClubAccesses mca
            WHERE mca.membershipId = m.id
              AND mca.organizationId = v_org
              AND mca.clubId = NEW.clubId
              AND mca.status = 'active'
          )
        )
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${label}';
    END IF;`;
}

function shiftBody(isUpdate) {
  return `BEGIN
    DECLARE v_org INT;
    SELECT organizationId INTO v_org FROM Clubs WHERE id = NEW.clubId;
    IF v_org IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift club is invalid';
    END IF;
    ${isUpdate ? `IF NOT (OLD.clubId <=> NEW.clubId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift clubId is immutable';
    END IF;` : ''}
    ${staffClubAuthority('staffId', 'Shift staff club authority mismatch')}
    ${accountClubAuthority('approvedByAccountId', 'Shift approval actor club authority mismatch')}
    ${accountClubAuthority('archivedByAccountId', 'Shift archive actor club authority mismatch')}
  END`;
}

function templateBody(isUpdate) {
  return `BEGIN
    DECLARE v_org INT;
    SELECT organizationId INTO v_org FROM Clubs WHERE id = NEW.clubId;
    IF v_org IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift report template club is invalid';
    END IF;
    ${isUpdate ? `IF NOT (OLD.clubId <=> NEW.clubId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ShiftReportTemplate clubId is immutable';
    END IF;` : ''}
    ${accountClubAuthority('createdByAccountId', 'Shift report template creator club authority mismatch')}
    ${accountClubAuthority('updatedByAccountId', 'Shift report template editor club authority mismatch')}
  END`;
}

function reportBody(isUpdate) {
  return `BEGIN
    DECLARE v_org INT;
    SELECT organizationId INTO v_org FROM Clubs WHERE id = NEW.clubId;
    IF v_org IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift report club is invalid';
    END IF;
    ${isUpdate ? `IF NOT (OLD.clubId <=> NEW.clubId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ShiftReport clubId is immutable';
    END IF;` : ''}
    IF NOT EXISTS (
      SELECT 1 FROM Shifts s
      WHERE s.id = NEW.shiftId AND s.clubId = NEW.clubId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift report shift club mismatch';
    END IF;
    IF NEW.templateId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM ShiftReportTemplates t
      WHERE t.id = NEW.templateId AND t.clubId = NEW.clubId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift report template club mismatch';
    END IF;
    ${accountClubAuthority('submittedByAccountId', 'Shift report submitter club authority mismatch')}
  END`;
}

function templateItemBody(isUpdate) {
  return `BEGIN
    ${isUpdate ? `IF NOT (OLD.templateId <=> NEW.templateId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift report template item parent is immutable';
    END IF;` : ''}
    IF NOT EXISTS (
      SELECT 1 FROM ShiftReportTemplates t WHERE t.id = NEW.templateId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift report template item parent mismatch';
    END IF;
  END`;
}

function answerBody(isUpdate) {
  return `BEGIN
    DECLARE v_template INT;
    ${isUpdate ? `IF NOT (OLD.reportId <=> NEW.reportId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift report answer parent is immutable';
    END IF;` : ''}
    SELECT templateId INTO v_template FROM ShiftReports WHERE id = NEW.reportId;
    IF v_template IS NULL AND NOT EXISTS (
      SELECT 1 FROM ShiftReports r WHERE r.id = NEW.reportId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift report answer parent mismatch';
    END IF;
    IF NEW.templateItemId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM ShiftReportTemplateItems i
      WHERE i.id = NEW.templateItemId AND i.templateId = v_template
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift report answer template item mismatch';
    END IF;
  END`;
}

function cashSessionBody(isUpdate) {
  return `BEGIN
    ${isUpdate ? `IF NOT (OLD.shiftId <=> NEW.shiftId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift cash session parent is immutable';
    END IF;` : ''}
    IF NOT EXISTS (
      SELECT 1 FROM Shifts s WHERE s.id = NEW.shiftId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift cash session shift mismatch';
    END IF;
  END`;
}

function cashExpenseBody(isUpdate) {
  return `BEGIN
    ${isUpdate ? `IF NOT (OLD.shiftId <=> NEW.shiftId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift cash expense shift parent is immutable';
    END IF;
    IF NOT (OLD.cashSessionId <=> NEW.cashSessionId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift cash expense session parent is immutable';
    END IF;` : ''}
    IF NOT EXISTS (
      SELECT 1 FROM Shifts s WHERE s.id = NEW.shiftId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift cash expense shift mismatch';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM ShiftCashSessions cs
      WHERE cs.id = NEW.cashSessionId AND cs.shiftId = NEW.shiftId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Shift cash expense session mismatch';
    END IF;
  END`;
}

const TRIGGERS = Object.freeze({
  shifts_tenant_bi: { body: shiftBody(false), event: 'INSERT', table: 'Shifts' },
  shifts_tenant_bu: { body: shiftBody(true), event: 'UPDATE', table: 'Shifts' },
  shift_report_templates_tenant_bi: {
    body: templateBody(false), event: 'INSERT', table: 'ShiftReportTemplates',
  },
  shift_report_templates_tenant_bu: {
    body: templateBody(true), event: 'UPDATE', table: 'ShiftReportTemplates',
  },
  shift_reports_tenant_bi: {
    body: reportBody(false), event: 'INSERT', table: 'ShiftReports',
  },
  shift_reports_tenant_bu: {
    body: reportBody(true), event: 'UPDATE', table: 'ShiftReports',
  },
  shift_report_template_items_tenant_bi: {
    body: templateItemBody(false), event: 'INSERT', table: 'ShiftReportTemplateItems',
  },
  shift_report_template_items_tenant_bu: {
    body: templateItemBody(true), event: 'UPDATE', table: 'ShiftReportTemplateItems',
  },
  shift_report_answers_tenant_bi: {
    body: answerBody(false), event: 'INSERT', table: 'ShiftReportAnswers',
  },
  shift_report_answers_tenant_bu: {
    body: answerBody(true), event: 'UPDATE', table: 'ShiftReportAnswers',
  },
  shift_cash_sessions_tenant_bi: {
    body: cashSessionBody(false), event: 'INSERT', table: 'ShiftCashSessions',
  },
  shift_cash_sessions_tenant_bu: {
    body: cashSessionBody(true), event: 'UPDATE', table: 'ShiftCashSessions',
  },
  shift_cash_expenses_tenant_bi: {
    body: cashExpenseBody(false), event: 'INSERT', table: 'ShiftCashExpenses',
  },
  shift_cash_expenses_tenant_bu: {
    body: cashExpenseBody(true), event: 'UPDATE', table: 'ShiftCashExpenses',
  },
});

function migrationError(message, code = 'TENANT_SHIFTS_REPORTS_MIGRATION_INVALID') {
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
    const marker = `__tenant_shift_literal_${literals.length}__`;
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
    .replace(/__tenant_shift_literal_(\d+)__/g, (_marker, index) => literals[Number(index)]);
}

async function selectRows(queryInterface, sql, replacements = {}) {
  const [rows] = await queryInterface.sequelize.query(sql, { replacements });
  return rows;
}

function rowValue(row, key) {
  return row[key] ?? row[key.toLowerCase()] ?? null;
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

async function getIndex(queryInterface, table, name) {
  return selectRows(queryInterface, `
    SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
           SUB_PART, COLLATION, INDEX_TYPE
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = :table AND INDEX_NAME = :name
    ORDER BY SEQ_IN_INDEX
  `, { name, table });
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
  `, { name });
  return rows[0] || null;
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

function columnIsCanonical(column) {
  return Boolean(
    column &&
      String(rowValue(column, 'DATA_TYPE')).toLowerCase() === 'int' &&
      /^int(?:\(\d+\))?$/.test(String(rowValue(column, 'COLUMN_TYPE')).toLowerCase()) &&
      rowValue(column, 'IS_NULLABLE') === 'NO' &&
      rowValue(column, 'COLUMN_DEFAULT') === null &&
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

function foreignKeyIsCanonical(row, expected) {
  return Boolean(
    row && sameIdentifier(rowValue(row, 'TABLE_NAME'), expected.table) &&
      rowValue(row, 'COLUMN_NAME') === expected.column &&
      sameIdentifier(
        rowValue(row, 'REFERENCED_TABLE_NAME'),
        expected.referencedTable,
      ) &&
      rowValue(row, 'REFERENCED_COLUMN_NAME') === expected.referencedColumn &&
      rowValue(row, 'UPDATE_RULE') === expected.onUpdate &&
      rowValue(row, 'DELETE_RULE') === expected.onDelete,
  );
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
      if (row.ACTION_STATEMENT !== undefined) {
        row.ACTION_STATEMENT = normalizeSql(row.ACTION_STATEMENT);
      }
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
    return getIndex(queryInterface, item.table, item.name);
  }
  if (kind === 'foreignKey') {
    const row = await getForeignKey(queryInterface, item.name);
    return row && sameIdentifier(rowValue(row, 'TABLE_NAME'), item.table) ? [row] : [];
  }
  if (kind === 'trigger') {
    const row = await getTrigger(queryInterface, item.name);
    return row && sameIdentifier(rowValue(row, 'EVENT_OBJECT_TABLE'), item.table)
      ? [row]
      : [];
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
  const columns = await Promise.all(COLUMNS.map(([table, name]) =>
    getColumn(queryInterface, table, name)));
  const indexes = await Promise.all(Object.entries(INDEXES).map(([name, expected]) =>
    getIndex(queryInterface, expected.table, name)));
  const foreignKeys = await Promise.all(Object.keys(FOREIGN_KEYS).map((name) =>
    getForeignKey(queryInterface, name)));
  const triggers = await Promise.all(Object.keys(TRIGGERS).map((name) =>
    getTrigger(queryInterface, name)));
  const anyReserved = columns.some(Boolean) || indexes.some((rows) => rows.length) ||
    foreignKeys.some(Boolean) || triggers.some(Boolean);
  if (!anyReserved) return { reasons: [], state: 'legacy' };

  const reasons = [];
  columns.forEach((column, index) => {
    if (!columnIsCanonical(column)) reasons.push(`column ${COLUMNS[index].join('.')} is not canonical`);
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
  return { reasons, state: reasons.length === 0 ? 'ready' : 'partial' };
}

async function getDefaultTenant(queryInterface) {
  const rows = await selectRows(queryInterface, `
    SELECT o.id AS organizationId, c.id AS clubId
    FROM Organizations o JOIN Clubs c ON c.organizationId = o.id
    WHERE o.slug = :organizationSlug AND c.slug = :clubSlug
    ORDER BY o.id, c.id
  `, {
    clubSlug: DEFAULT_CLUB_SLUG,
    organizationSlug: DEFAULT_ORGANIZATION_SLUG,
  });
  if (rows.length !== 1) throw migrationError('Exact default Organization and Club are required');
  return {
    clubId: Number(rowValue(rows[0], 'clubId')),
    organizationId: Number(rowValue(rows[0], 'organizationId')),
  };
}

async function assertLegacyDataCompatible(queryInterface, tenant) {
  const accountAuthorityMismatch = (table, field) => `
    SELECT COUNT(*) AS count FROM ${table} root
    WHERE root.${field} IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM Accounts a
      JOIN Memberships m ON m.accountId=a.id
        AND m.organizationId=:organizationId AND m.status='active'
      LEFT JOIN Staffs s ON s.id=m.staffId
        AND s.organizationId=:organizationId AND s.status='active'
      WHERE a.id=root.${field} AND a.status='active'
        AND ((a.staffId IS NULL AND m.staffId IS NULL) OR (a.staffId=m.staffId AND s.id=m.staffId))
        AND (m.role='owner' OR EXISTS (
          SELECT 1 FROM MembershipClubAccesses mca
          WHERE mca.membershipId=m.id AND mca.organizationId=:organizationId
            AND mca.clubId=:clubId AND mca.status='active'
            AND (mca.roleOverride IS NULL OR mca.roleOverride<>'owner')
        ))
    )
  `;
  const staffAuthorityMismatch = `
    SELECT COUNT(*) AS count FROM Shifts root
    WHERE root.staffId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM Staffs s
      JOIN Memberships m ON m.staffId=s.id
        AND m.organizationId=:organizationId AND m.status='active'
      WHERE s.id=root.staffId AND s.organizationId=:organizationId AND s.status='active'
        AND (m.role='owner' OR EXISTS (
          SELECT 1 FROM MembershipClubAccesses mca
          WHERE mca.membershipId=m.id AND mca.organizationId=:organizationId
            AND mca.clubId=:clubId AND mca.status='active'
        ))
    )
  `;
  const probes = [
    ['Shift staff', staffAuthorityMismatch],
    ['Shift approval actor', accountAuthorityMismatch('Shifts', 'approvedByAccountId')],
    ['Shift archive actor', accountAuthorityMismatch('Shifts', 'archivedByAccountId')],
    ['Template creator', accountAuthorityMismatch('ShiftReportTemplates', 'createdByAccountId')],
    ['Template editor', accountAuthorityMismatch('ShiftReportTemplates', 'updatedByAccountId')],
    ['Report submitter', accountAuthorityMismatch('ShiftReports', 'submittedByAccountId')],
    ['Report shift', `SELECT COUNT(*) AS count FROM ShiftReports r LEFT JOIN Shifts s ON s.id=r.shiftId WHERE s.id IS NULL`],
    ['Report template', `SELECT COUNT(*) AS count FROM ShiftReports r LEFT JOIN ShiftReportTemplates t ON t.id=r.templateId WHERE r.templateId IS NOT NULL AND t.id IS NULL`],
    ['Answer template item', `SELECT COUNT(*) AS count FROM ShiftReportAnswers a JOIN ShiftReports r ON r.id=a.reportId JOIN ShiftReportTemplateItems i ON i.id=a.templateItemId WHERE a.templateItemId IS NOT NULL AND (r.templateId IS NULL OR i.templateId<>r.templateId)`],
    ['Cash session shift', `SELECT COUNT(*) AS count FROM ShiftCashSessions cs LEFT JOIN Shifts s ON s.id=cs.shiftId WHERE s.id IS NULL`],
    ['Cash expense parents', `SELECT COUNT(*) AS count FROM ShiftCashExpenses expense LEFT JOIN Shifts s ON s.id=expense.shiftId LEFT JOIN ShiftCashSessions cs ON cs.id=expense.cashSessionId WHERE s.id IS NULL OR cs.id IS NULL OR cs.shiftId<>expense.shiftId`],
  ];
  for (const [label, sql] of probes) {
    const rows = await selectRows(queryInterface, sql, tenant);
    if (Number(rowValue(rows[0], 'count') || 0) > 0) {
      throw migrationError(`${label} contains non-default tenant provenance`);
    }
  }
}

function maybeFail(step) {
  if (process.env.TENANT_SHIFTS_REPORTS_MIGRATION_FAIL_STEP === step) {
    throw migrationError(
      `Forced shifts/reports migration failure at ${step}`,
      'TENANT_SHIFTS_REPORTS_FORCED_FAILURE',
    );
  }
}

async function createTrigger(queryInterface, name, expected) {
  await queryInterface.sequelize.query(
    `CREATE TRIGGER \`${name}\` BEFORE ${expected.event} ON \`${expected.table}\` FOR EACH ROW ${expected.body}`,
  );
}

async function preflightCleanupInvocation(queryInterface, created) {
  const items = [
    ...created.column.map((item) => ['column', item]),
    ...created.index.map((item) => ['index', item]),
    ...created.foreignKey.map((item) => ['foreignKey', item]),
    ...created.trigger.map((item) => ['trigger', item]),
  ];
  for (const [kind, item] of items) {
    const rows = await readArtifact(queryInterface, kind, item);
    if (rows.length === 0 || signature(kind, rows) !== item.signature) {
      const error = migrationError(
        `Shifts/reports cleanup ownership lost for ${kind} ${item.table}.${item.name}; operator repair required`,
        'TENANT_SHIFTS_REPORTS_CLEANUP_OWNERSHIP_LOST',
      );
      error.operatorRepair = true;
      throw error;
    }
  }
}

async function cleanupInvocation(queryInterface, created) {
  await preflightCleanupInvocation(queryInterface, created);
  for (const item of [...created.trigger].reverse()) {
    await queryInterface.sequelize.query(`DROP TRIGGER \`${item.name}\``);
  }
  for (const item of [...created.foreignKey].reverse()) {
    await queryInterface.removeConstraint(item.table, item.name);
  }
  for (const item of [...created.index].reverse()) {
    await queryInterface.removeIndex(item.table, item.name);
  }
  for (const item of [...created.column].reverse()) {
    await queryInterface.removeColumn(item.table, item.name);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const classification = await classifyState(queryInterface);
    if (classification.state === 'ready') return;
    if (classification.state !== 'legacy') {
      throw migrationError(`Shifts/reports migration refused partial schema: ${classification.reasons.join('; ')}`);
    }
    const tenant = await getDefaultTenant(queryInterface);
    await assertLegacyDataCompatible(queryInterface, tenant);
    const created = { column: [], foreignKey: [], index: [], trigger: [] };
    try {
      for (const [table, name] of COLUMNS) {
        await queryInterface.addColumn(table, name, {
          allowNull: true,
          type: Sequelize.INTEGER,
        });
        await track(queryInterface, created, 'column', { name, table });
      }
      maybeFail('after_columns');
      await queryInterface.sequelize.query(
        'UPDATE Shifts SET clubId=:clubId WHERE clubId IS NULL',
        { replacements: tenant },
      );
      await queryInterface.sequelize.query(
        'UPDATE ShiftReportTemplates SET clubId=:clubId WHERE clubId IS NULL',
        { replacements: tenant },
      );
      await queryInterface.sequelize.query(`
        UPDATE ShiftReports r JOIN Shifts s ON s.id=r.shiftId
        SET r.clubId=s.clubId WHERE r.clubId IS NULL
      `);
      for (const [table, name] of COLUMNS) {
        await queryInterface.changeColumn(table, name, {
          allowNull: false,
          type: Sequelize.INTEGER,
        });
        await refresh(queryInterface, created, 'column', { name, table });
      }
      maybeFail('after_backfill');
      for (const [name, expected] of Object.entries(FOREIGN_KEYS)) {
        await queryInterface.addConstraint(expected.table, {
          fields: [expected.column],
          name,
          onDelete: expected.onDelete,
          onUpdate: expected.onUpdate,
          references: { field: expected.referencedColumn, table: expected.referencedTable },
          type: 'foreign key',
        });
        await track(queryInterface, created, 'foreignKey', { name, table: expected.table });
      }
      for (const [name, expected] of Object.entries(INDEXES)) {
        await queryInterface.addIndex(expected.table, expected.columns, {
          name,
          unique: expected.unique,
        });
        await track(queryInterface, created, 'index', { name, table: expected.table });
      }
      maybeFail('after_constraints');
      for (const [name, expected] of Object.entries(TRIGGERS)) {
        await createTrigger(queryInterface, name, expected);
        await track(queryInterface, created, 'trigger', { name, table: expected.table });
      }
      maybeFail('after_triggers');
      const ready = await classifyState(queryInterface);
      if (ready.state !== 'ready') {
        throw migrationError(`Shifts/reports migration did not reach ready state: ${ready.reasons.join('; ')}`);
      }
    } catch (error) {
      try {
        await cleanupInvocation(queryInterface, created);
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
      throw migrationError(`Shifts/reports rollback refused partial schema: ${classification.reasons.join('; ')}`);
    }
    const organizations = await selectRows(
      queryInterface,
      'SELECT id FROM Organizations ORDER BY id LIMIT 2',
    );
    if (organizations.length > 1) {
      throw migrationError(
        'Shifts/reports rollback refused while a second Organization exists',
        'TENANT_SHIFTS_REPORTS_ROLLBACK_SECOND_ORGANIZATION',
      );
    }
    const tenant = await getDefaultTenant(queryInterface);
    const rows = await selectRows(queryInterface, `
      SELECT
        (SELECT COUNT(*) FROM Shifts WHERE clubId<>:clubId) +
        (SELECT COUNT(*) FROM ShiftReportTemplates WHERE clubId<>:clubId) +
        (SELECT COUNT(*) FROM ShiftReports WHERE clubId<>:clubId) AS count
    `, tenant);
    if (Number(rowValue(rows[0], 'count') || 0) > 0) {
      throw migrationError(
        'Shifts/reports rollback refused with non-default Club data',
        'TENANT_SHIFTS_REPORTS_ROLLBACK_NON_DEFAULT_CLUB',
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
    for (const [table, name] of [...COLUMNS].reverse()) {
      await queryInterface.removeColumn(table, name);
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
