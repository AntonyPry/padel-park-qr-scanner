'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const SequelizePackage = require('sequelize');
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
  MEMBERSHIP_ROLE_VALUES,
} = require('../../src/tenant-foundation/constants');

const SERVER_ROOT = path.resolve(__dirname, '../..');
const SAFE_DATABASE_PATTERN = /^setly_f9_rc_[a-z0-9_]+$/;

function assertDisposableDatabaseName(database) {
  if (!SAFE_DATABASE_PATTERN.test(String(database || ''))) {
    throw new Error(`Refusing non-disposable Feature 9 database: ${database || '<empty>'}`);
  }
  return database;
}

async function adminConnection() {
  return mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    password: process.env.DB_PASSWORD,
    user: process.env.DB_USER,
  });
}

async function createDisposableDatabase(database) {
  assertDisposableDatabaseName(database);
  const admin = await adminConnection();
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await admin.end();
  }
}

async function dropDisposableDatabase(database) {
  assertDisposableDatabaseName(database);
  const admin = await adminConnection();
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  } finally {
    await admin.end();
  }
}

function connect(database) {
  assertDisposableDatabaseName(database);
  return new SequelizePackage.Sequelize(
    database,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
      dialect: 'mysql',
      host: process.env.DB_HOST || '127.0.0.1',
      logging: false,
    },
  );
}

async function migrateAll(schema) {
  const queryInterface = schema.getQueryInterface();
  await queryInterface.createTable('SequelizeMeta', {
    name: {
      allowNull: false,
      primaryKey: true,
      type: SequelizePackage.STRING,
      unique: true,
    },
  });
  const migrations = fs.readdirSync(path.join(SERVER_ROOT, 'migrations'))
    .filter((file) => file.endsWith('.js'))
    .sort();
  for (const file of migrations) {
    const migration = require(path.join(SERVER_ROOT, 'migrations', file));
    await migration.up(queryInterface, SequelizePackage);
    await queryInterface.bulkInsert('SequelizeMeta', [{ name: file }]);
  }
  return migrations;
}

async function selectOne(schema, sql, replacements = {}) {
  const rows = await schema.query(sql, {
    replacements,
    type: SequelizePackage.QueryTypes.SELECT,
  });
  return rows[0] || null;
}

async function insertOrganization(schema, { name, slug }) {
  const now = new Date();
  await schema.query(
    `INSERT INTO Organizations (slug,name,status,createdAt,updatedAt)
     VALUES (:slug,:name,'active',:now,:now)`,
    { replacements: { name, now, slug } },
  );
  return Number((await selectOne(
    schema,
    'SELECT id FROM Organizations WHERE slug=:slug',
    { slug },
  )).id);
}

async function insertClub(schema, { name, organizationId, slug }) {
  const now = new Date();
  await schema.query(
    `INSERT INTO Clubs
       (organizationId,slug,name,timezone,status,createdAt,updatedAt)
     VALUES (:organizationId,:slug,:name,'Europe/Moscow','active',:now,:now)`,
    { replacements: { name, now, organizationId, slug } },
  );
  return Number((await selectOne(
    schema,
    'SELECT id FROM Clubs WHERE organizationId=:organizationId AND slug=:slug',
    { organizationId, slug },
  )).id);
}

async function insertRoleIdentity(schema, { clubs, organizationId, organizationKey, role }) {
  const now = new Date();
  let staffId = null;
  if (role !== 'owner') {
    await schema.query(
      `INSERT INTO Staffs (organizationId,name,role,phone,status,createdAt,updatedAt)
       VALUES (:organizationId,:name,:role,:phone,'active',:now,:now)`,
      {
        replacements: {
          name: `RC ${role}`,
          now,
          organizationId,
          phone: `+7999${organizationId}${MEMBERSHIP_ROLE_VALUES.indexOf(role)}0000`,
          role,
        },
      },
    );
    staffId = Number((await selectOne(
      schema,
      'SELECT id FROM Staffs WHERE organizationId=:organizationId AND name=:name',
      { name: `RC ${role}`, organizationId },
    )).id);
  }
  const email = `${role}.${organizationKey}@f9-rc.test`;
  await schema.query(
    `INSERT INTO Accounts
       (email,passwordHash,role,status,staffId,createdAt,updatedAt)
     VALUES (:email,'test-only-hash',:role,'active',:staffId,:now,:now)`,
    { replacements: { email, now, role, staffId } },
  );
  const accountId = Number((await selectOne(
    schema,
    'SELECT id FROM Accounts WHERE email=:email',
    { email },
  )).id);
  await schema.query(
    `INSERT INTO Memberships
       (organizationId,accountId,staffId,role,status,createdAt,updatedAt)
     VALUES (:organizationId,:accountId,:staffId,:role,'active',:now,:now)`,
    { replacements: { accountId, now, organizationId, role, staffId } },
  );
  const membershipId = Number((await selectOne(
    schema,
    `SELECT id FROM Memberships
      WHERE organizationId=:organizationId AND accountId=:accountId`,
    { accountId, organizationId },
  )).id);
  if (role !== 'owner') {
    for (const clubId of clubs) {
      await schema.query(
        `INSERT INTO MembershipClubAccesses
           (organizationId,membershipId,clubId,roleOverride,status,createdAt,updatedAt)
         VALUES (:organizationId,:membershipId,:clubId,NULL,'active',:now,:now)`,
        { replacements: { clubId, membershipId, now, organizationId } },
      );
    }
  }
  return { accountId, email, membershipId, role, staffId };
}

