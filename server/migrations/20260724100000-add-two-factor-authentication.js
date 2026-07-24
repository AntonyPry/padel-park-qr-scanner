'use strict';

const TABLES = Object.freeze([
  'AccountTwoFactors',
  'InstallationOperatorTwoFactors',
  'TwoFactorRecoveryCodes',
  'AuthLoginChallenges',
]);

const SESSION_COLUMNS = Object.freeze([
  ['NormalUserSessions', 'twoFactorVerifiedAt'],
  ['InstallationOperatorSessions', 'operatorId'],
  ['InstallationOperatorSessions', 'authMode'],
  ['InstallationOperatorSessions', 'credentialVersion'],
  ['InstallationOperatorSessions', 'twoFactorVerifiedAt'],
]);

const TRIGGERS = Object.freeze([
  {
    name: 'trg_account_two_factors_bi',
    table: 'AccountTwoFactors',
    event: 'INSERT',
    body: `BEGIN
      IF NEW.factorVersion < 1 OR NEW.recoveryGeneration < 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account two-factor version is invalid';
      END IF;
      IF NEW.status = 'pending' AND
         (NEW.secretCiphertext IS NOT NULL OR NEW.keyVersion IS NOT NULL
          OR NEW.pendingSecretCiphertext IS NULL OR NEW.pendingKeyVersion IS NULL
          OR NEW.pendingStartedAt IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pending account two-factor state is invalid';
      END IF;
      IF NEW.status = 'active' AND
         (NEW.secretCiphertext IS NULL OR NEW.keyVersion IS NULL OR NEW.keyVersion < 1) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account two-factor secret is required';
      END IF;
      IF NEW.status = 'active' AND NEW.enrolledAt IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account two-factor enrollment timestamp is required';
      END IF;
      IF NEW.status = 'disabled' AND
         (NEW.secretCiphertext IS NOT NULL OR NEW.keyVersion IS NOT NULL
          OR NEW.pendingSecretCiphertext IS NOT NULL OR NEW.pendingKeyVersion IS NOT NULL
          OR NEW.pendingStartedAt IS NOT NULL OR NEW.disabledAt IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Disabled account two-factor state is invalid';
      END IF;
    END`,
  },
  {
    name: 'trg_operator_two_factors_bi',
    table: 'InstallationOperatorTwoFactors',
    event: 'INSERT',
    body: `BEGIN
      IF NEW.operatorId NOT REGEXP BINARY '^op_[A-Za-z0-9_-]{16,64}$'
         OR NEW.factorVersion < 1 OR NEW.recoveryGeneration < 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Operator two-factor identity is invalid';
      END IF;
      IF NEW.status = 'pending' AND
         (NEW.secretCiphertext IS NOT NULL OR NEW.keyVersion IS NOT NULL
          OR NEW.pendingSecretCiphertext IS NULL OR NEW.pendingKeyVersion IS NULL
          OR NEW.pendingStartedAt IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pending operator two-factor state is invalid';
      END IF;
      IF NEW.status = 'active' AND
         (NEW.secretCiphertext IS NULL OR NEW.keyVersion IS NULL OR NEW.keyVersion < 1) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Operator two-factor secret is required';
      END IF;
      IF NEW.status = 'active' AND NEW.enrolledAt IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Operator two-factor enrollment timestamp is required';
      END IF;
      IF NEW.status = 'disabled' AND
         (NEW.secretCiphertext IS NOT NULL OR NEW.keyVersion IS NOT NULL
          OR NEW.pendingSecretCiphertext IS NOT NULL OR NEW.pendingKeyVersion IS NOT NULL
          OR NEW.pendingStartedAt IS NOT NULL OR NEW.disabledAt IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Disabled operator two-factor state is invalid';
      END IF;
    END`,
  },
  {
    name: 'trg_account_two_factors_bu',
    table: 'AccountTwoFactors',
    event: 'UPDATE',
    body: `BEGIN
      IF NOT (NEW.id <=> OLD.id) OR NOT (NEW.accountId <=> OLD.accountId)
         OR NEW.factorVersion < OLD.factorVersion
         OR NEW.recoveryGeneration < OLD.recoveryGeneration THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account two-factor identity is immutable';
      END IF;
      IF NEW.status = 'pending' AND
         (NEW.secretCiphertext IS NOT NULL OR NEW.keyVersion IS NOT NULL
          OR NEW.pendingSecretCiphertext IS NULL OR NEW.pendingKeyVersion IS NULL
          OR NEW.pendingStartedAt IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pending account two-factor state is invalid';
      END IF;
      IF NEW.status = 'active' AND
         (NEW.secretCiphertext IS NULL OR NEW.keyVersion IS NULL OR NEW.enrolledAt IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Active account two-factor state is invalid';
      END IF;
      IF NEW.status = 'disabled' AND
         (NEW.secretCiphertext IS NOT NULL OR NEW.keyVersion IS NOT NULL
          OR NEW.pendingSecretCiphertext IS NOT NULL OR NEW.pendingKeyVersion IS NOT NULL
          OR NEW.pendingStartedAt IS NOT NULL OR NEW.disabledAt IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Disabled account two-factor state is invalid';
      END IF;
      IF (NEW.pendingSecretCiphertext IS NULL) <> (NEW.pendingKeyVersion IS NULL)
         OR (NEW.pendingSecretCiphertext IS NULL) <> (NEW.pendingStartedAt IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account pending two-factor state is incomplete';
      END IF;
      IF OLD.lastUsedCounter IS NOT NULL AND NEW.status <> 'disabled'
         AND (NEW.lastUsedCounter IS NULL OR NEW.lastUsedCounter < OLD.lastUsedCounter) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Account two-factor counter cannot replay';
      END IF;
    END`,
  },
  {
    name: 'trg_operator_two_factors_bu',
    table: 'InstallationOperatorTwoFactors',
    event: 'UPDATE',
    body: `BEGIN
      IF NOT (NEW.id <=> OLD.id) OR NOT (NEW.operatorId <=> OLD.operatorId)
         OR NEW.factorVersion < OLD.factorVersion
         OR NEW.recoveryGeneration < OLD.recoveryGeneration THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Operator two-factor identity is immutable';
      END IF;
      IF NEW.status = 'pending' AND
         (NEW.secretCiphertext IS NOT NULL OR NEW.keyVersion IS NOT NULL
          OR NEW.pendingSecretCiphertext IS NULL OR NEW.pendingKeyVersion IS NULL
          OR NEW.pendingStartedAt IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pending operator two-factor state is invalid';
      END IF;
      IF NEW.status = 'active' AND
         (NEW.secretCiphertext IS NULL OR NEW.keyVersion IS NULL OR NEW.enrolledAt IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Active operator two-factor state is invalid';
      END IF;
      IF NEW.status = 'disabled' AND
         (NEW.secretCiphertext IS NOT NULL OR NEW.keyVersion IS NOT NULL
          OR NEW.pendingSecretCiphertext IS NOT NULL OR NEW.pendingKeyVersion IS NOT NULL
          OR NEW.pendingStartedAt IS NOT NULL OR NEW.disabledAt IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Disabled operator two-factor state is invalid';
      END IF;
      IF (NEW.pendingSecretCiphertext IS NULL) <> (NEW.pendingKeyVersion IS NULL)
         OR (NEW.pendingSecretCiphertext IS NULL) <> (NEW.pendingStartedAt IS NULL) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Operator pending two-factor state is incomplete';
      END IF;
      IF OLD.lastUsedCounter IS NOT NULL AND NEW.status <> 'disabled'
         AND (NEW.lastUsedCounter IS NULL OR NEW.lastUsedCounter < OLD.lastUsedCounter) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Operator two-factor counter cannot replay';
      END IF;
    END`,
  },
  {
    name: 'trg_two_factor_recovery_codes_bi',
    table: 'TwoFactorRecoveryCodes',
    event: 'INSERT',
    body: `BEGIN
      IF (NEW.accountTwoFactorId IS NULL) = (NEW.installationOperatorTwoFactorId IS NULL)
         OR NEW.generation < 1
         OR NEW.codeDigest NOT REGEXP BINARY '^[a-f0-9]{64}$'
         OR NEW.consumedAt IS NOT NULL
         OR NEW.revokedAt IS NOT NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Two-factor recovery code is invalid';
      END IF;
    END`,
  },
  {
    name: 'trg_two_factor_recovery_codes_bu',
    table: 'TwoFactorRecoveryCodes',
    event: 'UPDATE',
    body: `BEGIN
      IF NOT (NEW.id <=> OLD.id)
         OR NOT (NEW.accountTwoFactorId <=> OLD.accountTwoFactorId)
         OR NOT (NEW.installationOperatorTwoFactorId <=> OLD.installationOperatorTwoFactorId)
         OR NOT (NEW.generation <=> OLD.generation)
         OR NOT (NEW.codeDigest <=> OLD.codeDigest)
         OR (OLD.consumedAt IS NOT NULL AND NOT (NEW.consumedAt <=> OLD.consumedAt))
         OR (OLD.revokedAt IS NOT NULL AND NOT (NEW.revokedAt <=> OLD.revokedAt)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Two-factor recovery code is immutable';
      END IF;
    END`,
  },
  {
    name: 'trg_auth_login_challenges_bi',
    table: 'AuthLoginChallenges',
    event: 'INSERT',
    body: `BEGIN
      IF NEW.tokenDigest NOT REGEXP BINARY '^[a-f0-9]{64}$'
         OR NEW.expiresAt <= NEW.createdAt
         OR NEW.consumedAt IS NOT NULL
         OR (NEW.subjectKind = 'account' AND
             (NEW.accountId IS NULL OR NEW.operatorId IS NOT NULL OR
              NEW.operatorAuthMode IS NOT NULL OR NEW.operatorCredentialVersion IS NOT NULL))
         OR (NEW.subjectKind = 'installation_operator' AND
             (NEW.accountId IS NOT NULL
              OR NEW.operatorId NOT REGEXP BINARY '^op_[A-Za-z0-9_-]{16,64}$'
              OR NEW.operatorAuthMode <> 'static-directory'
              OR NEW.operatorCredentialVersion IS NULL
              OR NEW.operatorCredentialVersion < 1)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Authentication challenge is invalid';
      END IF;
    END`,
  },
  {
    name: 'trg_auth_login_challenges_bu',
    table: 'AuthLoginChallenges',
    event: 'UPDATE',
    body: `BEGIN
      IF NOT (NEW.id <=> OLD.id)
         OR NOT (NEW.subjectKind <=> OLD.subjectKind)
         OR NOT (NEW.accountId <=> OLD.accountId)
         OR NOT (NEW.operatorId <=> OLD.operatorId)
         OR NOT (NEW.operatorAuthMode <=> OLD.operatorAuthMode)
         OR NOT (NEW.operatorCredentialVersion <=> OLD.operatorCredentialVersion)
         OR NOT (NEW.purpose <=> OLD.purpose)
         OR NOT (NEW.tokenDigest <=> OLD.tokenDigest)
         OR NOT (NEW.expiresAt <=> OLD.expiresAt)
         OR (OLD.consumedAt IS NOT NULL AND NOT (NEW.consumedAt <=> OLD.consumedAt)) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Authentication challenge is immutable';
      END IF;
    END`,
  },
  {
    name: 'trg_normal_sessions_two_factor_bu',
    table: 'NormalUserSessions',
    event: 'UPDATE',
    body: `BEGIN
      IF OLD.twoFactorVerifiedAt IS NOT NULL AND
         (NEW.twoFactorVerifiedAt IS NULL OR NEW.twoFactorVerifiedAt < OLD.twoFactorVerifiedAt) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Normal session two-factor confirmation cannot move backward';
      END IF;
    END`,
  },
  {
    name: 'trg_operator_sessions_two_factor_bi',
    table: 'InstallationOperatorSessions',
    event: 'INSERT',
    body: `BEGIN
      IF NEW.credentialVersion < 1
         OR (NEW.authMode = 'legacy' AND
             (NEW.operatorId IS NOT NULL OR NEW.credentialVersion <> 1))
         OR (NEW.authMode = 'static-directory' AND
             NEW.operatorId NOT REGEXP BINARY '^op_[A-Za-z0-9_-]{16,64}$') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Operator session authentication identity is invalid';
      END IF;
    END`,
  },
  {
    name: 'trg_operator_sessions_two_factor_bu',
    table: 'InstallationOperatorSessions',
    event: 'UPDATE',
    body: `BEGIN
      IF NOT (NEW.operatorId <=> OLD.operatorId)
         OR NOT (NEW.authMode <=> OLD.authMode)
         OR NOT (NEW.credentialVersion <=> OLD.credentialVersion) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Operator session authentication identity is immutable';
      END IF;
      IF OLD.twoFactorVerifiedAt IS NOT NULL AND
         (NEW.twoFactorVerifiedAt IS NULL OR NEW.twoFactorVerifiedAt < OLD.twoFactorVerifiedAt) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Operator session two-factor confirmation cannot move backward';
      END IF;
    END`,
  },
]);

