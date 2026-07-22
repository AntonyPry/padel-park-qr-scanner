const {
  createTenantAttributionHooks,
} = require('../src/tenant-context/model-attribution');

module.exports = (sequelize, DataTypes) => {
  const PendingSale = sequelize.define('PendingSale', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    receiptId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    receiptItemId: {
      type: DataTypes.INTEGER,
      unique: true,
      allowNull: false,
    },
    saleSettingId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    catalogRuleId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    itemName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    saleIntent: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'pending',
    },
    clientId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    linkedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    linkedByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    ignoredAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    ignoredByAccountId: {
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
    statusReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  }, {
    hooks: createTenantAttributionHooks(
      ['organizationId', 'clubId'],
      'PendingSale',
    ),
  });

  PendingSale.associate = (models) => {
    PendingSale.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    PendingSale.belongsTo(models.Club, { foreignKey: 'clubId' });
    PendingSale.belongsTo(models.Receipt, {
      as: 'receipt',
      foreignKey: 'receiptId',
    });
    PendingSale.belongsTo(models.ReceiptItem, {
      as: 'receiptItem',
      foreignKey: 'receiptItemId',
    });
    PendingSale.belongsTo(models.EvotorSaleSetting, {
      as: 'saleSetting',
      foreignKey: 'saleSettingId',
    });
    PendingSale.belongsTo(models.CatalogRule, {
      as: 'catalogRule',
      foreignKey: 'catalogRuleId',
    });
    PendingSale.belongsTo(models.User, {
      as: 'client',
      foreignKey: 'clientId',
    });
    PendingSale.belongsTo(models.Account, {
      as: 'linkedBy',
      foreignKey: 'linkedByAccountId',
    });
    PendingSale.belongsTo(models.Account, {
      as: 'ignoredBy',
      foreignKey: 'ignoredByAccountId',
    });
    PendingSale.belongsTo(models.Account, {
      as: 'canceledBy',
      foreignKey: 'canceledByAccountId',
    });
    PendingSale.hasMany(models.PendingSaleHistory, {
      as: 'history',
      foreignKey: 'pendingSaleId',
    });
    PendingSale.hasOne(models.ClientSubscription, {
      as: 'clientSubscription',
      foreignKey: 'pendingSaleId',
    });
    PendingSale.hasOne(models.Certificate, {
      as: 'certificate',
      foreignKey: 'pendingSaleId',
    });
  };

  return PendingSale;
};
