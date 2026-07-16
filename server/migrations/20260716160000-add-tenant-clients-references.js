'use strict';

const { DEFAULT_ORGANIZATION_SLUG } = require('../src/tenant-foundation/constants');

const MIGRATION_NAME = '20260716160000-add-tenant-clients-references.js';
const TABLES = Object.freeze(['Users', 'ClientSources', 'VisitCategories']);
const CONSTRAINTS = Object.freeze({
  clientOrganization: 'fk_users_organization',
  clientSource: 'fk_users_organization_source',
  clientSourceOrganization: 'fk_client_sources_organization',
  clientSourceOrganizationId: 'uq_client_sources_organization_id',
  clientSourceOrganizationName: 'uq_client_sources_organization_name',
  clientOrganizationId: 'uq_users_organization_id',
  clientTelegram: 'uq_users_organization_telegram',
  clientVk: 'uq_users_organization_vk',
  clientWeb: 'uq_users_organization_web',
  mergedClient: 'fk_users_organization_merged_into',
  visitCategoryOrganization: 'fk_visit_categories_organization',
  visitCategoryOrganizationId: 'uq_visit_categories_organization_id',
  visitCategoryOrganizationName: 'uq_visit_categories_organization_name',
});
const INDEXES = Object.freeze({
  clientName: 'idx_users_organization_name_status_id',
  clientPhone: 'idx_users_organization_status_merged_phone',
  clientSource: 'idx_users_organization_source_status_id',
  clientStatus: 'idx_users_organization_status_merged_created',
  mergedClient: 'idx_users_organization_merged_into',
  sourceList: 'idx_client_sources_organization_status_sort_name',
  visitCategoryList: 'idx_visit_categories_organization_status_sort_name',
});
const TRIGGERS = Object.freeze({
  client: 'trg_users_organization_immutable',
  clientSource: 'trg_client_sources_organization_immutable',
  visitCategory: 'trg_visit_categories_organization_immutable',
});
const LEGACY = Object.freeze({
  clientSourceFk: 'fk_users_source_legacy',
  mergedClientFk: 'fk_users_merged_into_legacy',
  sourceName: 'client_sources_name_unique',
  telegram: 'uq_users_telegram_legacy',
  visitCategoryName: 'visit_categories_name_unique',
  vk: 'uq_users_vk_legacy',
  web: 'uq_users_web_legacy',
});

function migrationError(message) {
  return new Error(`Client/reference tenant migration refused: ${message}`);
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

async function getColumns(queryInterface, tableNames = TABLES) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (:tableNames)
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    { replacements: { tableNames } },
  );
  return rows;
}

async function getSchemaState(queryInterface) {
  const rows = await getColumns(queryInterface);
  const attributed = TABLES.filter((tableName) =>
    rows.some(
      (row) => row.tableName === tableName && row.columnName === 'organizationId',
    ),
  );
  return {
    attributed,
    mode:
      attributed.length === 0
        ? 'legacy'
        : attributed.length === TABLES.length
          ? 'ready'
          : 'partial',
  };
}

async function getExactDefaultOrganization(queryInterface, transaction) {
  const [organizations] = await queryInterface.sequelize.query(
    'SELECT id, slug, status FROM Organizations ORDER BY id FOR UPDATE',
    { transaction },
  );
  if (
    organizations.length !== 1 ||
    organizations[0].slug !== DEFAULT_ORGANIZATION_SLUG ||
    organizations[0].status !== 'active'
  ) {
    throw migrationError('exactly one active default Organization is required');
  }
  return organizations[0];
}

function assertClientGraph(users, sourceIds) {
  const usersById = new Map(users.map((row) => [Number(row.id), row]));
  for (const user of users) {
    if (user.sourceId != null && !sourceIds.has(Number(user.sourceId))) {
      throw migrationError(`User ${user.id} has stale sourceId ${user.sourceId}`);
    }
    if (user.mergedIntoUserId == null) continue;
    if (!usersById.has(Number(user.mergedIntoUserId))) {
      throw migrationError(
        `User ${user.id} has stale mergedIntoUserId ${user.mergedIntoUserId}`,
      );
    }
    const visited = new Set([Number(user.id)]);
    let current = user;
    while (current?.mergedIntoUserId != null) {
      const nextId = Number(current.mergedIntoUserId);
      if (visited.has(nextId)) {
        throw migrationError(`client merge cycle includes User ${user.id}`);
      }
      visited.add(nextId);
      current = usersById.get(nextId);
      if (!current) break;
    }
  }
}

