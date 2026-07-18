const {
  createTenantAttributionHooks,
} = require('../src/tenant-context/model-attribution');

module.exports = (sequelize, DataTypes) => {
  const CorporateClient = sequelize.define('CorporateClient', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    contactName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    contactPhone: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    contactEmail: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'active',
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    createdByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    archivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    archivedByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    archiveReason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    isTraining: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    trainingRole: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    trainingAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    trainingSessionId: { type: DataTypes.UUID, allowNull: true },
  }, {
    hooks: createTenantAttributionHooks(
      ['organizationId'],
      'CorporateClient',
    ),
  });

  CorporateClient.associate = (models) => {
    CorporateClient.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    CorporateClient.belongsTo(models.Account, {
      as: 'createdBy',
      foreignKey: 'createdByAccountId',
    });
    CorporateClient.belongsTo(models.Account, {
      as: 'archivedBy',
      foreignKey: 'archivedByAccountId',
    });
    CorporateClient.belongsTo(models.Account, {
      as: 'trainingAccount',
      foreignKey: 'trainingAccountId',
    });
    CorporateClient.hasMany(models.CorporateLedgerEntry, {
      as: 'ledgerEntries',
      foreignKey: 'corporateClientId',
    });
  };

  return CorporateClient;
};
