#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { auditDomainSource } = require('./audit-booking-court-writes');

const SERVER_ROOT = path.resolve(__dirname, '..');
const MODELS = Object.freeze({
  OnboardingEvent: 'OnboardingEvents',
  OnboardingProgress: 'OnboardingProgresses',
  OnboardingTrainingMode: 'OnboardingTrainingModes',
});
const ALLOWLIST = new Set(['src/services/onboarding.service.js']);

function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(absolute));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

function auditSource(source, file = '<memory>') {
  return Object.entries(MODELS).flatMap(([model, table]) =>
    auditDomainSource(source, file, model, table));
}

function auditEventBoundaries(source, file = '<memory>') {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    /\.tsx?$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const findings = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'recordEventSafe'
    ) {
      const options = node.arguments[2];
      const hasTenant = options && ts.isObjectLiteralExpression(options) &&
        options.properties.some((property) => {
          if (ts.isShorthandPropertyAssignment(property)) return property.name.text === 'tenant';
          if (!ts.isPropertyAssignment(property)) return false;
          return property.name.getText(parsed).replace(/^['"]|['"]$/g, '') === 'tenant';
        });
      if (!hasTenant) {
        const position = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
        findings.push({
          file,
          line: position.line + 1,
          match: node.getText(parsed).slice(0, 160),
          type: 'recordEventSafe without explicit tenant boundary',
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return findings;
}

function auditRepository({ serverRoot = SERVER_ROOT } = {}) {
  const findings = [];
  for (const root of ['src', 'scripts', 'seeders']) {
    for (const file of listFiles(path.join(serverRoot, root))) {
      const relative = path.relative(serverRoot, file).split(path.sep).join('/');
      if (ALLOWLIST.has(relative)) continue;
      const source = fs.readFileSync(file, 'utf8');
      findings.push(...auditSource(source, relative));
      findings.push(...auditEventBoundaries(source, relative));
    }
  }
  return findings;
}

function main() {
  const findings = auditRepository();
  if (findings.length) {
    console.error('Unauthorized onboarding direct writes found:');
    findings.forEach((finding) =>
      console.error(`- ${finding.file}:${finding.line} ${finding.type}: ${finding.match}`));
    process.exitCode = 1;
  } else {
    console.log('Onboarding AST direct-write audit passed.');
  }
}

if (require.main === module) main();
module.exports = {
  ALLOWLIST,
  MODELS,
  auditEventBoundaries,
  auditRepository,
  auditSource,
};
