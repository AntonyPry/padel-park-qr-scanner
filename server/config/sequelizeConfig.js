const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT || 3306);

module.exports = {
  development: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: DB_HOST,
    port: DB_PORT,
    dialect: 'mysql',
    logging: false,
  },
  test: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: DB_HOST,
    port: DB_PORT,
    dialect: 'mysql',
    logging: false,
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: DB_HOST,
    port: DB_PORT,
    dialect: 'mysql',
    logging: false,
  },
};
