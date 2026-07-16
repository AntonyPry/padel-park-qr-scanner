'use strict';

const {
  DEFAULT_CLUB_TIMEZONE,
  TENANT_STATUS_VALUES,
} = require('../src/tenant-foundation/constants');

module.exports = (sequelize, DataTypes) => {
  const Club = sequelize.define(
    'Club',
    {
      organizationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      slug: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      timezone: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: DEFAULT_CLUB_TIMEZONE,
      },
      status: {
        type: DataTypes.ENUM(...TENANT_STATUS_VALUES),
        allowNull: false,
        defaultValue: 'active',
      },
    },
    { tableName: 'Clubs' },
  );

  Club.associate = (models) => {
    Club.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    Club.hasMany(models.IntegrationConnection, { foreignKey: 'clubId' });
    Club.hasMany(models.MembershipClubAccess, { foreignKey: 'clubId' });
    Club.hasMany(models.Visit, { foreignKey: 'clubId' });
    Club.hasMany(models.ScannerEvent, { foreignKey: 'clubId' });
  };

  return Club;
};
