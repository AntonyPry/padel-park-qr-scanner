'use strict';

const BOOKING_STATUS_VALUES = ['new', 'confirmed', 'canceled', 'arrived', 'no_show'];
const PAYMENT_STATUS_VALUES = ['unpaid', 'partial', 'paid', 'refunded'];
const PAYMENT_METHOD_VALUES = ['unknown', 'cash', 'cashless', 'mixed'];
const BOOKING_SOURCE_VALUES = ['phone', 'admin', 'walk_in', 'other'];
const COURT_TYPE_VALUES = ['padel_double', 'padel_single', 'other'];
const CHANGE_ACTION_VALUES = [
  'created',
  'updated',
  'status_changed',
  'canceled',
  'rescheduled',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Courts', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      type: {
        type: Sequelize.ENUM(...COURT_TYPE_VALUES),
        allowNull: false,
        defaultValue: 'padel_double',
      },
      sortOrder: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      isActive: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.createTable('Bookings', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      courtId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Courts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      clientName: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      clientPhone: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      startsAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      endsAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      durationMinutes: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM(...BOOKING_STATUS_VALUES),
        allowNull: false,
        defaultValue: 'new',
      },
      paymentStatus: {
        type: Sequelize.ENUM(...PAYMENT_STATUS_VALUES),
        allowNull: false,
        defaultValue: 'unpaid',
      },
      paymentMethod: {
        type: Sequelize.ENUM(...PAYMENT_METHOD_VALUES),
        allowNull: false,
        defaultValue: 'unknown',
      },
      price: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      paidAmount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      source: {
        type: Sequelize.ENUM(...BOOKING_SOURCE_VALUES),
        allowNull: false,
        defaultValue: 'phone',
      },
      comment: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      cancellationReason: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      canceledAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      createdByAccountId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      updatedByAccountId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
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

    await queryInterface.createTable('BookingChangeLogs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      bookingId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Bookings',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      action: {
        type: Sequelize.ENUM(...CHANGE_ACTION_VALUES),
        allowNull: false,
      },
      fromStatus: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      toStatus: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      actorAccountId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      reason: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      snapshot: {
        type: Sequelize.JSON,
        allowNull: true,
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

    await queryInterface.addIndex('Courts', ['isActive', 'sortOrder'], {
      name: 'courts_active_sort_idx',
    });
    await queryInterface.addIndex('Bookings', ['courtId', 'startsAt', 'endsAt'], {
      name: 'bookings_court_time_idx',
    });
    await queryInterface.addIndex('Bookings', ['userId', 'startsAt'], {
      name: 'bookings_user_time_idx',
    });
    await queryInterface.addIndex('Bookings', ['status'], {
      name: 'bookings_status_idx',
    });
    await queryInterface.addIndex('Bookings', ['paymentStatus'], {
      name: 'bookings_payment_status_idx',
    });
    await queryInterface.addIndex('BookingChangeLogs', ['bookingId', 'createdAt'], {
      name: 'booking_change_logs_booking_created_idx',
    });

    const now = new Date();
    await queryInterface.bulkInsert('Courts', [
      { name: 'Корт 1', type: 'padel_double', sortOrder: 10, isActive: true, createdAt: now, updatedAt: now },
      { name: 'Корт 2', type: 'padel_double', sortOrder: 20, isActive: true, createdAt: now, updatedAt: now },
      { name: 'Корт 3', type: 'padel_double', sortOrder: 30, isActive: true, createdAt: now, updatedAt: now },
      { name: 'Корт 4', type: 'padel_double', sortOrder: 40, isActive: true, createdAt: now, updatedAt: now },
      { name: 'Корт 5', type: 'padel_double', sortOrder: 50, isActive: true, createdAt: now, updatedAt: now },
      { name: 'Корт 1x1', type: 'padel_single', sortOrder: 60, isActive: true, createdAt: now, updatedAt: now },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('BookingChangeLogs');
    await queryInterface.dropTable('Bookings');
    await queryInterface.dropTable('Courts');
  },
};
