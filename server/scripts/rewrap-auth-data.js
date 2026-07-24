#!/usr/bin/env node
'use strict';

const db = require('../models');
const {
  checkAndRewrapAuthData,
} = require('../src/services/auth-data-rewrap.service');

function parseArguments(argv) {
  const options = { apply: false };
  for (const argument of argv) {
    if (argument === '--apply') {
      options.apply = true;
    } else if (argument.startsWith('--batch-size=')) {
      options.batchSize = argument.slice('--batch-size='.length);
    } else if (argument.startsWith('--max-refs=')) {
      options.maxRefs = argument.slice('--max-refs='.length);
    } else {
      throw new TypeError('Unsupported argument');
    }
  }
  return options;
}

async function main() {
  const report = await checkAndRewrapAuthData(
    parseArguments(process.argv.slice(2)),
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.totals.errors > 0) process.exitCode = 2;
}

main()
  .catch(() => {
    process.stderr.write('Authentication envelope check failed\n');
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close().catch(() => {});
  });
