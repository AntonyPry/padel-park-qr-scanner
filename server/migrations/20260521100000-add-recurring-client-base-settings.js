'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ClientBases', 'recurringEnabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('ClientBases', 'recurringInterval', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'none',
    });
    await queryInterface.addColumn('ClientBases', 'recurringWeekday', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('ClientBases', 'recurringTime', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('ClientBases', 'recurringScopeType', {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: 'snapshot',
    });
    await queryInterface.addColumn('ClientBases', 'recurringDueDays', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('ClientBases', 'recurringAssignedToAccountId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Accounts',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('ClientBases', 'recurringTitle', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('ClientBases', 'recurringDescription', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('ClientBases', 'recurringNextRunAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('ClientBases', 'recurringLastRunAt', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addIndex('ClientBases', ['recurringEnabled', 'recurringNextRunAt'], {
      name: 'client_bases_recurring_due_idx',
    });
    await queryInterface.addIndex('ClientBases', ['recurringAssignedToAccountId'], {
      name: 'client_bases_recurring_assignee_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'ClientBases',
      'client_bases_recurring_assignee_idx',
    );
    await queryInterface.removeIndex('ClientBases', 'client_bases_recurring_due_idx');
    await queryInterface.removeColumn('ClientBases', 'recurringLastRunAt');
    await queryInterface.removeColumn('ClientBases', 'recurringNextRunAt');
    await queryInterface.removeColumn('ClientBases', 'recurringDescription');
    await queryInterface.removeColumn('ClientBases', 'recurringTitle');
    await queryInterface.removeColumn('ClientBases', 'recurringAssignedToAccountId');
    await queryInterface.removeColumn('ClientBases', 'recurringDueDays');
    await queryInterface.removeColumn('ClientBases', 'recurringScopeType');
    await queryInterface.removeColumn('ClientBases', 'recurringTime');
    await queryInterface.removeColumn('ClientBases', 'recurringWeekday');
    await queryInterface.removeColumn('ClientBases', 'recurringInterval');
    await queryInterface.removeColumn('ClientBases', 'recurringEnabled');
  },
};
