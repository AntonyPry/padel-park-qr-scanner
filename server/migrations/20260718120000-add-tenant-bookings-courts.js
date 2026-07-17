'use strict';

const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../src/tenant-foundation/constants');

const MIGRATION_NAME = '20260718120000-add-tenant-bookings-courts.js';
const ROOT_TABLES = Object.freeze([
  'Courts',
  'BookingSettings',
  'BookingPriceRules',
  'BookingScheduleExceptions',
  'BookingSeries',
  'Bookings',
  'Utilizations',
]);
const HASH_COLUMNS = Object.freeze({
  BookingSeries: Object.freeze([
    'creationKeyHash',
    'creationPayloadHash',
    'lastMutationKeyHash',
    'lastMutationPayloadHash',
  ]),
  Bookings: Object.freeze([
    'creationKeyHash',
    'creationPayloadHash',
    'lastMutationKeyHash',
    'lastMutationPayloadHash',
  ]),
});
const COLUMNS = Object.freeze(ROOT_TABLES.flatMap((table) => [
  Object.freeze({ table, name: 'organizationId', kind: 'tenant' }),
  Object.freeze({ table, name: 'clubId', kind: 'tenant' }),
  ...(HASH_COLUMNS[table] || []).map((name) =>
    Object.freeze({ table, name, kind: 'hash' })),
]));

const INDEX_DEFINITIONS = Object.freeze([
  ['Courts', 'uq_mt_booking_courts_tenant_id', true, ['organizationId', 'clubId', 'id']],
  ['Courts', 'uq_mt_booking_courts_club_name', true, ['clubId', 'name']],
  ['Courts', 'idx_mt_booking_courts_active_sort', false, ['organizationId', 'clubId', 'isActive', 'sortOrder']],
  ['BookingSettings', 'uq_mt_booking_settings_club', true, ['clubId']],
  ['BookingSettings', 'idx_mt_booking_settings_tenant_id', false, ['organizationId', 'clubId', 'id']],
  ['BookingPriceRules', 'idx_mt_booking_price_rules_scope', false, ['organizationId', 'clubId', 'status', 'courtType', 'priority']],
  ['BookingScheduleExceptions', 'uq_mt_booking_exceptions_club_date', true, ['clubId', 'date']],
  ['BookingScheduleExceptions', 'idx_mt_booking_exceptions_scope', false, ['organizationId', 'clubId', 'status', 'date']],
  ['BookingSeries', 'uq_mt_booking_series_tenant_id', true, ['organizationId', 'clubId', 'id']],
  ['BookingSeries', 'uq_mt_booking_series_creation_key', true, ['clubId', 'creationKeyHash']],
  ['BookingSeries', 'idx_mt_booking_series_schedule', false, ['organizationId', 'clubId', 'status', 'weekday', 'startTime']],
  ['BookingSeries', 'idx_mt_booking_series_client', false, ['organizationId', 'clubId', 'userId', 'startsOn']],
  ['Bookings', 'uq_mt_bookings_tenant_id', true, ['organizationId', 'clubId', 'id']],
  ['Bookings', 'uq_mt_bookings_creation_key', true, ['clubId', 'creationKeyHash']],
  ['Bookings', 'idx_mt_bookings_court_time', false, ['organizationId', 'clubId', 'courtId', 'startsAt', 'endsAt']],
  ['Bookings', 'idx_mt_bookings_client_time', false, ['organizationId', 'clubId', 'userId', 'startsAt']],
  ['Bookings', 'idx_mt_bookings_series_time', false, ['organizationId', 'clubId', 'bookingSeriesId', 'startsAt']],
  ['Bookings', 'idx_mt_bookings_analytics', false, ['organizationId', 'clubId', 'status', 'startsAt']],
  ['Utilizations', 'uq_mt_booking_utilizations_club_date', true, ['clubId', 'date']],
  ['Utilizations', 'idx_mt_booking_utilizations_scope', false, ['organizationId', 'clubId', 'date']],
].map(([table, name, unique, fields]) => Object.freeze({
  table,
  name,
  unique,
  fields: Object.freeze(fields),
})));

