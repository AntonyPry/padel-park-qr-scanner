#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '..');
const SEARCH_ROOTS = ['src', 'scripts', 'seeders'];
const ALLOWLIST = new Set([
  'src/services/account-lifecycle.service.js',
  'src/services/account-metadata.service.js',
  'src/services/account-seeder-adapter.js',
]);

const WRITE_PATTERNS = [
  { name: 'Account static write', regex: /\b(?:db\.)?Account\s*\.\s*(?:create|update|destroy|upsert|bulkCreate)\s*\(/g },
  { name: 'Account instance write', regex: /\b(?:account|lockedAccount|createdAccount)\s*\.\s*(?:update|destroy)\s*\(/gi },
  { name: 'Account graph instance write', regex: /\bgraph\s*\.\s*account\s*\.\s*(?:update|destroy)\s*\(/gi },
  { name: 'Accounts bulk write', regex: /\bbulk(?:Insert|Update|Delete)\s*\(\s*['"]Accounts['"]/g },
];

function listJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listJavaScriptFiles(absolute));
    if (entry.isFile() && /\.(?:js|ts)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function auditSource(source, file = '<memory>') {
  const findings = [];
  for (const pattern of WRITE_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(source))) {
      findings.push({
        file,
        line: lineNumberAt(source, match.index),
        match: match[0],
        type: pattern.name,
      });
    }
  }
  const accountVariables = new Set();
  const assignmentPattern =
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+(?:db\.)?Account\s*\.\s*(?:findByPk|findOne|findOrCreate|create)\s*\(/g;
  let assignment;
  while ((assignment = assignmentPattern.exec(source))) {
    accountVariables.add(assignment[1]);
  }
  for (const variable of accountVariables) {
    const instancePattern = new RegExp(
      `\\b${variable}\\s*\\.\\s*(?:update|destroy)\\s*\\(`,
      'g',
    );
    let match;
    while ((match = instancePattern.exec(source))) {
      if (
        findings.some(
          (finding) => finding.line === lineNumberAt(source, match.index),
        )
      ) {
        continue;
      }
      findings.push({
        file,
        line: lineNumberAt(source, match.index),
        match: match[0],
        type: 'Account inferred instance write',
      });
    }
  }
  return findings;
}

function auditRepository({ serverRoot = SERVER_ROOT } = {}) {
  const findings = [];
  for (const root of SEARCH_ROOTS) {
    const directory = path.join(serverRoot, root);
    for (const file of listJavaScriptFiles(directory)) {
      const relative = path.relative(serverRoot, file).split(path.sep).join('/');
      if (ALLOWLIST.has(relative)) continue;
      findings.push(...auditSource(fs.readFileSync(file, 'utf8'), relative));
    }
  }
  return findings;
}

function main() {
  const findings = auditRepository();
  if (findings.length > 0) {
    console.error('Unauthorized Account writes found:');
    for (const finding of findings) {
      console.error(
        `- ${finding.file}:${finding.line} ${finding.type}: ${finding.match}`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log('Account direct-write audit passed.');
}

if (require.main === module) main();

module.exports = {
  ALLOWLIST,
  WRITE_PATTERNS,
  auditRepository,
  auditSource,
};
