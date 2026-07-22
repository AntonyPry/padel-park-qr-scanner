#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../models');
const {
  assertHistoricalRootsConfigured,
  preflightProviderDefinitions,
  providerDefinitions,
} = require('./bootstrap-provider-connections');

function parseArgs(argv) {
  if (argv.length === 0) return { secretsOnly: false };
  if (argv.length === 1 && argv[0] === '--secrets-only') return { secretsOnly: true };
  throw new Error('Unsupported provider preflight argument');
}

async function tableCount(tableName) {
  const [tables] = await db.sequelize.query(
    `SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:tableName AND TABLE_TYPE='BASE TABLE'`,
    { replacements: { tableName } },
  );
  if (Number(tables[0]?.count || 0) !== 1) return 0;
  const [rows] = await db.sequelize.query(`SELECT COUNT(*) AS count FROM ${tableName}`);
  return Number(rows[0]?.count || 0);
}

async function collectPreMigrationRootCounts() {
  const [calls, rawEvents, subscriptions, receipts] = await Promise.all([
    tableCount('TelephonyCalls'),
    tableCount('TelephonyRawEvents'),
    tableCount('TelephonySubscriptions'),
    tableCount('Receipts'),
  ]);
  return Object.freeze({
    beeline: calls + rawEvents + subscriptions,
    evotor: receipts,
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const definitions = preflightProviderDefinitions(providerDefinitions());
  let rootCounts = null;
  if (!options.secretsOnly) {
    await db.sequelize.authenticate();
    rootCounts = await collectPreMigrationRootCounts();
    assertHistoricalRootsConfigured(definitions, rootCounts);
  }
  console.log(JSON.stringify({
    keyVersion: String(process.env.INTEGRATION_SECRETS_KEY_VERSION).trim(),
    providers: definitions.map((definition) => ({
      configured: definition.required.every((value) => String(value || '').trim()),
      provider: definition.provider,
    })),
    rootCounts,
    status: 'ok',
  }));
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(
        'Provider secret preflight failed:',
        error.code || 'INTEGRATION_SECRET_CONFIGURATION_INVALID',
      );
      process.exitCode = 1;
    })
    .finally(async () => db.sequelize.close());
}

module.exports = {
  collectPreMigrationRootCounts,
  main,
  parseArgs,
};
