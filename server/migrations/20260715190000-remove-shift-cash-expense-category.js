'use strict';

const TABLE = 'ShiftCashExpenses';
const LEGACY_CATEGORY_NAME = 'Расходы из кассы';

async function describeTable(queryInterface) {
  try {
    return await queryInterface.describeTable(TABLE);
  } catch (error) {
    if (error?.original?.code === 'ER_NO_SUCH_TABLE') return null;
    throw error;
  }
}

module.exports = {
  async up(queryInterface) {
    const columns = await describeTable(queryInterface);
    if (!columns) return;

    if (columns.categoryId) {
      const references = await queryInterface.getForeignKeyReferencesForTable(TABLE);
      const constraintNames = new Set(
        references
          .filter((reference) => reference.columnName === 'categoryId')
          .map((reference) => reference.constraintName)
          .filter(Boolean),
      );
      for (const constraintName of constraintNames) {
        await queryInterface.removeConstraint(TABLE, constraintName);
      }
      await queryInterface.removeColumn(TABLE, 'categoryId');
    }

    if (columns.categoryName) {
      await queryInterface.removeColumn(TABLE, 'categoryName');
    }
  },

  async down(queryInterface, Sequelize) {
    const columns = await describeTable(queryInterface);
    if (!columns) return;

    if (!columns.categoryName) {
      await queryInterface.addColumn(TABLE, 'categoryName', {
        allowNull: false,
        defaultValue: LEGACY_CATEGORY_NAME,
        type: Sequelize.STRING,
      });
      await queryInterface.changeColumn(TABLE, 'categoryName', {
        allowNull: false,
        type: Sequelize.STRING,
      });
    }

    if (!columns.categoryId) {
      await queryInterface.addColumn(TABLE, 'categoryId', {
        allowNull: true,
        type: Sequelize.INTEGER,
        references: { model: 'Categories', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      });
    }
  },
};
