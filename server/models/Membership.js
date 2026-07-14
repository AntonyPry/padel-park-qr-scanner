'use strict';

const {
  MEMBERSHIP_ROLE_VALUES,
  TENANT_STATUS_VALUES,
} = require('../src/tenant-foundation/constants');

module.exports = (sequelize, DataTypes) => {
  const Membership = sequelize.define(
    'Membership',
    {
      organizationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      accountId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      role: {
        type: DataTypes.ENUM(...MEMBERSHIP_ROLE_VALUES),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(...TENANT_STATUS_VALUES),
        allowNull: false,
      },
    },
    { tableName: 'Memberships' },
  );

  Membership.associate = (models) => {
    Membership.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    Membership.belongsTo(models.Account, { foreignKey: 'accountId' });
    Membership.hasMany(models.MembershipClubAccess, {
      foreignKey: 'membershipId',
    });
  };

  return Membership;
};
