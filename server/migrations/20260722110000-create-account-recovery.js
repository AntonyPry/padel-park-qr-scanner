'use strict';

const TABLES = Object.freeze(['AccountRecoveryRequests', 'AccountRecoveryTokens']);
const TRIGGERS = Object.freeze([
  { name: 'trg_account_recovery_tokens_bi', timing: 'BEFORE INSERT', table: 'AccountRecoveryTokens', body: `BEGIN IF NEW.tokenDigest NOT REGEXP BINARY '^[a-f0-9]{64}$' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Recovery token digest is invalid'; END IF; IF NEW.expiresAt <= NEW.issuedAt THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Recovery token expiry is invalid'; END IF; IF NEW.consumedAt IS NOT NULL OR NEW.revokedAt IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Recovery token must start active'; END IF; END` },
  { name: 'trg_account_recovery_tokens_bu', timing: 'BEFORE UPDATE', table: 'AccountRecoveryTokens', body: `BEGIN IF NOT (NEW.id <=> OLD.id) OR NOT (NEW.requestId <=> OLD.requestId) OR NOT (NEW.accountId <=> OLD.accountId) OR NOT (NEW.tokenDigest <=> OLD.tokenDigest) OR NOT (NEW.expiresAt <=> OLD.expiresAt) OR NOT (NEW.issuedAt <=> OLD.issuedAt) OR NOT (NEW.issuedBy <=> OLD.issuedBy) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Recovery token identity is immutable'; END IF; IF OLD.consumedAt IS NOT NULL AND NOT (NEW.consumedAt <=> OLD.consumedAt) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Recovery token consumption is irreversible'; END IF; IF OLD.revokedAt IS NOT NULL AND (NOT (NEW.revokedAt <=> OLD.revokedAt) OR NOT (NEW.revokeReason <=> OLD.revokeReason)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Recovery token revocation is irreversible'; END IF; END` },
  { name: 'trg_account_recovery_tokens_bd', timing: 'BEFORE DELETE', table: 'AccountRecoveryTokens', body: "BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Recovery token history is immutable'; END" },
]);

async function tableExists(queryInterface, name) {
  const tables = await queryInterface.showAllTables();
  return tables.some((table) => String(table).toLowerCase() === name.toLowerCase());
}

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of TABLES) {
      if (await tableExists(queryInterface, table)) throw new Error(`Account recovery migration refuses existing table ${table}`);
    }
    const id = { allowNull: false, primaryKey: true, type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4 };
    try {
      await queryInterface.createTable('AccountRecoveryRequests', {
        id,
        organizationId: { allowNull: false, type: Sequelize.INTEGER },
        clubId: { allowNull: false, type: Sequelize.INTEGER },
        accountId: { allowNull: false, type: Sequelize.INTEGER },
        status: { allowNull: false, type: Sequelize.ENUM('created', 'issued', 'used', 'revoked', 'expired'), defaultValue: 'created' },
        initiatedBy: { allowNull: false, type: Sequelize.STRING(160) },
        createdAt: { allowNull: false, type: Sequelize.DATE },
        updatedAt: { allowNull: false, type: Sequelize.DATE },
      });
      await queryInterface.createTable('AccountRecoveryTokens', {
        id,
        requestId: { allowNull: false, type: Sequelize.UUID },
        accountId: { allowNull: false, type: Sequelize.INTEGER },
        tokenDigest: { allowNull: false, type: Sequelize.CHAR(64).BINARY },
        expiresAt: { allowNull: false, type: Sequelize.DATE },
        issuedAt: { allowNull: false, type: Sequelize.DATE },
        issuedBy: { allowNull: false, type: Sequelize.STRING(160) },
        consumedAt: { allowNull: true, type: Sequelize.DATE },
        revokedAt: { allowNull: true, type: Sequelize.DATE },
        revokeReason: { allowNull: true, type: Sequelize.STRING(80) },
        createdAt: { allowNull: false, type: Sequelize.DATE },
        updatedAt: { allowNull: false, type: Sequelize.DATE },
      });
      await queryInterface.addIndex('AccountRecoveryRequests', ['organizationId', 'clubId', 'accountId', 'status'], { name: 'idx_account_recovery_requests_scope' });
      await queryInterface.addIndex('AccountRecoveryTokens', ['tokenDigest'], { name: 'uq_account_recovery_token_digest', unique: true });
      await queryInterface.addIndex('AccountRecoveryTokens', ['accountId', 'consumedAt', 'revokedAt', 'expiresAt'], { name: 'idx_account_recovery_token_active' });
      const fk = async (table, fields, ref, name, onDelete = 'RESTRICT') => queryInterface.addConstraint(table, { fields, type: 'foreign key', name, references: { table: ref, field: 'id' }, onDelete, onUpdate: 'RESTRICT' });
      await fk('AccountRecoveryRequests', ['organizationId'], 'Organizations', 'fk_recovery_request_org');
      await fk('AccountRecoveryRequests', ['clubId'], 'Clubs', 'fk_recovery_request_club');
      await fk('AccountRecoveryRequests', ['accountId'], 'Accounts', 'fk_recovery_request_account');
      await fk('AccountRecoveryTokens', ['requestId'], 'AccountRecoveryRequests', 'fk_recovery_token_request');
      await fk('AccountRecoveryTokens', ['accountId'], 'Accounts', 'fk_recovery_token_account');
      for (const trigger of TRIGGERS) await queryInterface.sequelize.query(`CREATE TRIGGER \`${trigger.name}\` ${trigger.timing} ON \`${trigger.table}\` FOR EACH ROW ${trigger.body}`);
    } catch (error) {
      for (const trigger of [...TRIGGERS].reverse()) await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS \`${trigger.name}\``);
      for (const table of [...TABLES].reverse()) if (await tableExists(queryInterface, table)) await queryInterface.dropTable(table);
      throw error;
    }
  },
  async down(queryInterface) {
    for (const table of TABLES) {
      if (await tableExists(queryInterface, table)) {
        const [rows] = await queryInterface.sequelize.query(`SELECT COUNT(*) AS count FROM \`${table}\``);
        if (Number(rows[0]?.count || 0) > 0) throw new Error(`Account recovery rollback refused while ${table} contains history`);
      }
    }
    for (const trigger of [...TRIGGERS].reverse()) await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS \`${trigger.name}\``);
    for (const table of [...TABLES].reverse()) if (await tableExists(queryInterface, table)) await queryInterface.dropTable(table);
  },
  __testing: { TABLES, TRIGGERS },
};
