'use strict';

const crypto = require('node:crypto');

const PRESERVATION_SCHEMA = 'setly.tenant-rollout-preservation';
const PRESERVATION_SCHEMA_VERSION = 1;
const CONTROL_TABLES = new Set([
  'Clubs',
  'InstallationProvisioningOperations',
  'IntegrationConnections',
  'MembershipClubAccesses',
  'Memberships',
  'Organizations',
  'SequelizeMeta',
]);

function quoteIdentifier(value) {
  return `\`${String(value).replaceAll('`', '``')}\``;
}

async function queryRows(sequelize, sql, options = {}) {
  const [rows] = await sequelize.query(sql, options);
  return rows;
}

function canonicalKeyValue(value) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return { base64: value.toString('base64') };
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  return String(value);
}

async function digestPrimaryKeys(
  sequelize,
  tableName,
  primaryKeyColumns,
  rowCount,
  transaction,
) {
  if (primaryKeyColumns.length === 0) return null;
  const columns = primaryKeyColumns.map(quoteIdentifier).join(', ');
  const order = primaryKeyColumns.map(quoteIdentifier).join(', ');
  const hash = crypto.createHash('sha256');
  const batchSize = 5000;
  for (let offset = 0; offset < rowCount; offset += batchSize) {
    const rows = await queryRows(
      sequelize,
      `SELECT ${columns}
         FROM ${quoteIdentifier(tableName)}
        ORDER BY ${order}
        LIMIT ${batchSize} OFFSET ${offset}`,
      { transaction },
    );
    for (const row of rows) {
      hash.update(JSON.stringify(
        primaryKeyColumns.map((column) => canonicalKeyValue(row[column])),
      ));
      hash.update('\n');
    }
  }
  return hash.digest('hex');
}

function digestRow(row, columns) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(columns.map((column) => canonicalKeyValue(row[column]))))
    .digest('hex');
}

async function digestPreservedData(
  sequelize,
  tableName,
  preservedColumns,
  primaryKeyColumns,
  rowCount,
  transaction,
) {
  const columns = preservedColumns.map(quoteIdentifier).join(', ');
  const hash = crypto.createHash('sha256');
  if (rowCount === 0) return hash.digest('hex');

  if (primaryKeyColumns.length === 0) {
    const rows = await queryRows(
      sequelize,
      `SELECT ${columns} FROM ${quoteIdentifier(tableName)}`,
      { transaction },
    );
    for (const rowDigest of rows
      .map((row) => digestRow(row, preservedColumns))
      .sort()) {
      hash.update(rowDigest);
      hash.update('\n');
    }
    return hash.digest('hex');
  }

  const order = primaryKeyColumns.map(quoteIdentifier).join(', ');
  const batchSize = 5000;
  for (let offset = 0; offset < rowCount; offset += batchSize) {
    const rows = await queryRows(
      sequelize,
      `SELECT ${columns}
         FROM ${quoteIdentifier(tableName)}
        ORDER BY ${order}
        LIMIT ${batchSize} OFFSET ${offset}`,
      { transaction },
    );
    for (const row of rows) {
      hash.update(digestRow(row, preservedColumns));
      hash.update('\n');
    }
  }
  return hash.digest('hex');
}

async function collectPreservedRowDigests(
  sequelize,
  tableName,
  preservedColumns,
  transaction,
) {
  const columns = preservedColumns.map(quoteIdentifier).join(', ');
  const rows = await queryRows(
    sequelize,
    `SELECT ${columns} FROM ${quoteIdentifier(tableName)}`,
    { transaction },
  );
  return rows.map((row) => digestRow(row, preservedColumns)).sort();
}

