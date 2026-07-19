'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('OwnerActivationTokens', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      organizationId: {
        allowNull: false,
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        references: { key: 'id', model: 'Organizations' },
        type: Sequelize.INTEGER,
      },
      accountId: {
        allowNull: false,
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        references: { key: 'id', model: 'Accounts' },
        type: Sequelize.INTEGER,
      },
      tokenHash: { allowNull: false, type: Sequelize.STRING(64) },
      expiresAt: { allowNull: false, type: Sequelize.DATE },
      consumedAt: { allowNull: true, type: Sequelize.DATE },
      invalidatedAt: { allowNull: true, type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addConstraint('OwnerActivationTokens', {
      fields: ['tokenHash'],
      name: 'uq_owner_activation_token_hash',
      type: 'unique',
    });
    await queryInterface.addIndex(
      'OwnerActivationTokens',
      ['organizationId', 'accountId', 'createdAt'],
      { name: 'idx_owner_activation_org_account_created' },
    );

    await queryInterface.createTable('InstallationProvisioningOperations', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      idempotencyKeyHash: { allowNull: false, type: Sequelize.STRING(64) },
      payloadHash: { allowNull: false, type: Sequelize.STRING(64) },
      organizationId: {
        allowNull: false,
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        references: { key: 'id', model: 'Organizations' },
        type: Sequelize.INTEGER,
      },
      ownerAccountId: {
        allowNull: false,
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        references: { key: 'id', model: 'Accounts' },
        type: Sequelize.INTEGER,
      },
      activationTokenId: {
        allowNull: false,
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        references: { key: 'id', model: 'OwnerActivationTokens' },
        type: Sequelize.INTEGER,
      },
      auditLogId: {
        allowNull: false,
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        references: { key: 'id', model: 'AuditLogs' },
        type: Sequelize.INTEGER,
      },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addConstraint('InstallationProvisioningOperations', {
      fields: ['idempotencyKeyHash'],
      name: 'uq_installation_provisioning_idempotency_hash',
      type: 'unique',
    });
    await queryInterface.addConstraint('InstallationProvisioningOperations', {
      fields: ['organizationId'],
      name: 'uq_installation_provisioning_organization',
      type: 'unique',
    });
    await queryInterface.addIndex(
      'InstallationProvisioningOperations',
      ['organizationId', 'createdAt'],
      { name: 'idx_installation_provisioning_org_created' },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('InstallationProvisioningOperations');
    await queryInterface.dropTable('OwnerActivationTokens');
  },
};
