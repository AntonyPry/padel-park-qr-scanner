'use strict';

const DEFAULT_SAMPLE_LIMIT = 10;
const PROVIDER_ROOTS = new Set([
  'Receipts',
  'TelephonyCalls',
  'TelephonyRawEvents',
  'TelephonySubscriptions',
]);
// Accepted domain migrations enforce these inherited/scope-dependent links
// with parent constraints and definition-checked triggers rather than a
// redundant direct Clubs/Memberships FK on every child.
const DERIVED_CLUB_LINK_TABLES = new Set([
  'AuditLogs',
  'CertificateRedemptions',
  'Certificates',
  'ClientSubscriptionRedemptions',
  'ClientSubscriptions',
  'CorporateLedgerEntries',
  'EvotorSaleSettings',
  'Finances',
  'OnboardingEvents',
  'OnboardingProgresses',
  'OnboardingTrainingModes',
  'PendingSaleHistories',
  'PendingSales',
]);
const DERIVED_MEMBERSHIP_LINK_TABLES = new Set([
  'OnboardingEvents',
  'OnboardingProgresses',
  'OnboardingTrainingModes',
]);
const OPTIONAL_ORGANIZATION_TABLES = new Set(['Finances']);
const OPTIONAL_CLUB_TABLES = new Set([
  'AuditLogs',
  'Finances',
  'OnboardingEvents',
  'OnboardingProgresses',
]);

function quoteIdentifier(value) {
  return `\`${String(value).replaceAll('`', '``')}\``;
}

function finding(code, table, count, samples = [], details = {}) {
  return Object.freeze({ code, count: Number(count), details, samples, table });
}

async function queryRows(sequelize, sql, replacements = {}) {
  const [rows] = await sequelize.query(sql, { replacements });
  return rows;
}

async function loadDefinition(sequelize) {
  const columns = await queryRows(
    sequelize,
    `SELECT TABLE_NAME AS tableName,
            COLUMN_NAME AS columnName,
            IS_NULLABLE AS nullable,
            COLUMN_TYPE AS columnType
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  );
  const foreignKeyColumns = await queryRows(
    sequelize,
    `SELECT TABLE_NAME AS tableName,
            CONSTRAINT_NAME AS constraintName,
            COLUMN_NAME AS columnName,
            REFERENCED_TABLE_NAME AS referencedTable,
            REFERENCED_COLUMN_NAME AS referencedColumn,
            ORDINAL_POSITION AS ordinalPosition
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
  );
  const indexes = await queryRows(
    sequelize,
    `SELECT TABLE_NAME AS tableName,
            INDEX_NAME AS indexName,
            NON_UNIQUE AS nonUnique,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
      GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE
      ORDER BY TABLE_NAME, INDEX_NAME`,
  );
  const triggers = await queryRows(
    sequelize,
    `SELECT EVENT_OBJECT_TABLE AS tableName,
            TRIGGER_NAME AS triggerName,
            ACTION_TIMING AS timing,
            EVENT_MANIPULATION AS eventName
       FROM INFORMATION_SCHEMA.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()
      ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME`,
  );

  const byTable = new Map();
  for (const column of columns) {
    const definition = byTable.get(column.tableName) || {
      columns: new Map(),
      foreignKeys: [],
      indexes: [],
      tableName: column.tableName,
      triggers: [],
    };
    definition.columns.set(column.columnName, column);
    byTable.set(column.tableName, definition);
  }
  const groupedForeignKeys = new Map();
  for (const column of foreignKeyColumns) {
    const key = `${column.tableName}\0${column.constraintName}`;
    const definition = groupedForeignKeys.get(key) || {
      columns: [],
      constraintName: column.constraintName,
      referencedColumns: [],
      referencedTable: column.referencedTable,
      tableName: column.tableName,
    };
    definition.columns.push(column.columnName);
    definition.referencedColumns.push(column.referencedColumn);
    groupedForeignKeys.set(key, definition);
  }
  for (const foreignKey of groupedForeignKeys.values()) {
    byTable.get(foreignKey.tableName)?.foreignKeys.push(foreignKey);
  }
  for (const index of indexes) byTable.get(index.tableName)?.indexes.push(index);
  for (const trigger of triggers) byTable.get(trigger.tableName)?.triggers.push(trigger);
  return { byTable, columns, foreignKeys: [...groupedForeignKeys.values()], indexes, triggers };
}

