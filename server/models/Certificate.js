const {
  createTenantAttributionHooks,
} = require('../src/tenant-context/model-attribution');

module.exports = (sequelize, DataTypes) => {
  const Certificate = sequelize.define('Certificate', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    code: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    clientId: {
      type: DataTypes.INTEGER,
      allowNull: false,
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
    certificateType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'money',
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    serviceType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    serviceName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    amountTotal: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    amountUsed: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    },
    unitsTotal: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    unitsUsed: {
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
  }, {
    hooks: createTenantAttributionHooks(
      ['organizationId', 'clubId'],
      'Certificate',
    ),
  });

  Certificate.associate = (models) => {
    Certificate.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    Certificate.belongsTo(models.Club, { foreignKey: 'clubId' });
    Certificate.belongsTo(models.User, {
      as: 'client',
      foreignKey: 'clientId',
    });
    Certificate.belongsTo(models.PendingSale, {
      as: 'pendingSale',
      foreignKey: 'pendingSaleId',
    });
    Certificate.belongsTo(models.Receipt, {
      as: 'sourceReceipt',
      foreignKey: 'sourceReceiptId',
    });
    Certificate.belongsTo(models.ReceiptItem, {
      as: 'sourceReceiptItem',
      foreignKey: 'sourceReceiptItemId',
    });
    Certificate.belongsTo(models.Account, {
      as: 'createdBy',
      foreignKey: 'createdByAccountId',
    });
    Certificate.belongsTo(models.Account, {
      as: 'canceledBy',
      foreignKey: 'canceledByAccountId',
    });
    Certificate.hasMany(models.CertificateRedemption, {
      as: 'redemptions',
      foreignKey: 'certificateId',
    });
  };

  return Certificate;
};
