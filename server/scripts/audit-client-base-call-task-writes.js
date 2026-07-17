#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { auditSource: auditAccountSource } = require('./audit-account-writes');

const SERVER_ROOT = path.resolve(__dirname, '..');
const SEARCH_ROOTS = Object.freeze(['src', 'scripts', 'seeders']);
const DOMAIN_MODELS = Object.freeze({
  CallTask: 'CallTasks',
  CallTaskAttempt: 'CallTaskAttempts',
  CallTaskClient: 'CallTaskClients',
  ClientBase: 'ClientBases',
  ClientSavedView: 'ClientSavedViews',
});
const ALLOWLISTS = Object.freeze({
  CallTask: new Set([
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/call-tasks.service.js',
    'src/services/clients.service.js',
    'src/services/onboarding.service.js',
    'src/services/telephony.service.js',
  ]),
  CallTaskAttempt: new Set([
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/call-tasks.service.js',
    'src/services/clients.service.js',
    'src/services/onboarding.service.js',
  ]),
  CallTaskClient: new Set([
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/call-tasks.service.js',
    'src/services/clients.service.js',
    'src/services/onboarding.service.js',
    'src/services/telephony.service.js',
  ]),
  ClientBase: new Set([
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/call-tasks.service.js',
    'src/services/client-bases.service.js',
    'src/services/onboarding.service.js',
  ]),
  ClientSavedView: new Set([
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/clients.service.js',
    'src/services/onboarding.service.js',
  ]),
});

function listSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(absolute));
    if (entry.isFile() && /\.(?:[cm]?js|[cm]?ts|tsx)$/.test(entry.name)) {
      files.push(absolute);
    }
  }
  return files;
}

function transformDomain(source, singular, plural) {
  return source
    .replace(/\bAccounts\b/g, 'LegacyIdentities')
    .replace(/\bAccount\b/g, 'LegacyIdentity')
    .replace(/\baccount\b/g, 'legacyIdentity')
    .replace(new RegExp(`\\b${plural}\\b`, 'g'), 'Accounts')
    .replace(new RegExp(`\\b${singular}\\b`, 'g'), 'Account');
}

function auditDomainSource(source, file, singular, plural) {
  return auditAccountSource(
    transformDomain(source, singular, plural),
    file,
  ).map((finding) => ({
    ...finding,
    match: finding.match
      .replace(/\bAccounts\b/g, plural)
      .replace(/\bAccount\b/g, singular),
    type: finding.type
      .replace(/\bAccounts\b/g, plural)
      .replace(/\bAccount\b/g, singular),
  }));
}

function auditSource(source, file = '<memory>') {
  return Object.entries(DOMAIN_MODELS).flatMap(([singular, plural]) =>
    auditDomainSource(source, file, singular, plural));
}

function auditRepository({ serverRoot = SERVER_ROOT } = {}) {
  const findings = [];
  for (const root of SEARCH_ROOTS) {
    const directory = path.join(serverRoot, root);
    for (const file of listSourceFiles(directory)) {
      const relative = path.relative(serverRoot, file).split(path.sep).join('/');
      const source = fs.readFileSync(file, 'utf8');
      for (const [singular, plural] of Object.entries(DOMAIN_MODELS)) {
        if (ALLOWLISTS[singular].has(relative)) continue;
        findings.push(auditDomainSource(source, relative, singular, plural));
      }
    }
  }
  return findings.flat();
}

function main() {
  const findings = auditRepository();
  if (findings.length > 0) {
    console.error('Unauthorized client-base/call-task writes found:');
    for (const finding of findings) {
      console.error(
        `- ${finding.file}:${finding.line} ${finding.type}: ${finding.match}`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log('Client-base/call-task direct-write audit passed.');
}

if (require.main === module) main();

module.exports = {
  ALLOWLISTS,
  DOMAIN_MODELS,
  auditDomainSource,
  auditRepository,
  auditSource,
  transformDomain,
};
