'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.hasMany(models.Visit, { foreignKey: 'userId' });
      User.belongsTo(models.User, {
        as: 'mergedInto',
        foreignKey: 'mergedIntoUserId',
      });
      User.belongsTo(models.Account, {
        as: 'mergedBy',
        foreignKey: 'mergedByAccountId',
      });
      User.hasMany(models.TrainingNote, { foreignKey: 'userId' });
      User.hasMany(models.TrainingPlanParticipant, {
        as: 'trainingPlanParticipants',
        foreignKey: 'userId',
      });
      User.hasMany(models.ClientTrainingSkill, {
        as: 'skillMap',
        foreignKey: 'userId',
      });
      User.belongsTo(models.ClientSource, { foreignKey: 'sourceId' });
      User.hasMany(models.CallTaskClient, {
        as: 'callTaskClients',
        foreignKey: 'userId',
      });
      User.hasMany(models.Booking, { foreignKey: 'userId' });
      User.hasMany(models.BookingSeries, { foreignKey: 'userId' });
    }
  }

  User.init(
    {
      telegramId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      vkId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      webId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      phoneNormalized: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      source: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      sourceId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      note: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM('active', 'archived'),
        allowNull: false,
        defaultValue: 'active',
      },
      mergedIntoUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      mergedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      mergedByAccountId: {
        type: DataTypes.INTEGER,
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
    },
    {
      sequelize,
      modelName: 'User',
    },
  );

  return User;
};
