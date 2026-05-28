'use strict';

const PAYMENT_STATUS_VALUES = ['unpaid', 'partial', 'paid', 'refunded'];
const PAYMENT_METHOD_VALUES = ['unknown', 'cash', 'cashless', 'mixed'];
const BOOKING_SOURCE_VALUES = ['phone', 'admin', 'walk_in', 'other'];
const SERIES_STATUS_VALUES = ['active', 'archived'];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('BookingSeries', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      name: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      courtId: {
        allowNull: false,
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        references: {
          key: 'id',
          model: 'Courts',
        },
        type: Sequelize.INTEGER,
      },
      userId: {
        allowNull: false,
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        references: {
          key: 'id',
          model: 'Users',
        },
        type: Sequelize.INTEGER,
      },
      clientName: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      clientPhone: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      weekday: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      startTime: {
        allowNull: false,
        type: Sequelize.STRING(5),
      },
      durationMinutes: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      startsOn: {
        allowNull: false,
        type: Sequelize.DATEONLY,
      },
      endsOn: {
        allowNull: false,
        type: Sequelize.DATEONLY,
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.ENUM(...SERIES_STATUS_VALUES),
      },
      paymentStatus: {
        allowNull: false,
        defaultValue: 'unpaid',
        type: Sequelize.ENUM(...PAYMENT_STATUS_VALUES),
      },
      paymentMethod: {
        allowNull: false,
        defaultValue: 'unknown',
        type: Sequelize.ENUM(...PAYMENT_METHOD_VALUES),
      },
      price: {
        allowNull: true,
        type: Sequelize.DECIMAL(10, 2),
      },
      source: {
        allowNull: false,
        defaultValue: 'phone',
        type: Sequelize.ENUM(...BOOKING_SOURCE_VALUES),
      },
      comment: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      lastGeneratedUntil: {
        allowNull: true,
        type: Sequelize.DATEONLY,
      },
      archivedAt: {
        allowNull: true,
        type: Sequelize.DATE,
      },
      archiveReason: {
        allowNull: true,
        type: Sequelize.TEXT,
      },
      createdByAccountId: {
        allowNull: true,
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        references: {
          key: 'id',
          model: 'Accounts',
        },
        type: Sequelize.INTEGER,
      },
      updatedByAccountId: {
        allowNull: true,
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        references: {
          key: 'id',
          model: 'Accounts',
        },
        type: Sequelize.INTEGER,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.addColumn('Bookings', 'bookingSeriesId', {
      allowNull: true,
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      references: {
        key: 'id',
        model: 'BookingSeries',
      },
      type: Sequelize.INTEGER,
    });

    await queryInterface.addIndex('BookingSeries', ['status', 'weekday', 'startTime'], {
      name: 'booking_series_status_weekday_time_idx',
    });
    await queryInterface.addIndex('BookingSeries', ['courtId', 'startsOn', 'endsOn'], {
      name: 'booking_series_court_dates_idx',
    });
    await queryInterface.addIndex('BookingSeries', ['userId', 'startsOn', 'endsOn'], {
      name: 'booking_series_user_dates_idx',
    });
    await queryInterface.addIndex('Bookings', ['bookingSeriesId', 'startsAt'], {
      name: 'bookings_series_time_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Bookings', 'bookings_series_time_idx');
    await queryInterface.removeColumn('Bookings', 'bookingSeriesId');
    await queryInterface.dropTable('BookingSeries');
  },
};
