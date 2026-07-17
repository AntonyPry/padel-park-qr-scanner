#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { auditSource: auditAccountSource } = require('./audit-account-writes');

const SERVER_ROOT = path.resolve(__dirname, '..');
const SEARCH_ROOTS = Object.freeze(['src', 'scripts', 'seeders']);
const DOMAIN_MODELS = Object.freeze({
  Booking: 'Bookings',
  BookingChangeLog: 'BookingChangeLogs',
  BookingParticipant: 'BookingParticipants',
  BookingPriceRule: 'BookingPriceRules',
  BookingScheduleException: 'BookingScheduleExceptions',
  BookingSeries: 'BookingSeries',
  BookingSettings: 'BookingSettings',
  Court: 'Courts',
  CourtBlock: 'CourtBlocks',
  Utilizations: 'Utilizations',
});
const ALLOWLISTS = Object.freeze({
  Booking: new Set([
    'seeders/20260526101000-demo-bookings.js',
    'src/services/bookings.service.js',
    'src/services/clients.service.js',
    'src/services/onboarding.service.js',
  ]),
  BookingChangeLog: new Set([
    'seeders/20260526101000-demo-bookings.js',
    'src/services/bookings.service.js',
    'src/services/onboarding.service.js',
  ]),
  BookingParticipant: new Set([
    'src/services/bookings.service.js',
    'src/services/clients.service.js',
  ]),
  BookingPriceRule: new Set(['src/services/booking-rules.service.js']),
  BookingScheduleException: new Set(['src/services/booking-rules.service.js']),
  BookingSeries: new Set([
    'src/services/bookings.service.js',
    'src/services/clients.service.js',
    'src/services/onboarding.service.js',
  ]),
  BookingSettings: new Set(['src/services/booking-rules.service.js']),
  Court: new Set([
    'src/services/booking-rules.service.js',
    'src/services/bookings.service.js',
  ]),
  CourtBlock: new Set(['src/services/booking-rules.service.js']),
  Utilizations: new Set([
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/utilization.service.js',
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
  const protectedSource = singular === plural
    ? source
      .replace(
        new RegExp(`([\\'\\"\\\`])${singular}\\b`, 'g'),
        '$1__BOOKING_TABLE__',
      )
      .replace(
        new RegExp(`\\b((?:insert(?:\\s+ignore)?\\s+into|replace\\s+into|update|delete(?:\\s+\\w+)?\\s+from|truncate(?:\\s+table)?)\\s+(?:\\\`[^\\\`]+\\\`\\.)?\\\`?)${singular}(\\\`?)\\b`, 'gi'),
        '$1__BOOKING_TABLE__$2',
      )
    : source;
  return protectedSource
    .replace(/\bAccounts\b/g, 'LegacyIdentities')
    .replace(/\bAccount\b/g, 'LegacyIdentity')
    .replace(/\baccount\b/g, 'legacyIdentity')
    .replace(new RegExp(`\\b${plural}\\b`, 'g'), singular === plural ? 'Account' : 'Accounts')
    .replace(new RegExp(`\\b${singular}\\b`, 'g'), 'Account')
    .replace(/__BOOKING_TABLE__/g, 'Accounts');
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
        findings.push(...auditDomainSource(source, relative, singular, plural));
      }
    }
  }
  return findings;
}

function main() {
  const findings = auditRepository();
  if (findings.length > 0) {
    console.error('Unauthorized Booking/Court direct writes found:');
    for (const finding of findings) {
      console.error(
        `- ${finding.file}:${finding.line} ${finding.type}: ${finding.match}`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log('Booking/Court direct-write audit passed.');
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
