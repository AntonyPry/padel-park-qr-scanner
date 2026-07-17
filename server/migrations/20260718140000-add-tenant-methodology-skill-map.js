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
  return String(value || '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

async function getColumn(queryInterface, table, column) {
  const rows = await selectRows(queryInterface, `
    SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column
  `, { column, table });
  return rows[0] || null;
}

async function getIndex(queryInterface, name) {
  const rows = await selectRows(queryInterface, `
    SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME,
           SUB_PART, COLLATION, INDEX_TYPE
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME = :name
    ORDER BY SEQ_IN_INDEX
  `, { name });
  return rows;
}

async function getForeignKey(queryInterface, name) {
  const rows = await selectRows(queryInterface, `
    SELECT k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME,
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
    SELECT EVENT_OBJECT_TABLE, EVENT_MANIPULATION, ACTION_TIMING, ACTION_STATEMENT
    FROM INFORMATION_SCHEMA.TRIGGERS
    WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = :name
  `, { name });
  return rows[0] || null;
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

function columnIsInvocationOwned(column) {
  return Boolean(
    column &&
      column.DATA_TYPE === 'int' &&
      /^int(?:\(\d+\))?$/.test(column.COLUMN_TYPE) &&
      ['YES', 'NO'].includes(column.IS_NULLABLE) &&
      (column.COLUMN_DEFAULT === null ||
        String(column.COLUMN_DEFAULT).toUpperCase() === 'NULL') &&
      String(column.EXTRA || '') === '',
  );
}

function indexIsCanonical(rows, expected) {
  return rows.length === expected.columns.length &&
    rows.every((row, index) =>
      row.TABLE_NAME === expected.table &&
      Number(row.NON_UNIQUE) === (expected.unique ? 0 : 1) &&
      Number(row.SEQ_IN_INDEX) === index + 1 &&
      row.COLUMN_NAME === expected.columns[index] &&
      row.SUB_PART === null &&
      ['A', null].includes(row.COLLATION) &&
      row.INDEX_TYPE === 'BTREE');
}

function foreignKeyIsCanonical(row, expected) {
  return Boolean(
    row &&
      row.TABLE_NAME === expected.table &&
      row.COLUMN_NAME === expected.column &&
      row.REFERENCED_TABLE_NAME === expected.referencedTable &&
      row.REFERENCED_COLUMN_NAME === expected.referencedColumn &&
      row.UPDATE_RULE === expected.onUpdate &&
      row.DELETE_RULE === expected.onDelete,
  );
}

function triggerIsCanonical(row, expected) {
  return Boolean(
    row &&
      row.EVENT_OBJECT_TABLE === expected.table &&
      row.EVENT_MANIPULATION === expected.event &&
      row.ACTION_TIMING === 'BEFORE' &&
      normalizeSql(row.ACTION_STATEMENT) === normalizeSql(expected.body),
  );
}

async function legacyUniqueIsCanonical(queryInterface) {
  const rows = await getIndex(queryInterface, 'training_skills_name_unique');
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
    Object.keys(INDEXES).map((name) => getIndex(queryInterface, name)),
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

async function cleanupInvocation(queryInterface, created) {
  for (const name of [...created.triggers].reverse()) {
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS \`${name}\``);
  }
  for (const name of [...created.foreignKeys].reverse()) {
    const expected = FOREIGN_KEYS[name];
    const row = await getForeignKey(queryInterface, name);
    if (foreignKeyIsCanonical(row, expected)) {
      await queryInterface.removeConstraint(expected.table, name);
    }
  }
  for (const name of [...created.indexes].reverse()) {
    const expected = INDEXES[name];
    const rows = await getIndex(queryInterface, name);
    if (indexIsCanonical(rows, expected)) {
      await queryInterface.removeIndex(expected.table, name);
    }
  }
  for (const [table, column] of [...created.columns].reverse()) {
    const row = await getColumn(queryInterface, table, column);
    if (columnIsInvocationOwned(row)) {
      await queryInterface.removeColumn(table, column);
    }
  }
  if (created.droppedLegacyUnique && !(await legacyUniqueIsCanonical(queryInterface))) {
    await queryInterface.addIndex('TrainingSkills', ['name'], {
      name: 'training_skills_name_unique',
      unique: true,
    });
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
      droppedLegacyUnique: false,
      foreignKeys: [],
      indexes: [],
      triggers: [],
    };

    try {
      for (const [table, column] of COLUMNS) {
        await queryInterface.addColumn(table, column, {
          allowNull: true,
          type: Sequelize.INTEGER,
        });
        created.columns.push([table, column]);
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
        created.foreignKeys.push(name);
      }
      for (const [name, expected] of Object.entries(INDEXES)) {
        await queryInterface.addIndex(expected.table, expected.columns, {
          name,
          unique: expected.unique,
        });
        created.indexes.push(name);
      }
      maybeFail('after_constraints');

      for (const [name, expected] of Object.entries(TRIGGERS)) {
        await createTrigger(queryInterface, name, expected);
        created.triggers.push(name);
      }
      maybeFail('after_triggers');

      await queryInterface.removeIndex('TrainingSkills', 'training_skills_name_unique');
      created.droppedLegacyUnique = true;
      maybeFail('after_legacy_unique_drop');

      const ready = await classifyState(queryInterface);
      if (ready.state !== 'ready') {
        throw migrationError(`Methodology tenant migration did not reach canonical ready state: ${ready.reasons.join('; ')}`);
      }
    } catch (error) {
      try {
        await cleanupInvocation(queryInterface, created);
      } catch (cleanupError) {
        error.cleanupError = cleanupError;
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
    classifyState,
    normalizeSql,
  },
};
