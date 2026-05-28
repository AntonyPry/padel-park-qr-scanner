'use strict';

const BOOKING_TYPE_VALUES = [
  'game',
  'tournament',
  'personal_training',
  'master_class',
  'group_training',
  'corporate',
];

async function addColumnIfMissing(queryInterface, Sequelize, tableName, columnName, definition) {
  const table = await queryInterface.describeTable(tableName);
  if (!table[columnName]) {
    await queryInterface.addColumn(tableName, columnName, definition(Sequelize));
  }
}

async function removeColumnIfExists(queryInterface, tableName, columnName) {
  const table = await queryInterface.describeTable(tableName);
  if (table[columnName]) {
    await queryInterface.removeColumn(tableName, columnName);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const bookingTypeColumn = (S) => ({
      allowNull: false,
      defaultValue: 'game',
      type: S.ENUM(...BOOKING_TYPE_VALUES),
    });
    const responsibleStaffColumn = (S) => ({
      allowNull: true,
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      references: {
        key: 'id',
        model: 'Staffs',
      },
      type: S.INTEGER,
    });

    await addColumnIfMissing(queryInterface, Sequelize, 'Bookings', 'bookingType', bookingTypeColumn);
    await addColumnIfMissing(queryInterface, Sequelize, 'Bookings', 'responsibleStaffId', responsibleStaffColumn);
    await addColumnIfMissing(queryInterface, Sequelize, 'BookingSeries', 'bookingType', bookingTypeColumn);
    await addColumnIfMissing(queryInterface, Sequelize, 'BookingSeries', 'responsibleStaffId', responsibleStaffColumn);

    await queryInterface.addIndex('Bookings', ['bookingType'], {
      name: 'bookings_type_idx',
    });
    await queryInterface.addIndex('Bookings', ['responsibleStaffId', 'startsAt'], {
      name: 'bookings_responsible_time_idx',
    });
    await queryInterface.addIndex('BookingSeries', ['bookingType'], {
      name: 'booking_series_type_idx',
    });
    await queryInterface.addIndex('BookingSeries', ['responsibleStaffId', 'weekday', 'startTime'], {
      name: 'booking_series_responsible_time_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('BookingSeries', 'booking_series_responsible_time_idx');
    await queryInterface.removeIndex('BookingSeries', 'booking_series_type_idx');
    await queryInterface.removeIndex('Bookings', 'bookings_responsible_time_idx');
    await queryInterface.removeIndex('Bookings', 'bookings_type_idx');
    await removeColumnIfExists(queryInterface, 'BookingSeries', 'responsibleStaffId');
    await removeColumnIfExists(queryInterface, 'BookingSeries', 'bookingType');
    await removeColumnIfExists(queryInterface, 'Bookings', 'responsibleStaffId');
    await removeColumnIfExists(queryInterface, 'Bookings', 'bookingType');
  },
};
