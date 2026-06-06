module.exports = (sequelize, DataTypes) => {
  const EvotorSaleSetting = sequelize.define('EvotorSaleSetting', {
    itemName: {
      type: DataTypes.STRING,
      unique: true,
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
  });

  EvotorSaleSetting.associate = (models) => {
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
