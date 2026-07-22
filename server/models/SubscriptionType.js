const {
  createTenantAttributionHooks,
} = require('../src/tenant-context/model-attribution');

module.exports = (sequelize, DataTypes) => {
  const SubscriptionType = sequelize.define('SubscriptionType', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    serviceType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'training',
    },
    trainingKind: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    timeSegment: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    sessionsTotal: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    isUnlimited: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    validityDays: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 30,
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    bonusPersonalSessions: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'active',
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    createdByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    updatedByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  }, {
    hooks: createTenantAttributionHooks(
      ['organizationId'],
      'SubscriptionType',
    ),
  });

  SubscriptionType.associate = (models) => {
    SubscriptionType.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    SubscriptionType.belongsTo(models.Account, {
      as: 'createdBy',
      foreignKey: 'createdByAccountId',
    });
    SubscriptionType.belongsTo(models.Account, {
      as: 'updatedBy',
      foreignKey: 'updatedByAccountId',
    });
    SubscriptionType.hasMany(models.ClientSubscription, {
      as: 'clientSubscriptions',
      foreignKey: 'subscriptionTypeId',
    });
  };

  return SubscriptionType;
};
