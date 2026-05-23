'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ScannerEvents', 'qrHash', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addIndex('ScannerEvents', ['qrHash'], {
      name: 'scanner_events_qr_hash_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('ScannerEvents', 'scanner_events_qr_hash_idx');
    await queryInterface.removeColumn('ScannerEvents', 'qrHash');
  },
};
