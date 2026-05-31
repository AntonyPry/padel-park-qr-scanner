module.exports = (sequelize, DataTypes) => {
  const CallTaskAttempt = sequelize.define('CallTaskAttempt', {
    callTaskClientId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    actorAccountId: {
      type: DataTypes.INTEGER,
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
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    deadlineAt: {
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

  CallTaskAttempt.associate = (models) => {
    CallTaskAttempt.belongsTo(models.CallTaskClient, {
      as: 'taskClient',
      foreignKey: 'callTaskClientId',
    });
    CallTaskAttempt.belongsTo(models.Account, {
      as: 'actorAccount',
      foreignKey: 'actorAccountId',
    });
  };

  return CallTaskAttempt;
};
