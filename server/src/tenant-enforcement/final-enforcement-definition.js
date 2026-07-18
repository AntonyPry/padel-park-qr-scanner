'use strict';

const INDEX_DEFINITIONS = Object.freeze([
  Object.freeze({
    columns: Object.freeze(['id', 'organizationId', 'clubId']),
    indexType: 'BTREE',
    kind: 'index',
    name: 'uq_final_telephony_calls_tenant_identity',
    table: 'TelephonyCalls',
    unique: true,
  }),
  Object.freeze({
    columns: Object.freeze(['id', 'telephonyCallId']),
    indexType: 'BTREE',
    kind: 'index',
    name: 'uq_final_transcription_jobs_call_identity',
    table: 'TelephonyTranscriptionJobs',
    unique: true,
  }),
]);

const FOREIGN_KEY_DEFINITIONS = Object.freeze([
  Object.freeze({
    columns: Object.freeze(['telephonyCallId', 'organizationId', 'clubId']),
    deleteRule: 'RESTRICT',
    kind: 'foreignKey',
    name: 'fk_final_transcription_jobs_call_tenant',
    referencedColumns: Object.freeze(['id', 'organizationId', 'clubId']),
    referencedTable: 'TelephonyCalls',
    table: 'TelephonyTranscriptionJobs',
    updateRule: 'RESTRICT',
  }),
  Object.freeze({
    columns: Object.freeze(['telephonyCallId', 'organizationId', 'clubId']),
    deleteRule: 'RESTRICT',
    kind: 'foreignKey',
    name: 'fk_final_telephony_raw_events_call_tenant',
    referencedColumns: Object.freeze(['id', 'organizationId', 'clubId']),
    referencedTable: 'TelephonyCalls',
    table: 'TelephonyRawEvents',
    updateRule: 'RESTRICT',
  }),
  Object.freeze({
    columns: Object.freeze(['transcriptionJobId', 'telephonyCallId']),
    deleteRule: 'RESTRICT',
    kind: 'foreignKey',
    name: 'fk_final_transcript_segments_job_call',
    referencedColumns: Object.freeze(['id', 'telephonyCallId']),
    referencedTable: 'TelephonyTranscriptionJobs',
    table: 'TelephonyTranscriptSegments',
    updateRule: 'RESTRICT',
  }),
  Object.freeze({
    columns: Object.freeze(['organizationId', 'userId']),
    deleteRule: 'RESTRICT',
    kind: 'foreignKey',
    name: 'fk_final_telephony_calls_client_tenant',
    referencedColumns: Object.freeze(['organizationId', 'id']),
    referencedTable: 'Users',
    table: 'TelephonyCalls',
    updateRule: 'RESTRICT',
  }),
  Object.freeze({
    columns: Object.freeze(['organizationId', 'staffId']),
    deleteRule: 'RESTRICT',
    kind: 'foreignKey',
    name: 'fk_final_telephony_calls_staff_tenant',
    referencedColumns: Object.freeze(['organizationId', 'id']),
    referencedTable: 'Staffs',
    table: 'TelephonyCalls',
    updateRule: 'RESTRICT',
  }),
  Object.freeze({
    columns: Object.freeze(['organizationId', 'clubId', 'linkedBookingId']),
    deleteRule: 'RESTRICT',
    kind: 'foreignKey',
    name: 'fk_final_telephony_calls_booking_tenant',
    referencedColumns: Object.freeze(['organizationId', 'clubId', 'id']),
    referencedTable: 'Bookings',
    table: 'TelephonyCalls',
    updateRule: 'RESTRICT',
  }),
]);

function immutableTriggerBody(comparisons, message) {
  return `BEGIN
            IF ${comparisons.map(
    (column) => `NOT (OLD.${column} <=> NEW.${column})`,
  ).join(' OR ')} THEN
              SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${message}';
            END IF;
          END`;
}

