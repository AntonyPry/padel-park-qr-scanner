'use strict';

const PLAN_TABLE = 'TenantOnboardingMigrationPlans';
const PLAN_KEY = 'feature-8.3';

function quoteIdentifier(value) {
  const name = String(value || '');
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return `\`${name}\``;
}

function cleanupOwnershipError(message) {
  const error = new Error(message);
  error.code = 'TENANT_ONBOARDING_CLEANUP_OWNERSHIP_LOST';
  error.operatorRepair = true;
  return error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function canonicalSql(value) {
  const input = String(value || '');
  let outside = '';
  let output = '';
  const flush = () => {
    if (!outside) return;
    output += outside.toLowerCase().replace(/`/g, '').replace(/\s+/g, ' ')
      .replace(/\s*([(),;=<>+*\/|-])\s*/g, '$1');
    outside = '';
  };
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character !== "'" && character !== '"') {
      outside += character;
      continue;
    }
    flush();
    const quote = character;
    let literal = quote;
    index += 1;
    for (; index < input.length; index += 1) {
      const current = input[index];
      literal += current;
      if (current === '\\' && index + 1 < input.length) {
        literal += input[index + 1];
        index += 1;
        continue;
      }
      if (current === quote) {
        if (input[index + 1] === quote) {
          literal += input[index + 1];
          index += 1;
          continue;
        }
        break;
      }
    }
    output += literal;
  }
  flush();
  return output.trim();
}

function pick(row, names) {
  const result = {};
  for (const name of names) {
    if (Object.hasOwn(row, name)) result[name] = row[name] === undefined ? null : row[name];
  }
  return result;
}

async function tableExists(queryInterface, table, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table`,
    { replacements: { table }, transaction },
  );
  return rows.length === 1;
}

async function captureColumn(queryInterface, table, name, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT * FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table AND COLUMN_NAME=:name`,
    { replacements: { name, table }, transaction },
  );
  if (rows.length !== 1) return null;
  return pick(rows[0], [
    'TABLE_NAME', 'COLUMN_NAME', 'ORDINAL_POSITION', 'COLUMN_DEFAULT', 'IS_NULLABLE',
    'DATA_TYPE', 'CHARACTER_MAXIMUM_LENGTH', 'CHARACTER_OCTET_LENGTH',
    'NUMERIC_PRECISION', 'NUMERIC_SCALE', 'DATETIME_PRECISION', 'CHARACTER_SET_NAME',
    'COLLATION_NAME', 'COLUMN_TYPE', 'EXTRA', 'PRIVILEGES',
    'COLUMN_COMMENT', 'GENERATION_EXPRESSION', 'SRS_ID',
  ]);
}

async function captureIndex(queryInterface, table, name, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT * FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table AND INDEX_NAME=:name
      ORDER BY SEQ_IN_INDEX`,
    { replacements: { name, table }, transaction },
  );
  if (!rows.length) return null;
  return rows.map((row) => pick(row, [
    'TABLE_NAME', 'NON_UNIQUE', 'INDEX_NAME', 'SEQ_IN_INDEX', 'COLUMN_NAME',
    'COLLATION', 'SUB_PART', 'PACKED', 'NULLABLE', 'INDEX_TYPE', 'COMMENT',
    'INDEX_COMMENT', 'IS_VISIBLE', 'EXPRESSION',
  ]));
}

async function captureForeignKey(queryInterface, table, name, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION,k.POSITION_IN_UNIQUE_CONSTRAINT,
            k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,
            r.UNIQUE_CONSTRAINT_NAME,r.MATCH_OPTION,r.UPDATE_RULE,r.DELETE_RULE
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
        AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME=:table
        AND k.CONSTRAINT_NAME=:name AND k.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY k.ORDINAL_POSITION`,
    { replacements: { name, table }, transaction },
  );
  return rows.length ? rows : null;
}

async function captureTrigger(queryInterface, name, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT * FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=:name`,
    { replacements: { name }, transaction },
  );
  if (rows.length !== 1) return null;
  const signature = pick(rows[0], [
    'TRIGGER_NAME', 'EVENT_MANIPULATION', 'EVENT_OBJECT_TABLE', 'ACTION_ORDER',
    'ACTION_CONDITION', 'ACTION_ORIENTATION', 'ACTION_TIMING', 'SQL_MODE',
    'CHARACTER_SET_CLIENT', 'COLLATION_CONNECTION', 'DATABASE_COLLATION',
  ]);
  signature.ACTION_STATEMENT = canonicalSql(rows[0].ACTION_STATEMENT);
  return signature;
}

async function captureArtifact(queryInterface, artifact, transaction) {
  if (artifact.kind === 'column') {
    return captureColumn(queryInterface, artifact.table, artifact.name, transaction);
  }
  if (artifact.kind === 'index') {
    return captureIndex(queryInterface, artifact.table, artifact.name, transaction);
  }
  if (artifact.kind === 'foreignKey') {
    return captureForeignKey(queryInterface, artifact.table, artifact.name, transaction);
  }
  if (artifact.kind === 'trigger') return captureTrigger(queryInterface, artifact.name, transaction);
  throw new Error(`Unknown onboarding migration artifact: ${artifact.kind}`);
}

