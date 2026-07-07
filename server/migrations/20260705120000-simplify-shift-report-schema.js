'use strict';

async function describe(queryInterface, tableName) {
  try {
    return await queryInterface.describeTable(tableName);
  } catch {
    return {};
  }
}

async function removeColumnIfExists(queryInterface, tableName, columnName) {
  const table = await describe(queryInterface, tableName);
  if (table[columnName]) {
    await queryInterface.removeColumn(tableName, columnName);
  }
}

async function addColumnIfMissing(queryInterface, tableName, columnName, definition) {
  const table = await describe(queryInterface, tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'ShiftReports', 'comment', {
      allowNull: true,
      type: Sequelize.TEXT,
    });

    await queryInterface.sequelize.query(`
      UPDATE ShiftReportTemplateItems
      SET itemType = 'checkbox', photoRequired = true
      WHERE itemType = 'checkbox_with_photo'
    `);
    await queryInterface.sequelize.query(`
      UPDATE ShiftReportTemplateItems
      SET itemType = 'checkbox', photoRequired = true
      WHERE itemType = 'photo'
    `);
    await queryInterface.sequelize.query(`
      UPDATE ShiftReportAnswers
      SET itemType = 'checkbox', photoRequired = true
      WHERE itemType = 'checkbox_with_photo'
    `);
    await queryInterface.sequelize.query(`
      UPDATE ShiftReportAnswers
      SET itemType = 'checkbox', photoRequired = true
      WHERE itemType = 'photo'
    `);

    await removeColumnIfExists(queryInterface, 'ShiftReportTemplateItems', 'helperText');
    await removeColumnIfExists(queryInterface, 'ShiftReportTemplateItems', 'isRequired');
    await removeColumnIfExists(queryInterface, 'ShiftReportAnswers', 'isRequired');
    await removeColumnIfExists(queryInterface, 'ShiftReportAnswers', 'comment');
  },

  async down(queryInterface, Sequelize) {
    await addColumnIfMissing(queryInterface, 'ShiftReportTemplateItems', 'helperText', {
      allowNull: true,
      type: Sequelize.TEXT,
    });
    await addColumnIfMissing(queryInterface, 'ShiftReportTemplateItems', 'isRequired', {
      allowNull: false,
      defaultValue: true,
      type: Sequelize.BOOLEAN,
    });
    await addColumnIfMissing(queryInterface, 'ShiftReportAnswers', 'isRequired', {
      allowNull: false,
      defaultValue: true,
      type: Sequelize.BOOLEAN,
    });
    await addColumnIfMissing(queryInterface, 'ShiftReportAnswers', 'comment', {
      allowNull: true,
      type: Sequelize.TEXT,
    });
    await removeColumnIfExists(queryInterface, 'ShiftReports', 'comment');
  },
};
