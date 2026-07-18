'use strict';

const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../src/tenant-foundation/constants');

const COLUMNS = Object.freeze([
  { column: 'organizationId', table: 'EvotorSaleSettings' },
  { column: 'clubId', table: 'EvotorSaleSettings' },
  { column: 'organizationId', table: 'PendingSales' },
  { column: 'clubId', table: 'PendingSales' },
  { column: 'organizationId', table: 'PendingSaleHistories' },
  { column: 'clubId', table: 'PendingSaleHistories' },
  { column: 'organizationId', table: 'SubscriptionTypes' },
  { column: 'organizationId', table: 'ClientSubscriptions' },
  { column: 'clubId', table: 'ClientSubscriptions' },
  { column: 'organizationId', table: 'ClientSubscriptionRedemptions' },
  { column: 'clubId', table: 'ClientSubscriptionRedemptions' },
  { column: 'organizationId', table: 'Certificates' },
  { column: 'clubId', table: 'Certificates' },
  { column: 'organizationId', table: 'CertificateRedemptions' },
  { column: 'clubId', table: 'CertificateRedemptions' },
  { column: 'organizationId', table: 'CorporateClients' },
  { column: 'organizationId', table: 'CorporateLedgerEntries' },
  { column: 'clubId', table: 'CorporateLedgerEntries' },
  { column: 'organizationId', nullable: true, table: 'Finances' },
  { column: 'clubId', nullable: true, table: 'Finances' },
]);

const FOREIGN_KEYS = Object.freeze(Object.fromEntries(COLUMNS.map((item) => {
  const prefix = item.table
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();
  const suffix = item.column === 'clubId' ? 'club' : 'organization';
  return [`${prefix}_${suffix}_fk`, {
    column: item.column,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    referencedColumn: 'id',
    referencedTable: item.column === 'clubId' ? 'Clubs' : 'Organizations',
    table: item.table,
  }];
})));

const INDEXES = Object.freeze({
  evotor_sale_settings_club_item_name_unique: {
    columns: ['clubId', 'itemName'], table: 'EvotorSaleSettings', unique: true,
  },
  pending_sales_club_status_created_idx: {
    columns: ['clubId', 'status', 'createdAt'], table: 'PendingSales', unique: false,
  },
  pending_sale_histories_club_sale_created_idx: {
    columns: ['clubId', 'pendingSaleId', 'createdAt'],
    table: 'PendingSaleHistories',
    unique: false,
  },
  subscription_types_org_name_unique: {
    columns: ['organizationId', 'name'], table: 'SubscriptionTypes', unique: true,
  },
  client_subscriptions_club_client_status_expires_idx: {
    columns: ['clubId', 'clientId', 'status', 'expiresAt'],
    table: 'ClientSubscriptions',
    unique: false,
  },
  client_subscription_redemptions_club_subscription_redeemed_idx: {
    columns: ['clubId', 'clientSubscriptionId', 'redeemedAt'],
    table: 'ClientSubscriptionRedemptions',
    unique: false,
  },
  certificates_club_code_unique: {
    columns: ['clubId', 'code'], table: 'Certificates', unique: true,
  },
  certificates_club_client_status_expires_idx: {
    columns: ['clubId', 'clientId', 'status', 'expiresAt'],
    table: 'Certificates',
    unique: false,
  },
  certificate_redemptions_club_certificate_redeemed_idx: {
    columns: ['clubId', 'certificateId', 'redeemedAt'],
    table: 'CertificateRedemptions',
    unique: false,
  },
  corporate_clients_org_status_name_idx: {
    columns: ['organizationId', 'status', 'name'],
    table: 'CorporateClients',
    unique: false,
  },
  corporate_ledger_entries_club_client_status_date_idx: {
    columns: ['clubId', 'corporateClientId', 'status', 'date'],
    table: 'CorporateLedgerEntries',
    unique: false,
  },
  finances_club_date_type_idx: {
    columns: ['clubId', 'date', 'type'], table: 'Finances', unique: false,
  },
});

