async function addIndexIfMissing(queryInterface, table, fields, name) {
  const indexes = await queryInterface.showIndex(table);
  if (indexes.some((index) => index.name === name)) return;
  await queryInterface.addIndex(table, fields, { name });
}

async function removeIndexIfPresent(queryInterface, table, name) {
  const indexes = await queryInterface.showIndex(table);
  if (!indexes.some((index) => index.name === name)) return;
  await queryInterface.removeIndex(table, name);
}

module.exports = {
  async up(queryInterface) {
    await addIndexIfMissing(queryInterface, 'Receipts', ['dateTime', 'type'], 'idx_receipts_datetime_type');
    await addIndexIfMissing(queryInterface, 'ClientSubscriptions', ['startsAt', 'status'], 'idx_client_subscriptions_starts_status');
    await addIndexIfMissing(queryInterface, 'Certificates', ['startsAt', 'status', 'source'], 'idx_certificates_starts_status_source');
    await addIndexIfMissing(queryInterface, 'Finances', ['date', 'isTraining', 'type'], 'idx_finances_date_training_type');
    await addIndexIfMissing(queryInterface, 'CorporateLedgerEntries', ['date', 'isTraining', 'status'], 'idx_corporate_ledger_date_training_status');
    await addIndexIfMissing(queryInterface, 'Bookings', ['startsAt', 'isTraining', 'status'], 'idx_bookings_starts_training_status');
  },

  async down(queryInterface) {
    await removeIndexIfPresent(queryInterface, 'Bookings', 'idx_bookings_starts_training_status');
    await removeIndexIfPresent(queryInterface, 'CorporateLedgerEntries', 'idx_corporate_ledger_date_training_status');
    await removeIndexIfPresent(queryInterface, 'Finances', 'idx_finances_date_training_type');
    await removeIndexIfPresent(queryInterface, 'Certificates', 'idx_certificates_starts_status_source');
    await removeIndexIfPresent(queryInterface, 'ClientSubscriptions', 'idx_client_subscriptions_starts_status');
    await removeIndexIfPresent(queryInterface, 'Receipts', 'idx_receipts_datetime_type');
  },
};
