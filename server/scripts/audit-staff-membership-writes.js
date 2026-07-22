#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { auditSource: auditAccountSource } = require('./audit-account-writes');

const SERVER_ROOT = path.resolve(__dirname, '..');
const SEARCH_ROOTS = Object.freeze(['src', 'scripts', 'seeders']);
const STAFF_ALLOWLIST = new Set([
  'seeders/20260511120000-demo-crm-data.js',
  'src/services/account-lifecycle.service.js',
  'src/services/account-seeder-adapter.js',
  'src/services/staff.service.js',
]);
const MEMBERSHIP_ALLOWLIST = new Set([
  'src/services/account-lifecycle.service.js',
  'src/services/account-seeder-adapter.js',
]);

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
    .replace(new RegExp(`\\b${plural}\\b`, 'g'), 'Accounts')
    .replace(new RegExp(`\\b${singular}\\b`, 'g'), 'Account');
}

function auditDomainSource(source, file, singular, plural) {
  const transformed = transformDomain(source, singular, plural);
  return auditAccountSource(transformed, file).map((finding) => ({
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
  return [
    ...auditDomainSource(source, file, 'Staff', 'Staffs'),
    ...auditDomainSource(source, file, 'Membership', 'Memberships'),
  ];
}

function auditRepository({ serverRoot = SERVER_ROOT } = {}) {
  const findings = [];
  for (const root of SEARCH_ROOTS) {
    const directory = path.join(serverRoot, root);
    for (const file of listSourceFiles(directory)) {
      const relative = path.relative(serverRoot, file).split(path.sep).join('/');
      const source = fs.readFileSync(file, 'utf8');
      if (!STAFF_ALLOWLIST.has(relative)) {
        findings.push(
          ...auditDomainSource(source, relative, 'Staff', 'Staffs'),
        );
      }
      if (!MEMBERSHIP_ALLOWLIST.has(relative)) {
        findings.push(
          ...auditDomainSource(source, relative, 'Membership', 'Memberships'),
        );
      }
    }
  }
  return findings;
}

function main() {
  const findings = auditRepository();
  if (findings.length > 0) {
    console.error('Unauthorized Staff/Membership writes found:');
    for (const finding of findings) {
      console.error(
        `- ${finding.file}:${finding.line} ${finding.type}: ${finding.match}`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log('Staff/Membership direct-write audit passed.');
}

if (require.main === module) main();

module.exports = {
  MEMBERSHIP_ALLOWLIST,
  STAFF_ALLOWLIST,
  auditRepository,
  auditSource,
  transformDomain,
};
