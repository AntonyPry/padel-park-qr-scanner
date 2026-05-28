'use strict';

const COURT_TYPE_VALUES = ['all', 'padel_double', 'padel_single', 'other'];
const RULE_STATUS_VALUES = ['active', 'archived'];
const BLOCK_STATUS_VALUES = ['active', 'archived'];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('BookingSettings', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      workingHoursStart: {
        allowNull: false,
        defaultValue: '08:00',
        type: Sequelize.STRING(5),
      },
      workingHoursEnd: {
        allowNull: false,
        defaultValue: '24:00',
        type: Sequelize.STRING(5),
      },
      slotStepMinutes: {
        allowNull: false,
        defaultValue: 30,
        type: Sequelize.INTEGER,
      },
      minDurationMinutes: {
        allowNull: false,
        defaultValue: 60,
        type: Sequelize.INTEGER,
      },
      maxDurationMinutes: {
        allowNull: false,
        defaultValue: 240,
        type: Sequelize.INTEGER,
      },
      cancellationDeadlineHours: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.INTEGER,
      },
      rescheduleDeadlineHours: {
        allowNull: false,
        defaultValue: 0,
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

    await queryInterface.createTable('BookingPriceRules', {
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
      courtType: {
        allowNull: false,
        defaultValue: 'all',
        type: Sequelize.ENUM(...COURT_TYPE_VALUES),
      },
      weekdays: {
        allowNull: false,
        type: Sequelize.JSON,
      },
      startTime: {
        allowNull: false,
        defaultValue: '08:00',
        type: Sequelize.STRING(5),
      },
      endTime: {
        allowNull: false,
        defaultValue: '24:00',
        type: Sequelize.STRING(5),
      },
      pricePerHour: {
        allowNull: false,
        defaultValue: 0,
        type: Sequelize.DECIMAL(10, 2),
      },
      priority: {
        allowNull: false,
        defaultValue: 100,
        type: Sequelize.INTEGER,
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.ENUM(...RULE_STATUS_VALUES),
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

    await queryInterface.createTable('CourtBlocks', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      courtId: {
        allowNull: false,
        references: {
          key: 'id',
          model: 'Courts',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      startsAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      endsAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      reason: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.ENUM(...BLOCK_STATUS_VALUES),
      },
      createdByAccountId: {
        allowNull: true,
        references: {
          key: 'id',
          model: 'Accounts',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      updatedByAccountId: {
        allowNull: true,
        references: {
          key: 'id',
          model: 'Accounts',
        },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
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

    await queryInterface.createTable('BookingScheduleExceptions', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      date: {
        allowNull: false,
        type: Sequelize.DATEONLY,
        unique: true,
      },
      isClosed: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      workingHoursStart: {
        allowNull: true,
        type: Sequelize.STRING(5),
      },
      workingHoursEnd: {
        allowNull: true,
        type: Sequelize.STRING(5),
      },
      reason: {
        allowNull: true,
        type: Sequelize.STRING,
      },
      status: {
        allowNull: false,
        defaultValue: 'active',
        type: Sequelize.ENUM(...RULE_STATUS_VALUES),
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

    await queryInterface.addIndex('BookingPriceRules', ['status', 'courtType', 'priority'], {
      name: 'booking_price_rules_status_court_priority_idx',
    });
    await queryInterface.addIndex('CourtBlocks', ['courtId', 'startsAt', 'endsAt', 'status'], {
      name: 'court_blocks_court_time_status_idx',
    });
    await queryInterface.addIndex('BookingScheduleExceptions', ['date', 'status'], {
      name: 'booking_schedule_exceptions_date_status_idx',
    });

    const now = new Date();
    await queryInterface.bulkInsert('BookingSettings', [
      {
        cancellationDeadlineHours: 0,
        createdAt: now,
        maxDurationMinutes: 240,
        minDurationMinutes: 60,
        rescheduleDeadlineHours: 0,
        slotStepMinutes: 30,
        updatedAt: now,
        workingHoursEnd: '24:00',
        workingHoursStart: '08:00',
      },
    ]);
    await queryInterface.bulkInsert('BookingPriceRules', [
      {
        courtType: 'padel_double',
        createdAt: now,
        endTime: '17:00',
        name: 'Будни дневной 2x2',
        pricePerHour: 3000,
        priority: 100,
        startTime: '08:00',
        status: 'active',
        updatedAt: now,
        weekdays: JSON.stringify([1, 2, 3, 4, 5]),
      },
      {
        courtType: 'padel_double',
        createdAt: now,
        endTime: '24:00',
        name: 'Будни вечер 2x2',
        pricePerHour: 4200,
        priority: 90,
        startTime: '17:00',
        status: 'active',
        updatedAt: now,
        weekdays: JSON.stringify([1, 2, 3, 4, 5]),
      },
      {
        courtType: 'padel_double',
        createdAt: now,
        endTime: '24:00',
        name: 'Выходные 2x2',
        pricePerHour: 4200,
        priority: 95,
        startTime: '08:00',
        status: 'active',
        updatedAt: now,
        weekdays: JSON.stringify([6, 7]),
      },
      {
        courtType: 'padel_single',
        createdAt: now,
        endTime: '24:00',
        name: 'Корт 1x1',
        pricePerHour: 2200,
        priority: 100,
        startTime: '08:00',
        status: 'active',
        updatedAt: now,
        weekdays: JSON.stringify([1, 2, 3, 4, 5, 6, 7]),
      },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('BookingScheduleExceptions');
    await queryInterface.dropTable('CourtBlocks');
    await queryInterface.dropTable('BookingPriceRules');
    await queryInterface.dropTable('BookingSettings');
  },
};
