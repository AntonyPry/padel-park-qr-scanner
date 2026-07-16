'use strict';

const { TENANT_STATUS_VALUES } = require('../src/tenant-foundation/constants');

module.exports = (sequelize, DataTypes) => {
  const Organization = sequelize.define(
    'Organization',
    {
      slug: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...TENANT_STATUS_VALUES),
        allowNull: false,
        defaultValue: 'active',
      },
    },
    { tableName: 'Organizations' },
  );

  Organization.associate = (models) => {
    Organization.hasMany(models.Club, { foreignKey: 'organizationId' });
    Organization.hasMany(models.IntegrationConnection, { foreignKey: 'organizationId' });
    Organization.hasMany(models.Membership, { foreignKey: 'organizationId' });
    Organization.hasMany(models.Staff, { foreignKey: 'organizationId' });
    Organization.hasMany(models.User, { foreignKey: 'organizationId' });
    Organization.hasMany(models.ClientSource, { foreignKey: 'organizationId' });
    Organization.hasMany(models.VisitCategory, { foreignKey: 'organizationId' });
    Organization.hasMany(models.Visit, { foreignKey: 'organizationId' });
    Organization.hasMany(models.ScannerEvent, { foreignKey: 'organizationId' });
  };

  return Organization;
};
