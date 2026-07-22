'use strict';

const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../src/tenant-foundation/constants');

const MIGRATION_NAME = '20260716180000-add-tenant-visits-scanner.js';
const TABLES = Object.freeze([
  'Visits',
  'ScannerEvents',
  'VisitCategoryAssignments',
]);
const CONSTRAINTS = Object.freeze({
  assignmentCategory: 'fk_visit_category_assignments_organization_category',
  assignmentVisit: 'fk_visit_category_assignments_tenant_visit',
  scannerClub: 'fk_scanner_events_organization_club',
  scannerOrganization: 'fk_scanner_events_organization',
  scannerUser: 'fk_scanner_events_organization_user',
  scannerVisit: 'fk_scanner_events_tenant_visit',
  visitClub: 'fk_visits_organization_club',
  visitDuplicate: 'fk_visits_tenant_duplicate',
  visitOrganization: 'fk_visits_organization',
  visitTenantId: 'uq_visits_tenant_id',
  visitUser: 'fk_visits_organization_user',
});
const INDEXES = Object.freeze({
  assignmentCategory: 'idx_visit_assignments_organization_category',
  assignmentVisit: 'idx_visit_assignments_tenant_visit',
  scannerClientEvent: 'uq_scanner_events_tenant_client_event_type',
  scannerCreated: 'idx_scanner_events_tenant_created',
  scannerQr: 'idx_scanner_events_tenant_qr_hash',
  scannerType: 'idx_scanner_events_tenant_type_created',
  visitClientEvent: 'uq_visits_tenant_client_event',
  visitDuplicate: 'idx_visits_tenant_duplicate',
  visitScanned: 'idx_visits_tenant_scanned',
  visitUserVisited: 'idx_visits_tenant_user_visited',
  visitVisited: 'idx_visits_tenant_visited',
});
const TRIGGERS = Object.freeze({
  assignment: 'trg_visit_assignments_tenant_immutable',
  scanner: 'trg_scanner_events_tenant_immutable',
  scannerInsert: 'trg_scanner_events_tenant_validate_insert',
  visit: 'trg_visits_tenant_immutable',
  visitInsert: 'trg_visits_tenant_validate_insert',
});
const LEGACY_INDEXES = Object.freeze({
  scannerClientEvent: 'scanner_events_client_event_type_unique',
  visitClientEvent: 'visits_client_event_id_unique',
});

function migrationError(message) {
  return new Error(`Visit/scanner tenant migration refused: ${message}`);
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

async function getColumns(queryInterface) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (:tableNames)
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    { replacements: { tableNames: TABLES } },
  );
  return rows;
}

async function getSchemaState(queryInterface) {
  const columns = await getColumns(queryInterface);
  const attributed = TABLES.filter((tableName) =>
    ['organizationId', 'clubId'].every((columnName) =>
      columns.some(
        (row) => row.tableName === tableName && row.columnName === columnName,
      ),
    ),
  );
  const anyAttributed = TABLES.some((tableName) =>
    ['organizationId', 'clubId'].some((columnName) =>
      columns.some(
        (row) => row.tableName === tableName && row.columnName === columnName,
      ),
    ),
  );
  if (!anyAttributed) return { attributed, mode: 'legacy' };
  if (attributed.length !== TABLES.length) return { attributed, mode: 'partial' };

  const requiredConstraints = [
    ['Visits', CONSTRAINTS.visitTenantId],
    ['Visits', CONSTRAINTS.visitOrganization],
    ['Visits', CONSTRAINTS.visitClub],
    ['Visits', CONSTRAINTS.visitUser],
    ['Visits', CONSTRAINTS.visitDuplicate],
    ['ScannerEvents', CONSTRAINTS.scannerOrganization],
    ['ScannerEvents', CONSTRAINTS.scannerClub],
    ['ScannerEvents', CONSTRAINTS.scannerVisit],
    ['ScannerEvents', CONSTRAINTS.scannerUser],
    ['VisitCategoryAssignments', CONSTRAINTS.assignmentVisit],
    ['VisitCategoryAssignments', CONSTRAINTS.assignmentCategory],
  ];
  const requiredIndexes = [
    ...Object.values(INDEXES).map((name) => [
      name.startsWith('idx_visit_assignments')
        ? 'VisitCategoryAssignments'
        : name.startsWith('idx_scanner') || name.startsWith('uq_scanner')
          ? 'ScannerEvents'
          : 'Visits',
      name,
    ]),
  ];
  const [constraintStates, indexStates, [triggerRows]] = await Promise.all([
    Promise.all(requiredConstraints.map(([tableName, constraintName]) =>
      constraintExists(queryInterface, tableName, constraintName))),
    Promise.all(requiredIndexes.map(([tableName, indexName]) =>
      indexExists(queryInterface, tableName, indexName))),
    queryInterface.sequelize.query(
      `SELECT TRIGGER_NAME AS triggerName
         FROM INFORMATION_SCHEMA.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE()
          AND TRIGGER_NAME IN (:triggerNames)`,
      { replacements: { triggerNames: Object.values(TRIGGERS) } },
    ),
  ]);
  const triggerNames = new Set(triggerRows.map((row) => row.triggerName));
  const isReady = constraintStates.every(Boolean)
    && indexStates.every(Boolean)
    && Object.values(TRIGGERS).every((name) => triggerNames.has(name));
  return { attributed, mode: isReady ? 'ready' : 'partial' };
}

