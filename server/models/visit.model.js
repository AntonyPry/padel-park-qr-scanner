'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Visit extends Model {
    static associate(models) {
      Visit.belongsTo(models.User, { foreignKey: 'userId' });
    }
  }

  Visit.init(
    {
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      scannedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      keyNumber: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Visit',
    }
  );

  return Visit;
};
