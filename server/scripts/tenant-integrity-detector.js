#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../models');
const {
  runTenantIntegrityDetector,
} = require('../src/tenant-enforcement/integrity-detector');

function parseArgs(argv) {
  const result = { output: null, strict: true };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--legacy-compatible') result.strict = false;
    else if (value === '--output') result.output = argv[++index] || null;
    else throw new Error(`Unsupported argument: ${value}`);
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = {
    generatedAt: new Date().toISOString(),
    ...await runTenantIntegrityDetector({
      sequelize: db.sequelize,
      strict: options.strict,
    }),
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    const output = path.resolve(options.output);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, serialized, { flag: 'wx' });
  }
  process.stdout.write(serialized);
  if (!report.ok) process.exitCode = 1;
}

main()
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.sequelize.close());