async function getExactDefaultTenant(queryInterface, transaction) {
  const [[organizations], [clubs]] = await Promise.all([
    queryInterface.sequelize.query(
      'SELECT id, slug, status FROM Organizations ORDER BY id FOR UPDATE',
      { transaction },
    ),
    queryInterface.sequelize.query(
      'SELECT id, organizationId, slug, status FROM Clubs ORDER BY id FOR UPDATE',
      { transaction },
    ),
  ]);
  if (
    organizations.length !== 1 ||
    organizations[0].slug !== DEFAULT_ORGANIZATION_SLUG ||
    organizations[0].status !== 'active'
  ) {
    throw migrationError('exactly one active default Organization is required');
  }
  if (
    clubs.length !== 1 ||
    clubs[0].slug !== DEFAULT_CLUB_SLUG ||
    clubs[0].status !== 'active' ||
    Number(clubs[0].organizationId) !== Number(organizations[0].id)
  ) {
    throw migrationError('exactly one active default Club is required');
  }
  return { club: clubs[0], organization: organizations[0] };
}

async function assertLegacyGraph(queryInterface, transaction) {
  const checks = [
    [
      `SELECT v.id FROM Visits v
       LEFT JOIN Users u ON u.id = v.userId
       WHERE u.id IS NULL LIMIT 1`,
      'Visit has a missing client',
    ],
    [
      `SELECT v.id FROM Visits v
       LEFT JOIN Visits parent ON parent.id = v.duplicateOfVisitId
       WHERE v.duplicateOfVisitId IS NOT NULL AND parent.id IS NULL LIMIT 1`,
      'Visit has a missing duplicate parent',
    ],
    [
      `SELECT event.id FROM ScannerEvents event
       LEFT JOIN Visits v ON v.id = event.visitId
       WHERE event.visitId IS NOT NULL AND v.id IS NULL LIMIT 1`,
      'ScannerEvent has a missing Visit',
    ],
    [
      `SELECT event.id FROM ScannerEvents event
       LEFT JOIN Users u ON u.id = event.userId
       WHERE event.userId IS NOT NULL AND u.id IS NULL LIMIT 1`,
      'ScannerEvent has a missing User',
    ],
    [
      `SELECT assignment.visitId FROM VisitCategoryAssignments assignment
       LEFT JOIN Visits v ON v.id = assignment.visitId
       LEFT JOIN VisitCategories category
         ON category.id = assignment.visitCategoryId
       WHERE v.id IS NULL OR category.id IS NULL LIMIT 1`,
      'VisitCategoryAssignment has a missing parent',
    ],
  ];
  for (const [sql, message] of checks) {
    const [rows] = await queryInterface.sequelize.query(sql, { transaction });
    if (rows.length > 0) throw migrationError(message);
  }
}

async function assertReadyGraph(
  queryInterface,
  { requireDefaultOnly = false } = {},
) {
  return queryInterface.sequelize.transaction(async (transaction) => {
    const tenant = requireDefaultOnly
      ? await getExactDefaultTenant(queryInterface, transaction)
      : null;
    const checks = [
      [
        `SELECT v.id FROM Visits v
         LEFT JOIN Clubs club
           ON club.organizationId = v.organizationId AND club.id = v.clubId
         LEFT JOIN Users u
           ON u.organizationId = v.organizationId AND u.id = v.userId
         LEFT JOIN Visits parent
           ON parent.organizationId = v.organizationId
          AND parent.clubId = v.clubId
          AND parent.id = v.duplicateOfVisitId
         WHERE v.organizationId IS NULL OR v.clubId IS NULL
            OR club.id IS NULL OR u.id IS NULL
            OR (v.duplicateOfVisitId IS NOT NULL AND parent.id IS NULL)
         LIMIT 1`,
        'Visit tenant graph is invalid',
      ],
      [
        `SELECT event.id FROM ScannerEvents event
         LEFT JOIN Clubs club
           ON club.organizationId = event.organizationId AND club.id = event.clubId
         LEFT JOIN Visits v
           ON v.organizationId = event.organizationId
          AND v.clubId = event.clubId
          AND v.id = event.visitId
         LEFT JOIN Users u
           ON u.organizationId = event.organizationId AND u.id = event.userId
         WHERE event.organizationId IS NULL OR event.clubId IS NULL
            OR club.id IS NULL
            OR (event.visitId IS NOT NULL AND v.id IS NULL)
            OR (event.userId IS NOT NULL AND u.id IS NULL)
         LIMIT 1`,
        'ScannerEvent tenant graph is invalid',
      ],
      [
        `SELECT assignment.visitId FROM VisitCategoryAssignments assignment
         LEFT JOIN Visits v
           ON v.organizationId = assignment.organizationId
          AND v.clubId = assignment.clubId
          AND v.id = assignment.visitId
         LEFT JOIN VisitCategories category
           ON category.organizationId = assignment.organizationId
          AND category.id = assignment.visitCategoryId
         WHERE assignment.organizationId IS NULL OR assignment.clubId IS NULL
            OR v.id IS NULL OR category.id IS NULL
         LIMIT 1`,
        'VisitCategoryAssignment tenant graph is invalid',
      ],
    ];
    if (tenant) {
      checks.unshift([
        `SELECT id FROM Visits
          WHERE organizationId <> :organizationId OR clubId <> :clubId
         UNION ALL
        SELECT id FROM ScannerEvents
          WHERE organizationId <> :organizationId OR clubId <> :clubId
         UNION ALL
        SELECT visitId AS id FROM VisitCategoryAssignments
          WHERE organizationId <> :organizationId OR clubId <> :clubId
         LIMIT 1`,
        'rollback found non-default tenant attribution',
      ]);
    }
    for (const [sql, message] of checks) {
      const [rows] = await queryInterface.sequelize.query(sql, {
        replacements: tenant
          ? {
              clubId: tenant.club.id,
              organizationId: tenant.organization.id,
            }
          : undefined,
        transaction,
      });
      if (rows.length > 0) throw migrationError(message);
    }
    return tenant;
  });
}

