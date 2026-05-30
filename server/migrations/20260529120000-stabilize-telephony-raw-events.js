'use strict';

async function addIndexIfMissing(queryInterface, tableName, fields, options) {
  const indexes = await queryInterface.showIndex(tableName);
  if (indexes.some((index) => index.name === options.name)) return;
  await queryInterface.addIndex(tableName, fields, options);
}

async function removeIndexIfExists(queryInterface, tableName, indexName) {
  try {
    await queryInterface.removeIndex(tableName, indexName);
  } catch (error) {
    const message = String(error.message || '');
    if (!/not exist|does not exist|check that it exists|Can't DROP/i.test(message)) {
      throw error;
    }
  }
}

module.exports = {
  async up(queryInterface) {
    if (queryInterface.sequelize.getDialect() === 'mysql') {
      await queryInterface.sequelize.query(`
        DELETE older
        FROM TelephonyRawEvents older
        INNER JOIN TelephonyRawEvents newer
          ON newer.provider = older.provider
          AND newer.externalEventId = older.externalEventId
          AND newer.externalEventId IS NOT NULL
          AND newer.id > older.id
      `);
    }

    await addIndexIfMissing(
      queryInterface,
      'TelephonyRawEvents',
      ['provider', 'externalEventId'],
      {
        name: 'telephony_raw_events_provider_external_event_idx',
        unique: true,
      },
    );
  },

  async down(queryInterface) {
    await removeIndexIfExists(
      queryInterface,
      'TelephonyRawEvents',
      'telephony_raw_events_provider_external_event_idx',
    );
  },
};
