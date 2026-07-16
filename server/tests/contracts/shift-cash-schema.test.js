const assert = require('node:assert/strict');
const test = require('node:test');
const { apiSchemas } = require('../../src/contracts/api-schemas');
const { schemaToJsonSchema } = require('../../src/contracts/openapi');

test('Shift Cash expense request publishes only current fields', () => {
  const schema = schemaToJsonSchema(apiSchemas.shiftCash.expenseBody);

  assert.deepEqual(Object.keys(schema.properties).sort(), [
    'amount',
    'description',
    'spentAt',
  ]);
  assert.equal(schema.additionalProperties, false);
});
