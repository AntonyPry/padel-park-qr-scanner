'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Visit extends Model {
    static associate(models) {
      Visit.belongsTo(models.Organization, { foreignKey: 'organizationId' });
      Visit.belongsTo(models.Club, { foreignKey: 'clubId' });
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
      organizationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      clubId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      scannedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      visitedAt: {
        type: DataTypes.VIRTUAL,
        get() {
          return this.getDataValue('scannedAt') || this.getDataValue('createdAt');
        },
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
      },
      keyIssuedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      keyIssuedByAccountId: {
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
      modelName: 'Visit',
      indexes: [
        {
          fields: ['organizationId', 'clubId', 'clientEventId'],
          name: 'uq_visits_tenant_client_event',
          unique: true,
        },
      ],
      hooks: {
        beforeBulkUpdate(options) {
          const attributes = options.attributes || {};
          if (
            Object.prototype.hasOwnProperty.call(attributes, 'organizationId') ||
            Object.prototype.hasOwnProperty.call(attributes, 'clubId')
          ) {
            const error = new Error('Visit tenant attribution is immutable');
            error.code = 'VISIT_TENANT_IMMUTABLE';
            throw error;
          }
        },
        beforeUpdate(visit) {
          if (visit.changed('organizationId') || visit.changed('clubId')) {
            const error = new Error('Visit tenant attribution is immutable');
            error.code = 'VISIT_TENANT_IMMUTABLE';
            throw error;
          }
        },
      },
    },
  );

  return Visit;
};
