#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../models');
const {
  migrateShiftReportAttachments,
} = require('../src/files-workers/shift-attachment-migration');

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--apply') && args.has('--rollback')) {
    throw new Error('Use either --apply or --rollback, not both');
  }
  await db.sequelize.authenticate();
  const manifest = await migrateShiftReportAttachments({
    apply: args.has('--apply'),
    rollback: args.has('--rollback'),
  });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  const unsafe =
    manifest.counts.checksumMismatch > 0 ||
    manifest.counts.invalidMetadata > 0 ||
    manifest.counts.missingLegacy > 0 ||
    manifest.counts.missingStorage > 0;
  if (unsafe) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error.code || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close().catch(() => {});
  });
