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
    Account.hasMany(models.Shift, {
      as: 'archivedShifts',
      foreignKey: 'archivedByAccountId',
    });
    Account.hasMany(models.Finance, {
      as: 'createdFinanceRecords',
      foreignKey: 'createdByAccountId',
    });
    Account.hasMany(models.PayrollPeriod, {
      as: 'reviewedPayrollPeriods',
      foreignKey: 'reviewedByAccountId',
    });
    Account.hasMany(models.PayrollPeriod, {
      as: 'approvedPayrollPeriods',
      foreignKey: 'approvedByAccountId',
    });
    Account.hasMany(models.PayrollPeriod, {
      as: 'paidPayrollPeriods',
      foreignKey: 'paidByAccountId',
    });
    Account.hasMany(models.FinanceChangeLog, {
      as: 'financeChangeLogs',
      foreignKey: 'accountId',
    });
    Account.hasMany(models.ScannerEvent, {
      as: 'scannerEvents',
      foreignKey: 'accountId',
    });
    Account.hasMany(models.Visit, {
      as: 'issuedVisitKeys',
      foreignKey: 'keyIssuedByAccountId',
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
    Account.hasMany(models.ClientSavedView, {
      as: 'clientSavedViews',
      foreignKey: 'accountId',
    });
    Account.hasMany(models.Booking, {
      as: 'createdBookings',
      foreignKey: 'createdByAccountId',
    });
    Account.hasMany(models.Booking, {
      as: 'updatedBookings',
      foreignKey: 'updatedByAccountId',
    });
    Account.hasMany(models.BookingChangeLog, {
      as: 'bookingChangeLogs',
      foreignKey: 'actorAccountId',
    });
    Account.hasMany(models.BookingSeries, {
      as: 'createdBookingSeries',
      foreignKey: 'createdByAccountId',
    });
    Account.hasMany(models.BookingSeries, {
      as: 'updatedBookingSeries',
      foreignKey: 'updatedByAccountId',
    });
    Account.hasMany(models.CourtBlock, {
      as: 'createdCourtBlocks',
      foreignKey: 'createdByAccountId',
    });
    Account.hasMany(models.CourtBlock, {
      as: 'updatedCourtBlocks',
      foreignKey: 'updatedByAccountId',
    });
  };

  return Account;
};
