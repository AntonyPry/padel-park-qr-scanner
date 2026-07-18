'use strict';

const {
  CLUB_ROLE_OVERRIDE_VALUES,
  TENANT_STATUS_VALUES,
} = require('../src/tenant-foundation/constants');
const {
  assertBulkAuthorityFieldsAreMutable,
  assertInstanceAuthorityFieldsAreMutable,
} = require('../src/tenant-enforcement/immutable-authority');

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
    {
      hooks: {
        beforeBulkUpdate(options) {
          assertBulkAuthorityFieldsAreMutable(
            options,
            ['organizationId', 'membershipId', 'clubId'],
            'Membership Club access authority is immutable',
          );
        },
        beforeUpdate(access) {
          assertInstanceAuthorityFieldsAreMutable(
            access,
            ['organizationId', 'membershipId', 'clubId'],
            'Membership Club access authority is immutable',
          );
        },
      },
      tableName: 'MembershipClubAccesses',
    },
  );

  MembershipClubAccess.associate = (models) => {
    MembershipClubAccess.belongsTo(models.Membership, {
      foreignKey: 'membershipId',
    });
    MembershipClubAccess.belongsTo(models.Club, { foreignKey: 'clubId' });
  };

  return MembershipClubAccess;
};