async function collectInstallationIdentitySnapshot({
  preservedColumnsByTable,
  sequelize,
} = {}) {
  if (!sequelize) throw new TypeError('sequelize is required');
  return sequelize.transaction(
    { isolationLevel: 'REPEATABLE READ', readOnly: true },
    async (transaction) => {
      const tables = await queryRows(
        sequelize,
        `SELECT TABLE_NAME AS tableName
           FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_TYPE = 'BASE TABLE'
          ORDER BY TABLE_NAME`,
        { transaction },
      );
      const primaryKeys = await queryRows(
        sequelize,
        `SELECT TABLE_NAME AS tableName,
                COLUMN_NAME AS columnName,
                ORDINAL_POSITION AS ordinalPosition
           FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE()
            AND CONSTRAINT_NAME = 'PRIMARY'
          ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        { transaction },
      );
      const primaryKeysByTable = new Map();
      for (const row of primaryKeys) {
        const columns = primaryKeysByTable.get(row.tableName) || [];
        columns.push(row.columnName);
        primaryKeysByTable.set(row.tableName, columns);
      }
      const columns = await queryRows(
        sequelize,
        `SELECT TABLE_NAME AS tableName,
                COLUMN_NAME AS columnName,
                ORDINAL_POSITION AS ordinalPosition
           FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
          ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        { transaction },
      );
      const columnsByTable = new Map();
      for (const row of columns) {
        const tableColumns = columnsByTable.get(row.tableName) || [];
        tableColumns.push(row.columnName);
        columnsByTable.set(row.tableName, tableColumns);
      }
      const inventory = [];
      for (const table of tables) {
        const tableName = table.tableName;
        const [{ rowCount }] = await queryRows(
          sequelize,
          `SELECT COUNT(*) AS rowCount FROM ${quoteIdentifier(tableName)}`,
          { transaction },
        );
        const primaryKeyColumns = primaryKeysByTable.get(tableName) || [];
        const currentColumns = columnsByTable.get(tableName) || [];
        const requestedColumns = preservedColumnsByTable?.[tableName];
        const preservedColumns = requestedColumns
          ? [...requestedColumns]
          : [...currentColumns];
        const missingColumns = preservedColumns.filter((column) =>
          !currentColumns.includes(column));
        if (missingColumns.length > 0) {
          const error = new Error(
            `Preserved columns are missing from ${tableName}: ${missingColumns.join(', ')}`,
          );
          error.code = 'ROLLOUT_PRESERVED_COLUMN_MISSING';
          throw error;
        }
        const normalizedRowCount = Number(rowCount);
        inventory.push(Object.freeze({
          controlTable: CONTROL_TABLES.has(tableName),
          preservedColumns: Object.freeze(preservedColumns),
          preservedDataDigest: await digestPreservedData(
            sequelize,
            tableName,
            preservedColumns,
            primaryKeyColumns,
            normalizedRowCount,
            transaction,
          ),
          preservedRowDigests: CONTROL_TABLES.has(tableName)
            ? Object.freeze(await collectPreservedRowDigests(
              sequelize,
              tableName,
              preservedColumns,
              transaction,
            ))
            : null,
          primaryKeyColumns: Object.freeze([...primaryKeyColumns]),
          primaryKeyDigest: await digestPrimaryKeys(
            sequelize,
            tableName,
            primaryKeyColumns,
            normalizedRowCount,
            transaction,
          ),
          rowCount: normalizedRowCount,
          tableName,
        }));
      }
      const identity = Object.freeze({
        schema: PRESERVATION_SCHEMA,
        schemaVersion: PRESERVATION_SCHEMA_VERSION,
        tables: Object.freeze(inventory),
      });
      return Object.freeze({
        ...identity,
        generatedAt: new Date().toISOString(),
        identityDigest: crypto
          .createHash('sha256')
          .update(JSON.stringify(identity))
          .digest('hex'),
      });
    },
  );
}

function validateSnapshot(snapshot) {
  if (
    !snapshot ||
    snapshot.schema !== PRESERVATION_SCHEMA ||
    snapshot.schemaVersion !== PRESERVATION_SCHEMA_VERSION ||
    !Array.isArray(snapshot.tables)
  ) {
    throw new Error('Tenant rollout preservation snapshot is invalid');
  }
  const names = new Set();
  for (const table of snapshot.tables) {
    if (!table?.tableName || names.has(table.tableName)) {
      throw new Error('Tenant rollout preservation snapshot has invalid table inventory');
    }
    if (
      !Array.isArray(table.preservedColumns) ||
      typeof table.preservedDataDigest !== 'string' ||
      (CONTROL_TABLES.has(table.tableName) &&
        !Array.isArray(table.preservedRowDigests))
    ) {
      throw new Error('Tenant rollout preservation snapshot has invalid data digest');
    }
    names.add(table.tableName);
  }
  return snapshot;
}

