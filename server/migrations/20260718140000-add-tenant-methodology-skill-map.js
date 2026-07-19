'use strict';

const { DEFAULT_ORGANIZATION_SLUG } = require('../src/tenant-foundation/constants');

const TABLES = Object.freeze({
  exercises: 'TrainingExercises',
  skills: 'TrainingSkills',
});

const COLUMNS = Object.freeze([
  ['TrainingSkills', 'organizationId'],
  ['TrainingExercises', 'organizationId'],
]);

const INDEX_VISIBILITY_SUPPORT = new WeakMap();

const INDEXES = Object.freeze({
  training_skills_org_id_unique: {
    columns: ['organizationId', 'id'],
    table: 'TrainingSkills',
    unique: true,
  },
  training_skills_org_name_unique: {
    columns: ['organizationId', 'name'],
    table: 'TrainingSkills',
    unique: true,
  },
  training_skills_org_status_direction_idx: {
    columns: ['organizationId', 'status', 'direction'],
    table: 'TrainingSkills',
    unique: false,
  },
  training_exercises_org_id_unique: {
    columns: ['organizationId', 'id'],
    table: 'TrainingExercises',
    unique: true,
  },
  training_exercises_org_status_elevel_idx: {
    columns: ['organizationId', 'status', 'eLevel'],
    table: 'TrainingExercises',
    unique: false,
  },
  training_exercises_org_main_skill_idx: {
    columns: ['organizationId', 'mainSkillId'],
    table: 'TrainingExercises',
    unique: false,
  },
  training_exercises_org_creator_status_idx: {
    columns: ['organizationId', 'createdByAccountId', 'status'],
    table: 'TrainingExercises',
    unique: false,
  },
});

const FOREIGN_KEYS = Object.freeze({
  training_skills_organization_fk: {
    column: 'organizationId',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    referencedColumn: 'id',
    referencedTable: 'Organizations',
    table: 'TrainingSkills',
  },
  training_exercises_organization_fk: {
    column: 'organizationId',
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    referencedColumn: 'id',
    referencedTable: 'Organizations',
    table: 'TrainingExercises',
  },
});

function membershipCheck(field, message) {
  return `
    IF NEW.${field} IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM Memberships m
      WHERE m.accountId = NEW.${field}
        AND m.organizationId = v_org
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${message}';
    END IF;`;
}

