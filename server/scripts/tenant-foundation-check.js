#!/usr/bin/env node
'use strict';

require('dotenv').config();
const db = require('../models');
const {
  assertTenantFoundationOperational,
} = require('../src/services/tenant-foundation.service');

async function main() {
  await db.sequelize.authenticate();
  const classification = await assertTenantFoundationOperational();
  console.log(
    JSON.stringify(
      {
        bootstrapPending: classification.bootstrapPending,
        checksum: classification.checksum,
        counts: classification.counts,
        state: classification.state,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close();
  });
