'use strict';

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

async function addIndexIfMissing(queryInterface, tableName, fields, options) {
  const indexes = await queryInterface.showIndex(tableName);
  if (indexes.some((index) => index.name === options.name)) return;
  await queryInterface.addIndex(tableName, fields, options);
}

module.exports = {
  async up(queryInterface) {
    await removeIndexIfExists(
      queryInterface,
      'TelephonyCalls',
      'telephony_calls_external_call_id_idx',
    );
    await removeIndexIfExists(
      queryInterface,
      'TelephonyCalls',
      'telephony_calls_external_tracking_id_idx',
    );
    await removeIndexIfExists(
      queryInterface,
      'TelephonyCalls',
      'telephony_calls_record_id_idx',
    );

    await addIndexIfMissing(
      queryInterface,
      'TelephonyCalls',
      ['provider', 'externalCallId'],
      {
        name: 'telephony_calls_provider_external_call_unique',
        unique: true,
      },
    );
    await addIndexIfMissing(
      queryInterface,
      'TelephonyCalls',
      ['provider', 'externalTrackingId'],
      {
        name: 'telephony_calls_provider_external_tracking_unique',
        unique: true,
      },
    );
    await addIndexIfMissing(queryInterface, 'TelephonyCalls', ['provider', 'recordId'], {
      name: 'telephony_calls_provider_record_unique',
      unique: true,
    });
    await addIndexIfMissing(
      queryInterface,
      'TelephonyCalls',
      ['provider', 'clientPhoneNormalized', 'startedAt'],
      {
        name: 'telephony_calls_provider_phone_started_unique',
        unique: true,
      },
    );
  },

  async down(queryInterface) {
    await removeIndexIfExists(
      queryInterface,
      'TelephonyCalls',
      'telephony_calls_provider_phone_started_unique',
    );
    await removeIndexIfExists(
      queryInterface,
      'TelephonyCalls',
      'telephony_calls_provider_record_unique',
    );
    await removeIndexIfExists(
      queryInterface,
      'TelephonyCalls',
      'telephony_calls_provider_external_tracking_unique',
    );
    await removeIndexIfExists(
      queryInterface,
      'TelephonyCalls',
      'telephony_calls_provider_external_call_unique',
    );

    await addIndexIfMissing(queryInterface, 'TelephonyCalls', ['externalCallId'], {
      name: 'telephony_calls_external_call_id_idx',
    });
    await addIndexIfMissing(queryInterface, 'TelephonyCalls', ['externalTrackingId'], {
      name: 'telephony_calls_external_tracking_id_idx',
    });
    await addIndexIfMissing(queryInterface, 'TelephonyCalls', ['recordId'], {
      name: 'telephony_calls_record_id_idx',
    });
  },
};
