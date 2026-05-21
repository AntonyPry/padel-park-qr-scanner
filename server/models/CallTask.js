module.exports = (sequelize, DataTypes) => {
  const CallTask = sequelize.define('CallTask', {
    clientBaseId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    scopeType: {
      type: DataTypes.ENUM('snapshot', 'dynamic'),
      allowNull: false,
      defaultValue: 'snapshot',
    },
    status: {
      type: DataTypes.ENUM('backlog', 'in_progress', 'done', 'archived'),
      allowNull: false,
      defaultValue: 'backlog',
    },
    assignedToAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    createdByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    dueAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    snapshotClientCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
  });

  CallTask.associate = (models) => {
    CallTask.belongsTo(models.ClientBase, {
      as: 'clientBase',
      foreignKey: 'clientBaseId',
    });
    CallTask.belongsTo(models.Account, {
      as: 'assignedToAccount',
      foreignKey: 'assignedToAccountId',
    });
    CallTask.belongsTo(models.Account, {
      as: 'createdByAccount',
      foreignKey: 'createdByAccountId',
    });
    CallTask.hasMany(models.CallTaskClient, {
      as: 'clients',
      foreignKey: 'callTaskId',
    });
  };

  return CallTask;
};
