'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  parseShard,
  selectShard,
} = require('../../scripts/run-test-group');

const FILES = [
  '/tests/a.test.js',
  '/tests/b.db.test.js',
  '/tests/c.test.js',
  '/tests/d.db.test.js',
  '/tests/e.db.test.js',
];

test('shards partition a group without omissions or duplicates', () => {
  const shards = [1, 2, 3].map((index) =>
    selectShard(FILES, { index, total: 3 }),
  );
  assert.deepEqual(shards.flat().sort(), [...FILES].sort());
  assert.equal(new Set(shards.flat()).size, FILES.length);
});

test('shard parser rejects malformed and impossible ranges', () => {
  assert.deepEqual(parseShard(), { index: 1, total: 1 });
  assert.deepEqual(parseShard('2/4'), { index: 2, total: 4 });
  assert.throws(() => parseShard('0/4'), /Invalid shard/);
  assert.throws(() => parseShard('5/4'), /Invalid shard/);
  assert.throws(() => parseShard('two/four'), /Invalid shard/);
});
