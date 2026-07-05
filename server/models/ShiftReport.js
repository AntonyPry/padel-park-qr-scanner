'use strict';

module.exports = (sequelize, DataTypes) => {
  const ShiftReport = sequelize.define('ShiftReport', {
    shiftId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    templateId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    templateVersion: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    templateSnapshot: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    itemsSnapshot: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    scheduledAt: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    scheduledSlotKey: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    submittedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    submittedByAccountId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'pending',
    },
  });

  ShiftReport.associate = (models) => {
    ShiftReport.belongsTo(models.Shift, {
      as: 'shift',
      foreignKey: 'shiftId',
    });
    ShiftReport.belongsTo(models.ShiftReportTemplate, {
      as: 'template',
      foreignKey: 'templateId',
    });
    ShiftReport.belongsTo(models.Account, {
      as: 'submittedBy',
      foreignKey: 'submittedByAccountId',
    });
    ShiftReport.hasMany(models.ShiftReportAnswer, {
      as: 'answers',
      foreignKey: 'reportId',
    });
  };

  return ShiftReport;
};
