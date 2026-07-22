#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { auditDomainSource } = require('./audit-booking-court-writes');

const SERVER_ROOT = path.resolve(__dirname, '..');
const SEARCH_ROOTS = Object.freeze(['src', 'scripts', 'seeders']);
const DOMAIN_MODELS = Object.freeze({
  Shift: 'Shifts',
  ShiftCashExpense: 'ShiftCashExpenses',
  ShiftCashSession: 'ShiftCashSessions',
  ShiftReport: 'ShiftReports',
  ShiftReportAnswer: 'ShiftReportAnswers',
  ShiftReportTemplate: 'ShiftReportTemplates',
  ShiftReportTemplateItem: 'ShiftReportTemplateItems',
});
const ALLOWLISTS = Object.freeze({
  Shift: new Set([
    'seeders/20260511120000-demo-crm-data.js',
    'src/services/shifts.service.js',
  ]),
  ShiftCashExpense: new Set([
    'src/services/onboarding.service.js',
    'src/services/shift-cash.service.js',
  ]),
  ShiftCashSession: new Set([
    'src/services/onboarding.service.js',
    'src/services/shift-cash.service.js',
  ]),
  ShiftReport: new Set(['src/services/shift-reports.service.js']),
  ShiftReportAnswer: new Set(['src/services/shift-reports.service.js']),
  ShiftReportTemplate: new Set(['src/services/shift-reports.service.js']),
  ShiftReportTemplateItem: new Set(['src/services/shift-reports.service.js']),
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
    console.error('Unauthorized shifts/reports direct writes found:');
    findings.forEach((finding) => {
      console.error(`- ${finding.file}:${finding.line} ${finding.type}: ${finding.match}`);
    });
    process.exitCode = 1;
    return;
  }
  console.log('Shifts/reports direct-write audit passed.');
}

if (require.main === module) main();

module.exports = {
  ALLOWLISTS,
  DOMAIN_MODELS,
  auditRepository,
  auditSource,
};
