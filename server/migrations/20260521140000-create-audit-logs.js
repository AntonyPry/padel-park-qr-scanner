'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('AuditLogs', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
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
      role: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      action: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      entityType: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      entityId: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      method: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      path: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      statusCode: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      summary: {
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

    await queryInterface.addIndex('AuditLogs', ['createdAt'], {
      name: 'audit_logs_created_at_idx',
    });
    await queryInterface.addIndex('AuditLogs', ['accountId'], {
      name: 'audit_logs_account_id_idx',
    });
    await queryInterface.addIndex('AuditLogs', ['entityType', 'entityId'], {
      name: 'audit_logs_entity_idx',
    });
    await queryInterface.addIndex('AuditLogs', ['action'], {
      name: 'audit_logs_action_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('AuditLogs', 'audit_logs_action_idx');
    await queryInterface.removeIndex('AuditLogs', 'audit_logs_entity_idx');
    await queryInterface.removeIndex('AuditLogs', 'audit_logs_account_id_idx');
    await queryInterface.removeIndex('AuditLogs', 'audit_logs_created_at_idx');
    await queryInterface.dropTable('AuditLogs');
  },
};
