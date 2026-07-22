'use strict';

const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../src/tenant-foundation/constants');

const COLUMNS = Object.freeze([
  ['TrainingNotes', 'clubId'],
  ['TrainingPlans', 'clubId'],
]);

const LOWER_CASE_TABLE_NAMES = new WeakMap();

const INDEXES = Object.freeze({
  training_notes_club_id_unique: {
    columns: ['clubId', 'id'], table: 'TrainingNotes', unique: true,
  },
  training_notes_club_user_trained_idx: {
    columns: ['clubId', 'userId', 'trainedAt', 'createdAt'],
    table: 'TrainingNotes',
    unique: false,
  },
  training_notes_club_trainer_trained_idx: {
    columns: ['clubId', 'trainerAccountId', 'trainedAt'],
    table: 'TrainingNotes',
    unique: false,
  },
  training_plans_club_id_unique: {
    columns: ['clubId', 'id'], table: 'TrainingPlans', unique: true,
  },
  training_plans_club_status_planned_idx: {
    columns: ['clubId', 'status', 'plannedAt'],
    table: 'TrainingPlans',
    unique: false,
  },
  training_plans_club_trainer_status_idx: {
    columns: ['clubId', 'trainerAccountId', 'status'],
    table: 'TrainingPlans',
    unique: false,
  },
});

