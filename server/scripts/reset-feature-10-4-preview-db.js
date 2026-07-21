'use strict';

const mysql = require('mysql2/promise');

const PREVIEW_DATABASE = 'setly_feature_10_4_structure_preview';

async function reset() {
  if (process.env.NODE_ENV === 'production' || process.env.DB_NAME === 'setly_production') {
    throw new Error('Feature 10.4 preview reset is forbidden in production');
  }
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
    user: process.env.DB_USER,
  });
  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${PREVIEW_DATABASE}\``);
    await connection.query(
      `CREATE DATABASE \`${PREVIEW_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await connection.end();
  }
  console.log(`Reset isolated preview database: ${PREVIEW_DATABASE}`);
}

reset().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
