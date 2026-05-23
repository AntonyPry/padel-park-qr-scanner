'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('ScannerEvents', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      eventType: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      severity: {
        type: Sequelize.ENUM('info', 'warning', 'error'),
        allowNull: false,
        defaultValue: 'info',
      },
      status: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      code: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      source: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      qrPreview: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      visitId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Visits',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      userId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      accountId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      clientEventId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.fn('NOW'),
      },
    });

    await queryInterface.addIndex('ScannerEvents', ['createdAt'], {
      name: 'scanner_events_created_at_idx',
    });
    await queryInterface.addIndex('ScannerEvents', ['eventType'], {
      name: 'scanner_events_type_idx',
    });
    await queryInterface.addIndex('ScannerEvents', ['accountId'], {
      name: 'scanner_events_account_idx',
    });
    await queryInterface.addIndex('ScannerEvents', ['clientEventId', 'eventType'], {
      unique: true,
      name: 'scanner_events_client_event_type_unique',
    });

    await queryInterface.addColumn('Visits', 'entrySource', {
      type: Sequelize.ENUM('qr', 'manual'),
      allowNull: false,
      defaultValue: 'qr',
    });
    await queryInterface.addColumn('Visits', 'qrRaw', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('Visits', 'duplicateOfVisitId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Visits',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('Visits', 'keyIssuedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('Visits', 'keyIssuedByAccountId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Accounts',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addIndex('Visits', ['userId', 'createdAt'], {
      name: 'visits_user_created_at_idx',
    });
    await queryInterface.addIndex('Visits', ['duplicateOfVisitId'], {
      name: 'visits_duplicate_of_idx',
    });
    await queryInterface.addIndex('Visits', ['keyIssuedByAccountId'], {
      name: 'visits_key_issued_by_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('Visits', 'visits_key_issued_by_idx');
    await queryInterface.removeIndex('Visits', 'visits_duplicate_of_idx');
    await queryInterface.removeIndex('Visits', 'visits_user_created_at_idx');
    await queryInterface.removeColumn('Visits', 'keyIssuedByAccountId');
    await queryInterface.removeColumn('Visits', 'keyIssuedAt');
    await queryInterface.removeColumn('Visits', 'duplicateOfVisitId');
    await queryInterface.removeColumn('Visits', 'qrRaw');
    await queryInterface.removeColumn('Visits', 'entrySource');

    await queryInterface.removeIndex('ScannerEvents', 'scanner_events_client_event_type_unique');
    await queryInterface.removeIndex('ScannerEvents', 'scanner_events_account_idx');
    await queryInterface.removeIndex('ScannerEvents', 'scanner_events_type_idx');
    await queryInterface.removeIndex('ScannerEvents', 'scanner_events_created_at_idx');
    await queryInterface.dropTable('ScannerEvents');
  },
};