async function assertNoLegacyDuplicates(queryInterface, transaction) {
  const duplicateQueries = [
    ['Users', 'telegramId'],
    ['Users', 'vkId'],
    ['Users', 'webId'],
    ['ClientSources', 'name'],
    ['VisitCategories', 'name'],
  ];
  for (const [tableName, columnName] of duplicateQueries) {
    const [rows] = await queryInterface.sequelize.query(
      `SELECT ${quoteIdentifier(columnName)} AS value, COUNT(*) AS rowCount
         FROM ${quoteIdentifier(tableName)}
        WHERE ${quoteIdentifier(columnName)} IS NOT NULL
          AND ${quoteIdentifier(columnName)} <> ''
        GROUP BY ${quoteIdentifier(columnName)}
       HAVING COUNT(*) > 1
        LIMIT 1`,
      { transaction },
    );
    if (rows.length > 0) {
      throw migrationError(
        `${tableName}.${columnName} has duplicate legacy values`,
      );
    }
  }
}

async function assertLegacyPreflight(queryInterface) {
  return queryInterface.sequelize.transaction(async (transaction) => {
    const organization = await getExactDefaultOrganization(
      queryInterface,
      transaction,
    );
    await assertNoLegacyDuplicates(queryInterface, transaction);
    const [[users], [sources]] = await Promise.all([
      queryInterface.sequelize.query(
        'SELECT id, sourceId, mergedIntoUserId FROM Users ORDER BY id FOR UPDATE',
        { transaction },
      ),
      queryInterface.sequelize.query(
        'SELECT id FROM ClientSources ORDER BY id FOR UPDATE',
        { transaction },
      ),
    ]);
    assertClientGraph(users, new Set(sources.map((row) => Number(row.id))));
    return { organization };
  });
}

async function assertReadyData(queryInterface, { requireDefaultOnly = false } = {}) {
  return queryInterface.sequelize.transaction(async (transaction) => {
    const organization = requireDefaultOnly
      ? await getExactDefaultOrganization(queryInterface, transaction)
      : null;
    const [[users], [sources], [categories]] = await Promise.all([
      queryInterface.sequelize.query(
        `SELECT id, organizationId, sourceId, mergedIntoUserId
           FROM Users ORDER BY id FOR UPDATE`,
        { transaction },
      ),
      queryInterface.sequelize.query(
        'SELECT id, organizationId FROM ClientSources ORDER BY id FOR UPDATE',
        { transaction },
      ),
      queryInterface.sequelize.query(
        'SELECT id, organizationId FROM VisitCategories ORDER BY id FOR UPDATE',
        { transaction },
      ),
    ]);
    const sourceById = new Map(sources.map((row) => [Number(row.id), row]));
    const userById = new Map(users.map((row) => [Number(row.id), row]));
    for (const row of [...users, ...sources, ...categories]) {
      if (!Number.isInteger(Number(row.organizationId))) {
        throw migrationError('NULL tenant attribution remains');
      }
      if (
        organization &&
        Number(row.organizationId) !== Number(organization.id)
      ) {
        throw migrationError('rollback found non-default tenant attribution');
      }
    }
    for (const user of users) {
      if (user.sourceId != null) {
        const source = sourceById.get(Number(user.sourceId));
        if (
          !source ||
          Number(source.organizationId) !== Number(user.organizationId)
        ) {
          throw migrationError(`User ${user.id} has a cross-organization source`);
        }
      }
      if (user.mergedIntoUserId != null) {
        const parent = userById.get(Number(user.mergedIntoUserId));
        if (
          !parent ||
          Number(parent.organizationId) !== Number(user.organizationId)
        ) {
          throw migrationError(`User ${user.id} has a cross-organization merge`);
        }
      }
    }
    assertClientGraph(users, new Set(sources.map((row) => Number(row.id))));
    return {
      counts: {
        clientSources: sources.length,
        users: users.length,
        visitCategories: categories.length,
      },
      organizationId: organization?.id || null,
    };
  });
}

