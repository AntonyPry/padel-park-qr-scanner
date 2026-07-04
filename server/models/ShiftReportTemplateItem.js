'use strict';

module.exports = (sequelize, DataTypes) => {
  const ShiftReportTemplateItem = sequelize.define('ShiftReportTemplateItem', {
    templateId: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    label: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    helperText: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    itemType: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'checkbox',
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
    sortOrder: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'active',
    },
    archivedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  });

  ShiftReportTemplateItem.associate = (models) => {
    ShiftReportTemplateItem.belongsTo(models.ShiftReportTemplate, {
      as: 'template',
      foreignKey: 'templateId',
    });
    ShiftReportTemplateItem.hasMany(models.ShiftReportAnswer, {
      as: 'answers',
      foreignKey: 'templateItemId',
    });
  };

  return ShiftReportTemplateItem;
};
