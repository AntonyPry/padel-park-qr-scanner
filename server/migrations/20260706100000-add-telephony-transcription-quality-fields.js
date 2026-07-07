'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('TelephonyTranscriptionJobs');

    if (!table.rawTranscriptText) {
      await queryInterface.addColumn('TelephonyTranscriptionJobs', 'rawTranscriptText', {
        allowNull: true,
        type: Sequelize.TEXT,
      });
    }
    if (!table.rawAsrJson) {
      await queryInterface.addColumn('TelephonyTranscriptionJobs', 'rawAsrJson', {
        allowNull: true,
        type: Sequelize.JSON,
      });
    }
    if (!table.corrections) {
      await queryInterface.addColumn('TelephonyTranscriptionJobs', 'corrections', {
        allowNull: true,
        type: Sequelize.JSON,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('TelephonyTranscriptionJobs');

    if (table.corrections) {
      await queryInterface.removeColumn('TelephonyTranscriptionJobs', 'corrections');
    }
    if (table.rawAsrJson) {
      await queryInterface.removeColumn('TelephonyTranscriptionJobs', 'rawAsrJson');
    }
    if (table.rawTranscriptText) {
      await queryInterface.removeColumn('TelephonyTranscriptionJobs', 'rawTranscriptText');
    }
  },
};