async function getExactIndexes(queryInterface, tableName, columnName) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT INDEX_NAME AS indexName,
            NON_UNIQUE AS nonUnique,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsList
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tableName
      GROUP BY INDEX_NAME, NON_UNIQUE`,
    { replacements: { tableName } },
  );
  return rows.filter(
    (row) =>
      row.indexName !== 'PRIMARY' &&
      String(row.columnsList) === columnName,
  );
}

async function removeExactUniqueIndexes(queryInterface, tableName, columnName) {
  const indexes = await getExactIndexes(queryInterface, tableName, columnName);
  for (const index of indexes) {
    if (Number(index.nonUnique) === 0) {
      await queryInterface.removeIndex(tableName, index.indexName);
    }
  }
}

async function hasExactIndex(queryInterface, tableName, columnsList, unique) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
            GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnsList
       FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :tableName
      GROUP BY INDEX_NAME, NON_UNIQUE`,
    { replacements: { tableName } },
  );
  return rows.some(
    (row) =>
      String(row.columnsList) === columnsList &&
      (!unique || Number(row.nonUnique) === 0),
  );
}

async function getForeignKeysForColumn(queryInterface, tableName, columnName) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT DISTINCT CONSTRAINT_NAME AS constraintName
       FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = :tableName
        AND COLUMN_NAME = :columnName
        AND REFERENCED_TABLE_NAME IS NOT NULL`,
    { replacements: { columnName, tableName } },
  );
  return rows.map((row) => row.constraintName);
}

async function removeForeignKeysForColumn(queryInterface, tableName, columnName) {
  const names = await getForeignKeysForColumn(
    queryInterface,
    tableName,
    columnName,
  );
  for (const name of names) await queryInterface.removeConstraint(tableName, name);
}

async function addImmutableTrigger(queryInterface, tableName, triggerName) {
  await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName)}`);
  await queryInterface.sequelize.query(
    `CREATE TRIGGER ${quoteIdentifier(triggerName)}
       BEFORE UPDATE ON ${quoteIdentifier(tableName)}
       FOR EACH ROW
       BEGIN
         IF NOT (OLD.organizationId <=> NEW.organizationId) THEN
           SIGNAL SQLSTATE '45000'
             SET MESSAGE_TEXT = 'Tenant organization attribution is immutable';
         END IF;
       END`,
  );
}

async function addTenantSchema(queryInterface, Sequelize, organizationId) {
  for (const tableName of TABLES) {
    await queryInterface.addColumn(tableName, 'organizationId', {
      allowNull: true,
      type: Sequelize.INTEGER,
    });
    await queryInterface.sequelize.query(
      `UPDATE ${quoteIdentifier(tableName)}
          SET organizationId = :organizationId
        WHERE organizationId IS NULL`,
      { replacements: { organizationId } },
    );
  }

  for (const [tableName, name] of [
    ['Users', CONSTRAINTS.clientOrganization],
    ['ClientSources', CONSTRAINTS.clientSourceOrganization],
    ['VisitCategories', CONSTRAINTS.visitCategoryOrganization],
  ]) {
    await queryInterface.addConstraint(tableName, {
      fields: ['organizationId'],
      name,
      onDelete: 'RESTRICT',
      onUpdate: 'RESTRICT',
      references: { field: 'id', table: 'Organizations' },
      type: 'foreign key',
    });
  }

  for (const [tableName, name] of [
    ['Users', CONSTRAINTS.clientOrganizationId],
    ['ClientSources', CONSTRAINTS.clientSourceOrganizationId],
    ['VisitCategories', CONSTRAINTS.visitCategoryOrganizationId],
  ]) {
    await queryInterface.addConstraint(tableName, {
      fields: ['organizationId', 'id'],
      name,
      type: 'unique',
    });
  }

  await removeForeignKeysForColumn(queryInterface, 'Users', 'sourceId');
  await removeForeignKeysForColumn(queryInterface, 'Users', 'mergedIntoUserId');
  await queryInterface.addConstraint('Users', {
    fields: ['organizationId', 'sourceId'],
    name: CONSTRAINTS.clientSource,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    references: {
      fields: ['organizationId', 'id'],
      table: 'ClientSources',
    },
    type: 'foreign key',
  });
  await queryInterface.addConstraint('Users', {
    fields: ['organizationId', 'mergedIntoUserId'],
    name: CONSTRAINTS.mergedClient,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    references: { fields: ['organizationId', 'id'], table: 'Users' },
    type: 'foreign key',
  });

  for (const [columnName, name] of [
    ['telegramId', CONSTRAINTS.clientTelegram],
    ['vkId', CONSTRAINTS.clientVk],
    ['webId', CONSTRAINTS.clientWeb],
  ]) {
    await removeExactUniqueIndexes(queryInterface, 'Users', columnName);
    await queryInterface.addConstraint('Users', {
      fields: ['organizationId', columnName],
      name,
      type: 'unique',
    });
  }
  await removeExactUniqueIndexes(queryInterface, 'ClientSources', 'name');
  await removeExactUniqueIndexes(queryInterface, 'VisitCategories', 'name');
  await queryInterface.addConstraint('ClientSources', {
    fields: ['organizationId', 'name'],
    name: CONSTRAINTS.clientSourceOrganizationName,
    type: 'unique',
  });
  await queryInterface.addConstraint('VisitCategories', {
    fields: ['organizationId', 'name'],
    name: CONSTRAINTS.visitCategoryOrganizationName,
    type: 'unique',
  });

  for (const [tableName, fields, name] of [
    ['Users', ['organizationId', 'status', 'mergedIntoUserId', 'createdAt', 'id'], INDEXES.clientStatus],
    ['Users', ['organizationId', 'status', 'mergedIntoUserId', 'phoneNormalized'], INDEXES.clientPhone],
    ['Users', ['organizationId', 'sourceId', 'status', 'id'], INDEXES.clientSource],
    ['Users', ['organizationId', 'name', 'status', 'id'], INDEXES.clientName],
    ['Users', ['organizationId', 'mergedIntoUserId'], INDEXES.mergedClient],
    ['ClientSources', ['organizationId', 'status', 'sortOrder', 'name'], INDEXES.sourceList],
    ['VisitCategories', ['organizationId', 'status', 'sortOrder', 'name'], INDEXES.visitCategoryList],
  ]) {
    await queryInterface.addIndex(tableName, fields, { name });
  }

  for (const tableName of TABLES) {
    await queryInterface.changeColumn(tableName, 'organizationId', {
      allowNull: false,
      type: Sequelize.INTEGER,
    });
  }
  await addImmutableTrigger(queryInterface, 'Users', TRIGGERS.client);
  await addImmutableTrigger(
    queryInterface,
    'ClientSources',
    TRIGGERS.clientSource,
  );
  await addImmutableTrigger(
    queryInterface,
    'VisitCategories',
    TRIGGERS.visitCategory,
  );
}

