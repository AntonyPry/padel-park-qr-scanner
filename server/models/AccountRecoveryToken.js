'use strict';

const { assertBulkAuthorityFieldsAreMutable, assertInstanceAuthorityFieldsAreMutable } = require('../src/tenant-enforcement/immutable-authority');

module.exports = (sequelize, DataTypes) => {
  const AccountRecoveryToken = sequelize.define('AccountRecoveryToken', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    requestId: { type: DataTypes.UUID, allowNull: false },
    accountId: { type: DataTypes.INTEGER, allowNull: false },
    tokenDigest: { type: DataTypes.CHAR(64).BINARY, allowNull: false, unique: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    issuedAt: { type: DataTypes.DATE, allowNull: false },
    issuedBy: { type: DataTypes.STRING(160), allowNull: false },
    consumedAt: { type: DataTypes.DATE, allowNull: true },
    revokedAt: { type: DataTypes.DATE, allowNull: true },
    revokeReason: { type: DataTypes.STRING(80), allowNull: true },
  }, {
    tableName: 'AccountRecoveryTokens',
    defaultScope: { attributes: { exclude: ['tokenDigest'] } },
    indexes: [{ fields: ['accountId', 'consumedAt', 'revokedAt', 'expiresAt'], name: 'idx_account_recovery_token_active' }],
    hooks: {
      beforeBulkDestroy() { throw new Error('Account recovery token history is immutable'); },
      beforeDestroy() { throw new Error('Account recovery token history is immutable'); },
      beforeBulkUpdate(options) { assertBulkAuthorityFieldsAreMutable(options, ['id', 'requestId', 'accountId', 'tokenDigest', 'expiresAt', 'issuedAt', 'issuedBy'], 'Account recovery token authority is immutable'); },
      beforeUpdate(token) {
        assertInstanceAuthorityFieldsAreMutable(token, ['id', 'requestId', 'accountId', 'tokenDigest', 'expiresAt', 'issuedAt', 'issuedBy'], 'Account recovery token authority is immutable');
        if (token.previous('consumedAt') && token.changed('consumedAt')) throw new Error('Account recovery token consumption is irreversible');
        if (token.previous('revokedAt') && (token.changed('revokedAt') || token.changed('revokeReason'))) throw new Error('Account recovery token revocation is irreversible');
      },
    },
  });
  AccountRecoveryToken.associate = (models) => {
    AccountRecoveryToken.belongsTo(models.Account, { foreignKey: 'accountId' });
    AccountRecoveryToken.belongsTo(models.AccountRecoveryRequest, { foreignKey: 'requestId' });
  };
  return AccountRecoveryToken;
};
