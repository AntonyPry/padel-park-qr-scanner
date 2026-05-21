'use strict';

const DEFAULT_CLIENT_SOURCES = [
  'Ресепшн (Админ)',
  'Вк',
  'Тг',
  'Радио',
  'Хоккей',
  'Сайт',
  'Инст',
  'Рекомендация друзей',
  'Увидел в тц',
  'Другое',
];

const DEFAULT_VISIT_CATEGORIES = [
  'Первый раз',
  'Мастер класс',
  'Групповая тренировка',
  'Индивидуальная тренировка',
  'Первый турнир',
  'Турнир',
  'Игра на сингл',
  'Игра 2х2',
  'Настольный теннис',
  'Вип раздевалка',
  'Аренда ракетки',
  'Ракетка шефа',
  'Тубус',
];

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function uniqueNames(values) {
  const seen = new Set();
  return values
    .map(normalizeName)
    .filter(Boolean)
    .filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function splitVisitCategories(value) {
  return String(value || '')
    .split(',')
    .map(normalizeName)
    .filter(Boolean);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ClientSources', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('active', 'archived'),
        allowNull: false,
        defaultValue: 'active',
      },
      sortOrder: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.createTable('VisitCategories', {
      id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('active', 'archived'),
        allowNull: false,
        defaultValue: 'active',
      },
      sortOrder: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.createTable('VisitCategoryAssignments', {
      visitId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: {
          model: 'Visits',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      visitCategoryId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        primaryKey: true,
        references: {
          model: 'VisitCategories',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
    });

    await queryInterface.addIndex('ClientSources', ['name'], {
      name: 'client_sources_name_unique',
      unique: true,
    });
    await queryInterface.addIndex('ClientSources', ['status'], {
      name: 'client_sources_status_idx',
    });
    await queryInterface.addIndex('VisitCategories', ['name'], {
      name: 'visit_categories_name_unique',
      unique: true,
    });
    await queryInterface.addIndex('VisitCategories', ['status'], {
      name: 'visit_categories_status_idx',
    });
    await queryInterface.addIndex('VisitCategoryAssignments', ['visitCategoryId'], {
      name: 'visit_category_assignments_category_idx',
    });

    const [sourceRows] = await queryInterface.sequelize.query(`
      SELECT DISTINCT source
      FROM Users
      WHERE source IS NOT NULL AND source <> ''
    `);
    const sourceNames = uniqueNames([
      ...DEFAULT_CLIENT_SOURCES,
      ...sourceRows.map((row) => row.source),
    ]);

    if (sourceNames.length > 0) {
      await queryInterface.bulkInsert(
        'ClientSources',
        sourceNames.map((name, index) => ({
          name,
          status: 'active',
          sortOrder: index + 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
    }

    const [visitRows] = await queryInterface.sequelize.query(`
      SELECT DISTINCT category
      FROM Visits
      WHERE category IS NOT NULL AND category <> ''
    `);
    const visitCategoryNames = uniqueNames([
      ...DEFAULT_VISIT_CATEGORIES,
      ...visitRows.flatMap((row) => splitVisitCategories(row.category)),
    ]);

    if (visitCategoryNames.length > 0) {
      await queryInterface.bulkInsert(
        'VisitCategories',
        visitCategoryNames.map((name, index) => ({
          name,
          status: 'active',
          sortOrder: index + 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
    }

    await queryInterface.addColumn('Users', 'sourceId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'ClientSources',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addIndex('Users', ['sourceId'], {
      name: 'users_source_id_idx',
    });

    await queryInterface.sequelize.query(`
      UPDATE Users u
      JOIN ClientSources cs ON LOWER(cs.name) = LOWER(u.source)
      SET u.sourceId = cs.id
      WHERE u.source IS NOT NULL AND u.source <> ''
    `);

    const [categoryRows] = await queryInterface.sequelize.query(
      'SELECT id, name FROM VisitCategories',
    );
    const categoryIdByName = new Map(
      categoryRows.map((row) => [String(row.name).toLowerCase(), row.id]),
    );
    const [visits] = await queryInterface.sequelize.query(`
      SELECT id, category
      FROM Visits
      WHERE category IS NOT NULL AND category <> ''
    `);
    const assignments = [];

    visits.forEach((visit) => {
      const names = splitVisitCategories(visit.category);
      names.forEach((name) => {
        const categoryId = categoryIdByName.get(name.toLowerCase());
        if (categoryId) {
          assignments.push({
            visitId: visit.id,
            visitCategoryId: categoryId,
          });
        }
      });
    });

    if (assignments.length > 0) {
      await queryInterface.bulkInsert('VisitCategoryAssignments', assignments, {
        ignoreDuplicates: true,
      });
    }

    await queryInterface.sequelize.query(`
      UPDATE Users
      SET status = 'archived'
      WHERE status = 'merged'
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE Users
      MODIFY status ENUM('active', 'archived') NOT NULL DEFAULT 'active'
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE Users
      MODIFY status ENUM('active', 'merged', 'archived') NOT NULL DEFAULT 'active'
    `);
    await queryInterface.sequelize.query(`
      UPDATE Users
      SET status = 'merged'
      WHERE mergedIntoUserId IS NOT NULL
    `);

    await queryInterface.removeIndex('Users', 'users_source_id_idx');
    await queryInterface.removeColumn('Users', 'sourceId');

    await queryInterface.removeIndex(
      'VisitCategoryAssignments',
      'visit_category_assignments_category_idx',
    );
    await queryInterface.removeIndex('VisitCategories', 'visit_categories_status_idx');
    await queryInterface.removeIndex('VisitCategories', 'visit_categories_name_unique');
    await queryInterface.removeIndex('ClientSources', 'client_sources_status_idx');
    await queryInterface.removeIndex('ClientSources', 'client_sources_name_unique');

    await queryInterface.dropTable('VisitCategoryAssignments');
    await queryInterface.dropTable('VisitCategories');
    await queryInterface.dropTable('ClientSources');

    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_ClientSources_status";',
      );
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_VisitCategories_status";',
      );
    }
  },
};
