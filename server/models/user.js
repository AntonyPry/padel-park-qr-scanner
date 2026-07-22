'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class User extends Model {
    static associate(models) {
      User.belongsTo(models.Organization, { foreignKey: 'organizationId' });
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
      User.hasMany(models.PendingSale, {
        as: 'pendingSales',
        foreignKey: 'clientId',
      });
      User.hasMany(models.ClientSubscription, {
        as: 'clientSubscriptions',
        foreignKey: 'clientId',
      });
      User.hasMany(models.ClientSubscriptionRedemption, {
        as: 'subscriptionRedemptions',
        foreignKey: 'clientId',
      });
      User.hasMany(models.Certificate, {
        as: 'certificates',
        foreignKey: 'clientId',
      });
      User.hasMany(models.CertificateRedemption, {
        as: 'certificateRedemptions',
        foreignKey: 'clientId',
      });
    }
  }

  User.init(
    {
      organizationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      telegramId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      vkId: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      webId: {
        type: DataTypes.STRING,
        allowNull: true,
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
      birthDate: {
        type: DataTypes.DATEONLY,
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
      trainingSessionId: { type: DataTypes.UUID, allowNull: true },
    },
    {
      sequelize,
      modelName: 'User',
      indexes: [
        { unique: true, fields: ['organizationId', 'telegramId'], name: 'uq_users_organization_telegram' },
        { unique: true, fields: ['organizationId', 'vkId'], name: 'uq_users_organization_vk' },
        { unique: true, fields: ['organizationId', 'webId'], name: 'uq_users_organization_web' },
      ],
      hooks: {
        beforeBulkUpdate(options) {
          if (Object.prototype.hasOwnProperty.call(options.attributes || {}, 'organizationId')) {
            const error = new Error('Client organization is immutable');
            error.code = 'CLIENT_ORGANIZATION_IMMUTABLE';
            throw error;
          }
        },
        beforeUpdate(user) {
          if (user.changed('organizationId')) {
            const error = new Error('Client organization is immutable');
            error.code = 'CLIENT_ORGANIZATION_IMMUTABLE';
            throw error;
          }
        },
      },
    },
  );

  return User;
};
