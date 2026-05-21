'use strict';

const ACCOUNT_ROLES_WITH_TRAINER = [
  'owner',
  'manager',
  'admin',
  'accountant',
  'viewer',
  'trainer',
];

const ACCOUNT_ROLES_WITHOUT_TRAINER = [
  'owner',
  'manager',
  'admin',
  'accountant',
  'viewer',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('Accounts', 'role', {
      type: Sequelize.ENUM(...ACCOUNT_ROLES_WITH_TRAINER),
      allowNull: false,
      defaultValue: 'admin',
    });

    await queryInterface.createTable('TrainingNotes', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      trainerAccountId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      trainedAt: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      level: {
        type: Sequelize.ENUM('D', 'D+', 'C', 'C+', 'B', 'B+', 'A'),
        allowNull: false,
      },
      exercises: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      note: {
        type: Sequelize.TEXT,
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

    await queryInterface.createTable('ClientBases', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      filters: {
        type: Sequelize.JSON,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('active', 'archived'),
        allowNull: false,
        defaultValue: 'active',
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
      lastCalculatedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      lastTaskCreatedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      lastTaskClientCount: {
        type: Sequelize.INTEGER,
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

    await queryInterface.addIndex('TrainingNotes', ['userId'], {
      name: 'training_notes_user_id_idx',
    });
    await queryInterface.addIndex('TrainingNotes', ['trainerAccountId'], {
      name: 'training_notes_trainer_account_id_idx',
    });
    await queryInterface.addIndex('TrainingNotes', ['trainedAt'], {
      name: 'training_notes_trained_at_idx',
    });
    await queryInterface.addIndex('ClientBases', ['status'], {
      name: 'client_bases_status_idx',
    });
    await queryInterface.addIndex('ClientBases', ['createdByAccountId'], {
      name: 'client_bases_created_by_account_id_idx',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('ClientBases', 'client_bases_created_by_account_id_idx');
    await queryInterface.removeIndex('ClientBases', 'client_bases_status_idx');
    await queryInterface.removeIndex('TrainingNotes', 'training_notes_trained_at_idx');
    await queryInterface.removeIndex(
      'TrainingNotes',
      'training_notes_trainer_account_id_idx',
    );
    await queryInterface.removeIndex('TrainingNotes', 'training_notes_user_id_idx');

    await queryInterface.dropTable('ClientBases');
    await queryInterface.dropTable('TrainingNotes');

    await queryInterface.bulkUpdate(
      'Accounts',
      { role: 'viewer' },
      { role: 'trainer' },
    );

    await queryInterface.changeColumn('Accounts', 'role', {
      type: Sequelize.ENUM(...ACCOUNT_ROLES_WITHOUT_TRAINER),
      allowNull: false,
      defaultValue: 'admin',
    });

    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_TrainingNotes_level";',
      );
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_ClientBases_status";',
      );
    }
  },
};