const LEGACY_UNIQUES = Object.freeze([
  { columns: ['itemName'], name: 'itemName', table: 'EvotorSaleSettings' },
  {
    columns: ['name'],
    name: 'subscription_types_name_unique',
    table: 'SubscriptionTypes',
  },
  { columns: ['code'], name: 'code', table: 'Certificates' },
  {
    columns: ['code'],
    name: 'certificates_code_unique',
    table: 'Certificates',
  },
]);

function organizationBody(label, isUpdate, extra = '') {
  return `BEGIN
    IF NOT EXISTS (SELECT 1 FROM Organizations o WHERE o.id=NEW.organizationId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='${label} organization is invalid';
    END IF;
    ${isUpdate ? `IF NOT (OLD.organizationId <=> NEW.organizationId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='${label} organizationId is immutable';
    END IF;` : ''}
    ${extra}
  END`;
}

function clubBody(label, isUpdate, extra = '') {
  return `BEGIN
    DECLARE v_org INT;
    SELECT organizationId INTO v_org FROM Clubs WHERE id=NEW.clubId;
    IF v_org IS NULL OR NOT (v_org <=> NEW.organizationId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='${label} club organization mismatch';
    END IF;
    ${isUpdate ? `IF NOT (OLD.organizationId <=> NEW.organizationId) OR
      NOT (OLD.clubId <=> NEW.clubId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='${label} tenant attribution is immutable';
    END IF;` : ''}
    ${extra}
  END`;
}

function financeBody(isUpdate) {
  return `BEGIN
    DECLARE v_org INT;
    IF (NEW.organizationId IS NULL AND NEW.clubId IS NOT NULL) OR
       (NEW.organizationId IS NOT NULL AND NEW.clubId IS NULL) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Finance tenant attribution is incomplete';
    END IF;
    IF NEW.clubId IS NOT NULL THEN
      SELECT organizationId INTO v_org FROM Clubs WHERE id=NEW.clubId;
      IF v_org IS NULL OR NOT (v_org <=> NEW.organizationId) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Finance club organization mismatch';
      END IF;
    END IF;
    ${isUpdate ? `IF NOT (OLD.organizationId <=> NEW.organizationId) OR
      NOT (OLD.clubId <=> NEW.clubId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Finance tenant attribution is immutable';
    END IF;` : ''}
  END`;
}

const PENDING_SALE_RELATIONS = `
    IF NOT EXISTS (SELECT 1 FROM Receipts r WHERE r.id=NEW.receiptId
      AND r.organizationId=NEW.organizationId AND r.clubId=NEW.clubId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PendingSale receipt tenant mismatch';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM ReceiptItems i WHERE i.id=NEW.receiptItemId
      AND i.receiptId=NEW.receiptId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PendingSale receipt item mismatch';
    END IF;
    IF NEW.saleSettingId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM EvotorSaleSettings s WHERE s.id=NEW.saleSettingId
        AND s.organizationId=NEW.organizationId AND s.clubId=NEW.clubId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PendingSale sale setting tenant mismatch';
    END IF;
    IF NEW.clientId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM Users u WHERE u.id=NEW.clientId
        AND u.organizationId=NEW.organizationId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PendingSale client organization mismatch';
    END IF;`;

const CLIENT_SUBSCRIPTION_RELATIONS = `
    IF NOT EXISTS (SELECT 1 FROM Users u WHERE u.id=NEW.clientId
      AND u.organizationId=NEW.organizationId) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ClientSubscription client organization mismatch';
    END IF;
    IF NEW.subscriptionTypeId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM SubscriptionTypes t WHERE t.id=NEW.subscriptionTypeId
        AND t.organizationId=NEW.organizationId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ClientSubscription type organization mismatch';
    END IF;
    IF NEW.pendingSaleId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM PendingSales p WHERE p.id=NEW.pendingSaleId
        AND p.organizationId=NEW.organizationId AND p.clubId=NEW.clubId
        AND p.clientId=NEW.clientId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ClientSubscription pending sale tenant mismatch';
    END IF;
    IF NEW.sourceReceiptId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM Receipts r WHERE r.id=NEW.sourceReceiptId
        AND r.organizationId=NEW.organizationId AND r.clubId=NEW.clubId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ClientSubscription receipt tenant mismatch';
    END IF;
    IF NEW.sourceReceiptItemId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM ReceiptItems i JOIN Receipts r ON r.id=i.receiptId
      WHERE i.id=NEW.sourceReceiptItemId
        AND r.organizationId=NEW.organizationId AND r.clubId=NEW.clubId
        AND (NEW.sourceReceiptId IS NULL OR r.id=NEW.sourceReceiptId)
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='ClientSubscription receipt item tenant mismatch';
    END IF;`;

const CERTIFICATE_RELATIONS = CLIENT_SUBSCRIPTION_RELATIONS
  .replaceAll('ClientSubscription', 'Certificate')
  .replace(/IF NEW\.subscriptionTypeId[\s\S]*?END IF;\n    /, '')
  .replace('SELECT 1 FROM PendingSales p WHERE p.id=NEW.pendingSaleId',
    'SELECT 1 FROM PendingSales p WHERE p.id=NEW.pendingSaleId');

function childRelations(parentTable, parentField, label) {
  return `IF NOT EXISTS (
      SELECT 1 FROM ${parentTable} p WHERE p.id=NEW.${parentField}
        AND p.organizationId=NEW.organizationId AND p.clubId=NEW.clubId
        AND p.clientId=NEW.clientId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='${label} parent tenant mismatch';
    END IF;`;
}

const TRIGGERS = {};
function addTriggerPair(prefix, table, bodyFactory) {
  TRIGGERS[`${prefix}_tenant_bi`] = {
    body: bodyFactory(false), event: 'INSERT', table,
  };
  TRIGGERS[`${prefix}_tenant_bu`] = {
    body: bodyFactory(true), event: 'UPDATE', table,
  };
}

addTriggerPair('evotor_sale_settings', 'EvotorSaleSettings', (isUpdate) =>
  clubBody('EvotorSaleSetting', isUpdate));
addTriggerPair('pending_sales', 'PendingSales', (isUpdate) =>
  clubBody('PendingSale', isUpdate, PENDING_SALE_RELATIONS));
addTriggerPair('pending_sale_histories', 'PendingSaleHistories', (isUpdate) =>
  clubBody('PendingSaleHistory', isUpdate, `IF NOT EXISTS (
      SELECT 1 FROM PendingSales p WHERE p.id=NEW.pendingSaleId
        AND p.organizationId=NEW.organizationId AND p.clubId=NEW.clubId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='PendingSaleHistory parent tenant mismatch';
    END IF;`));
addTriggerPair('subscription_types', 'SubscriptionTypes', (isUpdate) =>
  organizationBody('SubscriptionType', isUpdate));
addTriggerPair('client_subscriptions', 'ClientSubscriptions', (isUpdate) =>
  clubBody('ClientSubscription', isUpdate, CLIENT_SUBSCRIPTION_RELATIONS));
addTriggerPair(
  'client_subscription_redemptions',
  'ClientSubscriptionRedemptions',
  (isUpdate) => clubBody(
    'ClientSubscriptionRedemption',
    isUpdate,
    childRelations(
      'ClientSubscriptions',
      'clientSubscriptionId',
      'ClientSubscriptionRedemption',
    ),
  ),
);
addTriggerPair('certificates', 'Certificates', (isUpdate) =>
  clubBody('Certificate', isUpdate, CERTIFICATE_RELATIONS));
addTriggerPair(
  'certificate_redemptions',
  'CertificateRedemptions',
  (isUpdate) => clubBody(
    'CertificateRedemption',
    isUpdate,
    childRelations('Certificates', 'certificateId', 'CertificateRedemption'),
  ),
);
addTriggerPair('corporate_clients', 'CorporateClients', (isUpdate) =>
  organizationBody('CorporateClient', isUpdate));
addTriggerPair('corporate_ledger_entries', 'CorporateLedgerEntries', (isUpdate) =>
  clubBody('CorporateLedgerEntry', isUpdate, `IF NOT EXISTS (
      SELECT 1 FROM CorporateClients c WHERE c.id=NEW.corporateClientId
        AND c.organizationId=NEW.organizationId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CorporateLedgerEntry client organization mismatch';
    END IF;
    IF NEW.financeId IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM Finances f WHERE f.id=NEW.financeId
        AND f.organizationId=NEW.organizationId AND f.clubId=NEW.clubId
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='CorporateLedgerEntry finance tenant mismatch';
    END IF;`));
addTriggerPair('finances', 'Finances', financeBody);
Object.freeze(TRIGGERS);

function migrationError(
  message,
  code = 'TENANT_CLIENT_MONEY_MIGRATION_INVALID',
) {
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
    const marker = `__client_money_literal_${literals.length}__`;
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
    .replace(/__client_money_literal_(\d+)__/g,
      (_marker, index) => literals[Number(index)]);
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
    SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,COLUMN_TYPE,IS_NULLABLE,
      COLUMN_DEFAULT,EXTRA,CHARACTER_SET_NAME,COLLATION_NAME,COLUMN_COMMENT,
      GENERATION_EXPRESSION
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:table AND COLUMN_NAME=:column
  `, { column, table });
  return rows[0] || null;
}

async function getIndex(queryInterface, name) {
  return selectRows(queryInterface, `
    SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,
      SUB_PART,COLLATION,INDEX_TYPE
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND INDEX_NAME=:name
    ORDER BY TABLE_NAME,SEQ_IN_INDEX
  `, { name });
}

async function getForeignKey(queryInterface, name) {
  const rows = await selectRows(queryInterface, `
    SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,
      k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,
      r.UPDATE_RULE,r.DELETE_RULE
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
    JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
      ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA
     AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
    WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.CONSTRAINT_NAME=:name
  `, { name });
  return rows[0] || null;
}

async function getTrigger(queryInterface, name) {
  const rows = await selectRows(queryInterface, `
    SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,EVENT_MANIPULATION,
      ACTION_TIMING,ACTION_STATEMENT
    FROM INFORMATION_SCHEMA.TRIGGERS
    WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=:name
  `, { name });
  return rows[0] || null;
}

function columnIsCanonical(row, expected) {
  return Boolean(
    row &&
      String(rowValue(row, 'DATA_TYPE')).toLowerCase() === 'int' &&
      /^int(?:\(\d+\))?$/.test(
        String(rowValue(row, 'COLUMN_TYPE')).toLowerCase(),
      ) &&
      rowValue(row, 'IS_NULLABLE') === (expected.nullable ? 'YES' : 'NO') &&
      (
        rowValue(row, 'COLUMN_DEFAULT') === null ||
        (
          expected.nullable &&
          String(rowValue(row, 'COLUMN_DEFAULT')).toUpperCase() === 'NULL'
        )
      ) &&
      String(rowValue(row, 'EXTRA') || '') === '' &&
      rowValue(row, 'CHARACTER_SET_NAME') === null &&
      rowValue(row, 'COLLATION_NAME') === null &&
      String(rowValue(row, 'COLUMN_COMMENT') || '') === '' &&
      String(rowValue(row, 'GENERATION_EXPRESSION') || '') === '',
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
      normalizeSql(rowValue(row, 'ACTION_STATEMENT')) ===
        normalizeSql(expected.body),
  );
}

function artifactSignature(kind, rows) {
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
    return (await getIndex(queryInterface, item.name))
      .filter((row) => sameIdentifier(rowValue(row, 'TABLE_NAME'), item.table));
  }
  if (kind === 'foreignKey') {
    const row = await getForeignKey(queryInterface, item.name);
    return row && sameIdentifier(rowValue(row, 'TABLE_NAME'), item.table)
      ? [row]
      : [];
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
  if (rows.length === 0) {
    throw migrationError(`Cannot inventory ${kind} ${item.table}.${item.name}`);
  }
  created[kind].push({
    ...item,
    signature: artifactSignature(kind, rows),
  });
}

async function refresh(queryInterface, created, kind, item) {
  const tracked = created[kind].find((candidate) =>
    candidate.table === item.table && candidate.name === item.name);
  if (!tracked) throw migrationError(`Lost tracked ${kind} ${item.name}`);
  const rows = await readArtifact(queryInterface, kind, item);
  tracked.signature = artifactSignature(kind, rows);
}

async function classifyState(queryInterface) {
  const columns = await Promise.all(COLUMNS.map((item) =>
    getColumn(queryInterface, item.table, item.column)));
  const indexes = await Promise.all(Object.entries(INDEXES).map(([name, item]) =>
    readArtifact(queryInterface, 'index', { name, table: item.table })));
  const foreignKeys = await Promise.all(Object.keys(FOREIGN_KEYS).map((name) =>
    getForeignKey(queryInterface, name)));
  const triggers = await Promise.all(Object.keys(TRIGGERS).map((name) =>
    getTrigger(queryInterface, name)));
  const legacyUniques = await Promise.all(LEGACY_UNIQUES.map((item) =>
    readArtifact(queryInterface, 'index', item)));
  const anyReserved = columns.some(Boolean) ||
    indexes.some((rows) => rows.length > 0) || foreignKeys.some(Boolean) ||
    triggers.some(Boolean);

  if (!anyReserved) {
    const reasons = LEGACY_UNIQUES.flatMap((item, index) =>
      indexIsCanonical(legacyUniques[index], {
        columns: item.columns,
        table: item.table,
        unique: true,
      }) ? [] : [`legacy unique ${item.table}.${item.name} is not canonical`]);
    return { reasons, state: reasons.length === 0 ? 'legacy' : 'partial' };
  }

  const reasons = [];
  COLUMNS.forEach((item, index) => {
    if (!columnIsCanonical(columns[index], item)) {
      reasons.push(`column ${item.table}.${item.column} is not canonical`);
    }
  });
  Object.entries(INDEXES).forEach(([name, expected], index) => {
    if (!indexIsCanonical(indexes[index], expected)) {
      reasons.push(`index ${name} is not canonical`);
    }
  });
  Object.entries(FOREIGN_KEYS).forEach(([name, expected], index) => {
    if (!foreignKeyIsCanonical(foreignKeys[index], expected)) {
      reasons.push(`foreign key ${name} is not canonical`);
    }
  });
  Object.entries(TRIGGERS).forEach(([name, expected], index) => {
    if (!triggerIsCanonical(triggers[index], expected)) {
      reasons.push(`trigger ${name} is not canonical`);
    }
  });
  LEGACY_UNIQUES.forEach((item, index) => {
    if (indexIsCanonical(legacyUniques[index], {
      columns: item.columns,
      table: item.table,
      unique: true,
    })) {
      reasons.push(`legacy global unique ${item.table}.${item.name} still exists`);
    }
  });
  return { reasons, state: reasons.length === 0 ? 'ready' : 'partial' };
}

async function getDefaultTenant(queryInterface) {
  const rows = await selectRows(queryInterface, `
    SELECT o.id AS organizationId,c.id AS clubId
    FROM Organizations o JOIN Clubs c ON c.organizationId=o.id
    WHERE o.slug=:organizationSlug AND c.slug=:clubSlug
    ORDER BY o.id,c.id
  `, {
    clubSlug: DEFAULT_CLUB_SLUG,
    organizationSlug: DEFAULT_ORGANIZATION_SLUG,
  });
  if (rows.length !== 1) {
    throw migrationError('Exact default Organization and Club are required');
  }
  return {
    clubId: Number(rowValue(rows[0], 'clubId')),
    organizationId: Number(rowValue(rows[0], 'organizationId')),
  };
}

async function assertLegacyDataCompatible(queryInterface, tenant) {
  const probes = [
    ['PendingSales receipts', `SELECT COUNT(*) count FROM PendingSales p
      LEFT JOIN Receipts r ON r.id=p.receiptId
      WHERE r.id IS NULL OR r.organizationId IS NULL OR r.clubId IS NULL
        OR r.organizationId<>:organizationId OR r.clubId<>:clubId`],
    ['PendingSales receipt items', `SELECT COUNT(*) count FROM PendingSales p
      LEFT JOIN ReceiptItems i ON i.id=p.receiptItemId AND i.receiptId=p.receiptId
      WHERE i.id IS NULL`],
    ['PendingSales sale settings', `SELECT COUNT(*) count FROM PendingSales p
      LEFT JOIN EvotorSaleSettings s ON s.id=p.saleSettingId
      WHERE p.saleSettingId IS NOT NULL AND s.id IS NULL`],
    ['PendingSales clients', `SELECT COUNT(*) count FROM PendingSales p
      LEFT JOIN Users u ON u.id=p.clientId
      WHERE p.clientId IS NOT NULL
        AND (u.id IS NULL OR u.organizationId<>:organizationId)`],
    ['PendingSaleHistories parents', `SELECT COUNT(*) count FROM PendingSaleHistories h
      LEFT JOIN PendingSales p ON p.id=h.pendingSaleId WHERE p.id IS NULL`],
    ['ClientSubscriptions clients', `SELECT COUNT(*) count FROM ClientSubscriptions s
      LEFT JOIN Users u ON u.id=s.clientId
      WHERE u.id IS NULL OR u.organizationId<>:organizationId`],
    ['ClientSubscriptions types', `SELECT COUNT(*) count FROM ClientSubscriptions s
      LEFT JOIN SubscriptionTypes t ON t.id=s.subscriptionTypeId
      WHERE s.subscriptionTypeId IS NOT NULL AND t.id IS NULL`],
    ['ClientSubscriptions pending sales', `SELECT COUNT(*) count FROM ClientSubscriptions s
      LEFT JOIN PendingSales p ON p.id=s.pendingSaleId
      WHERE s.pendingSaleId IS NOT NULL
        AND (p.id IS NULL OR NOT (p.clientId <=> s.clientId))`],
    ['ClientSubscriptions source receipts', `SELECT COUNT(*) count FROM ClientSubscriptions s
      LEFT JOIN Receipts r ON r.id=s.sourceReceiptId
      WHERE s.sourceReceiptId IS NOT NULL
        AND (r.id IS NULL OR r.organizationId IS NULL OR r.clubId IS NULL
          OR r.organizationId<>:organizationId OR r.clubId<>:clubId)`],
    ['ClientSubscriptions source receipt items', `SELECT COUNT(*) count
      FROM ClientSubscriptions s LEFT JOIN ReceiptItems i ON i.id=s.sourceReceiptItemId
      LEFT JOIN Receipts r ON r.id=i.receiptId
      WHERE s.sourceReceiptItemId IS NOT NULL AND (
        i.id IS NULL OR r.id IS NULL OR r.organizationId IS NULL OR r.clubId IS NULL
        OR r.organizationId<>:organizationId OR r.clubId<>:clubId
        OR (s.sourceReceiptId IS NOT NULL AND r.id<>s.sourceReceiptId)
      )`],
    ['ClientSubscriptionRedemptions parents', `SELECT COUNT(*) count
      FROM ClientSubscriptionRedemptions r
      LEFT JOIN ClientSubscriptions s ON s.id=r.clientSubscriptionId
      WHERE s.id IS NULL OR NOT (s.clientId <=> r.clientId)`],
    ['Certificates clients', `SELECT COUNT(*) count FROM Certificates c
      LEFT JOIN Users u ON u.id=c.clientId
      WHERE u.id IS NULL OR u.organizationId<>:organizationId`],
    ['Certificates pending sales', `SELECT COUNT(*) count FROM Certificates c
      LEFT JOIN PendingSales p ON p.id=c.pendingSaleId
      WHERE c.pendingSaleId IS NOT NULL
        AND (p.id IS NULL OR NOT (p.clientId <=> c.clientId))`],
    ['Certificates source receipts', `SELECT COUNT(*) count FROM Certificates c
      LEFT JOIN Receipts r ON r.id=c.sourceReceiptId
      WHERE c.sourceReceiptId IS NOT NULL
        AND (r.id IS NULL OR r.organizationId IS NULL OR r.clubId IS NULL
          OR r.organizationId<>:organizationId OR r.clubId<>:clubId)`],
    ['Certificates source receipt items', `SELECT COUNT(*) count
      FROM Certificates c LEFT JOIN ReceiptItems i ON i.id=c.sourceReceiptItemId
      LEFT JOIN Receipts r ON r.id=i.receiptId
      WHERE c.sourceReceiptItemId IS NOT NULL AND (
        i.id IS NULL OR r.id IS NULL OR r.organizationId IS NULL OR r.clubId IS NULL
        OR r.organizationId<>:organizationId OR r.clubId<>:clubId
        OR (c.sourceReceiptId IS NOT NULL AND r.id<>c.sourceReceiptId)
      )`],
    ['CertificateRedemptions parents', `SELECT COUNT(*) count
      FROM CertificateRedemptions r
      LEFT JOIN Certificates c ON c.id=r.certificateId
      WHERE c.id IS NULL OR NOT (c.clientId <=> r.clientId)`],
    ['CorporateLedgerEntries clients', `SELECT COUNT(*) count
      FROM CorporateLedgerEntries l LEFT JOIN CorporateClients c
        ON c.id=l.corporateClientId WHERE c.id IS NULL`],
    ['CorporateLedgerEntries finances', `SELECT COUNT(*) count
      FROM CorporateLedgerEntries l LEFT JOIN Finances f ON f.id=l.financeId
      WHERE l.financeId IS NOT NULL AND f.id IS NULL`],
  ];
  for (const [label, sql] of probes) {
    const rows = await selectRows(queryInterface, sql, tenant);
    if (Number(rowValue(rows[0], 'count') || 0) > 0) {
      throw migrationError(`${label} contains incompatible legacy provenance`);
    }
  }
}

function maybeFail(step) {
  if (process.env.TENANT_CLIENT_MONEY_MIGRATION_FAIL_STEP === step) {
    throw migrationError(
      `Forced client money migration failure at ${step}`,
      'TENANT_CLIENT_MONEY_MIGRATION_FORCED_FAILURE',
    );
  }
}

async function createTrigger(queryInterface, name, expected) {
  await queryInterface.sequelize.query(
    `CREATE TRIGGER \`${name}\` BEFORE ${expected.event} ON ` +
      `\`${expected.table}\` FOR EACH ROW ${expected.body}`,
  );
}

async function restoreLegacyUnique(queryInterface, item) {
  await queryInterface.addIndex(item.table, item.columns, {
    name: item.name,
    unique: true,
  });
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
    if (
      rows.length === 0 ||
      artifactSignature(kind, rows) !== item.signature
    ) {
      throw migrationError(
        `Client money cleanup ownership lost for ${kind} ${item.table}.${item.name}`,
        'TENANT_CLIENT_MONEY_CLEANUP_OWNERSHIP_LOST',
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
  for (const item of [...created.removedLegacyUnique].reverse()) {
    const collision = await readArtifact(queryInterface, 'index', item);
    if (collision.length > 0) {
      throw migrationError(
        `Cannot restore legacy unique ${item.table}.${item.name}`,
        'TENANT_CLIENT_MONEY_CLEANUP_OWNERSHIP_LOST',
      );
    }
    await restoreLegacyUnique(queryInterface, item);
    const restored = await readArtifact(queryInterface, 'index', item);
    if (artifactSignature('index', restored) !== item.signature) {
      throw migrationError(
        `Legacy unique restoration changed ${item.table}.${item.name}`,
        'TENANT_CLIENT_MONEY_CLEANUP_OWNERSHIP_LOST',
      );
    }
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
      throw migrationError(
        `Client money migration refused partial schema: ${classification.reasons.join('; ')}`,
      );
    }
    const tenant = await getDefaultTenant(queryInterface);
    await assertLegacyDataCompatible(queryInterface, tenant);
    const created = {
      column: [],
      foreignKey: [],
      index: [],
      removedLegacyUnique: [],
      trigger: [],
    };
    try {
      for (const item of COLUMNS) {
        await queryInterface.addColumn(item.table, item.column, {
          allowNull: true,
          type: Sequelize.INTEGER,
        });
        await track(queryInterface, created, 'column', {
          name: item.column,
          table: item.table,
        });
      }
      maybeFail('after_columns');

      for (const item of COLUMNS) {
        await queryInterface.sequelize.query(
          `UPDATE \`${item.table}\` SET \`${item.column}\`=:` +
            `${item.column} WHERE \`${item.column}\` IS NULL`,
          { replacements: tenant },
        );
        await queryInterface.changeColumn(item.table, item.column, {
          allowNull: Boolean(item.nullable),
          type: Sequelize.INTEGER,
        });
        await refresh(queryInterface, created, 'column', {
          name: item.column,
          table: item.table,
        });
      }
      maybeFail('after_backfill');

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
        await track(queryInterface, created, 'foreignKey', {
          name,
          table: expected.table,
        });
      }
      for (const [name, expected] of Object.entries(INDEXES)) {
        await queryInterface.addIndex(expected.table, expected.columns, {
          name,
          unique: expected.unique,
        });
        await track(queryInterface, created, 'index', {
          name,
          table: expected.table,
        });
      }
      maybeFail('after_constraints');

      for (const [name, expected] of Object.entries(TRIGGERS)) {
        await createTrigger(queryInterface, name, expected);
        await track(queryInterface, created, 'trigger', {
          name,
          table: expected.table,
        });
      }
      maybeFail('after_triggers');

      for (const item of LEGACY_UNIQUES) {
        const rows = await readArtifact(queryInterface, 'index', item);
        const tracked = {
          ...item,
          signature: artifactSignature('index', rows),
        };
        await queryInterface.removeIndex(item.table, item.name);
        created.removedLegacyUnique.push(tracked);
      }
      maybeFail('after_legacy_unique_drop');

      const ready = await classifyState(queryInterface);
      if (ready.state !== 'ready') {
        throw migrationError(
          `Client money migration did not reach ready state: ${ready.reasons.join('; ')}`,
        );
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
      throw migrationError(
        `Client money rollback refused partial schema: ${classification.reasons.join('; ')}`,
      );
    }
    const organizations = await selectRows(
      queryInterface,
      'SELECT id FROM Organizations ORDER BY id LIMIT 2',
    );
    if (organizations.length > 1) {
      throw migrationError(
        'Client money rollback refused while a second Organization exists',
        'TENANT_CLIENT_MONEY_ROLLBACK_SECOND_ORGANIZATION',
      );
    }
    const tenant = await getDefaultTenant(queryInterface);
    const nonDefault = await selectRows(queryInterface, `
      SELECT ${COLUMNS.map((item) => {
        const expected = item.column === 'clubId' ? 'clubId' : 'organizationId';
        return `(SELECT COUNT(*) FROM \`${item.table}\` WHERE ` +
          `\`${item.column}\`<>:${expected})`;
      }).join(' + ')} AS count
    `, tenant);
    if (Number(rowValue(nonDefault[0], 'count') || 0) > 0) {
      throw migrationError(
        'Client money rollback refused with non-default tenant data',
        'TENANT_CLIENT_MONEY_ROLLBACK_NON_DEFAULT_TENANT',
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
    for (const item of LEGACY_UNIQUES) {
      await restoreLegacyUnique(queryInterface, item);
    }
    for (const item of [...COLUMNS].reverse()) {
      await queryInterface.removeColumn(item.table, item.column);
    }
    const legacy = await classifyState(queryInterface);
    if (legacy.state !== 'legacy') {
      throw migrationError(
        `Client money rollback did not restore legacy state: ${legacy.reasons.join('; ')}`,
      );
    }
  },

  __testing: {
    COLUMNS,
    FOREIGN_KEYS,
    INDEXES,
    LEGACY_UNIQUES,
    TRIGGERS,
    artifactSignature,
    classifyState,
    cleanupInvocation,
    normalizeSql,
    readArtifact,
  },
};