const FOREIGN_KEYS = Object.freeze({
  training_notes_club_fk: {
    column: 'clubId',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    referencedColumn: 'id',
    referencedTable: 'Clubs',
    table: 'TrainingNotes',
  },
  training_plans_club_fk: {
    column: 'clubId',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    referencedColumn: 'id',
    referencedTable: 'Clubs',
    table: 'TrainingPlans',
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

function trainingNoteBody(isUpdate) {
  return `BEGIN
    DECLARE v_org INT;
    SELECT organizationId INTO v_org FROM Clubs WHERE id = NEW.clubId;
    IF v_org IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingNote club is invalid';
    END IF;
    ${isUpdate ? `IF NOT (OLD.clubId <=> NEW.clubId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingNote clubId is immutable';
    END IF;` : ''}
    IF NOT EXISTS (
      SELECT 1 FROM Users u
      WHERE u.id = NEW.userId AND u.organizationId = v_org
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingNote client organization mismatch';
    END IF;
    ${accountClubAuthority('trainerAccountId', 'TrainingNote trainer club authority mismatch')}
    ${accountClubAuthority('trainingAccountId', 'TrainingNote training actor club authority mismatch')}
  END`;
}

function trainingPlanBody(isUpdate) {
  return `BEGIN
    DECLARE v_org INT;
    SELECT organizationId INTO v_org FROM Clubs WHERE id = NEW.clubId;
    IF v_org IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingPlan club is invalid';
    END IF;
    ${isUpdate ? `IF NOT (OLD.clubId <=> NEW.clubId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingPlan clubId is immutable';
    END IF;` : ''}
    IF NEW.bookingId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM Bookings b
      WHERE b.id = NEW.bookingId
        AND b.organizationId = v_org
        AND b.clubId = NEW.clubId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingPlan booking club mismatch';
    END IF;
    ${accountClubAuthority('trainerAccountId', 'TrainingPlan trainer club authority mismatch')}
    ${accountClubAuthority('trainingAccountId', 'TrainingPlan training actor club authority mismatch')}
  END`;
}

function participantBody() {
  return `BEGIN
    DECLARE v_club INT;
    DECLARE v_org INT;
    SELECT p.clubId, c.organizationId INTO v_club, v_org
    FROM TrainingPlans p
    JOIN Clubs c ON c.id = p.clubId
    WHERE p.id = NEW.trainingPlanId;
    IF v_club IS NULL OR NOT EXISTS (
      SELECT 1 FROM Users u
      WHERE u.id = NEW.userId AND u.organizationId = v_org
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingPlan participant organization mismatch';
    END IF;
    IF NEW.trainingNoteId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM TrainingNotes n
      WHERE n.id = NEW.trainingNoteId
        AND n.clubId = v_club
        AND n.userId = NEW.userId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingPlan participant note provenance mismatch';
    END IF;
  END`;
}

function planExerciseBody() {
  return `BEGIN
    DECLARE v_org INT;
    SELECT c.organizationId INTO v_org
    FROM TrainingPlans p JOIN Clubs c ON c.id = p.clubId
    WHERE p.id = NEW.trainingPlanId;
    IF v_org IS NULL OR (
      NEW.trainingExerciseId IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM TrainingExercises e
        WHERE e.id = NEW.trainingExerciseId AND e.organizationId = v_org
      )
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingPlanExercise club methodology mismatch';
    END IF;
  END`;
}

function noteExerciseBody() {
  return `BEGIN
    DECLARE v_org INT;
    SELECT c.organizationId INTO v_org
    FROM TrainingNotes n JOIN Clubs c ON c.id = n.clubId
    WHERE n.id = NEW.trainingNoteId;
    IF v_org IS NULL OR (
      NEW.trainingExerciseId IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM TrainingExercises e
        WHERE e.id = NEW.trainingExerciseId AND e.organizationId = v_org
      )
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingNoteExercise club methodology mismatch';
    END IF;
  END`;
}

const TRIGGERS = Object.freeze({
  training_notes_club_bi: {
    body: trainingNoteBody(false), event: 'INSERT', table: 'TrainingNotes',
  },
  training_notes_club_bu: {
    body: trainingNoteBody(true), event: 'UPDATE', table: 'TrainingNotes',
  },
  training_plans_club_bi: {
    body: trainingPlanBody(false), event: 'INSERT', table: 'TrainingPlans',
  },
  training_plans_club_bu: {
    body: trainingPlanBody(true), event: 'UPDATE', table: 'TrainingPlans',
  },
  training_plan_participants_club_bi: {
    body: participantBody(), event: 'INSERT', table: 'TrainingPlanParticipants',
  },
  training_plan_participants_club_bu: {
    body: participantBody(), event: 'UPDATE', table: 'TrainingPlanParticipants',
  },
  training_plan_exercises_club_bi: {
    body: planExerciseBody(), event: 'INSERT', table: 'TrainingPlanExercises',
  },
  training_plan_exercises_club_bu: {
    body: planExerciseBody(), event: 'UPDATE', table: 'TrainingPlanExercises',
  },
  training_note_exercises_club_bi: {
    body: noteExerciseBody(), event: 'INSERT', table: 'TrainingNoteExercises',
  },
  training_note_exercises_club_bu: {
    body: noteExerciseBody(), event: 'UPDATE', table: 'TrainingNoteExercises',
  },
});

function migrationError(message, code = 'TENANT_TRAINING_OPERATIONS_MIGRATION_INVALID') {
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
    const marker = `__tenant_training_literal_${literals.length}__`;
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
    .replace(/__tenant_training_literal_(\d+)__/g, (_marker, index) => literals[Number(index)]);
}

async function selectRows(queryInterface, sql, replacements = {}) {
  const [rows] = await queryInterface.sequelize.query(sql, { replacements });
  return rows;
}

function rowValue(row, key) {
  return row[key] ?? row[key.toLowerCase()] ?? null;
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
  const rows = await selectRows(
    queryInterface,
    'SELECT @@lower_case_table_names AS lowerCaseTableNames',
  );
  const setting = Number(rowValue(rows[0], 'lowerCaseTableNames'));
  if (![0, 1, 2].includes(setting)) {
    throw migrationError(`Unsupported lower_case_table_names value: ${setting}`);
  }
  LOWER_CASE_TABLE_NAMES.set(queryInterface, setting);
  return setting;
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

function indexIsCanonical(rows, expected, lowerCaseTableNames) {
  return rows.length === expected.columns.length && rows.every((row, index) =>
    tableIdentifierEquals(
      rowValue(row, 'TABLE_NAME'),
      expected.table,
      lowerCaseTableNames,
    ) &&
    Number(rowValue(row, 'NON_UNIQUE')) === (expected.unique ? 0 : 1) &&
    Number(rowValue(row, 'SEQ_IN_INDEX')) === index + 1 &&
    rowValue(row, 'COLUMN_NAME') === expected.columns[index] &&
    rowValue(row, 'SUB_PART') === null &&
    ['A', null].includes(rowValue(row, 'COLLATION')) &&
    String(rowValue(row, 'INDEX_TYPE')).toUpperCase() === 'BTREE');
}

function foreignKeyIsCanonical(row, expected, lowerCaseTableNames) {
  return Boolean(
    row &&
      tableIdentifierEquals(
        rowValue(row, 'TABLE_NAME'),
        expected.table,
        lowerCaseTableNames,
      ) &&
      rowValue(row, 'COLUMN_NAME') === expected.column &&
      tableIdentifierEquals(
        rowValue(row, 'REFERENCED_TABLE_NAME'),
        expected.referencedTable,
        lowerCaseTableNames,
      ) &&
      rowValue(row, 'REFERENCED_COLUMN_NAME') === expected.referencedColumn &&
      rowValue(row, 'UPDATE_RULE') === expected.onUpdate &&
      rowValue(row, 'DELETE_RULE') === expected.onDelete,
  );
}

function triggerIsCanonical(row, expected, lowerCaseTableNames) {
  return Boolean(
    row &&
      tableIdentifierEquals(
        rowValue(row, 'EVENT_OBJECT_TABLE'),
        expected.table,
        lowerCaseTableNames,
      ) &&
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
    return getIndex(queryInterface, item.table, item.name);
  }
  if (kind === 'foreignKey') {
    const row = await getForeignKey(queryInterface, item.name);
    const lowerCaseTableNames = await getLowerCaseTableNames(queryInterface);
    return row && tableIdentifierEquals(
      rowValue(row, 'TABLE_NAME'),
      item.table,
      lowerCaseTableNames,
    ) ? [row] : [];
  }
  if (kind === 'trigger') {
    const row = await getTrigger(queryInterface, item.name);
    const lowerCaseTableNames = await getLowerCaseTableNames(queryInterface);
    return row && tableIdentifierEquals(
      rowValue(row, 'EVENT_OBJECT_TABLE'),
      item.table,
      lowerCaseTableNames,
    )
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
  tracked.signature = signature(kind, rows);
}

async function classifyState(queryInterface) {
  const lowerCaseTableNames = await getLowerCaseTableNames(queryInterface);
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
    if (!indexIsCanonical(indexes[index], expected, lowerCaseTableNames)) reasons.push(`index ${name} is not canonical`);
  });
  Object.entries(FOREIGN_KEYS).forEach(([name, expected], index) => {
    if (!foreignKeyIsCanonical(foreignKeys[index], expected, lowerCaseTableNames)) reasons.push(`foreign key ${name} is not canonical`);
  });
  Object.entries(TRIGGERS).forEach(([name, expected], index) => {
    if (!triggerIsCanonical(triggers[index], expected, lowerCaseTableNames)) reasons.push(`trigger ${name} is not canonical`);
  });
  return { reasons, state: reasons.length === 0 ? 'ready' : 'partial' };
}

async function getDefaultTenant(queryInterface) {
  const rows = await selectRows(queryInterface, `
    SELECT o.id AS organizationId, c.id AS clubId
    FROM Organizations o
    JOIN Clubs c ON c.organizationId = o.id
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
    SELECT COUNT(*) AS count
    FROM ${table} root
    WHERE root.${field} IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM Accounts a
      JOIN Memberships m
        ON m.accountId=a.id
       AND m.organizationId=:organizationId
       AND m.status='active'
      LEFT JOIN Staffs s
        ON s.id=m.staffId
       AND s.organizationId=:organizationId
       AND s.status='active'
      WHERE a.id=root.${field}
        AND a.status='active'
        AND (
          (a.staffId IS NULL AND m.staffId IS NULL)
          OR (a.staffId=m.staffId AND s.id=m.staffId)
        )
        AND (
          m.role='owner'
          OR EXISTS (
            SELECT 1 FROM MembershipClubAccesses mca
            WHERE mca.membershipId=m.id
              AND mca.organizationId=:organizationId
              AND mca.clubId=:clubId
              AND mca.status='active'
          )
        )
    )
  `;
  const probes = [
    ['TrainingNotes clients', `SELECT COUNT(*) AS count FROM TrainingNotes n JOIN Users u ON u.id=n.userId WHERE u.organizationId<>:organizationId`],
    ['TrainingNotes exercises', `SELECT COUNT(*) AS count FROM TrainingNoteExercises ne JOIN TrainingNotes n ON n.id=ne.trainingNoteId JOIN TrainingExercises e ON e.id=ne.trainingExerciseId WHERE e.organizationId<>:organizationId`],
    ['TrainingPlans bookings', `SELECT COUNT(*) AS count FROM TrainingPlans p JOIN Bookings b ON b.id=p.bookingId WHERE b.organizationId<>:organizationId OR b.clubId<>:clubId`],
    ['TrainingPlans participants', `SELECT COUNT(*) AS count FROM TrainingPlanParticipants pp JOIN Users u ON u.id=pp.userId WHERE u.organizationId<>:organizationId`],
    ['TrainingPlans note provenance', `SELECT COUNT(*) AS count FROM TrainingPlanParticipants pp JOIN TrainingNotes n ON n.id=pp.trainingNoteId WHERE n.userId<>pp.userId`],
    ['TrainingPlans exercises', `SELECT COUNT(*) AS count FROM TrainingPlanExercises pe JOIN TrainingExercises e ON e.id=pe.trainingExerciseId WHERE e.organizationId<>:organizationId`],
    ['TrainingNotes trainer authority', accountAuthorityMismatch('TrainingNotes', 'trainerAccountId')],
    ['TrainingNotes training actor authority', accountAuthorityMismatch('TrainingNotes', 'trainingAccountId')],
    ['TrainingPlans trainer authority', accountAuthorityMismatch('TrainingPlans', 'trainerAccountId')],
    ['TrainingPlans training actor authority', accountAuthorityMismatch('TrainingPlans', 'trainingAccountId')],
  ];
  for (const [label, sql] of probes) {
    const rows = await selectRows(queryInterface, sql, tenant);
    if (Number(rowValue(rows[0], 'count') || 0) > 0) {
      throw migrationError(`${label} contains non-default tenant provenance`);
    }
  }
}

function maybeFail(step) {
  if (process.env.TENANT_TRAINING_NOTES_PLANS_MIGRATION_FAIL_STEP === step) {
    throw migrationError(
      `Forced training operations migration failure at ${step}`,
      'TENANT_TRAINING_OPERATIONS_FORCED_FAILURE',
    );
  }
}

async function createTrigger(queryInterface, name, expected) {
  await queryInterface.sequelize.query(
    `CREATE TRIGGER \`${name}\` BEFORE ${expected.event} ON \`${expected.table}\` FOR EACH ROW ${expected.body}`,
  );
}

async function cleanupInvocation(queryInterface, created) {
  const items = [
    ...created.column.map((item) => ['column', item]),
    ...created.index.map((item) => ['index', item]),
    ...created.foreignKey.map((item) => ['foreignKey', item]),
    ...created.trigger.map((item) => ['trigger', item]),
  ];
  for (const [kind, item] of items) {
    const rows = await readArtifact(queryInterface, kind, item);
    if (rows.length === 0 || signature(kind, rows) !== item.signature) {
      throw migrationError(
        `Training operations cleanup ownership lost for ${kind} ${item.table}.${item.name}`,
        'TENANT_TRAINING_OPERATIONS_CLEANUP_OWNERSHIP_LOST',
      );
    }
  }
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
      throw migrationError(`Training operations migration refused partial schema: ${classification.reasons.join('; ')}`);
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
        'UPDATE TrainingNotes SET clubId=:clubId WHERE clubId IS NULL',
        { replacements: tenant },
      );
      await queryInterface.sequelize.query(
        'UPDATE TrainingPlans SET clubId=:clubId WHERE clubId IS NULL',
        { replacements: tenant },
      );
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
        throw migrationError(`Training operations migration did not reach ready state: ${ready.reasons.join('; ')}`);
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
      throw migrationError(`Training operations rollback refused partial schema: ${classification.reasons.join('; ')}`);
    }
    const organizations = await selectRows(
      queryInterface,
      'SELECT id FROM Organizations ORDER BY id LIMIT 2',
    );
    if (organizations.length > 1) {
      throw migrationError(
        'Training operations rollback refused while a second Organization exists',
        'TENANT_TRAINING_OPERATIONS_ROLLBACK_SECOND_ORGANIZATION',
      );
    }
    const tenant = await getDefaultTenant(queryInterface);
    const nonDefault = await selectRows(queryInterface, `
      SELECT
        (SELECT COUNT(*) FROM TrainingNotes WHERE clubId<>:clubId) +
        (SELECT COUNT(*) FROM TrainingPlans WHERE clubId<>:clubId) AS count
    `, tenant);
    if (Number(rowValue(nonDefault[0], 'count') || 0) > 0) {
      throw migrationError(
        'Training operations rollback refused with non-default Club data',
        'TENANT_TRAINING_OPERATIONS_ROLLBACK_NON_DEFAULT_CLUB',
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
    foreignKeyIsCanonical,
    getLowerCaseTableNames,
    indexIsCanonical,
    normalizeSql,
    readArtifact,
    signature,
    tableIdentifierEquals,
    triggerIsCanonical,
  },
};
