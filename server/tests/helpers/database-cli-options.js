'use strict';

const { spawnSync: defaultSpawnSync } = require('node:child_process');

function classifyDatabaseCliFamily(versionOutput) {
  const normalized = String(versionOutput || '').trim();
  if (/\bmariadb\b/i.test(normalized)) return 'mariadb';
  if (/\bmysql(?:dump)?\b/i.test(normalized)) return 'mysql';
  throw new Error(
    'Unsupported database CLI family: expected MySQL or MariaDB --version output',
  );
}

function tlsArgsForDatabaseCliFamily(family) {
  if (family === 'mariadb') return ['--skip-ssl'];
  if (family === 'mysql') return ['--ssl-mode=DISABLED'];
  throw new Error(`Unsupported database CLI family: ${family}`);
}

function selectDatabaseCliTlsArgs(binary, options = {}) {
  const spawnSync = options.spawnSync || defaultSpawnSync;
  const result = spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const detail = String(result.stderr || result.error?.message || '').trim();
    throw new Error(
      `Unable to inspect database CLI ${binary}${detail ? `: ${detail}` : ''}`,
    );
  }
  const family = classifyDatabaseCliFamily(
    `${result.stdout || ''}\n${result.stderr || ''}`,
  );
  return {
    family,
    tlsArgs: tlsArgsForDatabaseCliFamily(family),
  };
}

module.exports = {
  classifyDatabaseCliFamily,
  selectDatabaseCliTlsArgs,
  tlsArgsForDatabaseCliFamily,
};