const FOREIGN_KEY_DEFINITIONS = Object.freeze([
  ...ROOT_TABLES.map((table) => [
    table,
    `fk_mt_booking_${table.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}_club`,
    ['organizationId', 'clubId'],
    'Clubs',
    ['organizationId', 'id'],
    'RESTRICT',
  ]),
  ['Bookings', 'fk_mt_bookings_court', ['organizationId', 'clubId', 'courtId'], 'Courts', ['organizationId', 'clubId', 'id'], 'RESTRICT'],
  ['Bookings', 'fk_mt_bookings_client', ['organizationId', 'userId'], 'Users', ['organizationId', 'id'], 'RESTRICT'],
  ['BookingSeries', 'fk_mt_booking_series_court', ['organizationId', 'clubId', 'courtId'], 'Courts', ['organizationId', 'clubId', 'id'], 'RESTRICT'],
  ['BookingSeries', 'fk_mt_booking_series_client', ['organizationId', 'userId'], 'Users', ['organizationId', 'id'], 'RESTRICT'],
].map(([table, name, fields, referencedTable, referencedFields, onDelete]) =>
  Object.freeze({
    table,
    name,
    fields: Object.freeze(fields),
    referencedTable,
    referencedFields: Object.freeze(referencedFields),
    onDelete,
    onUpdate: 'CASCADE',
  })));

const GLOBAL_UNIQUES = Object.freeze([
  Object.freeze({ table: 'Courts', field: 'name', fallbackName: 'uq_legacy_courts_name' }),
  Object.freeze({ table: 'BookingScheduleExceptions', field: 'date', fallbackName: 'uq_legacy_booking_schedule_exceptions_date' }),
  Object.freeze({ table: 'Utilizations', field: 'date', fallbackName: 'uq_legacy_utilizations_date' }),
]);

function migrationError(message, code = 'TENANT_BOOKINGS_COURTS_MIGRATION_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function forcedFailure(step) {
  if (process.env.TENANT_BOOKINGS_COURTS_MIGRATION_FAIL_STEP === step) {
    throw migrationError(
      `Forced Feature 5.5 migration failure after ${step}`,
      'TENANT_BOOKINGS_COURTS_MIGRATION_FORCED_FAILURE',
    );
  }
}

async function queryRows(queryInterface, sql, replacements = {}) {
  const [rows] = await queryInterface.sequelize.query(sql, { replacements });
  return rows;
}

function value(row, key) {
  return row[key] ?? row[key.toLowerCase()] ?? null;
}

function normalizeSql(sql) {
  return String(sql || '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),;])\s*/g, '$1')
    .replace(/\s*(<=>|<>|!=|<=|>=|=|<|>)\s*/g, '$1')
    .trim()
    .toLowerCase();
}

async function getDefaultTenant(queryInterface) {
  const organizations = await queryRows(
    queryInterface,
    'SELECT id, slug, status FROM Organizations ORDER BY id',
  );
  const clubs = await queryRows(
    queryInterface,
    'SELECT id, organizationId, slug, status FROM Clubs ORDER BY id',
  );
  if (
    organizations.length !== 1 ||
    clubs.length !== 1 ||
    organizations[0].slug !== DEFAULT_ORGANIZATION_SLUG ||
    organizations[0].status !== 'active' ||
    clubs[0].slug !== DEFAULT_CLUB_SLUG ||
    clubs[0].status !== 'active' ||
    Number(clubs[0].organizationId) !== Number(organizations[0].id)
  ) {
    throw migrationError(
      'Feature 5.5 requires the exact active single default Organization and Club',
      'TENANT_SINGLE_DEFAULT_REQUIRED',
    );
  }
  return {
    organizationId: Number(organizations[0].id),
    clubId: Number(clubs[0].id),
  };
}

async function globalUniqueIndexes(queryInterface, definition) {
  const rows = await queryInterface.showIndex(definition.table);
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.name)) groups.set(row.name, []);
    groups.get(row.name).push(row);
  }
  return [...groups.entries()]
    .filter(([, items]) =>
      items.length === 1 &&
      Boolean(items[0].unique) &&
      items[0].fields?.length === 1 &&
      items[0].fields[0].attribute === definition.field)
    .map(([name]) => name);
}

