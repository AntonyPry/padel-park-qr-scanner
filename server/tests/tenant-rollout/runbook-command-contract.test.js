'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const {
  ATTACHMENT_CLI_OPTIONS,
  parseArgs: parseAttachmentArgs,
} = require('../../scripts/migrate-shift-report-attachments');
const {
  BACKUP_MANIFEST_CLI_OPTIONS,
  parseArgs: parseBackupArgs,
} = require('../../scripts/tenant-backup-manifest');
const {
  ROLLOUT_CLI_OPTIONS,
  parseArgs: parseRolloutArgs,
} = require('../../scripts/tenant-production-rollout');
const {
  FINAL_RC_CLI_OPTIONS,
  parseArgs: parseFinalRcArgs,
} = require('../../scripts/run-final-tenant-rc');

const projectRoot = path.resolve(__dirname, '../../..');
const documents = Object.freeze([
  {
    markdown: fs.readFileSync(path.join(
      projectRoot,
      'docs/MULTI_TENANCY_PRODUCTION_ROLLOUT_V10_3.md',
    ), 'utf8'),
    name: 'production rollout',
  },
  {
    markdown: fs.readFileSync(path.join(projectRoot, 'docs/BACKUP_CHECKLIST.md'), 'utf8'),
    name: 'backup checklist',
  },
]);
const runbook = documents[0].markdown;
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'server/package.json')));

const contracts = Object.freeze({
  'tenant:backup:manifest': new Set(BACKUP_MANIFEST_CLI_OPTIONS),
  'tenant:files-workers:attachments': new Set(ATTACHMENT_CLI_OPTIONS),
  'tenant:providers:bootstrap': new Set(),
  'tenant:providers:preflight': new Set(),
  'tenant:rc:targeted': new Set(FINAL_RC_CLI_OPTIONS),
  'tenant:rollout:gate': new Set(ROLLOUT_CLI_OPTIONS),
});
const packageTargets = Object.freeze({
  'tenant:backup:manifest': 'node scripts/tenant-backup-manifest.js',
  'tenant:files-workers:attachments': 'node scripts/migrate-shift-report-attachments.js',
  'tenant:providers:bootstrap': 'node scripts/bootstrap-provider-connections.js',
  'tenant:providers:preflight': 'node scripts/preflight-provider-secrets.js',
  'tenant:rc:targeted': 'node scripts/run-final-tenant-rc.js',
  'tenant:rollout:gate': 'node scripts/tenant-production-rollout.js',
});
const parsers = Object.freeze({
  'tenant:backup:manifest': parseBackupArgs,
  'tenant:files-workers:attachments': parseAttachmentArgs,
  'tenant:rc:targeted': parseFinalRcArgs,
  'tenant:rollout:gate': parseRolloutArgs,
});
const booleanOptions = new Set(['apply', 'rollback', 'verify']);

function documentedNpmCommands(markdown, source) {
  const lines = markdown.split('\n');
  const commands = [];
  for (let index = 0; index < lines.length; index += 1) {
    let command = lines[index].trim();
    if (!command.startsWith('npm run ')) continue;
    while (command.endsWith('\\')) {
      command = `${command.slice(0, -1)} ${String(lines[++index] || '').trim()}`;
    }
    const match = command.match(/^npm run ([^\s]+)(?:\s+--\s+(.*))?$/);
    assert.ok(match, `Unparseable runbook npm command: ${command}`);
    commands.push({
      command,
      options: [...command.matchAll(/--([a-z][a-z0-9-]*)/g)].map((entry) => entry[1]),
      script: match[1],
      source,
    });
  }
  return commands;
}