async function countAndSample(sequelize, fromAndWhere, sampleLimit) {
  const [{ count }] = await queryRows(
    sequelize,
    `SELECT COUNT(*) AS count ${fromAndWhere}`,
  );
  if (Number(count) === 0) return { count: 0, samples: [] };
  const rows = await queryRows(
    sequelize,
    `SELECT child.* ${fromAndWhere} LIMIT ${Number(sampleLimit)}`,
  );
  return {
    count: Number(count),
    samples: rows.map((row) => ({ id: row.id ?? null })),
  };
}

async function detectForeignKeyViolations(sequelize, foreignKey, sampleLimit) {
  const child = quoteIdentifier(foreignKey.tableName);
  const parent = quoteIdentifier(foreignKey.referencedTable);
  const values = foreignKey.columns.map(
    (column) => `child.${quoteIdentifier(column)}`,
  );
  const allPresent = values.map((value) => `${value} IS NOT NULL`).join(' AND ');
  const join = foreignKey.columns.map(
    (column, index) =>
      `parent.${quoteIdentifier(foreignKey.referencedColumns[index])} = child.${quoteIdentifier(column)}`,
  ).join(' AND ');
  const parentProbe = `parent.${quoteIdentifier(foreignKey.referencedColumns[0])}`;
  const findings = [];
  if (foreignKey.columns.length > 1) {
    const identityIndex = foreignKey.referencedColumns.indexOf('id');
    const anchorIndex = identityIndex >= 0
      ? identityIndex
      : foreignKey.columns.length - 1;
    const anchor = values[anchorIndex];
    const partial = await countAndSample(
      sequelize,
      `FROM ${child} AS child WHERE ${anchor} IS NOT NULL AND NOT (${allPresent})`,
      sampleLimit,
    );
    if (partial.count > 0) {
      findings.push(finding(
        'PARTIAL_FOREIGN_KEY',
        foreignKey.tableName,
        partial.count,
        partial.samples,
        { constraint: foreignKey.constraintName },
      ));
    }
  }
  const orphan = await countAndSample(
    sequelize,
    `FROM ${child} AS child LEFT JOIN ${parent} AS parent ON ${join}
      WHERE (${allPresent}) AND ${parentProbe} IS NULL`,
    sampleLimit,
  );
  if (orphan.count > 0) {
    findings.push(finding(
      'MISSING_PARENT',
      foreignKey.tableName,
      orphan.count,
      orphan.samples,
      {
        constraint: foreignKey.constraintName,
        referencedTable: foreignKey.referencedTable,
      },
    ));
  }
  return findings;
}

function hasCompositeForeignKey(table, referencedTable, columns) {
  return table.foreignKeys.some(
    (foreignKey) =>
      foreignKey.referencedTable === referencedTable &&
      columns.every((column) => foreignKey.columns.includes(column)),
  );
}