async function ignoreMissing(operation) {
  try {
    await operation();
  } catch (error) {
    const code = error?.original?.code || error?.parent?.code || error?.code;
    if (
      error?.name === 'SequelizeUnknownConstraintError' ||
      [
        'ER_BAD_FIELD_ERROR',
        'ER_CANT_DROP_FIELD_OR_KEY',
        'ER_KEY_DOES_NOT_EXITS',
        'ER_NO_SUCH_TABLE',
        'ER_TRG_DOES_NOT_EXIST',
      ].includes(code)
    ) {
      return;
    }
    throw error;
  }
}

async function ensureLegacyUnique(
  queryInterface,
  tableName,
  columnName,
  name,
) {
  if (await hasExactIndex(queryInterface, tableName, columnName, true)) return;
  await queryInterface.addIndex(tableName, [columnName], { name, unique: true });
}

async function ensureLegacyForeignKeys(queryInterface) {
  const sourceFks = await getForeignKeysForColumn(
    queryInterface,
    'Users',
    'sourceId',
  );
  if (sourceFks.length === 0) {
    await queryInterface.addConstraint('Users', {
      fields: ['sourceId'],
      name: LEGACY.clientSourceFk,
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      references: { field: 'id', table: 'ClientSources' },
      type: 'foreign key',
    });
  }
  const mergeFks = await getForeignKeysForColumn(
    queryInterface,
    'Users',
    'mergedIntoUserId',
  );
  if (mergeFks.length === 0) {
    await queryInterface.addConstraint('Users', {
      fields: ['mergedIntoUserId'],
      name: LEGACY.mergedClientFk,
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      references: { field: 'id', table: 'Users' },
      type: 'foreign key',
    });
  }
}

