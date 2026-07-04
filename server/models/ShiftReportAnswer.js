'use strict';

module.exports = (sequelize, DataTypes) => {
  const ShiftReportAnswer = sequelize.define('ShiftReportAnswer', {
    reportId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    templateItemId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    itemSnapshot: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    itemLabel: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    itemType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    isRequired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    photoRequired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    booleanValue: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    textValue: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    numberValue: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
    },
    comment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    attachments: {
      type: DataTypes.JSON,
      allowNull: true,
    },
  });

  ShiftReportAnswer.associate = (models) => {
    ShiftReportAnswer.belongsTo(models.ShiftReport, {
      as: 'report',
      foreignKey: 'reportId',
    });
    ShiftReportAnswer.belongsTo(models.ShiftReportTemplateItem, {
      as: 'templateItem',
      foreignKey: 'templateItemId',
    });
  };

  return ShiftReportAnswer;
};
