'use strict';

const crypto = require('node:crypto');

const DEFAULT_ORGANIZATION_SLUG = 'padel-park';
const DEFAULT_CLUB_SLUG = 'padel-park';
const TENANT_CLUB_FK = 'telephony_transcription_jobs_tenant_club_fk';
const CLAIM_UNIQUE = 'telephony_transcription_jobs_claim_id_unique';
const QUEUE_INDEX = 'telephony_transcription_jobs_tenant_queue_idx';
const CALL_INDEX = 'telephony_transcription_jobs_tenant_call_idx';

async function rows(queryInterface, sql, options = {}) {
  const [result] = await queryInterface.sequelize.query(sql, options);
  return result;
}

function checksumJobs(items) {
  const value = items
    .map((row) => [row.id, row.telephonyCallId, row.status, row.attemptCount].join(':'))
    .join('|');
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function jobSnapshot(queryInterface) {
  const items = await rows(
    queryInterface,
    'SELECT id, telephonyCallId, status, attemptCount FROM TelephonyTranscriptionJobs ORDER BY id',
  );
  return { count: items.length, checksum: checksumJobs(items) };
}

async function exactDefaultTenant(queryInterface, transaction) {
  const organizations = await rows(
    queryInterface,
    'SELECT id, slug, status FROM Organizations ORDER BY id FOR UPDATE',
    { transaction },
  );
  const clubs = await rows(
    queryInterface,
    'SELECT id, organizationId, slug, status FROM Clubs ORDER BY id FOR UPDATE',
    { transaction },
  );
  if (
    organizations.length !== 1 ||
    clubs.length !== 1 ||
    organizations[0].slug !== DEFAULT_ORGANIZATION_SLUG ||
    clubs[0].slug !== DEFAULT_CLUB_SLUG ||
    organizations[0].status !== 'active' ||
    clubs[0].status !== 'active' ||
    Number(clubs[0].organizationId) !== Number(organizations[0].id)
  ) {
    throw new Error('Feature 4.2 requires the exact active default tenant');
  }
  return {
    clubId: Number(clubs[0].id),
    organizationId: Number(organizations[0].id),
  };
}

async function addColumnIfMissing(queryInterface, table, name, definition) {
  const description = await queryInterface.describeTable(table);
  if (description[name]) return false;
  await queryInterface.addColumn(table, name, definition);
  return true;
}

async function removeIndexIfPresent(queryInterface, table, name) {
  const indexes = await queryInterface.showIndex(table);
  if (indexes.some((index) => index.name === name)) {
    await queryInterface.removeIndex(table, name);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const before = await jobSnapshot(queryInterface);
    const tenant = await queryInterface.sequelize.transaction(async (transaction) => {
      const exact = await exactDefaultTenant(queryInterface, transaction);
      const orphans = await rows(
        queryInterface,
        `SELECT j.id
         FROM TelephonyTranscriptionJobs j
         LEFT JOIN TelephonyCalls c ON c.id = j.telephonyCallId
         WHERE c.id IS NULL
         LIMIT 1
         FOR UPDATE`,
        { transaction },
      );
      if (orphans.length > 0) {
        throw new Error('TelephonyTranscriptionJobs contains orphan TelephonyCall references');
      }
      return exact;
    });

    await addColumnIfMissing(queryInterface, 'TelephonyTranscriptionJobs', 'organizationId', {
      allowNull: true,
      type: Sequelize.INTEGER,
    });
    await addColumnIfMissing(queryInterface, 'TelephonyTranscriptionJobs', 'clubId', {
      allowNull: true,
      type: Sequelize.INTEGER,
    });
    await addColumnIfMissing(queryInterface, 'TelephonyTranscriptionJobs', 'claimId', {
      allowNull: true,
      type: Sequelize.UUID,
    });
    await addColumnIfMissing(queryInterface, 'TelephonyTranscriptionJobs', 'claimTokenHash', {
      allowNull: true,
      type: Sequelize.STRING(64),
    });
    await addColumnIfMissing(queryInterface, 'TelephonyTranscriptionJobs', 'claimExpiresAt', {
      allowNull: true,
      type: Sequelize.DATE,
    });
    await addColumnIfMissing(queryInterface, 'TelephonyTranscriptionJobs', 'claimWorkerCredentialId', {
      allowNull: true,
      type: Sequelize.STRING(96),
    });
    await addColumnIfMissing(queryInterface, 'TelephonyTranscriptionJobs', 'workerProtocolVersion', {
      allowNull: true,
      type: Sequelize.INTEGER,
    });

    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        `UPDATE TelephonyTranscriptionJobs
         SET organizationId = :organizationId, clubId = :clubId
         WHERE organizationId IS NULL OR clubId IS NULL`,
        { replacements: tenant, transaction },
      );
      const mismatches = await rows(
        queryInterface,
        `SELECT id FROM TelephonyTranscriptionJobs
         WHERE organizationId <> :organizationId OR clubId <> :clubId
         LIMIT 1
         FOR UPDATE`,
        { replacements: tenant, transaction },
      );
      if (mismatches.length > 0) {
        throw new Error('TelephonyTranscriptionJobs tenant attribution is ambiguous');
      }
    });

    await queryInterface.changeColumn('TelephonyTranscriptionJobs', 'organizationId', {
      allowNull: false,
      type: Sequelize.INTEGER,
    });
    await queryInterface.changeColumn('TelephonyTranscriptionJobs', 'clubId', {
      allowNull: false,
      type: Sequelize.INTEGER,
    });

    const constraints = await queryInterface.getForeignKeyReferencesForTable(
      'TelephonyTranscriptionJobs',
    );
    if (!constraints.some((constraint) => constraint.constraintName === TENANT_CLUB_FK)) {
      await queryInterface.addConstraint('TelephonyTranscriptionJobs', {
        fields: ['organizationId', 'clubId'],
        name: TENANT_CLUB_FK,
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
        references: {
          table: 'Clubs',
          fields: ['organizationId', 'id'],
        },
        type: 'foreign key',
      });
    }
    const indexes = await queryInterface.showIndex('TelephonyTranscriptionJobs');
    if (!indexes.some((index) => index.name === CLAIM_UNIQUE)) {
      await queryInterface.addIndex('TelephonyTranscriptionJobs', ['claimId'], {
        name: CLAIM_UNIQUE,
        unique: true,
      });
    }
    if (!indexes.some((index) => index.name === QUEUE_INDEX)) {
      await queryInterface.addIndex(
        'TelephonyTranscriptionJobs',
        ['organizationId', 'clubId', 'status', 'claimExpiresAt', 'createdAt', 'id'],
        { name: QUEUE_INDEX },
      );
    }
    if (!indexes.some((index) => index.name === CALL_INDEX)) {
      await queryInterface.addIndex(
        'TelephonyTranscriptionJobs',
        ['organizationId', 'clubId', 'telephonyCallId', 'createdAt', 'id'],
        { name: CALL_INDEX },
      );
    }

    const after = await jobSnapshot(queryInterface);
    if (before.count !== after.count || before.checksum !== after.checksum) {
      throw new Error('Feature 4.2 transcription attribution changed job rows unexpectedly');
    }
    console.log(JSON.stringify({ migration: 'Feature 4.2 transcription attribution', before, after }));
  },

  async down(queryInterface) {
    const before = await jobSnapshot(queryInterface);
    const constraints = await queryInterface.getForeignKeyReferencesForTable(
      'TelephonyTranscriptionJobs',
    );
    if (constraints.some((constraint) => constraint.constraintName === TENANT_CLUB_FK)) {
      await queryInterface.removeConstraint('TelephonyTranscriptionJobs', TENANT_CLUB_FK);
    }
    await removeIndexIfPresent(queryInterface, 'TelephonyTranscriptionJobs', CALL_INDEX);
    await removeIndexIfPresent(queryInterface, 'TelephonyTranscriptionJobs', QUEUE_INDEX);
    await removeIndexIfPresent(queryInterface, 'TelephonyTranscriptionJobs', CLAIM_UNIQUE);
    const columns = [
      'workerProtocolVersion',
      'claimWorkerCredentialId',
      'claimExpiresAt',
      'claimTokenHash',
      'claimId',
      'clubId',
      'organizationId',
    ];
    for (const column of columns) {
      const table = await queryInterface.describeTable('TelephonyTranscriptionJobs');
      if (table[column]) await queryInterface.removeColumn('TelephonyTranscriptionJobs', column);
    }
    const after = await jobSnapshot(queryInterface);
    if (before.count !== after.count || before.checksum !== after.checksum) {
      throw new Error('Feature 4.2 rollback changed transcription job data');
    }
    console.log(JSON.stringify({ migration: 'Feature 4.2 transcription attribution down', before, after }));
  },
};