async function dropTenantSchema(queryInterface) {
  for (const triggerName of Object.values(TRIGGERS)) {
    await queryInterface.sequelize.query(
      `DROP TRIGGER IF EXISTS ${quoteIdentifier(triggerName)}`,
    );
  }
  for (const name of [
    CONSTRAINTS.clientSource,
    CONSTRAINTS.mergedClient,
    CONSTRAINTS.clientTelegram,
    CONSTRAINTS.clientVk,
    CONSTRAINTS.clientWeb,
  ]) {
    await ignoreMissing(() => queryInterface.removeConstraint('Users', name));
  }
  for (const [tableName, name] of [
    ['ClientSources', CONSTRAINTS.clientSourceOrganizationName],
    ['VisitCategories', CONSTRAINTS.visitCategoryOrganizationName],
    ['Users', CONSTRAINTS.clientOrganization],
    ['ClientSources', CONSTRAINTS.clientSourceOrganization],
    ['VisitCategories', CONSTRAINTS.visitCategoryOrganization],
  ]) {
    await ignoreMissing(() => queryInterface.removeConstraint(tableName, name));
  }
  for (const [tableName, name] of [
    ['Users', INDEXES.clientStatus],
    ['Users', INDEXES.clientPhone],
    ['Users', INDEXES.clientSource],
    ['Users', INDEXES.clientName],
    ['Users', INDEXES.mergedClient],
    ['ClientSources', INDEXES.sourceList],
    ['VisitCategories', INDEXES.visitCategoryList],
  ]) {
    await ignoreMissing(() => queryInterface.removeIndex(tableName, name));
  }
  for (const [tableName, name] of [
    ['Users', CONSTRAINTS.clientOrganizationId],
    ['ClientSources', CONSTRAINTS.clientSourceOrganizationId],
    ['VisitCategories', CONSTRAINTS.visitCategoryOrganizationId],
  ]) {
    await ignoreMissing(() => queryInterface.removeConstraint(tableName, name));
  }
  for (const tableName of [...TABLES].reverse()) {
    const columns = await getColumns(queryInterface, [tableName]);
    if (columns.some((row) => row.columnName === 'organizationId')) {
      await queryInterface.removeColumn(tableName, 'organizationId');
    }
  }

  await ensureLegacyUnique(
    queryInterface,
    'Users',
    'telegramId',
    LEGACY.telegram,
  );
  await ensureLegacyUnique(queryInterface, 'Users', 'vkId', LEGACY.vk);
  await ensureLegacyUnique(queryInterface, 'Users', 'webId', LEGACY.web);
  await ensureLegacyUnique(
    queryInterface,
    'ClientSources',
    'name',
    LEGACY.sourceName,
  );
  await ensureLegacyUnique(
    queryInterface,
    'VisitCategories',
    'name',
    LEGACY.visitCategoryName,
  );
  await ensureLegacyForeignKeys(queryInterface);
}

async function findLaterMigrations(queryInterface, transaction) {
  const [rows] = await queryInterface.sequelize.query(
    'SELECT name FROM SequelizeMeta WHERE name > :migrationName ORDER BY name',
    { replacements: { migrationName: MIGRATION_NAME }, transaction },
  );
  return rows.map((row) => row.name);
}

async function assertRollbackPreflight(queryInterface) {
  const data = await assertReadyData(queryInterface, { requireDefaultOnly: true });
  return queryInterface.sequelize.transaction(async (transaction) => {
    const laterMigrations = await findLaterMigrations(queryInterface, transaction);
    if (laterMigrations.length > 0) {
      throw migrationError(
        `rollback has later migrations applied (${laterMigrations.join(', ')})`,
      );
    }
    console.info('[tenant-clients-references] rollback preflight', JSON.stringify(data));
    return data;
  });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const schema = await getSchemaState(queryInterface);
    if (schema.mode === 'partial') {
      throw migrationError(
        `partial tenant attribution exists (${schema.attributed.join(', ')})`,
      );
    }
    if (schema.mode === 'ready') {
      const data = await assertReadyData(queryInterface);
      console.info('[tenant-clients-references] repeated assertion', JSON.stringify(data));
      return;
    }

    const { organization } = await assertLegacyPreflight(queryInterface);
    let schemaTouched = false;
    try {
      schemaTouched = true;
      await addTenantSchema(queryInterface, Sequelize, organization.id);
      const data = await assertReadyData(queryInterface);
      console.info('[tenant-clients-references] migration assertion', JSON.stringify(data));
    } catch (error) {
      if (schemaTouched) {
        try {
          await dropTenantSchema(queryInterface);
        } catch (cleanupError) {
          error.cleanupError = cleanupError;
        }
      }
      throw error;
    }
  },

  async down(queryInterface) {
    const schema = await getSchemaState(queryInterface);
    if (schema.mode !== 'ready') {
      throw migrationError(`rollback expected ready schema, found ${schema.mode}`);
    }
    await assertRollbackPreflight(queryInterface);
    await dropTenantSchema(queryInterface);
  },

  _private: {
    assertClientGraph,
    assertLegacyPreflight,
    assertReadyData,
    assertRollbackPreflight,
    dropTenantSchema,
    getSchemaState,
  },
};
