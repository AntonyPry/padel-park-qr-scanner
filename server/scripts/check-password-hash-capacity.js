#!/usr/bin/env node
'use strict';

require('dotenv').config({ quiet: true });
const db = require('../models');
const authService = require('../src/services/auth.service');

async function main() {
  const [columns] = await db.sequelize.query(
    `SELECT DATA_TYPE AS dataType,
            CHARACTER_MAXIMUM_LENGTH AS characterMaximumLength
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'Accounts'
        AND COLUMN_NAME = 'passwordHash'`,
  );
  if (columns.length !== 1) {
    throw new Error('Expected exactly one Accounts.passwordHash column');
  }
  const column = columns[0];
  const capacity = Number(column.characterMaximumLength);
  if (
    String(column.dataType).toLowerCase() !== 'varchar' ||
    !Number.isInteger(capacity) ||
    capacity < authService._private.MAX_SUPPORTED_ARGON2_HASH_LENGTH
  ) {
    throw new Error('Accounts.passwordHash cannot hold every supported PHC hash');
  }
  console.log(JSON.stringify({
    column: 'Accounts.passwordHash',
    dataType: column.dataType,
    declaredCapacity: capacity,
    legacyHashLength: authService._private.LEGACY_HASH_LENGTH,
    maximumSupportedArgon2HashLength:
      authService._private.MAX_SUPPORTED_ARGON2_HASH_LENGTH,
    result: 'pass',
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close();
  });