function artifactKey(artifact) {
  return `${artifact.kind}:${artifact.table || ''}:${artifact.name}`;
}

async function persistPlan(queryInterface, plan) {
  await queryInterface.sequelize.query(
    `UPDATE ${quoteIdentifier(PLAN_TABLE)} SET planJson=:planJson WHERE featureKey=:featureKey`,
    { replacements: { featureKey: PLAN_KEY, planJson: JSON.stringify(plan) } },
  );
}

async function createPlanStore(queryInterface, Sequelize, legacy) {
  if (await tableExists(queryInterface, PLAN_TABLE)) {
    throw cleanupOwnershipError(`Onboarding plan table name is occupied: ${PLAN_TABLE}`);
  }
  await queryInterface.createTable(PLAN_TABLE, {
    featureKey: { allowNull: false, primaryKey: true, type: Sequelize.STRING(64) },
    planJson: { allowNull: false, type: Sequelize.TEXT('long') },
  });
  const plan = {
    artifacts: [],
    legacy,
    planStore: { columns: {}, primary: null, table: PLAN_TABLE },
    status: 'building',
    version: 1,
  };
  for (const name of ['featureKey', 'planJson']) {
    plan.planStore.columns[name] = await captureColumn(queryInterface, PLAN_TABLE, name);
  }
  plan.planStore.primary = await captureIndex(queryInterface, PLAN_TABLE, 'PRIMARY');
  await queryInterface.sequelize.query(
    `INSERT INTO ${quoteIdentifier(PLAN_TABLE)} (featureKey,planJson) VALUES (:featureKey,:planJson)`,
    { replacements: { featureKey: PLAN_KEY, planJson: JSON.stringify(plan) } },
  );
  return plan;
}

async function loadPlan(queryInterface, transaction) {
  if (!(await tableExists(queryInterface, PLAN_TABLE, transaction))) return null;
  let rows;
  try {
    [rows] = await queryInterface.sequelize.query(
      `SELECT planJson FROM ${quoteIdentifier(PLAN_TABLE)} WHERE featureKey=:featureKey`,
      { replacements: { featureKey: PLAN_KEY }, transaction },
    );
  } catch (error) {
    const ownershipError = cleanupOwnershipError(
      'Onboarding migration artifact plan columns are missing or changed',
    );
    ownershipError.cause = error;
    throw ownershipError;
  }
  if (rows.length !== 1) {
    throw cleanupOwnershipError('Onboarding migration artifact plan row is missing or duplicated');
  }
  try {
    const plan = JSON.parse(rows[0].planJson);
    if (plan.version !== 1 || !Array.isArray(plan.artifacts) || !plan.planStore) throw new Error();
    return plan;
  } catch {
    throw cleanupOwnershipError('Onboarding migration artifact plan is invalid');
  }
}

async function recordArtifact(queryInterface, plan, descriptor) {
  const signature = await captureArtifact(queryInterface, descriptor);
  if (!signature) {
    throw cleanupOwnershipError(`Created onboarding artifact is missing immediately: ${artifactKey(descriptor)}`);
  }
  const next = { ...descriptor, signature };
  const key = artifactKey(next);
  const index = plan.artifacts.findIndex((artifact) => artifactKey(artifact) === key);
  if (index === -1) plan.artifacts.push(next);
  else plan.artifacts[index] = next;
  await persistPlan(queryInterface, plan);
  return next;
}

async function assertPlanStore(queryInterface, plan, transaction) {
  if (!(await tableExists(queryInterface, PLAN_TABLE, transaction))) {
    throw cleanupOwnershipError('Onboarding migration plan table was created then removed');
  }
  for (const [name, signature] of Object.entries(plan.planStore.columns || {})) {
    const actual = await captureColumn(queryInterface, PLAN_TABLE, name, transaction);
    if (!actual || !same(actual, signature)) {
      throw cleanupOwnershipError(`Onboarding migration plan column ownership lost: ${name}`);
    }
  }
  const primary = await captureIndex(queryInterface, PLAN_TABLE, 'PRIMARY', transaction);
  if (!primary || !same(primary, plan.planStore.primary)) {
    throw cleanupOwnershipError('Onboarding migration plan primary index ownership lost');
  }
}

async function assertPlanOwnership(queryInterface, plan, transaction) {
  await assertPlanStore(queryInterface, plan, transaction);
  for (const artifact of plan.artifacts) {
    const actual = await captureArtifact(queryInterface, artifact, transaction);
    if (!actual) {
      throw cleanupOwnershipError(`Onboarding artifact was created then removed: ${artifactKey(artifact)}`);
    }
    if (!same(actual, artifact.signature)) {
      throw cleanupOwnershipError(`Onboarding artifact signature changed: ${artifactKey(artifact)}`);
    }
  }
}