async function getForeignKeys(queryInterface, tableName, columns) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT DISTINCT CONSTRAINT_NAME AS constraintName
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = :tableName
        AND COLUMN_NAME IN (:columns)
        AND REFERENCED_TABLE_NAME IS NOT NULL`,
    { replacements: { columns, tableName } },
  );
  return rows.map((row) => row.constraintName);
}

async function dropForeignKeys(queryInterface, tableName, columns) {
  const constraints = await getForeignKeys(queryInterface, tableName, columns);
  for (const constraintName of constraints) {
    await queryInterface.removeConstraint(tableName, constraintName);
  }
}

async function getLegacySchemaSnapshot(queryInterface) {
  const targets = [
    ['Visits', ['duplicateOfVisitId', 'userId']],
    ['ScannerEvents', ['visitId', 'userId']],
    ['VisitCategoryAssignments', ['visitCategoryId', 'visitId']],
  ];
  const foreignKeys = [];
  for (const [tableName, columns] of targets) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT kcu.CONSTRAINT_NAME AS constraintName,
              kcu.COLUMN_NAME AS columnName,
              kcu.ORDINAL_POSITION AS ordinalPosition,
              kcu.REFERENCED_TABLE_NAME AS referencedTableName,
              kcu.REFERENCED_COLUMN_NAME AS referencedColumnName,
              rc.DELETE_RULE AS deleteRule,
              rc.UPDATE_RULE AS updateRule
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
         JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
           ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
          AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
          AND rc.TABLE_NAME = kcu.TABLE_NAME
        WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
          AND kcu.TABLE_NAME = :tableName
          AND kcu.CONSTRAINT_NAME IN (
            SELECT candidate.CONSTRAINT_NAME
              FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE candidate
             WHERE candidate.CONSTRAINT_SCHEMA = DATABASE()
               AND candidate.TABLE_NAME = :tableName
               AND candidate.COLUMN_NAME IN (:columns)
               AND candidate.REFERENCED_TABLE_NAME IS NOT NULL
          )
        ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
      { replacements: { columns, tableName } },
    );
    const grouped = new Map();
    for (const row of rows) {
      if (!grouped.has(row.constraintName)) {
        grouped.set(row.constraintName, {
          deleteRule: row.deleteRule,
          fields: [],
          name: row.constraintName,
          referencedFields: [],
          referencedTable: row.referencedTableName,
          tableName,
          updateRule: row.updateRule,
        });
      }
      const definition = grouped.get(row.constraintName);
      definition.fields.push(row.columnName);
      definition.referencedFields.push(row.referencedColumnName);
    }
    foreignKeys.push(...grouped.values());
  }

  const indexes = [];
  for (const [tableName, name] of [
    ['Visits', LEGACY_INDEXES.visitClientEvent],
    ['ScannerEvents', LEGACY_INDEXES.scannerClientEvent],
  ]) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT COLUMN_NAME AS columnName, NON_UNIQUE AS nonUnique
         FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = :tableName
          AND INDEX_NAME = :name
        ORDER BY SEQ_IN_INDEX`,
      { replacements: { name, tableName } },
    );
    if (rows.length > 0) {
      indexes.push({
        fields: rows.map((row) => row.columnName),
        name,
        tableName,
        unique: Number(rows[0].nonUnique) === 0,
      });
    }
  }

  return { foreignKeys, indexes };
}

function assertLegacySchemaSnapshot(snapshot) {
  const expectedForeignKeys = [
    ['Visits', 'userId', 'Users', 'id', 'CASCADE', 'CASCADE'],
    ['Visits', 'duplicateOfVisitId', 'Visits', 'id', 'SET NULL', 'CASCADE'],
    ['ScannerEvents', 'visitId', 'Visits', 'id', 'SET NULL', 'CASCADE'],
    ['ScannerEvents', 'userId', 'Users', 'id', 'SET NULL', 'CASCADE'],
    ['VisitCategoryAssignments', 'visitId', 'Visits', 'id', 'CASCADE', 'CASCADE'],
    ['VisitCategoryAssignments', 'visitCategoryId', 'VisitCategories', 'id', 'RESTRICT', 'CASCADE'],
  ];
  for (const [
    tableName,
    field,
    referencedTable,
    referencedField,
    deleteRule,
    updateRule,
  ] of expectedForeignKeys) {
    const matches = snapshot.foreignKeys.filter((foreignKey) =>
      foreignKey.tableName === tableName
      && foreignKey.fields.length === 1
      && foreignKey.fields[0] === field
      && foreignKey.referencedTable === referencedTable
      && foreignKey.referencedFields.length === 1
      && foreignKey.referencedFields[0] === referencedField
      && foreignKey.deleteRule === deleteRule
      && foreignKey.updateRule === updateRule);
    if (matches.length !== 1) {
      throw migrationError(
        `legacy foreign key ${tableName}.${field} is missing or ambiguous`,
      );
    }
  }
  const expectedIndexes = [
    ['Visits', LEGACY_INDEXES.visitClientEvent, ['clientEventId']],
    [
      'ScannerEvents',
      LEGACY_INDEXES.scannerClientEvent,
      ['clientEventId', 'eventType'],
    ],
  ];
  const validIndexes = expectedIndexes.every(([tableName, name, fields]) =>
    snapshot.indexes.some((index) =>
      index.tableName === tableName
      && index.name === name
      && index.unique
      && JSON.stringify(index.fields) === JSON.stringify(fields)));
  if (snapshot.indexes.length !== 2 || !validIndexes) {
    throw migrationError('legacy visit/scanner idempotency indexes are incomplete');
  }
}

