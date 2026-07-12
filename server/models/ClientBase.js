module.exports = (sequelize, DataTypes) => {
  const ClientBase = sequelize.define('ClientBase', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    filters: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    origin: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    originMetadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('active', 'archived'),
      allowNull: false,
      defaultValue: 'active',
    },
    createdByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    lastCalculatedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastTaskCreatedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastTaskClientCount: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    slaDays: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    recurringEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    recurringInterval: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'none',
    },
    recurringWeekday: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    recurringTime: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    recurringScopeType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'snapshot',
    },
    recurringDueDays: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    recurringAssignedToAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    recurringTitle: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    recurringDescription: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    recurringNextRunAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    recurringLastRunAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    isTraining: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    trainingRole: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    trainingAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  });

  ClientBase.associate = (models) => {
    ClientBase.belongsTo(models.Account, {
      as: 'createdByAccount',
      foreignKey: 'createdByAccountId',
    });
    ClientBase.belongsTo(models.Account, {
      as: 'recurringAssignedToAccount',
      foreignKey: 'recurringAssignedToAccountId',
    });
    ClientBase.hasMany(models.CallTask, {
      as: 'callTasks',
      foreignKey: 'clientBaseId',
    });
  };

  return ClientBase;
};