function rootTriggerBody(table, event) {
  const immutable = event === 'UPDATE'
    ? `IF NOT (NEW.organizationId <=> OLD.organizationId) OR NOT (NEW.clubId <=> OLD.clubId) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${table} tenant attribution is immutable'; END IF;`
    : '';
  const hashes = ['Bookings', 'BookingSeries'].includes(table)
    ? `${event === 'UPDATE' ? `IF NOT (NEW.creationKeyHash <=> OLD.creationKeyHash) OR NOT (NEW.creationPayloadHash <=> OLD.creationPayloadHash) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${table} creation attribution is immutable'; END IF;` : ''}
       IF (NEW.creationKeyHash IS NULL) <> (NEW.creationPayloadHash IS NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${table} creation idempotency pair is invalid'; END IF;
       IF (NEW.lastMutationKeyHash IS NULL) <> (NEW.lastMutationPayloadHash IS NULL) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${table} mutation idempotency pair is invalid'; END IF;`
    : '';
  const staff = ['Bookings', 'BookingSeries'].includes(table)
    ? `IF NEW.responsibleStaffId IS NOT NULL AND NOT EXISTS (
         SELECT 1
           FROM Staffs staff
           JOIN Memberships membership
             ON membership.staffId = staff.id
            AND membership.organizationId = NEW.organizationId
            AND membership.status = 'active'
           JOIN Accounts account
             ON account.id = membership.accountId
            AND account.staffId = staff.id
            AND account.status = 'active'
      LEFT JOIN MembershipClubAccesses clubAccess
             ON clubAccess.membershipId = membership.id
            AND clubAccess.organizationId = NEW.organizationId
            AND clubAccess.clubId = NEW.clubId
            AND clubAccess.status = 'active'
            AND COALESCE(clubAccess.roleOverride, '') <> 'owner'
          WHERE staff.id = NEW.responsibleStaffId
            AND staff.organizationId = NEW.organizationId
            AND staff.status = 'active'
            AND (membership.role = 'owner' OR clubAccess.membershipId IS NOT NULL)
       ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${table} responsible Staff is not eligible for Club'; END IF;`
    : '';
  const accountReferences = ['Bookings', 'BookingSeries'].includes(table)
    ? ['createdByAccountId', 'updatedByAccountId', 'trainingAccountId']
      .map((field) => `IF NEW.${field} IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM Memberships membership
          WHERE membership.accountId = NEW.${field}
            AND membership.organizationId = NEW.organizationId
       ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${table} ${field} must belong to Organization'; END IF;`)
      .join('\n')
    : '';
  const series = table === 'Bookings'
    ? `IF NEW.bookingSeriesId IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM BookingSeries series
          WHERE series.id = NEW.bookingSeriesId
            AND series.organizationId = NEW.organizationId
            AND series.clubId = NEW.clubId
       ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BookingSeries must belong to Booking tenant'; END IF;`
    : '';
  return `BEGIN
    ${immutable}
    IF NOT EXISTS (
      SELECT 1 FROM Clubs club
       WHERE club.id = NEW.clubId
         AND club.organizationId = NEW.organizationId
         AND club.status = 'active'
    ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = '${table} requires an active authoritative Club'; END IF;
    ${hashes}
    ${staff}
    ${accountReferences}
    ${series}
  END`;
}

function triggerDefinitions() {
  const roots = ROOT_TABLES.flatMap((table) => {
    const slug = table.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
    return ['INSERT', 'UPDATE'].map((event) => ({
      name: `trg_mt_booking_${slug}_${event === 'INSERT' ? 'bi' : 'bu'}`,
      table,
      event,
      timing: 'BEFORE',
      body: rootTriggerBody(table, event),
    }));
  });
  return Object.freeze([
    ...roots,
    {
      name: 'trg_mt_booking_court_blocks_bi', table: 'CourtBlocks', event: 'INSERT', timing: 'BEFORE',
      body: `BEGIN
        IF NOT EXISTS (SELECT 1 FROM Courts court WHERE court.id = NEW.courtId AND court.isActive = 1)
        THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CourtBlock requires an active Court parent'; END IF;
        IF NEW.createdByAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM Courts court JOIN Memberships membership
            ON membership.organizationId = court.organizationId
           AND membership.accountId = NEW.createdByAccountId
           WHERE court.id = NEW.courtId
        ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CourtBlock createdByAccountId must belong to Organization'; END IF;
        IF NEW.updatedByAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM Courts court JOIN Memberships membership
            ON membership.organizationId = court.organizationId
           AND membership.accountId = NEW.updatedByAccountId
           WHERE court.id = NEW.courtId
        ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CourtBlock updatedByAccountId must belong to Organization'; END IF;
      END`,
    },
    {
      name: 'trg_mt_booking_court_blocks_bu', table: 'CourtBlocks', event: 'UPDATE', timing: 'BEFORE',
      body: `BEGIN
        IF NEW.courtId <> OLD.courtId AND NOT EXISTS (
          SELECT 1 FROM Courts oldCourt JOIN Courts newCourt
            ON newCourt.organizationId = oldCourt.organizationId
           AND newCourt.clubId = oldCourt.clubId
           AND newCourt.id = NEW.courtId
           AND newCourt.isActive = 1
           WHERE oldCourt.id = OLD.courtId
        ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CourtBlock cannot move across tenants'; END IF;
        IF NEW.createdByAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM Courts court JOIN Memberships membership
            ON membership.organizationId = court.organizationId
           AND membership.accountId = NEW.createdByAccountId
           WHERE court.id = NEW.courtId
        ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CourtBlock createdByAccountId must belong to Organization'; END IF;
        IF NEW.updatedByAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM Courts court JOIN Memberships membership
            ON membership.organizationId = court.organizationId
           AND membership.accountId = NEW.updatedByAccountId
           WHERE court.id = NEW.courtId
        ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CourtBlock updatedByAccountId must belong to Organization'; END IF;
      END`,
    },
    {
      name: 'trg_mt_booking_participants_bi', table: 'BookingParticipants', event: 'INSERT', timing: 'BEFORE',
      body: `BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM Bookings booking JOIN Users client
            ON client.id = NEW.userId AND client.organizationId = booking.organizationId
           WHERE booking.id = NEW.bookingId
        ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BookingParticipant must inherit Booking Organization'; END IF;
      END`,
    },
    {
      name: 'trg_mt_booking_participants_bu', table: 'BookingParticipants', event: 'UPDATE', timing: 'BEFORE',
      body: `BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM Bookings oldBooking JOIN Bookings newBooking
            ON newBooking.organizationId = oldBooking.organizationId
           AND newBooking.clubId = oldBooking.clubId
           AND newBooking.id = NEW.bookingId
           JOIN Users client ON client.id = NEW.userId AND client.organizationId = newBooking.organizationId
           WHERE oldBooking.id = OLD.bookingId
        ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BookingParticipant cannot move across tenants'; END IF;
      END`,
    },
    {
      name: 'trg_mt_booking_change_logs_bi', table: 'BookingChangeLogs', event: 'INSERT', timing: 'BEFORE',
      body: `BEGIN
        IF NEW.actorAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM Bookings booking JOIN Memberships membership
            ON membership.organizationId = booking.organizationId
           AND membership.accountId = NEW.actorAccountId
           WHERE booking.id = NEW.bookingId
        ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BookingChangeLog actor must belong to Organization'; END IF;
      END`,
    },
    {
      name: 'trg_mt_booking_change_logs_bu', table: 'BookingChangeLogs', event: 'UPDATE', timing: 'BEFORE',
      body: `BEGIN
        IF NEW.bookingId <> OLD.bookingId
        THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BookingChangeLog parent is immutable'; END IF;
        IF NEW.actorAccountId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM Bookings booking JOIN Memberships membership
            ON membership.organizationId = booking.organizationId
           AND membership.accountId = NEW.actorAccountId
           WHERE booking.id = NEW.bookingId
        ) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BookingChangeLog actor must belong to Organization'; END IF;
      END`,
    },
  ].map(Object.freeze));
}

const TRIGGER_DEFINITIONS = triggerDefinitions();

async function readInventory(queryInterface) {
  if (queryInterface.sequelize.getDialect() !== 'mysql') {
    const columns = [];
    for (const table of ROOT_TABLES) {
      const description = await queryInterface.describeTable(table);
      for (const name of ['organizationId', 'clubId', ...(HASH_COLUMNS[table] || [])]) {
        if (description[name]) columns.push({ TABLE_NAME: table, COLUMN_NAME: name, description: description[name] });
      }
    }
    const indexes = [];
    for (const table of ROOT_TABLES) {
      const rows = await queryInterface.showIndex(table);
      indexes.push(...rows.filter((row) => /^(uq|idx)_mt_booking/.test(row.name))
        .flatMap((row) => row.fields.map((field, index) => ({
          TABLE_NAME: table, INDEX_NAME: row.name, NON_UNIQUE: row.unique ? 0 : 1,
          COLUMN_NAME: field.attribute, SEQ_IN_INDEX: index + 1,
        }))));
    }
    return { columns, indexes, foreignKeys: [], triggers: [] };
  }
  const tablePlaceholders = ROOT_TABLES.map(() => '?').join(',');
  const names = [...new Set(COLUMNS.map(({ name }) => name))];
  const namePlaceholders = names.map(() => '?').join(',');
  const [columns] = await queryInterface.sequelize.query(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH, COLUMN_DEFAULT, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (${tablePlaceholders})
        AND COLUMN_NAME IN (${namePlaceholders})`,
    { replacements: [...ROOT_TABLES, ...names] },
  );
  const indexes = await queryRows(queryInterface,
    `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART, COLLATION, INDEX_TYPE
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND (INDEX_NAME LIKE 'uq\\_mt\\_booking%' ESCAPE '\\\\'
          OR INDEX_NAME LIKE 'idx\\_mt\\_booking%' ESCAPE '\\\\')`);
  const foreignKeys = await queryRows(queryInterface,
    `SELECT k.TABLE_NAME, k.CONSTRAINT_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
            k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
            r.UPDATE_RULE, r.DELETE_RULE
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
       JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
        AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
      WHERE k.CONSTRAINT_SCHEMA = DATABASE()
        AND k.CONSTRAINT_NAME LIKE 'fk\\_mt\\_booking%' ESCAPE '\\\\'`);
  const triggers = await queryRows(queryInterface,
    `SELECT TRIGGER_NAME, EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT
       FROM INFORMATION_SCHEMA.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()
        AND TRIGGER_NAME LIKE 'trg\\_mt\\_booking\\_%' ESCAPE '\\\\'`);
  return { columns, indexes, foreignKeys, triggers };
}

function columnsReady(rows) {
  if (rows.length !== COLUMNS.length) return false;
  return COLUMNS.every((definition) => {
    const row = rows.find((item) =>
      value(item, 'TABLE_NAME') === definition.table &&
      value(item, 'COLUMN_NAME') === definition.name);
    if (!row) return false;
    if (row.description) {
      return definition.kind === 'tenant'
        ? row.description.allowNull === false && /INT/i.test(String(row.description.type))
        : row.description.allowNull === true && /CHAR/i.test(String(row.description.type));
    }
    return definition.kind === 'tenant'
      ? String(value(row, 'DATA_TYPE')).toLowerCase() === 'int' && value(row, 'IS_NULLABLE') === 'NO'
      : String(value(row, 'DATA_TYPE')).toLowerCase() === 'varchar' &&
          Number(value(row, 'CHARACTER_MAXIMUM_LENGTH')) === 64 && value(row, 'IS_NULLABLE') === 'YES';
  });
}

function indexesReady(rows) {
  const names = new Set(rows.map((row) => value(row, 'INDEX_NAME')));
  if (names.size !== INDEX_DEFINITIONS.length) return false;
  return INDEX_DEFINITIONS.every((definition) => {
    const items = rows
      .filter((row) => value(row, 'INDEX_NAME') === definition.name)
      .sort((a, b) => Number(value(a, 'SEQ_IN_INDEX')) - Number(value(b, 'SEQ_IN_INDEX')));
    return items.length === definition.fields.length &&
      items.every((row, index) =>
        value(row, 'TABLE_NAME') === definition.table &&
        value(row, 'COLUMN_NAME') === definition.fields[index] &&
        Number(value(row, 'NON_UNIQUE')) === (definition.unique ? 0 : 1));
  });
}

function foreignKeysReady(rows) {
  const names = new Set(rows.map((row) => value(row, 'CONSTRAINT_NAME')));
  if (names.size !== FOREIGN_KEY_DEFINITIONS.length) return false;
  return FOREIGN_KEY_DEFINITIONS.every((definition) => {
    const items = rows
      .filter((row) => value(row, 'CONSTRAINT_NAME') === definition.name)
      .sort((a, b) => Number(value(a, 'ORDINAL_POSITION')) - Number(value(b, 'ORDINAL_POSITION')));
    return items.length === definition.fields.length && items.every((row, index) =>
      value(row, 'TABLE_NAME') === definition.table &&
      value(row, 'COLUMN_NAME') === definition.fields[index] &&
      value(row, 'REFERENCED_TABLE_NAME') === definition.referencedTable &&
      value(row, 'REFERENCED_COLUMN_NAME') === definition.referencedFields[index] &&
      String(value(row, 'UPDATE_RULE')).toUpperCase() === definition.onUpdate &&
      String(value(row, 'DELETE_RULE')).toUpperCase() === definition.onDelete);
  });
}

function triggersReady(rows) {
  if (rows.length !== TRIGGER_DEFINITIONS.length) return false;
  return TRIGGER_DEFINITIONS.every((definition) => {
    const row = rows.find((item) => value(item, 'TRIGGER_NAME') === definition.name);
    return row &&
      value(row, 'EVENT_OBJECT_TABLE') === definition.table &&
      String(value(row, 'ACTION_TIMING')).toUpperCase() === definition.timing &&
      String(value(row, 'EVENT_MANIPULATION')).toUpperCase() === definition.event &&
      normalizeSql(value(row, 'ACTION_STATEMENT')) === normalizeSql(definition.body);
  });
}

async function classifySchema(queryInterface) {
  const inventory = await readInventory(queryInterface);
  const artifacts = inventory.columns.length + inventory.indexes.length +
    inventory.foreignKeys.length + inventory.triggers.length;
  const globalCounts = await Promise.all(
    GLOBAL_UNIQUES.map((definition) => globalUniqueIndexes(queryInterface, definition)),
  );
  if (artifacts === 0) {
    return globalCounts.every((names) => names.length > 0) ? 'legacy' : 'partial';
  }
  const exactColumnPairs = new Set(COLUMNS.map(({ table, name }) => `${table}\0${name}`));
  if (inventory.columns.some((row) => !exactColumnPairs.has(
    `${value(row, 'TABLE_NAME')}\0${value(row, 'COLUMN_NAME')}`,
  ))) return 'partial';
  return columnsReady(inventory.columns) &&
    indexesReady(inventory.indexes) &&
    foreignKeysReady(inventory.foreignKeys) &&
    triggersReady(inventory.triggers) &&
    globalCounts.every((names) => names.length === 0)
    ? 'ready'
    : 'partial';
}

async function count(queryInterface, sql, replacements = {}) {
  const rows = await queryRows(queryInterface, sql, replacements);
  return Number(rows[0]?.count || 0);
}

async function assertLegacyGraph(queryInterface, tenant) {
  const checks = [
    ['more than one BookingSettings row exists', `SELECT GREATEST(COUNT(*) - 1, 0) AS count FROM BookingSettings`],
    ['Booking has an invalid Court or client', `SELECT COUNT(*) AS count FROM Bookings booking LEFT JOIN Courts court ON court.id=booking.courtId LEFT JOIN Users client ON client.id=booking.userId WHERE court.id IS NULL OR client.id IS NULL OR client.organizationId<>:organizationId`],
    ['BookingSeries has an invalid Court or client', `SELECT COUNT(*) AS count FROM BookingSeries series LEFT JOIN Courts court ON court.id=series.courtId LEFT JOIN Users client ON client.id=series.userId WHERE court.id IS NULL OR client.id IS NULL OR client.organizationId<>:organizationId`],
    ['Booking references an invalid series', `SELECT COUNT(*) AS count FROM Bookings booking LEFT JOIN BookingSeries series ON series.id=booking.bookingSeriesId WHERE booking.bookingSeriesId IS NOT NULL AND series.id IS NULL`],
    ['BookingParticipant has an invalid parent or client', `SELECT COUNT(*) AS count FROM BookingParticipants item LEFT JOIN Bookings booking ON booking.id=item.bookingId LEFT JOIN Users client ON client.id=item.userId WHERE booking.id IS NULL OR client.id IS NULL OR client.organizationId<>:organizationId`],
    ['CourtBlock has an invalid Court parent', `SELECT COUNT(*) AS count FROM CourtBlocks item LEFT JOIN Courts court ON court.id=item.courtId WHERE court.id IS NULL`],
    ['BookingChangeLog has an invalid Booking parent', `SELECT COUNT(*) AS count FROM BookingChangeLogs item LEFT JOIN Bookings booking ON booking.id=item.bookingId WHERE booking.id IS NULL`],
    ['Booking actor Account has no Organization Membership', `SELECT COUNT(*) AS count FROM (
       SELECT createdByAccountId AS accountId FROM Bookings WHERE createdByAccountId IS NOT NULL
       UNION ALL SELECT updatedByAccountId FROM Bookings WHERE updatedByAccountId IS NOT NULL
       UNION ALL SELECT trainingAccountId FROM Bookings WHERE trainingAccountId IS NOT NULL
       UNION ALL SELECT createdByAccountId FROM BookingSeries WHERE createdByAccountId IS NOT NULL
       UNION ALL SELECT updatedByAccountId FROM BookingSeries WHERE updatedByAccountId IS NOT NULL
       UNION ALL SELECT trainingAccountId FROM BookingSeries WHERE trainingAccountId IS NOT NULL
       UNION ALL SELECT createdByAccountId FROM CourtBlocks WHERE createdByAccountId IS NOT NULL
       UNION ALL SELECT updatedByAccountId FROM CourtBlocks WHERE updatedByAccountId IS NOT NULL
       UNION ALL SELECT actorAccountId FROM BookingChangeLogs WHERE actorAccountId IS NOT NULL
     ) refs LEFT JOIN Memberships membership
       ON membership.accountId=refs.accountId AND membership.organizationId=:organizationId
     WHERE membership.id IS NULL`],
    ['Booking or BookingSeries responsible Staff graph is invalid', `SELECT COUNT(*) AS count FROM (
       SELECT booking.responsibleStaffId AS staffId FROM Bookings booking WHERE booking.responsibleStaffId IS NOT NULL
       UNION ALL
       SELECT series.responsibleStaffId AS staffId FROM BookingSeries series WHERE series.responsibleStaffId IS NOT NULL
     ) refs
     LEFT JOIN Staffs staff ON staff.id=refs.staffId AND staff.organizationId=:organizationId AND staff.status='active'
     LEFT JOIN Memberships membership ON membership.staffId=staff.id AND membership.organizationId=:organizationId AND membership.status='active'
     LEFT JOIN Accounts account ON account.id=membership.accountId AND account.staffId=staff.id AND account.status='active'
     LEFT JOIN MembershipClubAccesses clubAccess ON clubAccess.membershipId=membership.id AND clubAccess.organizationId=:organizationId AND clubAccess.clubId=:clubId AND clubAccess.status='active'
     WHERE staff.id IS NULL OR membership.id IS NULL OR account.id IS NULL
        OR (membership.role<>'owner' AND (clubAccess.membershipId IS NULL OR clubAccess.roleOverride='owner'))`],
  ];
  for (const [label, sql] of checks) {
    if (await count(queryInterface, sql, tenant)) {
      throw migrationError(`Feature 5.5 preflight failed: ${label}`);
    }
  }
}

async function validateReadyData(queryInterface, tenant) {
  for (const table of ROOT_TABLES) {
    const invalid = await count(queryInterface,
      `SELECT COUNT(*) AS count FROM ${table}
        WHERE organizationId IS NULL OR clubId IS NULL
           OR organizationId<>:organizationId OR clubId<>:clubId`, tenant);
    if (invalid) throw migrationError(`Feature 5.5 invalid tenant attribution in ${table}`);
  }
  const relationChecks = [
    `SELECT COUNT(*) AS count FROM Bookings booking JOIN Courts court ON court.id=booking.courtId WHERE booking.organizationId<>court.organizationId OR booking.clubId<>court.clubId`,
    `SELECT COUNT(*) AS count FROM BookingSeries series JOIN Courts court ON court.id=series.courtId WHERE series.organizationId<>court.organizationId OR series.clubId<>court.clubId`,
    `SELECT COUNT(*) AS count FROM Bookings booking JOIN Users client ON client.id=booking.userId WHERE booking.organizationId<>client.organizationId`,
    `SELECT COUNT(*) AS count FROM BookingSeries series JOIN Users client ON client.id=series.userId WHERE series.organizationId<>client.organizationId`,
    `SELECT COUNT(*) AS count FROM Bookings booking JOIN BookingSeries series ON series.id=booking.bookingSeriesId WHERE booking.organizationId<>series.organizationId OR booking.clubId<>series.clubId`,
    `SELECT COUNT(*) AS count FROM BookingParticipants item JOIN Bookings booking ON booking.id=item.bookingId JOIN Users client ON client.id=item.userId WHERE booking.organizationId<>client.organizationId`,
  ];
  for (const sql of relationChecks) {
    if (await count(queryInterface, sql)) {
      throw migrationError('Feature 5.5 relationship attribution validation failed');
    }
  }
}

function tracker() {
  return { columns: [], indexes: [], constraints: [], triggers: [], removedUniques: [] };
}

async function addIndexes(queryInterface, created) {
  for (const definition of INDEX_DEFINITIONS) {
    await queryInterface.addIndex(definition.table, definition.fields, {
      name: definition.name,
      unique: definition.unique,
    });
    created.push({ table: definition.table, name: definition.name });
  }
}

async function addForeignKeys(queryInterface, created) {
  for (const definition of FOREIGN_KEY_DEFINITIONS) {
    await queryInterface.addConstraint(definition.table, {
      fields: definition.fields,
      name: definition.name,
      onDelete: definition.onDelete,
      onUpdate: definition.onUpdate,
      references: {
        table: definition.referencedTable,
        fields: definition.referencedFields,
      },
      type: 'foreign key',
    });
    created.push({ table: definition.table, name: definition.name });
  }
}

async function addTriggers(queryInterface, created) {
  if (queryInterface.sequelize.getDialect() !== 'mysql') return;
  for (const definition of TRIGGER_DEFINITIONS) {
    await queryInterface.sequelize.query(
      `CREATE TRIGGER \`${definition.name}\` ${definition.timing} ${definition.event} ON \`${definition.table}\` FOR EACH ROW ${definition.body}`,
    );
    created.push(definition.name);
  }
}

