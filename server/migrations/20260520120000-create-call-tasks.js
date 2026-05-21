'use strict';

const TASK_STATUS_VALUES = ['backlog', 'in_progress', 'done', 'archived'];
const TASK_SCOPE_VALUES = ['snapshot', 'dynamic'];
const TASK_CLIENT_STATUS_VALUES = [
  'new',
  'no_answer',
  'callback',
  'doubting',
  'booked',
  'refused',
];

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('CallTasks', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      clientBaseId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'ClientBases',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      scopeType: {
        type: Sequelize.ENUM(...TASK_SCOPE_VALUES),
        allowNull: false,
        defaultValue: 'snapshot',
      },
      status: {
        type: Sequelize.ENUM(...TASK_STATUS_VALUES),
        allowNull: false,
        defaultValue: 'backlog',
      },
      assignedToAccountId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Accounts',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
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
      dueAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      snapshotClientCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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

    await queryInterface.createTable('CallTaskClients', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      callTaskId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'CallTasks',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
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
      clientName: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      clientPhone: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      source: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      visitCount: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      lastVisitAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM(...TASK_CLIENT_STATUS_VALUES),
        allowNull: false,
        defaultValue: 'new',
      },
      summary: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      deadlineAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      contactedAt: {
        type: Sequelize.DATE,
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

    await queryInterface.createTable('CallTaskAttempts', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      callTaskClientId: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'CallTaskClients',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
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
      status: {
        type: Sequelize.ENUM(...TASK_CLIENT_STATUS_VALUES),
        allowNull: false,
      },
      summary: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      deadlineAt: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex('CallTasks', ['clientBaseId'], {
      name: 'call_tasks_client_base_id_idx',
    });
    await queryInterface.addIndex('CallTasks', ['status'], {
      name: 'call_tasks_status_idx',
    });
    await queryInterface.addIndex('CallTasks', ['assignedToAccountId'], {
      name: 'call_tasks_assigned_to_account_id_idx',
    });
    await queryInterface.addIndex('CallTaskClients', ['callTaskId'], {
      name: 'call_task_clients_call_task_id_idx',
    });
    await queryInterface.addIndex('CallTaskClients', ['userId'], {
      name: 'call_task_clients_user_id_idx',
    });
    await queryInterface.addIndex('CallTaskClients', ['status'], {
      name: 'call_task_clients_status_idx',
    });
    await queryInterface.addIndex('CallTaskClients', ['deadlineAt'], {
      name: 'call_task_clients_deadline_at_idx',
    });
    await queryInterface.addIndex('CallTaskClients', ['callTaskId', 'userId'], {
      unique: true,
      name: 'call_task_clients_task_user_unique',
    });
    await queryInterface.addIndex('CallTaskAttempts', ['callTaskClientId'], {
      name: 'call_task_attempts_task_client_id_idx',
    });
    await queryInterface.addIndex('CallTaskAttempts', ['actorAccountId'], {
      name: 'call_task_attempts_actor_account_id_idx',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex(
      'CallTaskAttempts',
      'call_task_attempts_actor_account_id_idx',
    );
    await queryInterface.removeIndex(
      'CallTaskAttempts',
      'call_task_attempts_task_client_id_idx',
    );
    await queryInterface.removeIndex(
      'CallTaskClients',
      'call_task_clients_task_user_unique',
    );
    await queryInterface.removeIndex(
      'CallTaskClients',
      'call_task_clients_deadline_at_idx',
    );
    await queryInterface.removeIndex(
      'CallTaskClients',
      'call_task_clients_status_idx',
    );
    await queryInterface.removeIndex(
      'CallTaskClients',
      'call_task_clients_user_id_idx',
    );
    await queryInterface.removeIndex(
      'CallTaskClients',
      'call_task_clients_call_task_id_idx',
    );
    await queryInterface.removeIndex(
      'CallTasks',
      'call_tasks_assigned_to_account_id_idx',
    );
    await queryInterface.removeIndex('CallTasks', 'call_tasks_status_idx');
    await queryInterface.removeIndex('CallTasks', 'call_tasks_client_base_id_idx');

    await queryInterface.dropTable('CallTaskAttempts');
    await queryInterface.dropTable('CallTaskClients');
    await queryInterface.dropTable('CallTasks');

    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_CallTasks_scopeType";',
      );
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_CallTasks_status";',
      );
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_CallTaskClients_status";',
      );
      await queryInterface.sequelize.query(
        'DROP TYPE IF EXISTS "enum_CallTaskAttempts_status";',
      );
    }
  },
};
