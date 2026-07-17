'use strict';

module.exports = (sequelize, DataTypes) => {
  const ShiftReportTemplate = sequelize.define('ShiftReportTemplate', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'active',
    },
    scheduleType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'daily_times',
    },
    scheduleConfig: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    gracePeriodMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 30,
    },
    version: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    archivedAt: {
      type: DataTypes.DATE,
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

  ShiftReportTemplate.associate = (models) => {
    ShiftReportTemplate.hasMany(models.ShiftReportTemplateItem, {
      as: 'items',
      foreignKey: 'templateId',
    });
    ShiftReportTemplate.hasMany(models.ShiftReport, {
      as: 'reports',
      foreignKey: 'templateId',
    });
    ShiftReportTemplate.belongsTo(models.Account, {
      as: 'createdBy',
      foreignKey: 'createdByAccountId',
    });
    ShiftReportTemplate.belongsTo(models.Account, {
      as: 'updatedBy',
      foreignKey: 'updatedByAccountId',
    });
  };

  return ShiftReportTemplate;
};
