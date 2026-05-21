module.exports = (sequelize, DataTypes) => {
  const Account = sequelize.define('Account', {
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    passwordHash: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    role: {
      type: DataTypes.ENUM(
        'owner',
        'manager',
        'admin',
        'accountant',
        'viewer',
        'trainer',
      ),
      allowNull: false,
      defaultValue: 'admin',
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive', 'archived'),
      allowNull: false,
      defaultValue: 'active',
    },
    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  Account.associate = (models) => {
    Account.belongsTo(models.Staff, { foreignKey: 'staffId' });
    Account.hasMany(models.Shift, {
      as: 'approvedShifts',
      foreignKey: 'approvedByAccountId',
    });
    Account.hasMany(models.TrainingNote, {
      as: 'trainingNotes',
      foreignKey: 'trainerAccountId',
    });
    Account.hasMany(models.CallTask, {
      as: 'assignedCallTasks',
      foreignKey: 'assignedToAccountId',
    });
    Account.hasMany(models.CallTask, {
      as: 'createdCallTasks',
      foreignKey: 'createdByAccountId',
    });
    Account.hasMany(models.CallTaskAttempt, {
      as: 'callTaskAttempts',
      foreignKey: 'actorAccountId',
    });
  };

  return Account;
};
