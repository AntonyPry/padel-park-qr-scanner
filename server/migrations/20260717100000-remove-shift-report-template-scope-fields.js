'use strict';

async function describe(queryInterface) {
  try {
    return await queryInterface.describeTable('ShiftReportTemplates');
  } catch {
    return {};
  }
}

module.exports = {
  async up(queryInterface) {
    const columns = await describe(queryInterface);

    if (columns.appliesToRole) {
      await queryInterface.removeColumn('ShiftReportTemplates', 'appliesToRole');
    }
    if (columns.appliesToShiftType) {
      await queryInterface.removeColumn('ShiftReportTemplates', 'appliesToShiftType');
    }
  },

  async down(queryInterface, Sequelize) {
    const columns = await describe(queryInterface);

    if (!columns.appliesToRole) {
      await queryInterface.addColumn('ShiftReportTemplates', 'appliesToRole', {
        allowNull: true,
        type: Sequelize.STRING,
      });
    }
    if (!columns.appliesToShiftType) {
      await queryInterface.addColumn('ShiftReportTemplates', 'appliesToShiftType', {
        allowNull: true,
        type: Sequelize.STRING,
      });
    }
  },
};
