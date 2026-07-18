const {
  createTenantAttributionHooks,
} = require('../src/tenant-context/model-attribution');

module.exports = (sequelize, DataTypes) => {
  const EvotorSaleSetting = sequelize.define('EvotorSaleSetting', {
    organizationId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    clubId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    itemName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    saleIntent: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'normal',
    },
    saleSettings: {
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
      ['organizationId', 'clubId'],
      'EvotorSaleSetting',
    ),
  });

  EvotorSaleSetting.associate = (models) => {
    EvotorSaleSetting.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    EvotorSaleSetting.belongsTo(models.Club, { foreignKey: 'clubId' });
    EvotorSaleSetting.belongsTo(models.Account, {
      as: 'createdBy',
      foreignKey: 'createdByAccountId',
    });
    EvotorSaleSetting.belongsTo(models.Account, {
      as: 'updatedBy',
      foreignKey: 'updatedByAccountId',
    });
    EvotorSaleSetting.hasMany(models.PendingSale, {
      as: 'pendingSales',
      foreignKey: 'saleSettingId',
    });
  };

  return EvotorSaleSetting;
};
