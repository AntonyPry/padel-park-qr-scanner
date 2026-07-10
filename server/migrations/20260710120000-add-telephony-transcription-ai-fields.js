'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('TelephonyTranscriptionJobs');

    if (!table.aiTranscriptText) {
      await queryInterface.addColumn('TelephonyTranscriptionJobs', 'aiTranscriptText', {
        allowNull: true,
        type: Sequelize.TEXT,
      });
    }
    if (!table.aiTranscriptSegments) {
      await queryInterface.addColumn('TelephonyTranscriptionJobs', 'aiTranscriptSegments', {
        allowNull: true,
        type: Sequelize.JSON,
      });
    }
    if (!table.aiCorrections) {
      await queryInterface.addColumn('TelephonyTranscriptionJobs', 'aiCorrections', {
        allowNull: true,
        type: Sequelize.JSON,
      });
    }
    if (!table.aiMetadata) {
      await queryInterface.addColumn('TelephonyTranscriptionJobs', 'aiMetadata', {
        allowNull: true,
        type: Sequelize.JSON,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('TelephonyTranscriptionJobs');

    if (table.aiMetadata) {
      await queryInterface.removeColumn('TelephonyTranscriptionJobs', 'aiMetadata');
    }
    if (table.aiCorrections) {
      await queryInterface.removeColumn('TelephonyTranscriptionJobs', 'aiCorrections');
    }
    if (table.aiTranscriptSegments) {
      await queryInterface.removeColumn('TelephonyTranscriptionJobs', 'aiTranscriptSegments');
    }
    if (table.aiTranscriptText) {
      await queryInterface.removeColumn('TelephonyTranscriptionJobs', 'aiTranscriptText');
    }
  },
};