test('every Feature 10.3 npm command maps to a real strict CLI option contract', () => {
  const commands = documents.flatMap((document) =>
    documentedNpmCommands(document.markdown, document.name));
  assert.ok(commands.length >= 15, 'expected rollout and backup npm commands to be inventoried');
  for (const document of documents) {
    assert.ok(
      commands.some((command) => command.source === document.name),
      `No npm commands inventoried for ${document.name}`,
    );
  }
  for (const invocation of commands) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(contracts, invocation.script),
      `Missing runbook CLI contract for ${invocation.script}`,
    );
    assert.equal(
      packageJson.scripts[invocation.script],
      packageTargets[invocation.script],
      `Unexpected package target for ${invocation.script}`,
    );
    for (const option of invocation.options) {
      assert.equal(
        contracts[invocation.script].has(option),
        true,
        `Unsupported --${option} in ${invocation.command}`,
      );
    }
    const parser = parsers[invocation.script];
    if (parser) {
      const argv = invocation.options.map((option) =>
        booleanOptions.has(option) ? `--${option}` : `--${option}=contract-value`);
      assert.doesNotThrow(
        () => parser(argv),
        `Parser rejected documented invocation: ${invocation.command}`,
      );
    } else {
      assert.deepEqual(invocation.options, [], `${invocation.script} accepts no CLI options`);
    }
  }

  assert.throws(() => parseAttachmentArgs(['--unsupported-runbook-option']), /Unsupported/);
  assert.throws(() => parseBackupArgs(['--unsupported-runbook-option']), /Unsupported/);
  assert.throws(() => parseFinalRcArgs(['--unsupported-runbook-option']), /Unsupported/);
  assert.throws(() => parseRolloutArgs(['--unsupported-runbook-option']), /Unsupported/);
  assert.throws(() => parseBackupArgs(['--verify', '--verify']), /Duplicate/);
  assert.throws(() => parseFinalRcArgs(['--output=/tmp/one', '--output=/tmp/two']), /Duplicate/);
  assert.throws(() => parseRolloutArgs(['--phase=stage', '--phase=stage']), /Duplicate/);
});

test('runbook requires discovered PM2 names and retains storage/loopback safety gates', () => {
  assert.doesNotMatch(runbook, /padel-bot/);
  assert.match(runbook, /pm2 list/);
  assert.match(runbook, /SETLY_PM2_APP/);
  assert.match(runbook, /SETLY_TRANSCRIPTION_PM2_APP/);
  assert.match(runbook, /имена\s+process были `bot` и `transcription-worker`/s);
  assert.match(runbook, /HOST=127\.0\.0\.1/);
  assert.match(runbook, /только loopback listener/);
  assert.match(runbook, /--expect-empty=/);
  assert.match(runbook, /missing source root/s);
});

test('provider secret preflight is documented before maintenance and migrations', () => {
  const firstPreflight = runbook.indexOf('npm run tenant:providers:preflight');
  assert.ok(firstPreflight >= 0, 'provider secret preflight is missing');
  assert.ok(
    firstPreflight < runbook.indexOf('pm2 stop "$SETLY_TRANSCRIPTION_PM2_APP"'),
    'provider secret preflight must run before process stop',
  );
  assert.ok(
    firstPreflight < runbook.indexOf('npx sequelize-cli db:migrate --env production'),
    'provider secret preflight must run before migrations',
  );
  const envExample = fs.readFileSync(path.join(projectRoot, 'server/.env.example'), 'utf8');
  assert.match(envExample, /^INTEGRATION_SECRETS_MASTER_KEY=$/mu);
  assert.match(envExample, /^INTEGRATION_SECRETS_KEY_VERSION=v1$/mu);
  assert.doesNotMatch(runbook, /INTEGRATION_SECRETS_MASTER_KEY=[A-Za-z0-9+/]/u);
});

test('every Feature 10.3 bash block is syntactically executable', () => {
  for (const document of documents) {
    const blocks = [...document.markdown.matchAll(/```bash\n([\s\S]*?)```/g)]
      .map((match) => match[1].replace(/<[^>\n]+>/g, 'contract-placeholder'));
    assert.ok(blocks.length >= 1, `expected bash blocks in ${document.name}`);
    blocks.forEach((block, index) => {
      const result = spawnSync('bash', ['-n'], { encoding: 'utf8', input: block });
      assert.equal(
        result.status,
        0,
        `${document.name} bash block ${index + 1}: ${result.stderr}`,
      );
    });
  }
});