async function removeGlobalUniques(queryInterface, removed) {
  for (const definition of GLOBAL_UNIQUES) {
    const names = await globalUniqueIndexes(queryInterface, definition);
    if (names.length === 0) throw migrationError(`Legacy unique ${definition.table}.${definition.field} is missing`);
    for (const name of names) {
      await queryInterface.removeIndex(definition.table, name);
      removed.push({ ...definition, name });
    }
  }
}

async function restoreGlobalUniques(queryInterface, definitions) {
  for (const definition of definitions) {
    const existing = await globalUniqueIndexes(queryInterface, definition);
    if (existing.length === 0) {
      await queryInterface.addIndex(definition.table, [definition.field], {
        name: definition.name || definition.fallbackName,
        unique: true,
      });
    }
  }
}

async function cleanupInvocation(queryInterface, created) {
  for (const name of [...created.triggers].reverse()) {
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS \`${name}\``);
  }
  for (const item of [...created.constraints].reverse()) {
    try { await queryInterface.removeConstraint(item.table, item.name); } catch (error) { if (!/unknown|does not exist/i.test(error.message)) throw error; }
  }
  for (const item of [...created.indexes].reverse()) {
    try { await queryInterface.removeIndex(item.table, item.name); } catch (error) { if (!/check that column\/key exists|does not exist/i.test(error.message)) throw error; }
  }
  await restoreGlobalUniques(queryInterface, created.removedUniques);
  for (const item of [...created.columns].reverse()) {
    const description = await queryInterface.describeTable(item.table);
    if (description[item.name]) await queryInterface.removeColumn(item.table, item.name);
  }
}

