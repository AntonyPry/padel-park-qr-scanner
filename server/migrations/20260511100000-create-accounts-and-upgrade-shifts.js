'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Accounts', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      staffId: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Staffs',
          key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      email: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true,
      },
      passwordHash: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      role: {
        type: Sequelize.ENUM('owner', 'manager', 'admin', 'accountant', 'viewer'),
        allowNull: false,
        defaultValue: 'admin',
      },
      status: {
        type: Sequelize.ENUM('active', 'inactive'),
        allowNull: false,
        defaultValue: 'active',
      },
      lastLoginAt: {
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

    await queryInterface.addColumn('Shifts', 'staffId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Staffs',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('Shifts', 'actualHours', {
      type: Sequelize.DECIMAL(4, 1),
      allowNull: true,
    });
    await queryInterface.addColumn('Shifts', 'startedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('Shifts', 'endedAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('Shifts', 'status', {
      type: Sequelize.ENUM('draft', 'active', 'closed', 'approved'),
      allowNull: false,
      defaultValue: 'closed',
    });
    await queryInterface.addColumn('Shifts', 'approvedByAccountId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Accounts',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addIndex('Accounts', ['staffId']);
    await queryInterface.addIndex('Accounts', ['email']);
    await queryInterface.addIndex('Shifts', ['staffId']);
    await queryInterface.addIndex('Shifts', ['status']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeIndex('Shifts', ['status']);
    await queryInterface.removeIndex('Shifts', ['staffId']);
    await queryInterface.removeIndex('Accounts', ['email']);
    await queryInterface.removeIndex('Accounts', ['staffId']);

    await queryInterface.removeColumn('Shifts', 'approvedByAccountId');
    await queryInterface.removeColumn('Shifts', 'status');
    await queryInterface.removeColumn('Shifts', 'endedAt');
    await queryInterface.removeColumn('Shifts', 'startedAt');
    await queryInterface.removeColumn('Shifts', 'actualHours');
    await queryInterface.removeColumn('Shifts', 'staffId');

    await queryInterface.dropTable('Accounts');

    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Accounts_role";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Accounts_status";');
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Shifts_status";');
    }
  },
};
