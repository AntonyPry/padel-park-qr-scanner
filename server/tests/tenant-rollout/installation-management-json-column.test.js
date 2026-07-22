'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const migration = require('../../migrations/20260720220000-add-installation-operator-management');

const { columnTypeAndLengthMatches } = migration.__testing;

test('installation operation response accepts canonical MySQL and MariaDB JSON storage', () => {
  assert.equal(columnTypeAndLengthMatches({
    CHARACTER_MAXIMUM_LENGTH: null,
    COLUMN_TYPE: 'json',
  }, 'json', null), true);
  assert.equal(columnTypeAndLengthMatches({
    CHARACTER_MAXIMUM_LENGTH: 4294967295,
    COLUMN_TYPE: 'longtext',
  }, 'json', null), true);

  assert.equal(columnTypeAndLengthMatches({
    CHARACTER_MAXIMUM_LENGTH: 255,
    COLUMN_TYPE: 'varchar(255)',
  }, 'json', null), false);
  assert.equal(columnTypeAndLengthMatches({
    CHARACTER_MAXIMUM_LENGTH: 1073741823,
    COLUMN_TYPE: 'longtext',
  }, 'json', null), false);
});
