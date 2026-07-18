const {
  createTenantAttributionHooks,
} = require('../src/tenant-context/model-attribution');

module.exports = (sequelize, DataTypes) => {
  const CertificateRedemption = sequelize.define('CertificateRedemption', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    certificateId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clientId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    serviceType: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    serviceName: {
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
  }, {
    hooks: createTenantAttributionHooks(
      ['organizationId', 'clubId'],
      'CertificateRedemption',
    ),
  });

  CertificateRedemption.associate = (models) => {
    CertificateRedemption.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    CertificateRedemption.belongsTo(models.Club, { foreignKey: 'clubId' });
    CertificateRedemption.belongsTo(models.Certificate, {
      as: 'certificate',
      foreignKey: 'certificateId',
    });
    CertificateRedemption.belongsTo(models.User, {
      as: 'client',
      foreignKey: 'clientId',
    });
    CertificateRedemption.belongsTo(models.Account, {
      as: 'redeemedBy',
      foreignKey: 'redeemedByAccountId',
    });
    CertificateRedemption.belongsTo(models.Account, {
      as: 'reversedBy',
      foreignKey: 'reversedByAccountId',
    });
  };

  return CertificateRedemption;
};
