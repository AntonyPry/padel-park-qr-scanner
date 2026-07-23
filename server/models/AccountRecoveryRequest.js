'use strict';

module.exports = (sequelize, DataTypes) => {
  const AccountRecoveryRequest = sequelize.define('AccountRecoveryRequest', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    organizationId: { type: DataTypes.INTEGER, allowNull: false },
    clubId: { type: DataTypes.INTEGER, allowNull: false },
    accountId: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.ENUM('created', 'issued', 'used', 'revoked', 'expired'), allowNull: false, defaultValue: 'created' },
    initiatedBy: { type: DataTypes.STRING(160), allowNull: false },
  }, { tableName: 'AccountRecoveryRequests' });
  AccountRecoveryRequest.associate = (models) => {
    AccountRecoveryRequest.belongsTo(models.Account, { as: 'account', foreignKey: 'accountId' });
    AccountRecoveryRequest.hasMany(models.AccountRecoveryToken, { as: 'tokens', foreignKey: 'requestId' });
    AccountRecoveryRequest.belongsTo(models.Organization, { foreignKey: 'organizationId' });
    AccountRecoveryRequest.belongsTo(models.Club, { foreignKey: 'clubId' });
  };
  return AccountRecoveryRequest;
};
