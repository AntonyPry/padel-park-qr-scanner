'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const MIGRATIONS_ROOT = path.resolve(__dirname, '../../migrations');
const ROLLOUT_MIGRATIONS = [
  '20260718120000-add-tenant-bookings-courts.js',
  '20260718140000-add-tenant-methodology-skill-map.js',
  '20260718160000-add-tenant-training-notes-plans.js',
  '20260719120000-add-tenant-finance-prepayments-wave.js',
  '20260719160000-add-tenant-shifts-reports.js',
  '20260719200000-add-tenant-audit-log.js',
  '20260719220000-add-tenant-onboarding.js',
  '20260720100000-add-final-tenant-enforcement.js',
  '20260720120000-add-installation-provisioning.js',
];

function statisticsQueries(source) {
  return [...source.matchAll(/`([^`]*INFORMATION_SCHEMA\.STATISTICS[^`]*)`/gis)]
    .map((match) => match[1]);
}

test('rollout migrations bind named MySQL index lookups to their owning table', () => {
  for (const file of ROLLOUT_MIGRATIONS) {
    const source = fs.readFileSync(path.join(MIGRATIONS_ROOT, file), 'utf8');
    assert.doesNotMatch(
      source,
      /async function getIndex\(queryInterface, name\)/,
      `${file} must accept the owning table for named index lookup`,
    );
    for (const query of statisticsQueries(source)) {
      const isNamedLookup = /INDEX_NAME\s*(?:=|LIKE|IN\s*\()/i.test(query);
      if (!isNamedLookup) continue;
      assert.match(
        query,
        /TABLE_NAME\s*(?:=\s*:table(?:Name)?|IN\s*\()/i,
        `${file} has a schema-wide lookup for a table-local index name`,
      );
      assert.doesNotMatch(
        query,
        /TABLE_NAME\s*<>\s*:table/i,
        `${file} must not treat an index on another table as a name collision`,
      );
    }
  }
});
