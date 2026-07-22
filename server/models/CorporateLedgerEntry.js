const {
  createTenantAttributionHooks,
} = require('../src/tenant-context/model-attribution');

module.exports = (sequelize, DataTypes) => {
  const CorporateLedgerEntry = sequelize.define('CorporateLedgerEntry', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    corporateClientId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'deposit',
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'active',
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    financeId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    financeCreatedByLedger: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    category: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    comment: {
      type: DataTypes.TEXT,
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
    metadata: {
      type: DataTypes.JSON,
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
      ['organizationId', 'clubId'],
      'CorporateLedgerEntry',
    ),
  });

  CorporateLedgerEntry.associate = (models) => {
    CorporateLedgerEntry.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    CorporateLedgerEntry.belongsTo(models.Club, { foreignKey: 'clubId' });
    CorporateLedgerEntry.belongsTo(models.CorporateClient, {
      as: 'corporateClient',
      foreignKey: 'corporateClientId',
    });
    CorporateLedgerEntry.belongsTo(models.Finance, {
      as: 'finance',
      foreignKey: 'financeId',
    });
    CorporateLedgerEntry.belongsTo(models.Account, {
      as: 'createdBy',
      foreignKey: 'createdByAccountId',
    });
    CorporateLedgerEntry.belongsTo(models.Account, {
      as: 'canceledBy',
      foreignKey: 'canceledByAccountId',
    });
    CorporateLedgerEntry.belongsTo(models.Account, {
      as: 'trainingAccount',
      foreignKey: 'trainingAccountId',
    });
  };

  return CorporateLedgerEntry;
};
