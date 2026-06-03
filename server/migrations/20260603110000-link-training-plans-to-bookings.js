'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('BookingParticipants', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      bookingId: {
        allowNull: false,
        references: {
          key: 'id',
          model: 'Bookings',
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        type: Sequelize.INTEGER,
      },
      userId: {
        allowNull: false,
        references: {
          key: 'id',
          model: 'Users',
        },
        onDelete: 'CASCADE',
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

    await queryInterface.addColumn('TrainingPlans', 'bookingId', {
      allowNull: true,
      references: {
        key: 'id',
        model: 'Bookings',
      },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
      type: Sequelize.INTEGER,
    });

    await queryInterface.addIndex('BookingParticipants', ['bookingId', 'userId'], {
      name: 'booking_participants_booking_user_unique',
      unique: true,
    });
    await queryInterface.addIndex('BookingParticipants', ['userId', 'bookingId'], {
      name: 'booking_participants_user_booking_idx',
    });
    await queryInterface.addIndex('TrainingPlans', ['bookingId'], {
      name: 'training_plans_booking_id_unique',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'TrainingPlans',
      'training_plans_booking_id_unique',
    );
    await queryInterface.removeColumn('TrainingPlans', 'bookingId');
    await queryInterface.removeIndex(
      'BookingParticipants',
      'booking_participants_user_booking_idx',
    );
    await queryInterface.removeIndex(
      'BookingParticipants',
      'booking_participants_booking_user_unique',
    );
    await queryInterface.dropTable('BookingParticipants');
  },
};
