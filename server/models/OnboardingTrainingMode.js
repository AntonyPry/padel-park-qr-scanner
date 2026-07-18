module.exports = (sequelize, DataTypes) => {
  const ownership = ['accountId', 'organizationId', 'membershipId'];
  const OnboardingTrainingMode = sequelize.define('OnboardingTrainingMode', {
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    organizationId: { type: DataTypes.INTEGER, allowNull: false },
    membershipId: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    clubId: { type: DataTypes.INTEGER, allowNull: false },
    sessionId: { type: DataTypes.UUID, allowNull: true, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: true },
    isEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
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
      allowNull: true,
    },
    enabledAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    disabledAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  }, {
    hooks: {
      beforeBulkUpdate(options) {
        if ([...ownership, 'clubId', 'role', 'sessionId'].some(
          (field) => Object.hasOwn(options.attributes || {}, field),
        )) {
          throw new Error('OnboardingTrainingMode ownership is immutable');
        }
      },
      beforeUpdate(row) {
        if (ownership.some((field) => row.changed(field))) {
          throw new Error('OnboardingTrainingMode ownership is immutable');
        }
        if (
          row.previous('sessionId') &&
          (row.changed('clubId') || row.changed('role') ||
            (row.changed('sessionId') && row.sessionId))
        ) {
          throw new Error('Retained onboarding session ownership is immutable');
        }
      },
    },
  });

  OnboardingTrainingMode.associate = (models) => {
    OnboardingTrainingMode.belongsTo(models.Account, {
      as: 'account',
      foreignKey: 'accountId',
    });
    OnboardingTrainingMode.belongsTo(models.Organization, {
      foreignKey: 'organizationId',
    });
    OnboardingTrainingMode.belongsTo(models.Membership, {
      foreignKey: 'membershipId',
    });
    OnboardingTrainingMode.belongsTo(models.Club, {
      foreignKey: 'clubId',
    });
  };

  return OnboardingTrainingMode;
};
