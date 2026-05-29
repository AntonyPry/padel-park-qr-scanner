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
    await addIndexIfMissing(
      queryInterface,
      'TelephonyCalls',
      ['provider', 'recordExternalId'],
      {
        name: 'telephony_calls_provider_record_external_unique',
        unique: true,
      },
    );
  },

  async down(queryInterface) {
    await removeIndexIfExists(
      queryInterface,
      'TelephonyCalls',
      'telephony_calls_provider_record_external_unique',
    );
  },
};