function inspectDefinition(definition, { strict }) {
  const findings = [];
  const tables = [...definition.byTable.values()];
  for (const table of tables) {
    const hasOrganization = table.columns.has('organizationId');
    const hasClub = table.columns.has('clubId');
    const hasMembership = table.columns.has('membershipId');
    const hasTenantClubLink = table.foreignKeys.some(
      (foreignKey) =>
        foreignKey.columns.includes('organizationId') &&
        foreignKey.columns.includes('clubId'),
    );
    if (
      hasOrganization &&
      hasClub &&
      !hasTenantClubLink &&
      !DERIVED_CLUB_LINK_TABLES.has(table.tableName)
    ) {
      findings.push(finding(
        'MISSING_TENANT_CLUB_CONSTRAINT',
        table.tableName,
        1,
      ));
    }
    if (
      hasOrganization &&
      hasMembership &&
      !hasCompositeForeignKey(table, 'Memberships', ['organizationId', 'membershipId']) &&
      !DERIVED_MEMBERSHIP_LINK_TABLES.has(table.tableName)
    ) {
      findings.push(finding(
        'MISSING_TENANT_MEMBERSHIP_CONSTRAINT',
        table.tableName,
        1,
      ));
    }
    if (
      strict &&
      hasOrganization &&
      table.columns.get('organizationId').nullable === 'YES' &&
      !PROVIDER_ROOTS.has(table.tableName) &&
      !OPTIONAL_ORGANIZATION_TABLES.has(table.tableName)
    ) {
      findings.push(finding('NULLABLE_TENANT_OWNER_COLUMN', table.tableName, 1));
    }
    if (
      strict &&
      hasClub &&
      table.columns.get('clubId').nullable === 'YES' &&
      !PROVIDER_ROOTS.has(table.tableName) &&
      !OPTIONAL_CLUB_TABLES.has(table.tableName)
    ) {
      findings.push(finding('NULLABLE_TENANT_CLUB_COLUMN', table.tableName, 1));
    }
  }

  const expectedTriggers = {
    Clubs: 'trg_final_clubs_tenant_immutable',
    MembershipClubAccesses: 'trg_final_accesses_tenant_immutable',
    Memberships: 'trg_final_memberships_authority_immutable',
    Staffs: 'trg_final_staffs_tenant_immutable',
    TelephonyTranscriptSegments: 'trg_final_transcript_segments_link_immutable',
    TelephonyTranscriptionJobs: 'trg_final_transcription_jobs_tenant_immutable',
  };
  for (const [tableName, triggerName] of Object.entries(expectedTriggers)) {
    const table = definition.byTable.get(tableName);
    if (!table?.triggers.some((trigger) => trigger.triggerName === triggerName)) {
      findings.push(finding(
        'MISSING_IMMUTABILITY_TRIGGER',
        tableName,
        1,
        [],
        { triggerName },
      ));
    }
  }
  return findings;
}

async function detectDirectTenantViolations(sequelize, definition, { sampleLimit, strict }) {
  const findings = [];
  for (const table of definition.byTable.values()) {
    if (!table.columns.has('organizationId')) continue;
    const quotedTable = quoteIdentifier(table.tableName);
    const organization = await countAndSample(
      sequelize,
      `FROM ${quotedTable} AS child
       LEFT JOIN Organizations AS parent ON parent.id = child.organizationId
       WHERE ${OPTIONAL_ORGANIZATION_TABLES.has(table.tableName)
        ? '(child.organizationId IS NOT NULL AND parent.id IS NULL)'
        : '(child.organizationId IS NULL OR parent.id IS NULL)'}`,
      sampleLimit,
    );
    if (organization.count > 0) {
      findings.push(finding(
        'MISSING_ORGANIZATION_OWNER',
        table.tableName,
        organization.count,
        organization.samples,
      ));
    }
    if (table.columns.has('clubId')) {
      const allowNullClub = OPTIONAL_CLUB_TABLES.has(table.tableName) ||
        (PROVIDER_ROOTS.has(table.tableName) && !strict);
      const club = await countAndSample(
        sequelize,
        `FROM ${quotedTable} AS child
         LEFT JOIN Clubs AS parent
           ON parent.id = child.clubId
          AND parent.organizationId = child.organizationId
         WHERE ${allowNullClub ? '(child.clubId IS NOT NULL AND parent.id IS NULL)' : '(child.clubId IS NULL OR parent.id IS NULL)'}`,
        sampleLimit,
      );
      if (club.count > 0) {
        findings.push(finding(
          'WRONG_OR_MISSING_CLUB_OWNER',
          table.tableName,
          club.count,
          club.samples,
        ));
      }
    }
    if (table.columns.has('membershipId')) {
      const membership = await countAndSample(
        sequelize,
        `FROM ${quotedTable} AS child
         LEFT JOIN Memberships AS parent
           ON parent.id = child.membershipId
          AND parent.organizationId = child.organizationId
         WHERE child.membershipId IS NULL OR parent.id IS NULL`,
        sampleLimit,
      );
      if (membership.count > 0) {
        findings.push(finding(
          'WRONG_OR_MISSING_MEMBERSHIP_OWNER',
          table.tableName,
          membership.count,
          membership.samples,
        ));
      }
    }
    if (table.columns.has('integrationConnectionId')) {
      const requireConnection = strict && PROVIDER_ROOTS.has(table.tableName);
      const connection = await countAndSample(
        sequelize,
        `FROM ${quotedTable} AS child
         LEFT JOIN IntegrationConnections AS parent
           ON parent.id = child.integrationConnectionId
          AND parent.organizationId = child.organizationId
          AND parent.clubId = child.clubId
         WHERE ${requireConnection
          ? '(child.integrationConnectionId IS NULL OR parent.id IS NULL)'
          : '(child.integrationConnectionId IS NOT NULL AND parent.id IS NULL)'}`,
        sampleLimit,
      );
      if (connection.count > 0) {
        findings.push(finding(
          'WRONG_OR_MISSING_PROVIDER_CONNECTION',
          table.tableName,
          connection.count,
          connection.samples,
        ));
      }
    }
  }
  return findings;
}

