'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Visit extends Model {
    static associate(models) {
      Visit.belongsTo(models.User, { foreignKey: 'userId' });
      Visit.belongsTo(models.Visit, {
        as: 'duplicateOfVisit',
        foreignKey: 'duplicateOfVisitId',
      });
      Visit.belongsTo(models.Account, {
        as: 'keyIssuedBy',
        foreignKey: 'keyIssuedByAccountId',
      });
      Visit.belongsToMany(models.VisitCategory, {
        through: models.VisitCategoryAssignment,
        foreignKey: 'visitId',
        otherKey: 'visitCategoryId',
        as: 'categories',
        timestamps: false,
      });
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
      category: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      entrySource: {
        type: DataTypes.ENUM('qr', 'manual'),
        allowNull: false,
        defaultValue: 'qr',
      },
      qrRaw: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      duplicateOfVisitId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      clientEventId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      keyIssuedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      keyIssuedByAccountId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Visit',
    },
  );

  return Visit;
};