async function assertCurrentArtifactNamesAbsent(queryInterface) {
  const [[constraints], [indexes], [triggers]] = await Promise.all([
    queryInterface.sequelize.query(
      `SELECT TABLE_NAME AS tableName,CONSTRAINT_NAME AS name
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA=DATABASE()
          AND CONSTRAINT_NAME IN (:names)`,
      { replacements: { names: Object.values(CONSTRAINTS) } },
    ),
    queryInterface.sequelize.query(
      `SELECT DISTINCT TABLE_NAME AS tableName,INDEX_NAME AS name
         FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA=DATABASE()
          AND INDEX_NAME IN (:names)`,
      { replacements: { names: Object.values(INDEXES) } },
    ),
    queryInterface.sequelize.query(
      `SELECT EVENT_OBJECT_TABLE AS tableName,TRIGGER_NAME AS name
         FROM INFORMATION_SCHEMA.TRIGGERS
        WHERE TRIGGER_SCHEMA=DATABASE()
          AND TRIGGER_NAME IN (:names)`,
      { replacements: { names: Object.values(TRIGGERS) } },
    ),
  ]);
  const collisions = [...constraints, ...indexes, ...triggers];
  if (collisions.length > 0) {
    throw migrationError(
      `legacy schema already contains reserved tenant artifacts: ${collisions
        .map((row) => `${row.tableName}.${row.name}`)
        .sort()
        .join(', ')}`,
    );
  }
}

async function dropLegacySchemaSnapshot(queryInterface, snapshot) {
  for (const foreignKey of snapshot.foreignKeys) {
    if (await constraintExists(
      queryInterface,
      foreignKey.tableName,
      foreignKey.name,
    )) {
      await queryInterface.removeConstraint(
        foreignKey.tableName,
        foreignKey.name,
      );
    }
  }
  for (const index of snapshot.indexes) {
    await removeIndexIfExists(queryInterface, index.tableName, index.name);
  }
}

async function restoreLegacySchemaSnapshot(queryInterface, snapshot) {
  for (const foreignKey of snapshot.foreignKeys) {
    if (!(await constraintExists(
      queryInterface,
      foreignKey.tableName,
      foreignKey.name,
    ))) {
      await queryInterface.addConstraint(foreignKey.tableName, {
        fields: foreignKey.fields,
        name: foreignKey.name,
        onDelete: foreignKey.deleteRule,
        onUpdate: foreignKey.updateRule,
        references: {
          fields: foreignKey.referencedFields,
          table: foreignKey.referencedTable,
        },
        type: 'foreign key',
      });
    }
  }
  for (const index of snapshot.indexes) {
    if (!(await indexExists(queryInterface, index.tableName, index.name))) {
      await queryInterface.addIndex(index.tableName, index.fields, {
        name: index.name,
        unique: index.unique,
      });
    }
  }
}

async function indexExists(queryInterface, tableName, indexName) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = :tableName
        AND INDEX_NAME = :indexName
      LIMIT 1`,
    { replacements: { indexName, tableName } },
  );
  return rows.length > 0;
}

async function removeIndexIfExists(queryInterface, tableName, indexName) {
  if (await indexExists(queryInterface, tableName, indexName)) {
    await queryInterface.removeIndex(tableName, indexName);
  }
}

async function constraintExists(queryInterface, tableName, constraintName) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = :tableName
        AND CONSTRAINT_NAME = :constraintName
      LIMIT 1`,
    { replacements: { constraintName, tableName } },
  );
  return rows.length > 0;
}

async function removeConstraintIfExists(queryInterface, tableName, constraintName) {
  if (await constraintExists(queryInterface, tableName, constraintName)) {
    await queryInterface.removeConstraint(tableName, constraintName);
  }
}

async function addImmutableTrigger(queryInterface, tableName, triggerName) {
  await queryInterface.sequelize.query(
    `DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName)}`,
  );
  await queryInterface.sequelize.query(
    `CREATE TRIGGER ${quoteIdentifier(triggerName)}
       BEFORE UPDATE ON ${quoteIdentifier(tableName)}
       FOR EACH ROW
       BEGIN
         IF NOT (OLD.organizationId <=> NEW.organizationId)
            OR NOT (OLD.clubId <=> NEW.clubId) THEN
           SIGNAL SQLSTATE '45000'
             SET MESSAGE_TEXT = 'tenant attribution is immutable';
         END IF;
       END`,
  );
}

