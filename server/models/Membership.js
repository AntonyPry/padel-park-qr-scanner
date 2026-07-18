'use strict';

const {
  MEMBERSHIP_ROLE_VALUES,
  TENANT_STATUS_VALUES,
} = require('../src/tenant-foundation/constants');
const {
  assertBulkAuthorityFieldsAreMutable,
  assertInstanceAuthorityFieldsAreMutable,
} = require('../src/tenant-enforcement/immutable-authority');

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
      staffId: {
        type: DataTypes.INTEGER,
        allowNull: true,
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
    {
      hooks: {
        beforeBulkUpdate(options) {
          assertBulkAuthorityFieldsAreMutable(
            options,
            ['organizationId', 'accountId'],
            'Membership tenant authority is immutable',
          );
        },
        beforeUpdate(membership) {
          assertInstanceAuthorityFieldsAreMutable(
            membership,
            ['organizationId', 'accountId'],
            'Membership tenant authority is immutable',
          );
        },
      },
      tableName: 'Memberships',
    },
  );

  Membership.associate = (models) => {
    Membership.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    Membership.belongsTo(models.Account, { foreignKey: 'accountId' });
    Membership.belongsTo(models.Staff, { foreignKey: 'staffId' });
    Membership.hasMany(models.MembershipClubAccess, {
      foreignKey: 'membershipId',
    });
  };

  return Membership;
};
