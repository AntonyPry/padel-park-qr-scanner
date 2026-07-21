'use strict';

const SESSION_TABLE = 'InstallationOperatorSessions';
const OPERATION_TABLE = 'InstallationMutationOperations';
const CONNECTION_TABLE = 'IntegrationConnections';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(SESSION_TABLE, {
      id: { autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      sessionId: { allowNull: false, type: Sequelize.STRING(32) },
      username: { allowNull: false, type: Sequelize.STRING(120) },
      expiresAt: { allowNull: false, type: Sequelize.DATE },
      revokedAt: { allowNull: true, type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex(SESSION_TABLE, ['sessionId'], {
      name: 'uq_installation_operator_session_id',
      unique: true,
    });
    await queryInterface.addIndex(SESSION_TABLE, ['username', 'expiresAt'], {
      name: 'idx_installation_operator_session_expiry',
    });

    await queryInterface.createTable(OPERATION_TABLE, {
      id: { autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      idempotencyKeyHash: { allowNull: false, type: Sequelize.STRING(64) },
      payloadHash: { allowNull: false, type: Sequelize.STRING(64) },
      organizationId: {
        allowNull: false,
        references: { key: 'id', model: 'Organizations' },
        onDelete: 'RESTRICT',
        onUpdate: 'RESTRICT',
        type: Sequelize.INTEGER,
      },
      clubId: {
        allowNull: true,
        references: { key: 'id', model: 'Clubs' },
        onDelete: 'RESTRICT',
        onUpdate: 'RESTRICT',
        type: Sequelize.INTEGER,
      },
      action: { allowNull: false, type: Sequelize.STRING(96) },
      response: { allowNull: false, type: Sequelize.JSON },
      auditLogId: {
        allowNull: false,
        references: { key: 'id', model: 'AuditLogs' },
        onDelete: 'RESTRICT',
        onUpdate: 'RESTRICT',
        type: Sequelize.INTEGER,
      },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex(OPERATION_TABLE, ['idempotencyKeyHash'], {
      name: 'uq_installation_mutation_idempotency_hash',
      unique: true,
    });
    await queryInterface.addIndex(OPERATION_TABLE, ['organizationId', 'clubId', 'createdAt'], {
      name: 'idx_installation_mutation_scope_created',
    });

    await queryInterface.addColumn(CONNECTION_TABLE, 'credentialFingerprint', {
      allowNull: true,
      type: Sequelize.STRING(64),
    });
    await queryInterface.addColumn(CONNECTION_TABLE, 'providerIdentityFingerprint', {
      allowNull: true,
      type: Sequelize.STRING(64),
    });
    await queryInterface.addColumn(CONNECTION_TABLE, 'fingerprintKeyVersion', {
      allowNull: true,
      type: Sequelize.STRING(32),
    });
    await queryInterface.addIndex(CONNECTION_TABLE, ['provider', 'credentialFingerprint'], {
      name: 'uq_integration_provider_credential_fingerprint',
      unique: true,
    });
    await queryInterface.addIndex(CONNECTION_TABLE, ['provider', 'providerIdentityFingerprint'], {
      name: 'uq_integration_provider_identity_fingerprint',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      CONNECTION_TABLE,
      'uq_integration_provider_identity_fingerprint',
    );
    await queryInterface.removeIndex(
      CONNECTION_TABLE,
      'uq_integration_provider_credential_fingerprint',
    );
    await queryInterface.removeColumn(CONNECTION_TABLE, 'fingerprintKeyVersion');
    await queryInterface.removeColumn(CONNECTION_TABLE, 'providerIdentityFingerprint');
    await queryInterface.removeColumn(CONNECTION_TABLE, 'credentialFingerprint');
    await queryInterface.dropTable(OPERATION_TABLE);
    await queryInterface.dropTable(SESSION_TABLE);
  },
};