const TRIGGER_DEFINITIONS = Object.freeze([
  Object.freeze({
    body: immutableTriggerBody(['organizationId'], 'Club tenant attribution is immutable'),
    event: 'UPDATE',
    kind: 'trigger',
    name: 'trg_final_clubs_tenant_immutable',
    orientation: 'ROW',
    table: 'Clubs',
    timing: 'BEFORE',
  }),
  Object.freeze({
    body: immutableTriggerBody(
      ['organizationId', 'accountId'],
      'Membership tenant authority is immutable',
    ),
    event: 'UPDATE',
    kind: 'trigger',
    name: 'trg_final_memberships_authority_immutable',
    orientation: 'ROW',
    table: 'Memberships',
    timing: 'BEFORE',
  }),
  Object.freeze({
    body: immutableTriggerBody(
      ['organizationId', 'membershipId', 'clubId'],
      'Membership Club access authority is immutable',
    ),
    event: 'UPDATE',
    kind: 'trigger',
    name: 'trg_final_accesses_tenant_immutable',
    orientation: 'ROW',
    table: 'MembershipClubAccesses',
    timing: 'BEFORE',
  }),
  Object.freeze({
    body: immutableTriggerBody(['organizationId'], 'Staff tenant attribution is immutable'),
    event: 'UPDATE',
    kind: 'trigger',
    name: 'trg_final_staffs_tenant_immutable',
    orientation: 'ROW',
    table: 'Staffs',
    timing: 'BEFORE',
  }),
  Object.freeze({
    body: immutableTriggerBody(
      ['organizationId', 'clubId', 'telephonyCallId'],
      'Transcription job tenant attribution is immutable',
    ),
    event: 'UPDATE',
    kind: 'trigger',
    name: 'trg_final_transcription_jobs_tenant_immutable',
    orientation: 'ROW',
    table: 'TelephonyTranscriptionJobs',
    timing: 'BEFORE',
  }),
  Object.freeze({
    body: immutableTriggerBody(
      ['transcriptionJobId', 'telephonyCallId'],
      'Transcript segment ownership links are immutable',
    ),
    event: 'UPDATE',
    kind: 'trigger',
    name: 'trg_final_transcript_segments_link_immutable',
    orientation: 'ROW',
    table: 'TelephonyTranscriptSegments',
    timing: 'BEFORE',
  }),
]);

const FINAL_ENFORCEMENT_DEFINITIONS = Object.freeze([
  ...INDEX_DEFINITIONS,
  ...FOREIGN_KEY_DEFINITIONS,
  ...TRIGGER_DEFINITIONS,
]);

function artifactKey(definition) {
  return `${definition.kind}:${definition.name}`;
}