function rootSkillBody(isUpdate) {
  return `BEGIN
    DECLARE v_org INT;
    SET v_org = NEW.organizationId;
    ${isUpdate ? `IF NOT (OLD.organizationId <=> NEW.organizationId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingSkill organizationId is immutable';
    END IF;` : ''}
    ${membershipCheck('createdByAccountId', 'TrainingSkill creator organization mismatch')}
    ${membershipCheck('updatedByAccountId', 'TrainingSkill updater organization mismatch')}
  END`;
}

function rootExerciseBody(isUpdate) {
  return `BEGIN
    DECLARE v_org INT;
    SET v_org = NEW.organizationId;
    ${isUpdate ? `IF NOT (OLD.organizationId <=> NEW.organizationId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingExercise organizationId is immutable';
    END IF;` : ''}
    IF NEW.mainSkillId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM TrainingSkills s
      WHERE s.id = NEW.mainSkillId AND s.organizationId = v_org
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingExercise main skill organization mismatch';
    END IF;
    ${membershipCheck('createdByAccountId', 'TrainingExercise creator organization mismatch')}
    ${membershipCheck('updatedByAccountId', 'TrainingExercise updater organization mismatch')}
    ${membershipCheck('approvedByAccountId', 'TrainingExercise approver organization mismatch')}
  END`;
}

function exerciseSkillBody() {
  return `BEGIN
    IF NOT EXISTS (
      SELECT 1
      FROM TrainingExercises e
      JOIN TrainingSkills s ON s.id = NEW.trainingSkillId
      WHERE e.id = NEW.trainingExerciseId
        AND e.organizationId = s.organizationId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingExerciseSkill organization mismatch';
    END IF;
  END`;
}

function clientSkillBody() {
  return `BEGIN
    DECLARE v_org INT;
    SELECT u.organizationId INTO v_org
    FROM Users u
    WHERE u.id = NEW.userId;
    IF v_org IS NULL OR NOT EXISTS (
      SELECT 1 FROM TrainingSkills s
      WHERE s.id = NEW.trainingSkillId AND s.organizationId = v_org
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ClientTrainingSkill organization mismatch';
    END IF;
    ${membershipCheck('updatedByAccountId', 'ClientTrainingSkill updater organization mismatch')}
    ${membershipCheck('trainingAccountId', 'ClientTrainingSkill training account organization mismatch')}
  END`;
}

function historyBody() {
  return `BEGIN
    DECLARE v_org INT;
    SELECT u.organizationId INTO v_org
    FROM Users u
    WHERE u.id = NEW.userId;
    IF v_org IS NULL OR NOT EXISTS (
      SELECT 1
      FROM ClientTrainingSkills cts
      JOIN TrainingSkills s ON s.id = cts.trainingSkillId
      WHERE cts.id = NEW.clientTrainingSkillId
        AND cts.userId = NEW.userId
        AND cts.trainingSkillId = NEW.trainingSkillId
        AND s.organizationId = v_org
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ClientTrainingSkillHistory parent organization mismatch';
    END IF;
    ${membershipCheck('updatedByAccountId', 'Skill history actor organization mismatch')}
    ${membershipCheck('trainingAccountId', 'Skill history training account organization mismatch')}
    IF NEW.source = 'structured_training' THEN
      IF NEW.trainingNoteId IS NULL OR NEW.trainingNoteExerciseId IS NULL OR NOT EXISTS (
        SELECT 1
        FROM TrainingNotes n
        JOIN TrainingNoteExercises ne
          ON ne.id = NEW.trainingNoteExerciseId
         AND ne.trainingNoteId = n.id
        JOIN TrainingExercises e ON e.id = ne.trainingExerciseId
        WHERE n.id = NEW.trainingNoteId
          AND n.userId = NEW.userId
          AND e.organizationId = v_org
          AND (
            e.mainSkillId = NEW.trainingSkillId
            OR EXISTS (
              SELECT 1 FROM TrainingExerciseSkills es
              WHERE es.trainingExerciseId = e.id
                AND es.trainingSkillId = NEW.trainingSkillId
            )
          )
      ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Structured skill history note provenance mismatch';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM TrainingNotes n
        WHERE n.id = NEW.trainingNoteId
          AND n.trainerAccountId IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM Memberships m
            WHERE m.accountId = n.trainerAccountId
              AND m.organizationId = v_org
          )
      ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Structured skill history trainer provenance mismatch';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM TrainingPlanParticipants pp
        JOIN TrainingPlans p ON p.id = pp.trainingPlanId
        LEFT JOIN Bookings b ON b.id = p.bookingId
        WHERE pp.trainingNoteId = NEW.trainingNoteId
          AND (pp.userId <> NEW.userId OR (b.id IS NOT NULL AND b.organizationId <> v_org))
      ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Structured skill history booking provenance mismatch';
      END IF;
    ELSEIF NEW.trainingNoteId IS NOT NULL OR NEW.trainingNoteExerciseId IS NOT NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Manual skill history cannot reference training note';
    END IF;
  END`;
}

function noteExerciseBody() {
  return `BEGIN
    DECLARE v_org INT;
    IF NEW.trainingExerciseId IS NOT NULL THEN
      SELECT u.organizationId INTO v_org
      FROM TrainingNotes n
      JOIN Users u ON u.id = n.userId
      WHERE n.id = NEW.trainingNoteId;
      IF v_org IS NULL OR NOT EXISTS (
        SELECT 1 FROM TrainingExercises e
        WHERE e.id = NEW.trainingExerciseId AND e.organizationId = v_org
      ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingNoteExercise organization mismatch';
      END IF;
      IF EXISTS (
        SELECT 1 FROM TrainingNotes n
        WHERE n.id = NEW.trainingNoteId
          AND n.trainerAccountId IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM Memberships m
            WHERE m.accountId = n.trainerAccountId
              AND m.organizationId = v_org
          )
      ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingNote trainer organization mismatch';
      END IF;
    END IF;
  END`;
}

function planExerciseBody() {
  return `BEGIN
    DECLARE v_org INT;
    DECLARE v_min_org INT;
    DECLARE v_max_org INT;
    IF NEW.trainingExerciseId IS NOT NULL THEN
      SELECT b.organizationId INTO v_org
      FROM TrainingPlans p
      JOIN Bookings b ON b.id = p.bookingId
      WHERE p.id = NEW.trainingPlanId;
      IF v_org IS NULL THEN
        SELECT MIN(u.organizationId), MAX(u.organizationId)
          INTO v_min_org, v_max_org
        FROM TrainingPlanParticipants pp
        JOIN Users u ON u.id = pp.userId
        WHERE pp.trainingPlanId = NEW.trainingPlanId;
        IF v_min_org IS NULL OR v_min_org <> v_max_org THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingPlan participant organization mismatch';
        END IF;
        SET v_org = v_min_org;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM TrainingExercises e
        WHERE e.id = NEW.trainingExerciseId AND e.organizationId = v_org
      ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TrainingPlanExercise organization mismatch';
      END IF;
    END IF;
  END`;
}

const TRIGGERS = Object.freeze({
  training_skills_tenant_bi: { body: rootSkillBody(false), event: 'INSERT', table: 'TrainingSkills' },
  training_skills_tenant_bu: { body: rootSkillBody(true), event: 'UPDATE', table: 'TrainingSkills' },
  training_exercises_tenant_bi: { body: rootExerciseBody(false), event: 'INSERT', table: 'TrainingExercises' },
  training_exercises_tenant_bu: { body: rootExerciseBody(true), event: 'UPDATE', table: 'TrainingExercises' },
  training_exercise_skills_tenant_bi: { body: exerciseSkillBody(), event: 'INSERT', table: 'TrainingExerciseSkills' },
  training_exercise_skills_tenant_bu: { body: exerciseSkillBody(), event: 'UPDATE', table: 'TrainingExerciseSkills' },
  client_training_skills_tenant_bi: { body: clientSkillBody(), event: 'INSERT', table: 'ClientTrainingSkills' },
  client_training_skills_tenant_bu: { body: clientSkillBody(), event: 'UPDATE', table: 'ClientTrainingSkills' },
  client_training_skill_history_tenant_bi: { body: historyBody(), event: 'INSERT', table: 'ClientTrainingSkillHistories' },
  client_training_skill_history_tenant_bu: { body: historyBody(), event: 'UPDATE', table: 'ClientTrainingSkillHistories' },
  training_note_exercises_tenant_bi: { body: noteExerciseBody(), event: 'INSERT', table: 'TrainingNoteExercises' },
  training_note_exercises_tenant_bu: { body: noteExerciseBody(), event: 'UPDATE', table: 'TrainingNoteExercises' },
  training_plan_exercises_tenant_bi: { body: planExerciseBody(), event: 'INSERT', table: 'TrainingPlanExercises' },
  training_plan_exercises_tenant_bu: { body: planExerciseBody(), event: 'UPDATE', table: 'TrainingPlanExercises' },
});

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
    const marker = `__tenant_sql_literal_${literals.length}__`;
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
    .replace(/__tenant_sql_literal_(\d+)__/g, (_marker, index) => literals[Number(index)]);
}

function migrationError(message, code = 'TENANT_METHODOLOGY_MIGRATION_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function selectRows(queryInterface, sql, replacements = {}) {
  const [rows] = await queryInterface.sequelize.query(sql, { replacements });
  return rows;
}

function value(row, key) {
  return row[key] ?? row[key.toLowerCase()] ?? null;
}

function sameIdentifier(left, right) {
  return String(left || '').toLowerCase() === String(right || '').toLowerCase();
}

async function getColumn(queryInterface, table, column) {
  const rows = await selectRows(queryInterface, `
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE,
           CHARACTER_MAXIMUM_LENGTH, CHARACTER_OCTET_LENGTH,
           NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION,
           COLUMN_DEFAULT, EXTRA, CHARACTER_SET_NAME, COLLATION_NAME,
           COLUMN_COMMENT, GENERATION_EXPRESSION
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column
  `, { column, table });
  return rows[0] || null;
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

async function getIndex(queryInterface, table, name) {
  const visibility = await supportsIndexVisibility(queryInterface)
    ? 'IS_VISIBLE'
    : "'YES' AS IS_VISIBLE";
  const rows = await selectRows(queryInterface, `
    SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
           SUB_PART, COLLATION, INDEX_TYPE, ${visibility}
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = :table AND INDEX_NAME = :name
    ORDER BY SEQ_IN_INDEX
  `, { name, table });
  return rows;
}

async function getForeignKey(queryInterface, name) {
  const rows = await selectRows(queryInterface, `
    SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
           k.REFERENCED_TABLE_NAME,
           k.REFERENCED_COLUMN_NAME, r.UPDATE_RULE, r.DELETE_RULE
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

function normalizeDefault(valueToNormalize) {
  if (
    valueToNormalize === null ||
    valueToNormalize === undefined ||
    String(valueToNormalize).trim().toUpperCase() === 'NULL'
  ) {
    return null;
  }
  return String(valueToNormalize);
}

function normalizeColumnRow(row) {
  return {
    characterMaximumLength: value(row, 'CHARACTER_MAXIMUM_LENGTH') === null
      ? null
      : Number(value(row, 'CHARACTER_MAXIMUM_LENGTH')),
    characterOctetLength: value(row, 'CHARACTER_OCTET_LENGTH') === null
      ? null
      : Number(value(row, 'CHARACTER_OCTET_LENGTH')),
    characterSetName: value(row, 'CHARACTER_SET_NAME'),
    collationName: value(row, 'COLLATION_NAME'),
    columnComment: String(value(row, 'COLUMN_COMMENT') || ''),
    columnDefault: normalizeDefault(value(row, 'COLUMN_DEFAULT')),
    columnName: value(row, 'COLUMN_NAME'),
    columnType: String(value(row, 'COLUMN_TYPE') || '').toLowerCase(),
    dataType: String(value(row, 'DATA_TYPE') || '').toLowerCase(),
    datetimePrecision: value(row, 'DATETIME_PRECISION') === null
      ? null
      : Number(value(row, 'DATETIME_PRECISION')),
    extra: String(value(row, 'EXTRA') || '').trim().toLowerCase(),
    generationExpression: String(value(row, 'GENERATION_EXPRESSION') || ''),
    isNullable: String(value(row, 'IS_NULLABLE') || '').toUpperCase(),
    numericPrecision: value(row, 'NUMERIC_PRECISION') === null
      ? null
      : Number(value(row, 'NUMERIC_PRECISION')),
    numericScale: value(row, 'NUMERIC_SCALE') === null
      ? null
      : Number(value(row, 'NUMERIC_SCALE')),
    tableName: value(row, 'TABLE_NAME'),
  };
}

function normalizeIndexRows(rows) {
  return rows.map((row) => ({
    collation: value(row, 'COLLATION'),
    columnName: value(row, 'COLUMN_NAME'),
    indexName: value(row, 'INDEX_NAME'),
    indexType: String(value(row, 'INDEX_TYPE') || '').toUpperCase(),
    isVisible: String(value(row, 'IS_VISIBLE') || '').toUpperCase(),
    nonUnique: Number(value(row, 'NON_UNIQUE')),
    sequence: Number(value(row, 'SEQ_IN_INDEX')),
    subPart: value(row, 'SUB_PART') === null ? null : Number(value(row, 'SUB_PART')),
    tableName: value(row, 'TABLE_NAME'),
  })).sort((left, right) =>
    left.tableName.localeCompare(right.tableName) ||
    left.indexName.localeCompare(right.indexName) ||
    left.sequence - right.sequence);
}

function normalizeForeignKeyRows(rows) {
  return rows.map((row) => ({
    columnName: value(row, 'COLUMN_NAME'),
    constraintName: value(row, 'CONSTRAINT_NAME'),
    deleteRule: String(value(row, 'DELETE_RULE') || '').toUpperCase(),
    ordinalPosition: Number(value(row, 'ORDINAL_POSITION')),
    referencedColumnName: value(row, 'REFERENCED_COLUMN_NAME'),
    referencedTableName: value(row, 'REFERENCED_TABLE_NAME'),
    tableName: value(row, 'TABLE_NAME'),
    updateRule: String(value(row, 'UPDATE_RULE') || '').toUpperCase(),
  })).sort((left, right) =>
    left.tableName.localeCompare(right.tableName) ||
    left.constraintName.localeCompare(right.constraintName) ||
    left.ordinalPosition - right.ordinalPosition);
}

function normalizeTriggerRows(rows) {
  return rows.map((row) => ({
    body: normalizeSql(value(row, 'ACTION_STATEMENT')),
    event: String(value(row, 'EVENT_MANIPULATION') || '').toUpperCase(),
    name: value(row, 'TRIGGER_NAME'),
    tableName: value(row, 'EVENT_OBJECT_TABLE'),
    timing: String(value(row, 'ACTION_TIMING') || '').toUpperCase(),
  })).sort((left, right) => left.name.localeCompare(right.name));
}

function artifactSignature(kind, rows) {
  if (kind === 'column') {
    return JSON.stringify(rows.map(normalizeColumnRow).sort((left, right) =>
      left.tableName.localeCompare(right.tableName) ||
      left.columnName.localeCompare(right.columnName)));
  }
  if (kind === 'index') return JSON.stringify(normalizeIndexRows(rows));
  if (kind === 'constraint') return JSON.stringify(normalizeForeignKeyRows(rows));
  if (kind === 'trigger') return JSON.stringify(normalizeTriggerRows(rows));
  throw migrationError(`Unknown methodology artifact kind: ${kind}`);
}

async function readArtifactRows(queryInterface, kind, item) {
  if (kind === 'column') {
    const row = await getColumn(queryInterface, item.table, item.name);
    return row ? [row] : [];
  }
  if (kind === 'index') {
    return getIndex(queryInterface, item.table, item.name);
  }
  if (kind === 'constraint') {
    return selectRows(queryInterface, `
      SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
             k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
             r.UPDATE_RULE, r.DELETE_RULE
      FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
      JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
        ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
       AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA = DATABASE()
        AND k.TABLE_NAME = :table AND k.CONSTRAINT_NAME = :name
      ORDER BY k.ORDINAL_POSITION
    `, item);
  }
  if (kind === 'trigger') {
    const row = await getTrigger(queryInterface, item.name);
    return row && sameIdentifier(value(row, 'EVENT_OBJECT_TABLE'), item.table)
      ? [row]
      : [];
  }
  throw migrationError(`Unknown methodology artifact kind: ${kind}`);
}

async function readSameNameConflicts(queryInterface, kind, item) {
  if (kind === 'index') {
    // MySQL index names are table-local. A same-named index on an operator
    // backup table is unrelated ownership, not a collision.
    return [];
  }
  if (kind === 'constraint') {
    return selectRows(queryInterface, `
      SELECT TABLE_NAME, CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND CONSTRAINT_NAME = :name AND TABLE_NAME <> :table
    `, item);
  }
  return [];
}

async function trackCreatedArtifact(queryInterface, target, kind, item) {
  const rows = await readArtifactRows(queryInterface, kind, item);
  if (rows.length === 0) {
    throw migrationError(`Failed to inventory created ${kind} ${item.table}.${item.name}`);
  }
  target.push({ ...item, signature: artifactSignature(kind, rows) });
}

async function refreshTrackedArtifact(queryInterface, target, kind, item) {
  const tracked = target.find((candidate) =>
    candidate.table === item.table && candidate.name === item.name);
  if (!tracked) throw migrationError(`Lost tracked ${kind} ${item.table}.${item.name}`);
  const rows = await readArtifactRows(queryInterface, kind, item);
  if (rows.length === 0) {
    throw migrationError(`Cannot refresh tracked ${kind} ${item.table}.${item.name}`);
  }
  tracked.signature = artifactSignature(kind, rows);
}

function columnIsCanonical(column) {
  return Boolean(
    column &&
      column.DATA_TYPE === 'int' &&
      /^int(?:\(\d+\))?$/.test(column.COLUMN_TYPE) &&
      column.IS_NULLABLE === 'NO' &&
      (column.COLUMN_DEFAULT === null ||
        String(column.COLUMN_DEFAULT).toUpperCase() === 'NULL') &&
      String(column.EXTRA || '') === '',
  );
}

function indexIsCanonical(rows, expected) {
  return rows.length === expected.columns.length &&
    rows.every((row, index) =>
      sameIdentifier(row.TABLE_NAME, expected.table) &&
      Number(row.NON_UNIQUE) === (expected.unique ? 0 : 1) &&
      Number(row.SEQ_IN_INDEX) === index + 1 &&
      row.COLUMN_NAME === expected.columns[index] &&
      row.SUB_PART === null &&
      ['A', null].includes(row.COLLATION) &&
      row.INDEX_TYPE === 'BTREE' &&
      row.IS_VISIBLE === 'YES');
}

function foreignKeyIsCanonical(row, expected) {
  return Boolean(
    row &&
      sameIdentifier(row.TABLE_NAME, expected.table) &&
      row.COLUMN_NAME === expected.column &&
      sameIdentifier(row.REFERENCED_TABLE_NAME, expected.referencedTable) &&
      row.REFERENCED_COLUMN_NAME === expected.referencedColumn &&
      row.UPDATE_RULE === expected.onUpdate &&
      row.DELETE_RULE === expected.onDelete,
  );
}

function triggerIsCanonical(row, expected) {
  return Boolean(
    row &&
      sameIdentifier(row.EVENT_OBJECT_TABLE, expected.table) &&
      row.EVENT_MANIPULATION === expected.event &&
      row.ACTION_TIMING === 'BEFORE' &&
      normalizeSql(row.ACTION_STATEMENT) === normalizeSql(expected.body),
  );
}

async function legacyUniqueIsCanonical(queryInterface) {
  const rows = await getIndex(
    queryInterface,
    'TrainingSkills',
    'training_skills_name_unique',
  );
  return indexIsCanonical(rows, {
    columns: ['name'],
    table: 'TrainingSkills',
    unique: true,
  });
}

async function classifyState(queryInterface) {
  const columnRows = await Promise.all(
    COLUMNS.map(([table, column]) => getColumn(queryInterface, table, column)),
  );
  const indexRows = await Promise.all(
    Object.entries(INDEXES).map(([name, expected]) =>
      getIndex(queryInterface, expected.table, name)),
  );
  const fkRows = await Promise.all(
    Object.keys(FOREIGN_KEYS).map((name) => getForeignKey(queryInterface, name)),
  );
  const triggerRows = await Promise.all(
    Object.keys(TRIGGERS).map((name) => getTrigger(queryInterface, name)),
  );
  const anyReserved = columnRows.some(Boolean) ||
    indexRows.some((rows) => rows.length > 0) ||
    fkRows.some(Boolean) ||
    triggerRows.some(Boolean);

  if (!anyReserved) {
    if (!(await legacyUniqueIsCanonical(queryInterface))) {
      return { reasons: ['legacy TrainingSkills name unique is missing or non-canonical'], state: 'partial' };
    }
    return { reasons: [], state: 'legacy' };
  }

  const reasons = [];
  columnRows.forEach((column, index) => {
    if (!columnIsCanonical(column)) reasons.push(`column ${COLUMNS[index].join('.')} is not canonical`);
  });
  Object.entries(INDEXES).forEach(([name, expected], index) => {
    if (!indexIsCanonical(indexRows[index], expected)) reasons.push(`index ${name} is not canonical`);
  });
  Object.entries(FOREIGN_KEYS).forEach(([name, expected], index) => {
    if (!foreignKeyIsCanonical(fkRows[index], expected)) reasons.push(`foreign key ${name} is not canonical`);
  });
  Object.entries(TRIGGERS).forEach(([name, expected], index) => {
    if (!triggerIsCanonical(triggerRows[index], expected)) reasons.push(`trigger ${name} is not canonical`);
  });
  if (await legacyUniqueIsCanonical(queryInterface)) {
    reasons.push('legacy global skill-name unique still exists');
  }
  return { reasons, state: reasons.length === 0 ? 'ready' : 'partial' };
}

async function getDefaultOrganization(queryInterface) {
  const rows = await selectRows(queryInterface, `
    SELECT id FROM Organizations WHERE slug = :slug ORDER BY id
  `, { slug: DEFAULT_ORGANIZATION_SLUG });
  if (rows.length !== 1) {
    throw migrationError('Exact default Organization is required for methodology backfill');
  }
  return Number(rows[0].id);
}

async function assertLegacyDataCompatible(queryInterface, organizationId) {
  const probes = [
    ['ClientTrainingSkills', `
      SELECT COUNT(*) AS count FROM ClientTrainingSkills c
      JOIN Users u ON u.id = c.userId
      WHERE u.organizationId <> :organizationId
    `],
    ['ClientTrainingSkillHistories', `
      SELECT COUNT(*) AS count FROM ClientTrainingSkillHistories h
      JOIN Users u ON u.id = h.userId
      WHERE u.organizationId <> :organizationId
    `],
    ['TrainingNoteExercises', `
      SELECT COUNT(*) AS count FROM TrainingNoteExercises ne
      JOIN TrainingNotes n ON n.id = ne.trainingNoteId
      JOIN Users u ON u.id = n.userId
      WHERE ne.trainingExerciseId IS NOT NULL AND u.organizationId <> :organizationId
    `],
    ['TrainingPlanExercises', `
      SELECT COUNT(*) AS count FROM TrainingPlanExercises pe
      JOIN TrainingPlans p ON p.id = pe.trainingPlanId
      LEFT JOIN Bookings b ON b.id = p.bookingId
      LEFT JOIN TrainingPlanParticipants pp ON pp.trainingPlanId = p.id
      LEFT JOIN Users u ON u.id = pp.userId
      WHERE pe.trainingExerciseId IS NOT NULL
        AND ((b.id IS NOT NULL AND b.organizationId <> :organizationId)
          OR (u.id IS NOT NULL AND u.organizationId <> :organizationId))
    `],
  ];
  for (const [label, sql] of probes) {
    const rows = await selectRows(queryInterface, sql, { organizationId });
    if (Number(rows[0]?.count || 0) > 0) {
      throw migrationError(`${label} contains non-default Organization provenance`);
    }
  }
}

function maybeFail(step) {
  if (process.env.TENANT_METHODOLOGY_SKILL_MAP_MIGRATION_FAIL_STEP === step) {
    throw migrationError(`Forced methodology migration failure at ${step}`, 'TENANT_METHODOLOGY_FORCED_FAILURE');
  }
}

async function createTrigger(queryInterface, name, expected) {
  await queryInterface.sequelize.query(
    `CREATE TRIGGER \`${name}\` BEFORE ${expected.event} ON \`${expected.table}\` FOR EACH ROW ${expected.body}`,
  );
}

function cleanupOwnershipError(kind, item, detail = '') {
  return migrationError(
    `Methodology cleanup ownership lost for ${kind} ${item.table || ''}.${item.name}${detail}; operator repair required`,
    'TENANT_METHODOLOGY_CLEANUP_OWNERSHIP_LOST',
  );
}

async function assertLegacyUniqueCanBeRestored(queryInterface, item) {
  const rows = await readArtifactRows(queryInterface, 'index', item);
  const sameNameConflicts = await readSameNameConflicts(
    queryInterface,
    'index',
    item,
  );
  const duplicateNames = await selectRows(queryInterface, `
    SELECT name FROM TrainingSkills GROUP BY name HAVING COUNT(*) > 1 LIMIT 1
  `);
  const replacementUniques = await selectRows(queryInterface, `
    SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table
    GROUP BY INDEX_NAME
    HAVING MIN(NON_UNIQUE) = 0
       AND COUNT(*) = 1
       AND MAX(CASE WHEN COLUMN_NAME = 'name' THEN 1 ELSE 0 END) = 1
  `, item);
  if (
    rows.length > 0 ||
    sameNameConflicts.length > 0 ||
    duplicateNames.length > 0 ||
    replacementUniques.length > 0
  ) {
    throw cleanupOwnershipError('removed-index', item, ' (legacy unique restoration collision)');
  }
}

async function cleanupInvocation(queryInterface, created) {
  const ownershipChecks = [
    ...created.columns.map((item) => ['column', item]),
    ...created.indexes.map((item) => ['index', item]),
    ...created.foreignKeys.map((item) => ['constraint', item]),
    ...created.triggers.map((item) => ['trigger', item]),
  ];
  for (const [kind, item] of ownershipChecks) {
    const rows = await readArtifactRows(queryInterface, kind, item);
    const sameNameConflicts = await readSameNameConflicts(
      queryInterface,
      kind,
      item,
    );
    if (
      rows.length === 0 ||
      sameNameConflicts.length > 0 ||
      artifactSignature(kind, rows) !== item.signature
    ) {
      throw cleanupOwnershipError(kind, item);
    }
  }
  if (created.removedLegacyUnique) {
    await assertLegacyUniqueCanBeRestored(
      queryInterface,
      created.removedLegacyUnique,
    );
  }

  for (const item of [...created.triggers].reverse()) {
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS \`${item.name}\``);
  }
  for (const item of [...created.foreignKeys].reverse()) {
    await queryInterface.removeConstraint(item.table, item.name);
  }
  for (const item of [...created.indexes].reverse()) {
    await queryInterface.removeIndex(item.table, item.name);
  }
  if (created.removedLegacyUnique) {
    await queryInterface.addIndex('TrainingSkills', ['name'], {
      name: created.removedLegacyUnique.name,
      unique: true,
    });
    const restored = await readArtifactRows(
      queryInterface,
      'index',
      created.removedLegacyUnique,
    );
    if (
      artifactSignature('index', restored) !==
      created.removedLegacyUnique.signature
    ) {
      throw cleanupOwnershipError(
        'restored-index',
        created.removedLegacyUnique,
      );
    }
  }
  for (const item of [...created.columns].reverse()) {
    await queryInterface.removeColumn(item.table, item.name);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const classification = await classifyState(queryInterface);
    if (classification.state === 'ready') return;
    if (classification.state !== 'legacy') {
      throw migrationError(`Methodology tenant migration refused partial schema: ${classification.reasons.join('; ')}`);
    }

    const organizationId = await getDefaultOrganization(queryInterface);
    await assertLegacyDataCompatible(queryInterface, organizationId);
    const created = {
      columns: [],
      foreignKeys: [],
      indexes: [],
      removedLegacyUnique: null,
      triggers: [],
    };

    try {
      for (const [table, column] of COLUMNS) {
        await queryInterface.addColumn(table, column, {
          allowNull: true,
          type: Sequelize.INTEGER,
        });
        await trackCreatedArtifact(
          queryInterface,
          created.columns,
          'column',
          { name: column, table },
        );
      }
      maybeFail('after_columns');

      await queryInterface.sequelize.query(
        'UPDATE TrainingSkills SET organizationId = :organizationId WHERE organizationId IS NULL',
        { replacements: { organizationId } },
      );
      await queryInterface.sequelize.query(
        'UPDATE TrainingExercises SET organizationId = :organizationId WHERE organizationId IS NULL',
        { replacements: { organizationId } },
      );
      for (const [table, column] of COLUMNS) {
        await queryInterface.changeColumn(table, column, {
          allowNull: false,
          type: Sequelize.INTEGER,
        });
        await refreshTrackedArtifact(
          queryInterface,
          created.columns,
          'column',
          { name: column, table },
        );
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
        await trackCreatedArtifact(
          queryInterface,
          created.foreignKeys,
          'constraint',
          { name, table: expected.table },
        );
      }
      for (const [name, expected] of Object.entries(INDEXES)) {
        await queryInterface.addIndex(expected.table, expected.columns, {
          name,
          unique: expected.unique,
        });
        await trackCreatedArtifact(
          queryInterface,
          created.indexes,
          'index',
          { name, table: expected.table },
        );
      }
      maybeFail('after_constraints');

      for (const [name, expected] of Object.entries(TRIGGERS)) {
        await createTrigger(queryInterface, name, expected);
        await trackCreatedArtifact(
          queryInterface,
          created.triggers,
          'trigger',
          { name, table: expected.table },
        );
      }
      maybeFail('after_triggers');

      const legacyUnique = {
        name: 'training_skills_name_unique',
        table: 'TrainingSkills',
      };
      const legacyUniqueRows = await readArtifactRows(
        queryInterface,
        'index',
        legacyUnique,
      );
      await queryInterface.removeIndex(legacyUnique.table, legacyUnique.name);
      created.removedLegacyUnique = {
        ...legacyUnique,
        signature: artifactSignature('index', legacyUniqueRows),
      };
      maybeFail('after_legacy_unique_drop');

      const ready = await classifyState(queryInterface);
      if (ready.state !== 'ready') {
        throw migrationError(`Methodology tenant migration did not reach canonical ready state: ${ready.reasons.join('; ')}`);
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
      throw migrationError(`Methodology tenant rollback refused partial schema: ${classification.reasons.join('; ')}`);
    }
    const organizationRows = await selectRows(
      queryInterface,
      'SELECT id FROM Organizations ORDER BY id LIMIT 2',
    );
    if (organizationRows.length > 1) {
      throw migrationError(
        'Methodology tenant rollback refused while a second Organization exists',
        'TENANT_METHODOLOGY_ROLLBACK_SECOND_ORGANIZATION',
      );
    }

    for (const name of Object.keys(TRIGGERS).reverse()) {
      await queryInterface.sequelize.query(`DROP TRIGGER \`${name}\``);
    }
    await queryInterface.addIndex('TrainingSkills', ['name'], {
      name: 'training_skills_name_unique',
      unique: true,
    });
    for (const [name, expected] of Object.entries(FOREIGN_KEYS).reverse()) {
      await queryInterface.removeConstraint(expected.table, name);
    }
    for (const [name, expected] of Object.entries(INDEXES).reverse()) {
      await queryInterface.removeIndex(expected.table, name);
    }
    for (const [table, column] of [...COLUMNS].reverse()) {
      await queryInterface.removeColumn(table, column);
    }
  },

  __testing: {
    COLUMNS,
    FOREIGN_KEYS,
    INDEXES,
    TRIGGERS,
    artifactSignature,
    classifyState,
    cleanupInvocation,
    indexIsCanonical,
    normalizeSql,
    readArtifactRows,
    readSameNameConflicts,
    supportsIndexVisibility,
  },
};
