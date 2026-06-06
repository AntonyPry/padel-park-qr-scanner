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
    Account.hasMany(models.OnboardingProgress, {
      as: 'onboardingProgress',
      foreignKey: 'accountId',
    });
    Account.hasOne(models.OnboardingTrainingMode, {
      as: 'onboardingTrainingMode',
      foreignKey: 'accountId',
    });
    Account.hasMany(models.OnboardingEvent, {
      as: 'onboardingEvents',
      foreignKey: 'accountId',
    });
    Account.hasMany(models.EvotorSaleSetting, {
      as: 'createdEvotorSaleSettings',
      foreignKey: 'createdByAccountId',
    });
    Account.hasMany(models.EvotorSaleSetting, {
      as: 'updatedEvotorSaleSettings',
      foreignKey: 'updatedByAccountId',
    });
    Account.hasMany(models.PendingSale, {
      as: 'linkedPendingSales',
      foreignKey: 'linkedByAccountId',
    });
    Account.hasMany(models.PendingSale, {
      as: 'ignoredPendingSales',
      foreignKey: 'ignoredByAccountId',
    });
    Account.hasMany(models.PendingSale, {
      as: 'canceledPendingSales',
      foreignKey: 'canceledByAccountId',
    });
    Account.hasMany(models.PendingSaleHistory, {
      as: 'pendingSaleHistory',
      foreignKey: 'accountId',
    });
    Account.hasMany(models.ClientSubscriptionRedemption, {
      as: 'subscriptionRedemptions',
      foreignKey: 'redeemedByAccountId',
    });
    Account.hasMany(models.ClientSubscriptionRedemption, {
      as: 'reversedSubscriptionRedemptions',
      foreignKey: 'reversedByAccountId',
    });
    Account.hasMany(models.Certificate, {
      as: 'createdCertificates',
      foreignKey: 'createdByAccountId',
    });
    Account.hasMany(models.Certificate, {
      as: 'canceledCertificates',
      foreignKey: 'canceledByAccountId',
    });
    Account.hasMany(models.CertificateRedemption, {
      as: 'certificateRedemptions',
      foreignKey: 'redeemedByAccountId',
    });
    Account.hasMany(models.CertificateRedemption, {
      as: 'reversedCertificateRedemptions',
      foreignKey: 'reversedByAccountId',
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