// Normalize formatting only. Quoted strings and identifier quotes are copied
// byte-for-byte so a changed MESSAGE_TEXT or quoted identifier is definition
// drift rather than a semantic approximation.
function normalizeTriggerBody(value) {
  const source = String(value || '').trim();
  let output = '';
  let quote = null;
  let pendingSpace = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      output += character;
      if (character === '\\' && index + 1 < source.length) {
        output += source[index + 1];
        index += 1;
      } else if (character === quote) {
        if (source[index + 1] === quote) {
          output += source[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (["'", '"', '`'].includes(character)) {
      if (pendingSpace && output && !output.endsWith(' ')) output += ' ';
      pendingSpace = false;
      quote = character;
      output += character;
      continue;
    }
    if (/\s/u.test(character)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && output && !output.endsWith(' ')) output += ' ';
    pendingSpace = false;
    output += character;
  }
  return output.trim();
}

function normalizeRule(value) {
  return String(value || '').trim().toUpperCase();
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactSignature(expected, actual) {
  if (!actual || expected.kind !== actual.kind || expected.name !== actual.name) return false;
  if (expected.table !== actual.table) return false;
  if (expected.kind === 'index') {
    return sameArray(expected.columns, actual.columns) &&
      expected.unique === actual.unique &&
      expected.indexType === normalizeRule(actual.indexType) &&
      actual.subParts.every((value) => value === null) &&
      actual.collations.every((value) => value === 'A');
  }
  if (expected.kind === 'foreignKey') {
    return sameArray(expected.columns, actual.columns) &&
      expected.referencedTable === actual.referencedTable &&
      sameArray(expected.referencedColumns, actual.referencedColumns) &&
      expected.updateRule === normalizeRule(actual.updateRule) &&
      expected.deleteRule === normalizeRule(actual.deleteRule);
  }
  return expected.event === normalizeRule(actual.event) &&
    expected.timing === normalizeRule(actual.timing) &&
    expected.orientation === normalizeRule(actual.orientation) &&
    normalizeTriggerBody(expected.body) === normalizeTriggerBody(actual.body);
}

function equivalentSignature(expected, actual) {
  return exactSignature(expected, { ...actual, name: expected.name });
}

async function queryRows(sequelize, sql) {
  const [rows] = await sequelize.query(sql);
  return rows;
}

async function loadFinalEnforcementDefinition(sequelize) {
  const indexRows = await queryRows(
    sequelize,
    `SELECT TABLE_NAME AS tableName,
            INDEX_NAME AS name,
            NON_UNIQUE AS nonUnique,
            INDEX_TYPE AS indexType,
            COLUMN_NAME AS columnName,
            SEQ_IN_INDEX AS ordinalPosition,
            SUB_PART AS subPart,
            COLLATION AS collation
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
  );
  const foreignKeyRows = await queryRows(
    sequelize,
    `SELECT k.TABLE_NAME AS tableName,
            k.CONSTRAINT_NAME AS name,
            k.COLUMN_NAME AS columnName,
            k.REFERENCED_TABLE_NAME AS referencedTable,
            k.REFERENCED_COLUMN_NAME AS referencedColumn,
            k.ORDINAL_POSITION AS ordinalPosition,
            r.UPDATE_RULE AS updateRule,
            r.DELETE_RULE AS deleteRule
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS k
       JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS AS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
        AND r.TABLE_NAME = k.TABLE_NAME
        AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA = DATABASE()
        AND k.REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
  );
  const triggerRows = await queryRows(
    sequelize,
    `SELECT EVENT_OBJECT_TABLE AS tableName,
            TRIGGER_NAME AS name,
            EVENT_MANIPULATION AS event,
            ACTION_TIMING AS timing,
            ACTION_ORIENTATION AS orientation,
            ACTION_STATEMENT AS body
       FROM INFORMATION_SCHEMA.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()
      ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME`,
  );

  const indexMap = new Map();
  for (const row of indexRows) {
    const key = `index:${row.tableName}:${row.name}`;
    const definition = indexMap.get(key) || {
      collations: [], columns: [], indexType: row.indexType, kind: 'index',
      name: row.name, subParts: [], table: row.tableName, unique: Number(row.nonUnique) === 0,
    };
    definition.columns.push(row.columnName);
    definition.subParts.push(row.subPart === null ? null : Number(row.subPart));
    definition.collations.push(row.collation);
    indexMap.set(key, definition);
  }

  const foreignKeyMap = new Map();
  for (const row of foreignKeyRows) {
    const key = `foreignKey:${row.tableName}:${row.name}`;
    const definition = foreignKeyMap.get(key) || {
      columns: [], deleteRule: row.deleteRule, kind: 'foreignKey', name: row.name,
      referencedColumns: [], referencedTable: row.referencedTable, table: row.tableName,
      updateRule: row.updateRule,
    };
    definition.columns.push(row.columnName);
    definition.referencedColumns.push(row.referencedColumn);
    foreignKeyMap.set(key, definition);
  }

  const triggers = triggerRows.map((row) => ({
    body: row.body,
    event: row.event,
    kind: 'trigger',
    name: row.name,
    orientation: row.orientation,
    table: row.tableName,
    timing: row.timing,
  }));
  const artifacts = [...indexMap.values(), ...foreignKeyMap.values(), ...triggers];
  return Object.freeze({ artifacts, foreignKeys: [...foreignKeyMap.values()] });
}

function classifyLoadedDefinition(loaded) {
  const artifacts = FINAL_ENFORCEMENT_DEFINITIONS.map((expected) => {
    const sameName = loaded.artifacts.filter(
      (actual) => actual.kind === expected.kind && actual.name === expected.name,
    );
    const exact = sameName.length === 1 && exactSignature(expected, sameName[0]);
    const equivalents = loaded.artifacts.filter(
      (actual) => actual.kind === expected.kind &&
        actual.name !== expected.name &&
        equivalentSignature(expected, actual),
    );
    return Object.freeze({
      actual: sameName,
      equivalents: equivalents.map((item) => ({ name: item.name, table: item.table })),
      expected,
      key: artifactKey(expected),
      state: exact && equivalents.length === 0
        ? 'exact'
        : sameName.length === 0 && equivalents.length === 0
          ? 'absent'
          : 'drift',
    });
  });
  const exact = artifacts.filter((item) => item.state === 'exact').length;
  const absent = artifacts.filter((item) => item.state === 'absent').length;
  const state = exact === artifacts.length
    ? 'ready'
    : absent === artifacts.length
      ? 'legacy'
      : 'partial';
  return Object.freeze({ artifacts, loaded, state });
}

async function classifyFinalEnforcementDefinition(sequelize) {
  return classifyLoadedDefinition(await loadFinalEnforcementDefinition(sequelize));
}

function triggerCreateSql(definition) {
  return `CREATE TRIGGER ${definition.name}
          ${definition.timing} ${definition.event} ON ${definition.table}
          FOR EACH ${definition.orientation}
          ${definition.body}`;
}

module.exports = {
  FINAL_ENFORCEMENT_DEFINITIONS,
  FOREIGN_KEY_DEFINITIONS,
  INDEX_DEFINITIONS,
  TRIGGER_DEFINITIONS,
  artifactKey,
  classifyFinalEnforcementDefinition,
  classifyLoadedDefinition,
  exactSignature,
  loadFinalEnforcementDefinition,
  normalizeTriggerBody,
  triggerCreateSql,
};
