'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TEST_ROOT = path.resolve(__dirname, '../tests');

function listTestFiles(directory = TEST_ROOT) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listTestFiles(absolute));
    if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(absolute);
  }
  return files.sort();
}

function parseShard(value) {
  if (!value) return { index: 1, total: 1 };
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) throw new Error(`Invalid shard: ${value}`);
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (index < 1 || total < 1 || index > total) {
    throw new Error(`Invalid shard: ${value}`);
  }
  return { index, total };
}

function selectShard(files, shard) {
  return files.filter((_, position) => position % shard.total === shard.index - 1);
}

function readOption(argv, name, fallback) {
  const prefix = `--${name}=`;
  const value = argv.find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function main(argv = process.argv.slice(2)) {
  const shard = parseShard(readOption(argv, 'shard'));
  const concurrency = Number(readOption(argv, 'concurrency', '1'));
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Invalid concurrency: ${concurrency}`);
  }

  const files = listTestFiles();
  const selected = selectShard(files, shard);
  if (selected.length === 0) throw new Error('No tests selected');

  console.log(
    `[test-shard] shard=${shard.index}/${shard.total} ` +
      `files=${selected.length}/${files.length} concurrency=${concurrency}`,
  );

  const result = spawnSync(
    process.execPath,
    ['--test', `--test-concurrency=${concurrency}`, ...selected],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (require.main === module) main();

module.exports = {
  listTestFiles,
  parseShard,
  selectShard,
};
