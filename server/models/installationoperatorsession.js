'use strict';

const {
  assertBulkAuthorityFieldsAreMutable,
  assertInstanceAuthorityFieldsAreMutable,
} = require('../src/tenant-enforcement/immutable-authority');

const IMMUTABLE_FIELDS = Object.freeze([
  'id',
  'sessionId',
  'username',
  'expiresAt',
  'createdAt',
]);

module.exports = (sequelize, DataTypes) => sequelize.define(
  'InstallationOperatorSession',
  {
    sessionId: { allowNull: false, type: DataTypes.STRING(32), unique: true },
    username: { allowNull: false, type: DataTypes.STRING(120) },
    expiresAt: { allowNull: false, type: DataTypes.DATE },
    revokedAt: { allowNull: true, type: DataTypes.DATE },
  },
  {
    hooks: {
      beforeBulkDestroy() {
        throw new Error('Installation operator session history is immutable');
      },
      beforeBulkUpdate(options) {
        assertBulkAuthorityFieldsAreMutable(
          options,
          IMMUTABLE_FIELDS,
          'Installation operator session authority is immutable',
        );
      },
      beforeDestroy() {
        throw new Error('Installation operator session history is immutable');
      },
      beforeUpdate(session) {
        assertInstanceAuthorityFieldsAreMutable(
          session,
          IMMUTABLE_FIELDS,
          'Installation operator session authority is immutable',
        );
        if (session.previous('revokedAt') && session.changed('revokedAt')) {
          throw new Error('Installation operator session revocation is irreversible');
        }
      },
    },
    tableName: 'InstallationOperatorSessions',
  },
);