async function insertConnection(schema, { clubId, organizationId, provider, purpose }) {
  const now = new Date();
  const publicId = `ic_f9_${provider}_${organizationId}_${clubId}`;
  await schema.query(
    `INSERT INTO IntegrationConnections
       (publicId,organizationId,clubId,provider,purpose,connectionKey,status,
        config,metadata,secretCiphertext,secretKeyVersion,secretUpdatedAt,createdAt,updatedAt)
     VALUES (:publicId,:organizationId,:clubId,:provider,:purpose,'default','active',
       '{}','{}','test-only-ciphertext','test-v1',:now,:now,:now)`,
    { replacements: { clubId, now, organizationId, provider, publicId, purpose } },
  );
  return Number((await selectOne(
    schema,
    'SELECT id FROM IntegrationConnections WHERE publicId=:publicId',
    { publicId },
  )).id);
}

async function insertProviderFixture(schema, tenant, key) {
  const now = new Date();
  const beelineConnectionId = await insertConnection(schema, {
    ...tenant,
    provider: 'beeline',
    purpose: 'telephony',
  });
  const evotorConnectionId = await insertConnection(schema, {
    ...tenant,
    provider: 'evotor',
    purpose: 'point_of_sale',
  });
  await schema.query(
    `INSERT INTO TelephonyCalls
       (organizationId,clubId,integrationConnectionId,providerNamespace,provider,
        externalCallId,direction,callStatus,processingStatus,recordingStatus,createdAt,updatedAt)
     VALUES (:organizationId,:clubId,:connectionId,:namespace,'beeline',:externalCallId,
       'inbound','completed','new','missing',:now,:now)`,
    {
      replacements: {
        ...tenant,
        connectionId: beelineConnectionId,
        externalCallId: `same-call-${key}`,
        namespace: `f9:${key}:beeline`,
        now,
      },
    },
  );
  const callId = Number((await selectOne(
    schema,
    'SELECT id FROM TelephonyCalls WHERE integrationConnectionId=:connectionId',
    { connectionId: beelineConnectionId },
  )).id);
  await schema.query(
    `INSERT INTO TelephonyRawEvents
       (organizationId,clubId,integrationConnectionId,idempotencyKey,deliveryCount,
        lastReceivedAt,provider,eventType,externalEventId,payload,receivedAt,
        processingStatus,telephonyCallId,createdAt,updatedAt)
     VALUES (:organizationId,:clubId,:connectionId,:idempotencyKey,1,:now,
       'beeline','CALL','same-event','{}',:now,'processed',:callId,:now,:now)`,
    {
      replacements: {
        ...tenant,
        callId,
        connectionId: beelineConnectionId,
        idempotencyKey: `f9:${key}:event`,
        now,
      },
    },
  );
  await schema.query(
    `INSERT INTO TelephonySubscriptions
       (organizationId,clubId,integrationConnectionId,providerNamespace,provider,
        subscriptionId,status,subscriptionType,callbackUrl,createdAt,updatedAt)
     VALUES (:organizationId,:clubId,:connectionId,:namespace,'beeline',:subscriptionId,
       'active','BASIC_CALL','https://invalid.f9.test/callback',:now,:now)`,
    {
      replacements: {
        ...tenant,
        connectionId: beelineConnectionId,
        namespace: `f9:${key}:beeline`,
        now,
        subscriptionId: `same-subscription-${key}`,
      },
    },
  );
  await schema.query(
    `INSERT INTO Receipts
       (organizationId,clubId,integrationConnectionId,idempotencyKey,evotorId,dateTime,
        type,totalAmount,cash,cashless,createdAt,updatedAt)
     VALUES (:organizationId,:clubId,:connectionId,:idempotencyKey,:evotorId,:now,
       'SELL',100,100,0,:now,:now)`,
    {
      replacements: {
        ...tenant,
        connectionId: evotorConnectionId,
        evotorId: `same-receipt-${key}`,
        idempotencyKey: `f9:${key}:receipt`,
        now,
      },
    },
  );
  await schema.query(
    `INSERT INTO TelephonyTranscriptionJobs
       (organizationId,clubId,telephonyCallId,status,attemptCount,createdAt,updatedAt)
     VALUES (:organizationId,:clubId,:callId,'queued',0,:now,:now)`,
    { replacements: { ...tenant, callId, now } },
  );
  const jobId = Number((await selectOne(
    schema,
    'SELECT id FROM TelephonyTranscriptionJobs WHERE telephonyCallId=:callId',
    { callId },
  )).id);
  await schema.query(
    `INSERT INTO TelephonyTranscriptSegments
       (transcriptionJobId,telephonyCallId,speaker,text,sortOrder,createdAt,updatedAt)
     VALUES (:jobId,:callId,'client','same transcript',0,:now,:now)`,
    { replacements: { callId, jobId, now } },
  );
  return { beelineConnectionId, callId, evotorConnectionId, jobId };
}

