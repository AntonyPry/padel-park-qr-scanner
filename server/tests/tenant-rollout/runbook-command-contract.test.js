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

const projectRoot = path.resolve(__dirname, '../../..');
const runbookPath = path.join(
  projectRoot,
  'docs/MULTI_TENANCY_PRODUCTION_ROLLOUT_V10_3.md',
);
const runbook = fs.readFileSync(runbookPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'server/package.json')));

const contracts = Object.freeze({
  'tenant:backup:manifest': new Set(BACKUP_MANIFEST_CLI_OPTIONS),
  'tenant:files-workers:attachments': new Set(ATTACHMENT_CLI_OPTIONS),
  'tenant:providers:bootstrap': new Set(),
  'tenant:rollout:gate': new Set(ROLLOUT_CLI_OPTIONS),
});
const packageTargets = Object.freeze({
  'tenant:backup:manifest': 'node scripts/tenant-backup-manifest.js',
  'tenant:files-workers:attachments': 'node scripts/migrate-shift-report-attachments.js',
  'tenant:providers:bootstrap': 'node scripts/bootstrap-provider-connections.js',
  'tenant:rollout:gate': 'node scripts/tenant-production-rollout.js',
});
const parsers = Object.freeze({
  'tenant:backup:manifest': parseBackupArgs,
  'tenant:files-workers:attachments': parseAttachmentArgs,
  'tenant:rollout:gate': parseRolloutArgs,
});
const booleanOptions = new Set(['apply', 'rollback', 'verify']);

function documentedNpmCommands(markdown) {
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
    });
  }
  return commands;
}

test('every Feature 10.3 npm command maps to a real strict CLI option contract', () => {
  const commands = documentedNpmCommands(runbook);
  assert.ok(commands.length >= 10, 'expected all rollout npm commands to be inventoried');
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
  assert.throws(() => parseRolloutArgs(['--unsupported-runbook-option']), /Unsupported/);
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

test('every Feature 10.3 bash block is syntactically executable', () => {
  const blocks = [...runbook.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
  assert.ok(blocks.length >= 5, 'expected rollout bash blocks');
  blocks.forEach((block, index) => {
    const result = spawnSync('bash', ['-n'], { encoding: 'utf8', input: block });
    assert.equal(result.status, 0, `bash block ${index + 1}: ${result.stderr}`);
  });
});
