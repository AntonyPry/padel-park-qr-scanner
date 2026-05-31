module.exports = (sequelize, DataTypes) => {
  const CallTaskClient = sequelize.define('CallTaskClient', {
    callTaskId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    clientName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    clientPhone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    source: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    visitCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    lastVisitAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM(
        'new',
        'no_answer',
        'callback',
        'doubting',
        'booked',
        'refused',
      ),
      allowNull: false,
      defaultValue: 'new',
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    deadlineAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    contactedAt: {
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

  CallTaskClient.associate = (models) => {
    CallTaskClient.belongsTo(models.CallTask, {
      as: 'callTask',
      foreignKey: 'callTaskId',
    });
    CallTaskClient.belongsTo(models.User, {
      as: 'client',
      foreignKey: 'userId',
    });
    CallTaskClient.hasMany(models.CallTaskAttempt, {
      as: 'attempts',
      foreignKey: 'callTaskClientId',
    });
  };

  return CallTaskClient;
};