async function removeReadyArtifacts(queryInterface) {
  if (queryInterface.sequelize.getDialect() === 'mysql') {
    for (const definition of [...TRIGGER_DEFINITIONS].reverse()) {
      await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS \`${definition.name}\``);
    }
  }
  for (const definition of [...FOREIGN_KEY_DEFINITIONS].reverse()) {
    await queryInterface.removeConstraint(definition.table, definition.name);
  }
  for (const definition of [...INDEX_DEFINITIONS].reverse()) {
    await queryInterface.removeIndex(definition.table, definition.name);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const state = await classifySchema(queryInterface);
    if (state === 'ready') return;
    if (state === 'partial') {
      throw migrationError(
        'Feature 5.5 found a pre-existing partial or lookalike schema; no changes were applied',
        'TENANT_BOOKINGS_COURTS_PARTIAL_SCHEMA',
      );
    }

    const tenant = await getDefaultTenant(queryInterface);
    await assertLegacyGraph(queryInterface, tenant);
    const created = tracker();
    try {
      for (const definition of COLUMNS) {
        await queryInterface.addColumn(definition.table, definition.name, definition.kind === 'tenant'
          ? { allowNull: true, type: Sequelize.INTEGER }
          : { allowNull: true, type: Sequelize.STRING(64) });
        created.columns.push({ table: definition.table, name: definition.name });
      }
      forcedFailure('columns');

      for (const table of ROOT_TABLES) {
        await queryInterface.sequelize.query(
          `UPDATE ${table} SET organizationId=:organizationId, clubId=:clubId`,
          { replacements: tenant },
        );
      }
      await validateReadyData(queryInterface, tenant);
      forcedFailure('backfill');

      for (const table of ROOT_TABLES) {
        await queryInterface.changeColumn(table, 'organizationId', {
          allowNull: false,
          type: Sequelize.INTEGER,
        });
        await queryInterface.changeColumn(table, 'clubId', {
          allowNull: false,
          type: Sequelize.INTEGER,
        });
      }
      forcedFailure('not-null');

      await addIndexes(queryInterface, created.indexes);
      forcedFailure('indexes');
      await addForeignKeys(queryInterface, created.constraints);
      forcedFailure('constraints');
      await addTriggers(queryInterface, created.triggers);
      forcedFailure('triggers');
      await removeGlobalUniques(queryInterface, created.removedUniques);
      forcedFailure('legacy-uniques');
      await validateReadyData(queryInterface, tenant);
    } catch (error) {
      await cleanupInvocation(queryInterface, created);
      throw error;
    }
  },

  async down(queryInterface) {
    const state = await classifySchema(queryInterface);
    if (state === 'legacy') return;
    if (state !== 'ready') {
      throw migrationError(
        'Feature 5.5 rollback refuses a partial schema; no changes were applied',
        'TENANT_BOOKINGS_COURTS_PARTIAL_SCHEMA',
      );
    }
    const tenant = await getDefaultTenant(queryInterface);
    await validateReadyData(queryInterface, tenant);
    const later = await queryRows(
      queryInterface,
      'SELECT name FROM SequelizeMeta WHERE name > :name ORDER BY name',
      { name: MIGRATION_NAME },
    );
    if (later.length > 0) throw migrationError('Feature 5.5 rollback refuses later migrations');
    if (queryInterface.sequelize.getDialect() === 'mysql') {
      const external = await queryRows(queryInterface,
        `SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
          WHERE CONSTRAINT_SCHEMA=DATABASE()
            AND REFERENCED_TABLE_NAME IN ('Courts','BookingSeries','Bookings')
            AND REFERENCED_COLUMN_NAME IN ('organizationId','clubId')
            AND CONSTRAINT_NAME NOT LIKE 'fk\\_mt\\_booking%' ESCAPE '\\\\'`);
      if (external.length) throw migrationError('Feature 5.5 rollback refuses external tenant references');
    }

    await removeReadyArtifacts(queryInterface);
    await restoreGlobalUniques(queryInterface, GLOBAL_UNIQUES);
    for (const definition of [...COLUMNS].reverse()) {
      await queryInterface.removeColumn(definition.table, definition.name);
    }
  },

  __testing: {
    FOREIGN_KEY_DEFINITIONS,
    INDEX_DEFINITIONS,
    classifySchema,
    columnsReady,
    foreignKeysReady,
    indexesReady,
    normalizeSql,
    readInventory,
    triggersReady,
    triggerDefinitions,
  },
};