async function captureLegacyUniqueIndexes(queryInterface, transaction) {
  const definitions = [];
  for (const requirement of [
    { fields: ['accountId', 'role', 'taskKey'], table: 'OnboardingProgresses' },
    { fields: ['accountId'], table: 'OnboardingTrainingModes' },
  ]) {
    const [names] = await queryInterface.sequelize.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table AND NON_UNIQUE=0
        GROUP BY INDEX_NAME
        HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR '|')=:fields`,
      { replacements: { fields: requirement.fields.join('|'), table: requirement.table }, transaction },
    );
    if (names.length !== 1 || names[0].INDEX_NAME === 'PRIMARY') {
      throw cleanupOwnershipError(`Legacy unique index is missing or ambiguous: ${requirement.table}`);
    }
    const name = names[0].INDEX_NAME;
    const signature = await captureIndex(queryInterface, requirement.table, name, transaction);
    const columns = {};
    for (const field of requirement.fields) {
      columns[field] = await captureColumn(queryInterface, requirement.table, field, transaction);
    }
    definitions.push({
      columns,
      fields: requirement.fields,
      name,
      removed: false,
      signature,
      table: requirement.table,
    });
  }
  return definitions;
}

async function assertLegacyRestorable(queryInterface, plan, transaction) {
  for (const legacy of plan.legacy || []) {
    for (const [name, signature] of Object.entries(legacy.columns || {})) {
      const actual = await captureColumn(queryInterface, legacy.table, name, transaction);
      if (!actual || !same(actual, signature)) {
        throw cleanupOwnershipError(`Legacy index source column changed: ${legacy.table}.${name}`);
      }
    }
    const current = await captureIndex(queryInterface, legacy.table, legacy.name, transaction);
    if (!legacy.removed) {
      if (!current || !same(current, legacy.signature)) {
        throw cleanupOwnershipError(`Legacy unique index changed before cleanup: ${legacy.table}.${legacy.name}`);
      }
      continue;
    }
    if (current) {
      throw cleanupOwnershipError(`Legacy unique index name collision: ${legacy.table}.${legacy.name}`);
    }
    const fieldSql = legacy.fields.map(quoteIdentifier).join(',');
    const [duplicates] = await queryInterface.sequelize.query(
      `SELECT ${fieldSql},COUNT(*) duplicateCount FROM ${quoteIdentifier(legacy.table)}
        GROUP BY ${fieldSql} HAVING COUNT(*)>1 LIMIT 1`,
      { transaction },
    );
    if (duplicates.length) {
      throw cleanupOwnershipError(`Legacy unique index cannot be restored: ${legacy.table}.${legacy.name}`);
    }
  }
}

function indexColumnSql(row) {
  const value = row.EXPRESSION || quoteIdentifier(row.COLUMN_NAME);
  const subpart = row.SUB_PART == null ? '' : `(${Number(row.SUB_PART)})`;
  const direction = row.COLLATION === 'D' ? ' DESC' : row.COLLATION === 'A' ? ' ASC' : '';
  return `${value}${subpart}${direction}`;
}

async function restoreLegacyIndexes(queryInterface, plan, transaction) {
  for (const legacy of plan.legacy || []) {
    if (!legacy.removed) continue;
    const rows = legacy.signature;
    const type = String(rows[0].INDEX_TYPE || 'BTREE').toUpperCase();
    await queryInterface.sequelize.query(
      `ALTER TABLE ${quoteIdentifier(legacy.table)} ADD UNIQUE INDEX ${quoteIdentifier(legacy.name)}
       (${rows.map(indexColumnSql).join(',')}) USING ${type}`,
      { transaction },
    );
    const restored = await captureIndex(queryInterface, legacy.table, legacy.name, transaction);
    if (!restored || !same(restored, legacy.signature)) {
      throw cleanupOwnershipError(`Legacy unique index restoration drift: ${legacy.table}.${legacy.name}`);
    }
  }
}

async function removeRecordedArtifacts(queryInterface, plan, transaction) {
  for (const artifact of [...plan.artifacts].reverse()) {
    if (artifact.kind === 'trigger') {
      await queryInterface.sequelize.query(`DROP TRIGGER ${quoteIdentifier(artifact.name)}`, { transaction });
    } else if (artifact.kind === 'foreignKey') {
      await queryInterface.removeConstraint(artifact.table, artifact.name, { transaction });
    } else if (artifact.kind === 'index') {
      await queryInterface.removeIndex(artifact.table, artifact.name, { transaction });
    } else if (artifact.kind === 'column') {
      await queryInterface.removeColumn(artifact.table, artifact.name, { transaction });
    }
  }
}

async function dropPlanStore(queryInterface, transaction) {
  await queryInterface.dropTable(PLAN_TABLE, { transaction });
}

module.exports = {
  PLAN_KEY,
  PLAN_TABLE,
  artifactKey,
  assertLegacyRestorable,
  assertPlanOwnership,
  canonicalSql,
  captureArtifact,
  captureColumn,
  captureForeignKey,
  captureIndex,
  captureLegacyUniqueIndexes,
  captureTrigger,
  cleanupOwnershipError,
  createPlanStore,
  dropPlanStore,
  loadPlan,
  persistPlan,
  recordArtifact,
  removeRecordedArtifacts,
  restoreLegacyIndexes,
  same,
  tableExists,
};