const CROSS_LINK_RULES = Object.freeze([
  {
    code: 'CROSS_TENANT_RAW_EVENT_CALL',
    sql: `FROM TelephonyRawEvents AS child
          JOIN TelephonyCalls AS parent ON parent.id = child.telephonyCallId
         WHERE child.telephonyCallId IS NOT NULL
           AND (NOT (child.organizationId <=> parent.organizationId)
             OR NOT (child.clubId <=> parent.clubId))`,
    table: 'TelephonyRawEvents',
  },
  {
    code: 'CROSS_TENANT_TRANSCRIPTION_JOB_CALL',
    sql: `FROM TelephonyTranscriptionJobs AS child
          JOIN TelephonyCalls AS parent ON parent.id = child.telephonyCallId
         WHERE NOT (child.organizationId <=> parent.organizationId)
            OR NOT (child.clubId <=> parent.clubId)`,
    table: 'TelephonyTranscriptionJobs',
  },
  {
    code: 'CROSS_CALL_TRANSCRIPT_SEGMENT',
    sql: `FROM TelephonyTranscriptSegments AS child
          JOIN TelephonyTranscriptionJobs AS parent ON parent.id = child.transcriptionJobId
         WHERE child.telephonyCallId <> parent.telephonyCallId`,
    table: 'TelephonyTranscriptSegments',
  },
]);

async function runTenantIntegrityDetector({
  sampleLimit = DEFAULT_SAMPLE_LIMIT,
  sequelize,
  strict = true,
} = {}) {
  if (!sequelize) throw new TypeError('sequelize is required');
  const definition = await loadDefinition(sequelize);
  const findings = inspectDefinition(definition, { strict });
  for (const foreignKey of definition.foreignKeys) {
    findings.push(...await detectForeignKeyViolations(sequelize, foreignKey, sampleLimit));
  }
  findings.push(...await detectDirectTenantViolations(
    sequelize,
    definition,
    { sampleLimit, strict },
  ));
  for (const rule of CROSS_LINK_RULES) {
    if (!definition.byTable.has(rule.table)) continue;
    const result = await countAndSample(sequelize, rule.sql, sampleLimit);
    if (result.count > 0) {
      findings.push(finding(rule.code, rule.table, result.count, result.samples));
    }
  }
  const unsafeCount = findings.reduce((total, item) => total + item.count, 0);
  const directTables = [...definition.byTable.values()]
    .filter((table) => table.columns.has('organizationId'))
    .map((table) => table.tableName)
    .sort();
  return Object.freeze({
    classifications: {
      directTenantTables: directTables,
      globalOrInheritedTables: [...definition.byTable.keys()]
        .filter((tableName) => !directTables.includes(tableName))
        .sort(),
      providerRoots: [...PROVIDER_ROOTS].sort(),
    },
    counts: {
      directTenantTables: directTables.length,
      findings: findings.length,
      foreignKeys: definition.foreignKeys.length,
      tables: definition.byTable.size,
      unsafe: unsafeCount,
    },
    findings,
    mode: strict ? 'strict-enforcement' : 'legacy-compatible',
    ok: findings.length === 0,
    schemaVersion: 1,
  });
}

module.exports = {
  CROSS_LINK_RULES,
  DERIVED_CLUB_LINK_TABLES,
  DERIVED_MEMBERSHIP_LINK_TABLES,
  OPTIONAL_CLUB_TABLES,
  OPTIONAL_ORGANIZATION_TABLES,
  PROVIDER_ROOTS,
  loadDefinition,
  runTenantIntegrityDetector,
};
