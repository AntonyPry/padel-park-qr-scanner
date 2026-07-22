module.exports = (sequelize, DataTypes) => {
  const immutableError = () => {
    const error = new Error('OnboardingEvent rows are immutable');
    error.code = 'ONBOARDING_EVENT_IMMUTABLE';
    throw error;
  };
  const assertTrainingDestroy = (source) => {
    const values = typeof source?.get === 'function' ? source.get() : source?.where;
    if (values?.isTraining === true && values?.trainingSessionId && values?.accountId) return;
    const error = new Error('Only owned training-session OnboardingEvent rows can be deleted');
    error.code = 'ONBOARDING_EVENT_DELETE_FORBIDDEN';
    throw error;
  };
  const OnboardingEvent = sequelize.define('OnboardingEvent', {
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    organizationId: { type: DataTypes.INTEGER, allowNull: false },
    membershipId: { type: DataTypes.INTEGER, allowNull: false },
    clubId: { type: DataTypes.INTEGER, allowNull: true },
    trainingSessionId: { type: DataTypes.UUID, allowNull: true },
    idempotencyKey: { type: DataTypes.STRING(64), allowNull: false },
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
    eventKey: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    entityType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    entityId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    isTraining: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    payload: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    completedTaskKeys: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  }, {
    hooks: {
      beforeBulkDestroy: (options) => assertTrainingDestroy(options),
      beforeDestroy: (event) => assertTrainingDestroy(event),
      beforeBulkUpdate: immutableError,
      beforeUpdate: immutableError,
    },
  });

  OnboardingEvent.associate = (models) => {
    OnboardingEvent.belongsTo(models.Account, {
      as: 'account',
      foreignKey: 'accountId',
    });
    OnboardingEvent.belongsTo(models.Organization, {
      foreignKey: 'organizationId',
    });
    OnboardingEvent.belongsTo(models.Membership, {
      foreignKey: 'membershipId',
    });
    OnboardingEvent.belongsTo(models.Club, {
      foreignKey: 'clubId',
    });
  };

  return OnboardingEvent;
};
