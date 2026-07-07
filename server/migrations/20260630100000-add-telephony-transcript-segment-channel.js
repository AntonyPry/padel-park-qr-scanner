module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('TelephonyTranscriptSegments');
    if (!table.channel) {
      await queryInterface.addColumn('TelephonyTranscriptSegments', 'channel', {
        allowNull: true,
        type: Sequelize.STRING,
      });
    }
  },

  async down(queryInterface) {
    const table = await queryInterface.describeTable('TelephonyTranscriptSegments');
    if (table.channel) {
      await queryInterface.removeColumn('TelephonyTranscriptSegments', 'channel');
    }
  },
};
