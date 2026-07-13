const assert = require('node:assert/strict');
const test = require('node:test');
const migration = require('../../migrations/20260712130000-add-revenue-ltv-analytics-indexes');

const expectedIndexes = new Map([
  ['ClientSubscriptions', 'idx_client_subscriptions_starts_status'],
  ['Certificates', 'idx_certificates_starts_status_source'],
  ['Finances', 'idx_finances_date_training_type'],
  ['CorporateLedgerEntries', 'idx_corporate_ledger_date_training_status'],
  ['Bookings', 'idx_bookings_starts_training_status'],
]);

test('revenue LTV migration reuses an equivalent Receipts index with a legacy name', async () => {
  const additions = [];
  const queryInterface = {
    async showIndex(table) {
      if (table === 'Receipts') {
        return [{
          name: 'idx_receipts_date_time_type',
          fields: [{ attribute: 'dateTime' }, { attribute: 'type' }],
        }];
      }
      return [];
    },
    async addIndex(table, fields, options) {
      additions.push({ table, fields, name: options.name });
    },
  };

  await migration.up(queryInterface);

  assert.equal(additions.some(({ table }) => table === 'Receipts'), false);
  assert.deepEqual(
    new Map(additions.map(({ table, name }) => [table, name])),
    expectedIndexes,
  );
});

test('revenue LTV migration does not treat a differently ordered index as equivalent', async () => {
  const additions = [];
  const queryInterface = {
    async showIndex(table) {
      if (table === 'Receipts') {
        return [{
          name: 'idx_receipts_type_date_time',
          fields: [{ attribute: 'type' }, { attribute: 'dateTime' }],
        }];
      }
      return [{ name: expectedIndexes.get(table), fields: [] }];
    },
    async addIndex(table, fields, options) {
      additions.push({ table, fields, name: options.name });
    },
  };

  await migration.up(queryInterface);

  assert.deepEqual(additions, [{
    table: 'Receipts',
    fields: ['dateTime', 'type'],
    name: 'idx_receipts_datetime_type',
  }]);
});