async function tableExists(queryInterface, table) {
  const tables = await queryInterface.showAllTables();
  return tables.some((value) => String(value).toLowerCase() === table.toLowerCase());
}

async function columnExists(queryInterface, table, column) {
  const description = await queryInterface.describeTable(table);
  return Object.prototype.hasOwnProperty.call(description, column);
}

async function createTrigger(queryInterface, definition) {
  await queryInterface.sequelize.query(
    `CREATE TRIGGER \`${definition.name}\` BEFORE ${definition.event} ON \`${definition.table}\`
     FOR EACH ROW ${definition.body}`,
  );
}

async function dropTrigger(queryInterface, name) {
  await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS \`${name}\``);
}

async function addForeignKey(
  queryInterface,
  table,
  field,
  referencedTable,
  name,
  onDelete = 'RESTRICT',
  referencedField = 'id',
) {
  await queryInterface.addConstraint(table, {
    fields: [field],
    name,
    onDelete,
    onUpdate: 'RESTRICT',
    references: { field: referencedField, table: referencedTable },
    type: 'foreign key',
  });
}

module.exports = {
  async up(queryInterface, Sequelize) {
    for (const table of TABLES) {
      if (await tableExists(queryInterface, table)) {
        throw new Error(`Two-factor migration refuses existing table ${table}`);
      }
    }
    for (const [table, column] of SESSION_COLUMNS) {
      if (await columnExists(queryInterface, table, column)) {
        throw new Error(`Two-factor migration refuses existing column ${table}.${column}`);
      }
    }

    const createdTables = [];
    const addedColumns = [];
    const createdTriggers = [];
    const id = {
      allowNull: false,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
      type: Sequelize.UUID,
    };
    const timestamps = {
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    };
    try {
      await queryInterface.addColumn('NormalUserSessions', 'twoFactorVerifiedAt', {
        allowNull: true,
        type: Sequelize.DATE,
      });
      addedColumns.push(['NormalUserSessions', 'twoFactorVerifiedAt']);
      await queryInterface.addColumn('InstallationOperatorSessions', 'operatorId', {
        allowNull: true,
        type: Sequelize.STRING(80),
      });
      addedColumns.push(['InstallationOperatorSessions', 'operatorId']);
      await queryInterface.addColumn('InstallationOperatorSessions', 'authMode', {
        allowNull: false,
        defaultValue: 'legacy',
        type: Sequelize.ENUM('legacy', 'static-directory'),
      });
      addedColumns.push(['InstallationOperatorSessions', 'authMode']);
      await queryInterface.addColumn('InstallationOperatorSessions', 'credentialVersion', {
        allowNull: false,
        defaultValue: 1,
        type: Sequelize.INTEGER,
      });
      addedColumns.push(['InstallationOperatorSessions', 'credentialVersion']);
      await queryInterface.addColumn(
        'InstallationOperatorSessions',
        'twoFactorVerifiedAt',
        { allowNull: true, type: Sequelize.DATE },
      );
      addedColumns.push(['InstallationOperatorSessions', 'twoFactorVerifiedAt']);
      await queryInterface.addIndex(
        'InstallationOperatorSessions',
        ['operatorId', 'revokedAt', 'expiresAt'],
        { name: 'idx_installation_operator_sessions_identity_active' },
      );

      const factorColumns = (identityField, identityType) => ({
        id,
        [identityField]: { allowNull: false, type: identityType, unique: true },
        secretCiphertext: { allowNull: true, type: Sequelize.TEXT('medium') },
        keyVersion: { allowNull: true, type: Sequelize.INTEGER },
        pendingSecretCiphertext: { allowNull: true, type: Sequelize.TEXT('medium') },
        pendingKeyVersion: { allowNull: true, type: Sequelize.INTEGER },
        pendingStartedAt: { allowNull: true, type: Sequelize.DATE },
        status: {
          allowNull: false,
          defaultValue: 'pending',
          type: Sequelize.ENUM('pending', 'active', 'disabled'),
        },
        factorVersion: { allowNull: false, defaultValue: 1, type: Sequelize.INTEGER },
        recoveryGeneration: { allowNull: false, defaultValue: 0, type: Sequelize.INTEGER },
        lastUsedCounter: { allowNull: true, type: Sequelize.BIGINT.UNSIGNED },
        enrolledAt: { allowNull: true, type: Sequelize.DATE },
        disabledAt: { allowNull: true, type: Sequelize.DATE },
        ...timestamps,
      });
      await queryInterface.createTable(
        'AccountTwoFactors',
        factorColumns('accountId', Sequelize.INTEGER),
      );
      createdTables.push('AccountTwoFactors');
      await queryInterface.createTable(
        'InstallationOperatorTwoFactors',
        factorColumns('operatorId', Sequelize.STRING(80)),
      );
      createdTables.push('InstallationOperatorTwoFactors');
      await addForeignKey(
        queryInterface,
        'AccountTwoFactors',
        'accountId',
        'Accounts',
        'fk_account_two_factor_account',
        'CASCADE',
      );

      await queryInterface.createTable('TwoFactorRecoveryCodes', {
        id,
        accountTwoFactorId: { allowNull: true, type: Sequelize.UUID },
        installationOperatorTwoFactorId: { allowNull: true, type: Sequelize.UUID },
        generation: { allowNull: false, type: Sequelize.INTEGER },
        codeDigest: { allowNull: false, type: Sequelize.CHAR(64).BINARY },
        consumedAt: { allowNull: true, type: Sequelize.DATE },
        revokedAt: { allowNull: true, type: Sequelize.DATE },
        ...timestamps,
      });
      createdTables.push('TwoFactorRecoveryCodes');
      await queryInterface.addIndex('TwoFactorRecoveryCodes', ['codeDigest'], {
        name: 'uq_two_factor_recovery_code_digest',
        unique: true,
      });
      await queryInterface.addIndex(
        'TwoFactorRecoveryCodes',
        ['accountTwoFactorId', 'generation', 'consumedAt', 'revokedAt'],
        { name: 'idx_account_two_factor_recovery_codes_active' },
      );
      await queryInterface.addIndex(
        'TwoFactorRecoveryCodes',
        ['installationOperatorTwoFactorId', 'generation', 'consumedAt', 'revokedAt'],
        { name: 'idx_operator_two_factor_recovery_codes_active' },
      );
      await addForeignKey(
        queryInterface,
        'TwoFactorRecoveryCodes',
        'accountTwoFactorId',
        'AccountTwoFactors',
        'fk_two_factor_recovery_code_account_factor',
        'CASCADE',
      );
      await addForeignKey(
        queryInterface,
        'TwoFactorRecoveryCodes',
        'installationOperatorTwoFactorId',
        'InstallationOperatorTwoFactors',
        'fk_two_factor_recovery_code_operator_factor',
        'CASCADE',
      );

      await queryInterface.createTable('AuthLoginChallenges', {
        id,
        subjectKind: {
          allowNull: false,
          type: Sequelize.ENUM('account', 'installation_operator'),
        },
        accountId: { allowNull: true, type: Sequelize.INTEGER },
        operatorId: { allowNull: true, type: Sequelize.STRING(80) },
        operatorAuthMode: {
          allowNull: true,
          type: Sequelize.ENUM('legacy', 'static-directory'),
        },
        operatorCredentialVersion: { allowNull: true, type: Sequelize.INTEGER },
        purpose: {
          allowNull: false,
          type: Sequelize.ENUM('login', 'required_enrollment'),
        },
        tokenDigest: { allowNull: false, type: Sequelize.CHAR(64).BINARY },
        expiresAt: { allowNull: false, type: Sequelize.DATE },
        consumedAt: { allowNull: true, type: Sequelize.DATE },
        ...timestamps,
      });
      createdTables.push('AuthLoginChallenges');
      await queryInterface.addIndex('AuthLoginChallenges', ['tokenDigest'], {
        name: 'uq_auth_login_challenge_digest',
        unique: true,
      });
      await queryInterface.addIndex(
        'AuthLoginChallenges',
        ['subjectKind', 'accountId', 'operatorId', 'consumedAt', 'expiresAt'],
        { name: 'idx_auth_login_challenge_subject_active' },
      );
      await addForeignKey(
        queryInterface,
        'AuthLoginChallenges',
        'accountId',
        'Accounts',
        'fk_auth_login_challenge_account',
      );

      for (const trigger of TRIGGERS) {
        await createTrigger(queryInterface, trigger);
        createdTriggers.push(trigger.name);
      }
    } catch (error) {
      for (const name of createdTriggers.reverse()) await dropTrigger(queryInterface, name);
      for (const table of createdTables.reverse()) {
        if (await tableExists(queryInterface, table)) await queryInterface.dropTable(table);
      }
      await queryInterface.removeIndex(
        'InstallationOperatorSessions',
        'idx_installation_operator_sessions_identity_active',
      ).catch(() => {});
      for (const [table, column] of addedColumns.reverse()) {
        if (await columnExists(queryInterface, table, column)) {
          await queryInterface.removeColumn(table, column);
        }
      }
      throw error;
    }
  },

  async down(queryInterface) {
    for (const table of TABLES) {
      if (!await tableExists(queryInterface, table)) continue;
      const [rows] = await queryInterface.sequelize.query(
        `SELECT COUNT(*) AS count FROM \`${table}\``,
      );
      if (Number(rows[0]?.count || 0) > 0) {
        throw new Error(
          `Two-factor rollback refused while ${table} contains security history`,
        );
      }
    }
    const [sessionRows] = await queryInterface.sequelize.query(
      `SELECT
        (SELECT COUNT(*) FROM NormalUserSessions
          WHERE twoFactorVerifiedAt IS NOT NULL) AS normalVerified,
        (SELECT COUNT(*) FROM InstallationOperatorSessions
          WHERE twoFactorVerifiedAt IS NOT NULL
             OR authMode <> 'legacy'
             OR operatorId IS NOT NULL
             OR credentialVersion <> 1) AS operatorChanged`,
    );
    if (
      Number(sessionRows[0]?.normalVerified || 0) > 0 ||
      Number(sessionRows[0]?.operatorChanged || 0) > 0
    ) {
      throw new Error('Two-factor rollback refused while session evidence exists');
    }
    for (const trigger of [...TRIGGERS].reverse()) await dropTrigger(queryInterface, trigger.name);
    for (const table of [...TABLES].reverse()) {
      if (await tableExists(queryInterface, table)) await queryInterface.dropTable(table);
    }
    await queryInterface.removeIndex(
      'InstallationOperatorSessions',
      'idx_installation_operator_sessions_identity_active',
    );
    for (const [table, column] of [...SESSION_COLUMNS].reverse()) {
      if (await columnExists(queryInterface, table, column)) {
        await queryInterface.removeColumn(table, column);
      }
    }
  },

  __testing: {
    SESSION_COLUMNS,
    TABLES,
    TRIGGERS,
  },
};
