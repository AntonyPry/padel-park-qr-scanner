module.exports = (sequelize, DataTypes) => {
  const ownership = ['accountId', 'organizationId', 'membershipId', 'clubId'];
  const OnboardingProgress = sequelize.define('OnboardingProgress', {
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    membershipId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: true,
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
    },
    taskKey: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('in_progress', 'completed', 'skipped'),
      allowNull: false,
      defaultValue: 'in_progress',
    },
    completedAt: {
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
        if (ownership.some((field) => Object.hasOwn(options.attributes || {}, field))) {
          throw new Error('OnboardingProgress ownership is immutable');
        }
      },
      beforeUpdate(row) {
        if (ownership.some((field) => row.changed(field))) {
          throw new Error('OnboardingProgress ownership is immutable');
        }
      },
    },
  });

  OnboardingProgress.associate = (models) => {
    OnboardingProgress.belongsTo(models.Account, {
      as: 'account',
      foreignKey: 'accountId',
    });
    OnboardingProgress.belongsTo(models.Organization, {
      foreignKey: 'organizationId',
    });
    OnboardingProgress.belongsTo(models.Membership, {
      foreignKey: 'membershipId',
    });
    OnboardingProgress.belongsTo(models.Club, {
      foreignKey: 'clubId',
    });
  };

  return OnboardingProgress;
};