async function seedTwoTenantFixture(schema) {
  const defaultTenant = await selectOne(
    schema,
    `SELECT o.id AS organizationId,c.id AS clubId
       FROM Organizations AS o
       JOIN Clubs AS c ON c.organizationId=o.id
      WHERE o.slug=:organizationSlug AND c.slug=:clubSlug`,
    {
      clubSlug: DEFAULT_CLUB_SLUG,
      organizationSlug: DEFAULT_ORGANIZATION_SLUG,
    },
  );
  const organizationA = Number(defaultTenant.organizationId);
  const clubsA = [
    Number(defaultTenant.clubId),
    await insertClub(schema, {
      name: 'RC Annex',
      organizationId: organizationA,
      slug: 'annex',
    }),
  ];
  const organizationB = await insertOrganization(schema, {
    name: 'RC Organization B',
    slug: 'rc-organization-b',
  });
  const clubsB = [
    await insertClub(schema, {
      name: 'RC Main',
      organizationId: organizationB,
      slug: DEFAULT_CLUB_SLUG,
    }),
    await insertClub(schema, {
      name: 'RC Annex',
      organizationId: organizationB,
      slug: 'annex',
    }),
  ];
  const identities = { A: {}, B: {} };
  for (const [organizationKey, organizationId, clubs] of [
    ['A', organizationA, clubsA],
    ['B', organizationB, clubsB],
  ]) {
    for (const role of MEMBERSHIP_ROLE_VALUES) {
      identities[organizationKey][role] = await insertRoleIdentity(schema, {
        clubs,
        organizationId,
        organizationKey: organizationKey.toLowerCase(),
        role,
      });
    }
  }
  const users = {};
  for (const [organizationKey, organizationId] of [
    ['A', organizationA],
    ['B', organizationB],
  ]) {
    const now = new Date();
    await schema.query(
      `INSERT INTO Users
         (organizationId,webId,name,phone,phoneNormalized,status,source,createdAt,updatedAt)
       VALUES (:organizationId,'same-client','Same Client','+79990001122','79990001122',
         'active','rc',:now,:now)`,
      { replacements: { now, organizationId } },
    );
    users[organizationKey] = Number((await selectOne(
      schema,
      `SELECT id FROM Users
        WHERE organizationId=:organizationId AND phoneNormalized='79990001122'`,
      { organizationId },
    )).id);
  }
  const providers = {
    A: await insertProviderFixture(
      schema,
      { clubId: clubsA[0], organizationId: organizationA },
      'a',
    ),
    B: await insertProviderFixture(
      schema,
      { clubId: clubsB[0], organizationId: organizationB },
      'b',
    ),
  };
  return {
    clubs: { A: clubsA, B: clubsB },
    identities,
    organizations: { A: organizationA, B: organizationB },
    providers,
    users,
  };
}

module.exports = {
  SAFE_DATABASE_PATTERN,
  assertDisposableDatabaseName,
  connect,
  createDisposableDatabase,
  dropDisposableDatabase,
  migrateAll,
  seedTwoTenantFixture,
  selectOne,
};