async function addVisitTenantTriggers(queryInterface) {
  await queryInterface.sequelize.query(
    `DROP TRIGGER IF EXISTS ${quoteIdentifier(TRIGGERS.visit)}`,
  );
  await queryInterface.sequelize.query(
    `CREATE TRIGGER ${quoteIdentifier(TRIGGERS.visit)}
       BEFORE UPDATE ON Visits
       FOR EACH ROW
       BEGIN
         IF NOT (OLD.organizationId <=> NEW.organizationId)
            OR NOT (OLD.clubId <=> NEW.clubId) THEN
           SIGNAL SQLSTATE '45000'
             SET MESSAGE_TEXT = 'tenant attribution is immutable';
         END IF;
         IF NEW.duplicateOfVisitId IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM Visits parent
               WHERE parent.id = NEW.duplicateOfVisitId
                 AND parent.organizationId = NEW.organizationId
                 AND parent.clubId = NEW.clubId
            ) THEN
           SIGNAL SQLSTATE '45000'
             SET MESSAGE_TEXT = 'duplicate visit tenant mismatch';
         END IF;
       END`,
  );
  await queryInterface.sequelize.query(
    `DROP TRIGGER IF EXISTS ${quoteIdentifier(TRIGGERS.visitInsert)}`,
  );
  await queryInterface.sequelize.query(
    `CREATE TRIGGER ${quoteIdentifier(TRIGGERS.visitInsert)}
       BEFORE INSERT ON Visits
       FOR EACH ROW
       BEGIN
         IF NEW.duplicateOfVisitId IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM Visits parent
               WHERE parent.id = NEW.duplicateOfVisitId
                 AND parent.organizationId = NEW.organizationId
                 AND parent.clubId = NEW.clubId
            ) THEN
           SIGNAL SQLSTATE '45000'
             SET MESSAGE_TEXT = 'duplicate visit tenant mismatch';
         END IF;
       END`,
  );
}

async function addScannerTenantTriggers(queryInterface) {
  await queryInterface.sequelize.query(
    `DROP TRIGGER IF EXISTS ${quoteIdentifier(TRIGGERS.scanner)}`,
  );
  await queryInterface.sequelize.query(
    `CREATE TRIGGER ${quoteIdentifier(TRIGGERS.scanner)}
       BEFORE UPDATE ON ScannerEvents
       FOR EACH ROW
       BEGIN
         IF NOT (OLD.organizationId <=> NEW.organizationId)
            OR NOT (OLD.clubId <=> NEW.clubId) THEN
           SIGNAL SQLSTATE '45000'
             SET MESSAGE_TEXT = 'tenant attribution is immutable';
         END IF;
         IF NEW.visitId IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM Visits visit
               WHERE visit.id = NEW.visitId
                 AND visit.organizationId = NEW.organizationId
                 AND visit.clubId = NEW.clubId
            ) THEN
           SIGNAL SQLSTATE '45000'
             SET MESSAGE_TEXT = 'scanner visit tenant mismatch';
         END IF;
         IF NEW.userId IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM Users user
               WHERE user.id = NEW.userId
                 AND user.organizationId = NEW.organizationId
            ) THEN
           SIGNAL SQLSTATE '45000'
             SET MESSAGE_TEXT = 'scanner user tenant mismatch';
         END IF;
       END`,
  );
  await queryInterface.sequelize.query(
    `DROP TRIGGER IF EXISTS ${quoteIdentifier(TRIGGERS.scannerInsert)}`,
  );
  await queryInterface.sequelize.query(
    `CREATE TRIGGER ${quoteIdentifier(TRIGGERS.scannerInsert)}
       BEFORE INSERT ON ScannerEvents
       FOR EACH ROW
       BEGIN
         IF NEW.visitId IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM Visits visit
               WHERE visit.id = NEW.visitId
                 AND visit.organizationId = NEW.organizationId
                 AND visit.clubId = NEW.clubId
            ) THEN
           SIGNAL SQLSTATE '45000'
             SET MESSAGE_TEXT = 'scanner visit tenant mismatch';
         END IF;
         IF NEW.userId IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM Users user
               WHERE user.id = NEW.userId
                 AND user.organizationId = NEW.organizationId
            ) THEN
           SIGNAL SQLSTATE '45000'
             SET MESSAGE_TEXT = 'scanner user tenant mismatch';
         END IF;
       END`,
  );
}