function compareInstallationIdentitySnapshots(before, after) {
  validateSnapshot(before);
  validateSnapshot(after);
  const afterByTable = new Map(after.tables.map((table) => [table.tableName, table]));
  const findings = [];
  const backfillableEmptyControlTables = [];
  let preservedRows = 0;
  for (const expected of before.tables) {
    const actual = afterByTable.get(expected.tableName);
    if (!actual) {
      findings.push({ code: 'ROLLOUT_TABLE_REMOVED', table: expected.tableName });
      continue;
    }
    preservedRows += expected.rowCount;
    const isControlTable = CONTROL_TABLES.has(expected.tableName);
    if (isControlTable && expected.rowCount === 0) {
      backfillableEmptyControlTables.push(expected.tableName);
    }
    if (isControlTable && actual.rowCount < expected.rowCount) {
      findings.push({
        after: actual.rowCount,
        before: expected.rowCount,
        code: 'ROLLOUT_CONTROL_ROW_COUNT_DECREASED',
        table: expected.tableName,
      });
    } else if (!isControlTable && actual.rowCount !== expected.rowCount) {
      findings.push({
        after: actual.rowCount,
        before: expected.rowCount,
        code: 'ROLLOUT_ROW_COUNT_CHANGED',
        table: expected.tableName,
      });
    }
    if (JSON.stringify(actual.primaryKeyColumns) !== JSON.stringify(expected.primaryKeyColumns)) {
      findings.push({ code: 'ROLLOUT_PRIMARY_KEY_CHANGED', table: expected.tableName });
    } else if (
      !isControlTable &&
      expected.primaryKeyDigest !== null &&
      actual.primaryKeyDigest !== expected.primaryKeyDigest
    ) {
      findings.push({ code: 'ROLLOUT_PRIMARY_KEY_SET_CHANGED', table: expected.tableName });
    }
    if (
      JSON.stringify(actual.preservedColumns) !== JSON.stringify(expected.preservedColumns)
    ) {
      findings.push({ code: 'ROLLOUT_PRESERVED_COLUMNS_CHANGED', table: expected.tableName });
    } else if (
      !isControlTable &&
      actual.preservedDataDigest !== expected.preservedDataDigest
    ) {
      findings.push({ code: 'ROLLOUT_HISTORICAL_DATA_CHANGED', table: expected.tableName });
    }
    if (isControlTable) {
      const remaining = new Map();
      for (const rowDigest of actual.preservedRowDigests || []) {
        remaining.set(rowDigest, (remaining.get(rowDigest) || 0) + 1);
      }
      const missingRows = [];
      for (const rowDigest of expected.preservedRowDigests || []) {
        const count = remaining.get(rowDigest) || 0;
        if (count === 0) missingRows.push(rowDigest);
        else remaining.set(rowDigest, count - 1);
      }
      if (missingRows.length > 0) {
        findings.push({
          code: 'ROLLOUT_PREEXISTING_CONTROL_DATA_CHANGED',
          missingRows: missingRows.length,
          table: expected.tableName,
        });
      }
    }
  }
  return Object.freeze({
    backfillableEmptyControlTables: Object.freeze(
      backfillableEmptyControlTables.sort(),
    ),
    findings: Object.freeze(findings),
    ok: findings.length === 0,
    preservedRows,
    verifiedTables: before.tables.length,
  });
}

module.exports = {
  CONTROL_TABLES,
  PRESERVATION_SCHEMA,
  PRESERVATION_SCHEMA_VERSION,
  collectInstallationIdentitySnapshot,
  compareInstallationIdentitySnapshots,
  validateSnapshot,
};
