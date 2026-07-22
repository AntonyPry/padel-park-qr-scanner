#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { auditDomainSource } = require('./audit-booking-court-writes');

const SERVER_ROOT = path.resolve(__dirname, '..');
const SEARCH_ROOTS = Object.freeze(['src', 'scripts', 'seeders']);
const DOMAIN_MODELS = Object.freeze({
  Certificate: 'Certificates',
  CertificateRedemption: 'CertificateRedemptions',
  ClientSubscription: 'ClientSubscriptions',
  ClientSubscriptionRedemption: 'ClientSubscriptionRedemptions',
  CorporateClient: 'CorporateClients',
  CorporateLedgerEntry: 'CorporateLedgerEntries',
  EvotorSaleSetting: 'EvotorSaleSettings',
  Finance: 'Finances',
  PendingSale: 'PendingSales',
  PendingSaleHistory: 'PendingSaleHistories',
  SubscriptionType: 'SubscriptionTypes',
});
const ALLOWLISTS = Object.freeze({
  Certificate: new Set([
    'src/services/certificates.service.js',
    'src/services/clients.service.js',
  ]),
  CertificateRedemption: new Set(['src/services/certificates.service.js']),
  ClientSubscription: new Set([
    'src/services/clients.service.js',
    'src/services/subscriptions.service.js',
  ]),
  ClientSubscriptionRedemption: new Set([
    'src/services/subscriptions.service.js',
  ]),
  CorporateClient: new Set([
    'src/services/corporate-clients.service.js',
    'src/services/onboarding.service.js',
  ]),
  CorporateLedgerEntry: new Set([
    'src/services/corporate-clients.service.js',
    'src/services/onboarding.service.js',
  ]),
  EvotorSaleSetting: new Set(['src/services/pending-sale.service.js']),
  Finance: new Set([
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/corporate-clients.service.js',
    'src/services/finance.service.js',
    'src/services/onboarding.service.js',
  ]),
  PendingSale: new Set(['src/services/pending-sale.service.js']),
  PendingSaleHistory: new Set(['src/services/pending-sale.service.js']),
  SubscriptionType: new Set(['src/services/subscriptions.service.js']),
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
    console.error('Unauthorized client-money direct writes found:');
    findings.forEach((finding) => {
      console.error(
        `- ${finding.file}:${finding.line} ${finding.type}: ${finding.match}`,
      );
    });
    process.exitCode = 1;
    return;
  }
  console.log('Client-money direct-write audit passed.');
}

if (require.main === module) main();

module.exports = {
  ALLOWLISTS,
  DOMAIN_MODELS,
  auditRepository,
  auditSource,
};
