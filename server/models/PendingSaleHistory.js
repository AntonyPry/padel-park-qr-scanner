const {
  createTenantAttributionHooks,
} = require('../src/tenant-context/model-attribution');

module.exports = (sequelize, DataTypes) => {
  const PendingSaleHistory = sequelize.define('PendingSaleHistory', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    pendingSaleId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    action: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    fromStatus: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    toStatus: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    accountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    role: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    beforeData: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    afterData: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  }, {
    hooks: createTenantAttributionHooks(
      ['organizationId', 'clubId'],
      'PendingSaleHistory',
    ),
  });

  PendingSaleHistory.associate = (models) => {
    PendingSaleHistory.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    PendingSaleHistory.belongsTo(models.Club, { foreignKey: 'clubId' });
    PendingSaleHistory.belongsTo(models.PendingSale, {
      as: 'pendingSale',
      foreignKey: 'pendingSaleId',
    });
    PendingSaleHistory.belongsTo(models.Account, {
      as: 'account',
      foreignKey: 'accountId',
    });
  };

  return PendingSaleHistory;
};