async function addTenantColumns(queryInterface, Sequelize, tenant) {
  for (const tableName of TABLES) {
    await queryInterface.addColumn(tableName, 'organizationId', {
      allowNull: true,
      type: Sequelize.INTEGER,
    });
    await queryInterface.addColumn(tableName, 'clubId', {
      allowNull: true,
      type: Sequelize.INTEGER,
    });
  }

  await queryInterface.sequelize.query(
    `UPDATE Visits
        SET organizationId = :organizationId, clubId = :clubId
      WHERE organizationId IS NULL OR clubId IS NULL`,
    {
      replacements: {
        clubId: tenant.club.id,
        organizationId: tenant.organization.id,
      },
    },
  );
  await queryInterface.sequelize.query(
    `UPDATE ScannerEvents event
       LEFT JOIN Visits v ON v.id = event.visitId
          SET event.organizationId = COALESCE(v.organizationId, :organizationId),
              event.clubId = COALESCE(v.clubId, :clubId)
        WHERE event.organizationId IS NULL OR event.clubId IS NULL`,
    {
      replacements: {
        clubId: tenant.club.id,
        organizationId: tenant.organization.id,
      },
    },
  );
  await queryInterface.sequelize.query(
    `UPDATE VisitCategoryAssignments assignment
       JOIN Visits v ON v.id = assignment.visitId
          SET assignment.organizationId = v.organizationId,
              assignment.clubId = v.clubId
        WHERE assignment.organizationId IS NULL OR assignment.clubId IS NULL`,
  );

  for (const tableName of TABLES) {
    await queryInterface.changeColumn(tableName, 'organizationId', {
      allowNull: false,
      type: Sequelize.INTEGER,
    });
    await queryInterface.changeColumn(tableName, 'clubId', {
      allowNull: false,
      type: Sequelize.INTEGER,
    });
  }
}

