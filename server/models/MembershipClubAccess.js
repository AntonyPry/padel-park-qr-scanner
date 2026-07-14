'use strict';

const {
  CLUB_ROLE_OVERRIDE_VALUES,
  TENANT_STATUS_VALUES,
} = require('../src/tenant-foundation/constants');

module.exports = (sequelize, DataTypes) => {
  const MembershipClubAccess = sequelize.define(
    'MembershipClubAccess',
    {
      organizationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      membershipId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      clubId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      roleOverride: {
        type: DataTypes.ENUM(...CLUB_ROLE_OVERRIDE_VALUES),
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM(...TENANT_STATUS_VALUES),
        allowNull: false,
      },
    },
    { tableName: 'MembershipClubAccesses' },
  );

  MembershipClubAccess.associate = (models) => {
    MembershipClubAccess.belongsTo(models.Membership, {
      foreignKey: 'membershipId',
    });
    MembershipClubAccess.belongsTo(models.Club, { foreignKey: 'clubId' });
  };

  return MembershipClubAccess;
};
