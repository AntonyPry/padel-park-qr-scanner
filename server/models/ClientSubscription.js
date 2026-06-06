module.exports = (sequelize, DataTypes) => {
  const ClientSubscription = sequelize.define('ClientSubscription', {
    clientId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    subscriptionTypeId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    pendingSaleId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      unique: true,
    },
    sourceReceiptId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    sourceReceiptItemId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      unique: true,
    },
    source: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'evotor_pending_sale',
    },
    typeName: {
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
    sessionsUsed: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    isUnlimited: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    bonusPersonalSessions: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    startsAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'active',
    },
    pricePaid: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    saleAmount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    createdByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    canceledAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    canceledByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    cancelReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  });

  ClientSubscription.associate = (models) => {
    ClientSubscription.belongsTo(models.User, {
      as: 'client',
      foreignKey: 'clientId',
    });
    ClientSubscription.belongsTo(models.SubscriptionType, {
      as: 'subscriptionType',
      foreignKey: 'subscriptionTypeId',
    });
    ClientSubscription.belongsTo(models.PendingSale, {
      as: 'pendingSale',
      foreignKey: 'pendingSaleId',
    });
    ClientSubscription.belongsTo(models.Receipt, {
      as: 'sourceReceipt',
      foreignKey: 'sourceReceiptId',
    });
    ClientSubscription.belongsTo(models.ReceiptItem, {
      as: 'sourceReceiptItem',
      foreignKey: 'sourceReceiptItemId',
    });
    ClientSubscription.belongsTo(models.Account, {
      as: 'createdBy',
      foreignKey: 'createdByAccountId',
    });
    ClientSubscription.belongsTo(models.Account, {
      as: 'canceledBy',
      foreignKey: 'canceledByAccountId',
    });
    ClientSubscription.hasMany(models.ClientSubscriptionRedemption, {
      as: 'redemptions',
      foreignKey: 'clientSubscriptionId',
    });
  };

  return ClientSubscription;
};
