'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  selectDatabaseCliTlsArgs,
} = require('./database-cli-options');

function selectForVersion(binary, versionOutput) {
  const calls = [];
  const selection = selectDatabaseCliTlsArgs(binary, {
    spawnSync(...args) {
      calls.push(args);
      return { status: 0, stderr: '', stdout: versionOutput };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], binary);
  assert.deepEqual(calls[0][1], ['--version']);
  return selection;
}

test('MySQL 8 clients use ssl-mode and never receive rejected --skip-ssl', () => {
  const versions = [
    ['mysql', 'mysql  Ver 8.0.42-0ubuntu0.24.04.1 for Linux on x86_64 ((Ubuntu))'],
    ['mysqldump', 'mysqldump  Ver 8.0.42-0ubuntu0.24.04.1 for Linux on x86_64 ((Ubuntu))'],
  ];
  for (const [binary, version] of versions) {
    const selection = selectForVersion(binary, version);
    assert.equal(selection.family, 'mysql');
    assert.deepEqual(selection.tlsArgs, ['--ssl-mode=DISABLED']);
    assert.equal(selection.tlsArgs.includes('--skip-ssl'), false);
  }
});

test('MariaDB clients receive their supported --skip-ssl option', () => {
  const versions = [
    ['mysql', 'mysql from 11.8.2-MariaDB, client 15.2 for osx10.20 (arm64)'],
    ['mysqldump', 'mysqldump from 11.8.2-MariaDB, client 10.19 for osx10.20 (arm64)'],
  ];
  for (const [binary, version] of versions) {
    const selection = selectForVersion(binary, version);
    assert.equal(selection.family, 'mariadb');
    assert.deepEqual(selection.tlsArgs, ['--skip-ssl']);
    assert.equal(selection.tlsArgs.includes('--ssl-mode=DISABLED'), false);
  }
});

test('unknown or unavailable database clients fail closed before backup', () => {
  assert.throws(
    () => selectForVersion('database-cli', 'database-cli version 1.0'),
    /expected MySQL or MariaDB/,
  );
  assert.throws(
    () => selectDatabaseCliTlsArgs('mysql', {
      spawnSync() {
        return { status: 127, stderr: 'command not found', stdout: '' };
      },
    }),
    /Unable to inspect database CLI mysql: command not found/,
  );
});