async function addTenantSchema(queryInterface) {
  await queryInterface.addConstraint('Visits', {
    fields: ['organizationId', 'clubId', 'id'],
    name: CONSTRAINTS.visitTenantId,
    type: 'unique',
  });
  await queryInterface.addConstraint('Visits', {
    fields: ['organizationId'],
    name: CONSTRAINTS.visitOrganization,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    references: { fields: ['id'], table: 'Organizations' },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('Visits', {
    fields: ['organizationId', 'clubId'],
    name: CONSTRAINTS.visitClub,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    references: { fields: ['organizationId', 'id'], table: 'Clubs' },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('Visits', {
    fields: ['organizationId', 'userId'],
    name: CONSTRAINTS.visitUser,
    onDelete: 'CASCADE',
    onUpdate: 'RESTRICT',
    references: { fields: ['organizationId', 'id'], table: 'Users' },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('Visits', {
    fields: ['duplicateOfVisitId'],
    name: CONSTRAINTS.visitDuplicate,
    onDelete: 'SET NULL',
    onUpdate: 'RESTRICT',
    references: { fields: ['id'], table: 'Visits' },
    type: 'foreign key',
  });

  await queryInterface.addConstraint('ScannerEvents', {
    fields: ['organizationId'],
    name: CONSTRAINTS.scannerOrganization,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    references: { fields: ['id'], table: 'Organizations' },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('ScannerEvents', {
    fields: ['organizationId', 'clubId'],
    name: CONSTRAINTS.scannerClub,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    references: { fields: ['organizationId', 'id'], table: 'Clubs' },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('ScannerEvents', {
    fields: ['visitId'],
    name: CONSTRAINTS.scannerVisit,
    onDelete: 'SET NULL',
    onUpdate: 'RESTRICT',
    references: { fields: ['id'], table: 'Visits' },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('ScannerEvents', {
    fields: ['userId'],
    name: CONSTRAINTS.scannerUser,
    onDelete: 'SET NULL',
    onUpdate: 'RESTRICT',
    references: { fields: ['id'], table: 'Users' },
    type: 'foreign key',
  });

  await queryInterface.addConstraint('VisitCategoryAssignments', {
    fields: ['organizationId', 'clubId', 'visitId'],
    name: CONSTRAINTS.assignmentVisit,
    onDelete: 'CASCADE',
    onUpdate: 'RESTRICT',
    references: {
      fields: ['organizationId', 'clubId', 'id'],
      table: 'Visits',
    },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('VisitCategoryAssignments', {
    fields: ['organizationId', 'visitCategoryId'],
    name: CONSTRAINTS.assignmentCategory,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    references: {
      fields: ['organizationId', 'id'],
      table: 'VisitCategories',
    },
    type: 'foreign key',
  });

  const indexes = [
    ['Visits', ['organizationId', 'clubId', 'clientEventId'], INDEXES.visitClientEvent, true],
    ['Visits', ['organizationId', 'clubId', 'visitedAt', 'id'], INDEXES.visitVisited],
    ['Visits', ['organizationId', 'clubId', 'userId', 'visitedAt', 'id'], INDEXES.visitUserVisited],
    ['Visits', ['organizationId', 'clubId', 'scannedAt', 'id'], INDEXES.visitScanned],
    ['Visits', ['organizationId', 'clubId', 'duplicateOfVisitId'], INDEXES.visitDuplicate],
    ['ScannerEvents', ['organizationId', 'clubId', 'clientEventId', 'eventType'], INDEXES.scannerClientEvent, true],
    ['ScannerEvents', ['organizationId', 'clubId', 'createdAt', 'id'], INDEXES.scannerCreated],
    ['ScannerEvents', ['organizationId', 'clubId', 'eventType', 'createdAt'], INDEXES.scannerType],
    ['ScannerEvents', ['organizationId', 'clubId', 'qrHash'], INDEXES.scannerQr],
    ['VisitCategoryAssignments', ['organizationId', 'clubId', 'visitId'], INDEXES.assignmentVisit],
    ['VisitCategoryAssignments', ['organizationId', 'visitCategoryId'], INDEXES.assignmentCategory],
  ];
  for (const [tableName, fields, name, unique = false] of indexes) {
    await queryInterface.addIndex(tableName, fields, { name, unique });
  }

  await addVisitTenantTriggers(queryInterface);
  await addScannerTenantTriggers(queryInterface);
  await addImmutableTrigger(
    queryInterface,
    'VisitCategoryAssignments',
    TRIGGERS.assignment,
  );
}

async function removeCurrentInvocationArtifacts(queryInterface) {
  for (const triggerName of Object.values(TRIGGERS)) {
    await queryInterface.sequelize.query(
      `DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName)}`,
    );
  }

  for (const [tableName, constraintNames] of [
    ['VisitCategoryAssignments', [
      CONSTRAINTS.assignmentCategory,
      CONSTRAINTS.assignmentVisit,
    ]],
    ['ScannerEvents', [
      CONSTRAINTS.scannerUser,
      CONSTRAINTS.scannerVisit,
      CONSTRAINTS.scannerClub,
      CONSTRAINTS.scannerOrganization,
    ]],
    ['Visits', [
      CONSTRAINTS.visitDuplicate,
      CONSTRAINTS.visitUser,
      CONSTRAINTS.visitClub,
      CONSTRAINTS.visitOrganization,
      CONSTRAINTS.visitTenantId,
    ]],
  ]) {
    for (const constraintName of constraintNames) {
      await removeConstraintIfExists(
        queryInterface,
        tableName,
        constraintName,
      );
    }
  }

  for (const [tableName, indexNames] of [
    ['VisitCategoryAssignments', [
      INDEXES.assignmentCategory,
      INDEXES.assignmentVisit,
    ]],
    ['ScannerEvents', [
      INDEXES.scannerQr,
      INDEXES.scannerType,
      INDEXES.scannerCreated,
      INDEXES.scannerClientEvent,
    ]],
    ['Visits', [
      INDEXES.visitDuplicate,
      INDEXES.visitScanned,
      INDEXES.visitUserVisited,
      INDEXES.visitVisited,
      INDEXES.visitClientEvent,
    ]],
  ]) {
    for (const indexName of indexNames) {
      await removeIndexIfExists(queryInterface, tableName, indexName);
    }
  }
}

async function removeCurrentInvocationColumns(queryInterface) {
  const columns = await getColumns(queryInterface);
  for (const tableName of [...TABLES].reverse()) {
    for (const columnName of ['clubId', 'organizationId']) {
      if (columns.some((row) =>
        row.tableName === tableName && row.columnName === columnName)) {
        await queryInterface.removeColumn(tableName, columnName);
      }
    }
  }
}

async function cleanupCurrentInvocation(queryInterface, legacySnapshot) {
  await removeCurrentInvocationArtifacts(queryInterface);
  await removeCurrentInvocationColumns(queryInterface);
  await restoreLegacySchemaSnapshot(queryInterface, legacySnapshot);
}

async function removeTenantSchema(queryInterface) {
  for (const triggerName of Object.values(TRIGGERS)) {
    await queryInterface.sequelize.query(
      `DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName)}`,
    );
  }

  await removeConstraintIfExists(
    queryInterface,
    'VisitCategoryAssignments',
    CONSTRAINTS.assignmentCategory,
  );
  await removeConstraintIfExists(
    queryInterface,
    'VisitCategoryAssignments',
    CONSTRAINTS.assignmentVisit,
  );
  await removeConstraintIfExists(
    queryInterface,
    'ScannerEvents',
    CONSTRAINTS.scannerUser,
  );
  await removeConstraintIfExists(
    queryInterface,
    'ScannerEvents',
    CONSTRAINTS.scannerVisit,
  );
  await removeConstraintIfExists(
    queryInterface,
    'ScannerEvents',
    CONSTRAINTS.scannerClub,
  );
  await removeConstraintIfExists(
    queryInterface,
    'ScannerEvents',
    CONSTRAINTS.scannerOrganization,
  );
  await removeConstraintIfExists(
    queryInterface,
    'Visits',
    CONSTRAINTS.visitDuplicate,
  );
  await removeConstraintIfExists(
    queryInterface,
    'Visits',
    CONSTRAINTS.visitUser,
  );
  await removeConstraintIfExists(
    queryInterface,
    'Visits',
    CONSTRAINTS.visitClub,
  );
  await removeConstraintIfExists(
    queryInterface,
    'Visits',
    CONSTRAINTS.visitOrganization,
  );
  await removeConstraintIfExists(
    queryInterface,
    'Visits',
    CONSTRAINTS.visitTenantId,
  );

  await dropForeignKeys(queryInterface, 'Visits', [
    'duplicateOfVisitId',
    'userId',
  ]);
  await dropForeignKeys(queryInterface, 'ScannerEvents', ['visitId', 'userId']);
  await dropForeignKeys(queryInterface, 'VisitCategoryAssignments', [
    'visitCategoryId',
    'visitId',
  ]);

  for (const [tableName, names] of [
    ['VisitCategoryAssignments', [INDEXES.assignmentCategory, INDEXES.assignmentVisit]],
    ['ScannerEvents', [INDEXES.scannerQr, INDEXES.scannerType, INDEXES.scannerCreated, INDEXES.scannerClientEvent]],
    ['Visits', [INDEXES.visitDuplicate, INDEXES.visitScanned, INDEXES.visitUserVisited, INDEXES.visitVisited, INDEXES.visitClientEvent]],
  ]) {
    for (const name of names) {
      await removeIndexIfExists(queryInterface, tableName, name);
    }
  }

  if (!(await indexExists(queryInterface, 'Visits', LEGACY_INDEXES.visitClientEvent))) {
    await queryInterface.addIndex('Visits', ['clientEventId'], {
      name: LEGACY_INDEXES.visitClientEvent,
      unique: true,
    });
  }
  if (!(await indexExists(queryInterface, 'ScannerEvents', LEGACY_INDEXES.scannerClientEvent))) {
    await queryInterface.addIndex('ScannerEvents', ['clientEventId', 'eventType'], {
      name: LEGACY_INDEXES.scannerClientEvent,
      unique: true,
    });
  }

  await queryInterface.addConstraint('Visits', {
    fields: ['userId'],
    name: 'fk_visits_user_legacy_v53',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    references: { fields: ['id'], table: 'Users' },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('Visits', {
    fields: ['duplicateOfVisitId'],
    name: 'fk_visits_duplicate_legacy_v53',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
    references: { fields: ['id'], table: 'Visits' },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('ScannerEvents', {
    fields: ['visitId'],
    name: 'fk_scanner_events_visit_legacy_v53',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
    references: { fields: ['id'], table: 'Visits' },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('ScannerEvents', {
    fields: ['userId'],
    name: 'fk_scanner_events_user_legacy_v53',
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
    references: { fields: ['id'], table: 'Users' },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('VisitCategoryAssignments', {
    fields: ['visitId'],
    name: 'fk_visit_assignments_visit_legacy_v53',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    references: { fields: ['id'], table: 'Visits' },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('VisitCategoryAssignments', {
    fields: ['visitCategoryId'],
    name: 'fk_visit_assignments_category_legacy_v53',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
    references: { fields: ['id'], table: 'VisitCategories' },
    type: 'foreign key',
  });

  const columns = await getColumns(queryInterface);
  for (const tableName of [...TABLES].reverse()) {
    for (const columnName of ['clubId', 'organizationId']) {
      if (
        columns.some(
          (row) =>
            row.tableName === tableName && row.columnName === columnName,
        )
      ) {
        await queryInterface.removeColumn(tableName, columnName);
      }
    }
  }
}

async function assertRollbackAllowed(queryInterface) {
  const tenant = await assertReadyGraph(queryInterface, {
    requireDefaultOnly: true,
  });
  const [later] = await queryInterface.sequelize.query(
    `SELECT name FROM SequelizeMeta
      WHERE name > :migrationName
      ORDER BY name`,
    { replacements: { migrationName: MIGRATION_NAME } },
  );
  if (later.length > 0) {
    throw migrationError('later migrations depend on visit tenant attribution');
  }
  const [[visitCount], [scannerCount], [assignmentCount]] = await Promise.all([
    queryInterface.sequelize.query('SELECT COUNT(*) AS count FROM Visits'),
    queryInterface.sequelize.query('SELECT COUNT(*) AS count FROM ScannerEvents'),
    queryInterface.sequelize.query(
      'SELECT COUNT(*) AS count FROM VisitCategoryAssignments',
    ),
  ]);
  console.info(
    '[tenant-visits-scanner] rollback preflight',
    JSON.stringify({
      assignmentCount: Number(assignmentCount[0].count),
      clubId: Number(tenant.club.id),
      organizationId: Number(tenant.organization.id),
      scannerCount: Number(scannerCount[0].count),
      visitCount: Number(visitCount[0].count),
    }),
  );
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const state = await getSchemaState(queryInterface);
    if (state.mode === 'ready') {
      await assertReadyGraph(queryInterface);
      return;
    }
    if (state.mode === 'partial') {
      throw migrationError(
        'pre-existing partial schema requires an explicit operator repair; no changes were applied',
      );
    }

    const tenant = await queryInterface.sequelize.transaction(
      async (transaction) => {
        const exactTenant = await getExactDefaultTenant(
          queryInterface,
          transaction,
        );
        await assertLegacyGraph(queryInterface, transaction);
        return exactTenant;
      },
    );
    const legacySnapshot = await getLegacySchemaSnapshot(queryInterface);
    assertLegacySchemaSnapshot(legacySnapshot);
    await assertCurrentArtifactNamesAbsent(queryInterface);

    try {
      await addTenantColumns(queryInterface, Sequelize, tenant);
      if (
        String(process.env.TENANT_VISITS_SCANNER_MIGRATION_FAIL_AFTER_BACKFILL)
          .trim()
          .toLowerCase() === 'true'
      ) {
        throw migrationError('forced failure after backfill');
      }
      await assertReadyGraph(queryInterface);
      await dropLegacySchemaSnapshot(queryInterface, legacySnapshot);
      await addTenantSchema(queryInterface);
      await assertReadyGraph(queryInterface);
    } catch (error) {
      try {
        await cleanupCurrentInvocation(queryInterface, legacySnapshot);
      } catch (cleanupError) {
        error.cleanupError = cleanupError;
      }
      throw error;
    }
  },

  async down(queryInterface) {
    const state = await getSchemaState(queryInterface);
    if (state.mode === 'legacy') return;
    if (state.mode !== 'ready') {
      throw migrationError(
        'partial schema requires an explicit operator repair; rollback made no changes',
      );
    }
    await assertRollbackAllowed(queryInterface);
    await removeTenantSchema(queryInterface);
    await assertLegacyGraph(queryInterface);
  },
};
