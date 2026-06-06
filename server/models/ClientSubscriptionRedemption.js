module.exports = (sequelize, DataTypes) => {
  const ClientSubscriptionRedemption = sequelize.define('ClientSubscriptionRedemption', {
    clientSubscriptionId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clientId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
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
    redeemedAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    redeemedByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'active',
    },
    reversedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    reversedByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    reversalReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  });

  ClientSubscriptionRedemption.associate = (models) => {
    ClientSubscriptionRedemption.belongsTo(models.ClientSubscription, {
      as: 'subscription',
      foreignKey: 'clientSubscriptionId',
    });
    ClientSubscriptionRedemption.belongsTo(models.User, {
      as: 'client',
      foreignKey: 'clientId',
    });
    ClientSubscriptionRedemption.belongsTo(models.Account, {
      as: 'redeemedBy',
      foreignKey: 'redeemedByAccountId',
    });
    ClientSubscriptionRedemption.belongsTo(models.Account, {
      as: 'reversedBy',
      foreignKey: 'reversedByAccountId',
    });
  };

  return ClientSubscriptionRedemption;
};
