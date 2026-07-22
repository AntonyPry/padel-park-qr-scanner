'use strict';

const {
  assertBulkAuthorityFieldsAreMutable,
  assertInstanceAuthorityFieldsAreMutable,
} = require('../src/tenant-enforcement/immutable-authority');

const IMMUTABLE_FIELDS = Object.freeze([
  'id',
  'accountId',
  'tokenDigest',
  'expiresAt',
  'createdAt',
]);

module.exports = (sequelize, DataTypes) => {
  const NormalUserSession = sequelize.define(
    'NormalUserSession',
    {
      id: {
        allowNull: false,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        type: DataTypes.UUID,
      },
      accountId: {
        allowNull: false,
        type: DataTypes.INTEGER,
      },
      tokenDigest: {
        allowNull: false,
        type: DataTypes.CHAR(64).BINARY,
        unique: true,
        validate: { is: /^[a-f0-9]{64}$/u },
      },
      expiresAt: {
        allowNull: false,
        type: DataTypes.DATE,
      },
      revokedAt: {
        allowNull: true,
        type: DataTypes.DATE,
      },
      revokedReason: {
        allowNull: true,
        type: DataTypes.STRING(64),
      },
    },
    {
      defaultScope: {
        attributes: { exclude: ['tokenDigest'] },
      },
      hooks: {
        beforeBulkDestroy() {
          throw new Error('Normal user session history is immutable');
        },
        beforeBulkUpdate(options) {
          assertBulkAuthorityFieldsAreMutable(
            options,
            IMMUTABLE_FIELDS,
            'Normal user session authority is immutable',
          );
        },
        beforeDestroy() {
          throw new Error('Normal user session history is immutable');
        },
        beforeUpdate(session) {
          assertInstanceAuthorityFieldsAreMutable(
            session,
            IMMUTABLE_FIELDS,
            'Normal user session authority is immutable',
          );
          if (
            session.previous('revokedAt') &&
            (session.changed('revokedAt') || session.changed('revokedReason'))
          ) {
            throw new Error('Normal user session revocation is irreversible');
          }
        },
      },
      tableName: 'NormalUserSessions',
    },
  );

  NormalUserSession.associate = (models) => {
    NormalUserSession.belongsTo(models.Account, { foreignKey: 'accountId' });
  };

  return NormalUserSession;
};
