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
const CANONICAL_SERVICE = 'src/services/onboarding.service.js';
const CANONICAL_WRITE_METHODS = Object.freeze({
  'OnboardingEvent static write': new Set(['recordEventForTarget']),
  'OnboardingProgress instance write': new Set(['setTrainingMode']),
  'OnboardingProgress static write': new Set(['resetProgress', 'saveTaskProgress']),
  'OnboardingTrainingMode instance write': new Set([
    'cleanupTrainingData', 'loadTrainingMode', 'setTrainingMode',
  ]),
  'OnboardingTrainingMode static write': new Set(['setTrainingMode']),
});

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

function functionRanges(parsed) {
  const ranges = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      ranges.push({ end: node.end, name: node.name.text, start: node.getStart(parsed) });
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return ranges;
}

function methodForLine(parsed, ranges, line) {
  const position = parsed.getPositionOfLineAndCharacter(Math.max(0, line - 1), 0);
  const matches = ranges.filter((range) => range.start <= position && position < range.end);
  matches.sort((left, right) => (left.end - left.start) - (right.end - right.start));
  return matches[0]?.name || null;
}

function auditCanonicalServiceWrites(source, file = CANONICAL_SERVICE) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const ranges = functionRanges(parsed);
  return auditSource(source, file).filter((finding) => {
    const method = methodForLine(parsed, ranges, finding.line);
    return !CANONICAL_WRITE_METHODS[finding.type]?.has(method);
  });
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
  const functionAliases = new Set();
  const objectAliases = new Map();

  function isRecordEventReference(node) {
    return ts.isPropertyAccessExpression(node) && node.name.text === 'recordEventSafe';
  }

  function expressionIsFunctionAlias(node) {
    if (!node) return false;
    if (isRecordEventReference(node)) return true;
    if (ts.isIdentifier(node)) return functionAliases.has(node.text);
    return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'bind' &&
      (isRecordEventReference(node.expression.expression) ||
        (ts.isIdentifier(node.expression.expression) &&
          functionAliases.has(node.expression.expression.text)));
  }

  function collectAliases(node) {
    let changed = false;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (expressionIsFunctionAlias(node.initializer) && !functionAliases.has(node.name.text)) {
        functionAliases.add(node.name.text);
        changed = true;
      }
      if (
        ts.isObjectLiteralExpression(node.initializer) || ts.isIdentifier(node.initializer)
      ) {
        const value = ts.isIdentifier(node.initializer)
          ? objectAliases.get(node.initializer.text)
          : node.initializer;
        if (value && objectAliases.get(node.name.text) !== value) {
          objectAliases.set(node.name.text, value);
          changed = true;
        }
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        const property = element.propertyName?.getText(parsed) || element.name.getText(parsed);
        if (property === 'recordEventSafe' && ts.isIdentifier(element.name) &&
          !functionAliases.has(element.name.text)) {
          functionAliases.add(element.name.text);
          changed = true;
        }
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)) {
      if (expressionIsFunctionAlias(node.right) && !functionAliases.has(node.left.text)) {
        functionAliases.add(node.left.text);
        changed = true;
      }
      if (ts.isObjectLiteralExpression(node.right) || ts.isIdentifier(node.right)) {
        const value = ts.isIdentifier(node.right) ? objectAliases.get(node.right.text) : node.right;
        if (value && objectAliases.get(node.left.text) !== value) {
          objectAliases.set(node.left.text, value);
          changed = true;
        }
      }
    }
    ts.forEachChild(node, (child) => {
      if (collectAliases(child)) changed = true;
    });
    return changed;
  }

  for (let iteration = 0; iteration < 20; iteration += 1) {
    if (!collectAliases(parsed)) break;
  }

  function hasTenantProperty(node, seen = new Set()) {
    if (!node) return false;
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return false;
      seen.add(node.text);
      return hasTenantProperty(objectAliases.get(node.text), seen);
    }
    if (!ts.isObjectLiteralExpression(node)) return false;
    let hasTenant = false;
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) {
        if (ts.isIdentifier(property.expression) && objectAliases.has(property.expression.text)) {
          hasTenant = hasTenantProperty(property.expression, new Set(seen)) || hasTenant;
        } else if (ts.isObjectLiteralExpression(property.expression)) {
          hasTenant = hasTenantProperty(property.expression, new Set(seen)) || hasTenant;
        } else {
          hasTenant = false;
        }
        continue;
      }
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'tenant') {
        hasTenant = true;
      } else if (ts.isPropertyAssignment(property) &&
        property.name.getText(parsed).replace(/^['"]|['"]$/g, '') === 'tenant') {
        hasTenant = true;
      }
    }
    return hasTenant;
  }

  function callIsEventBoundary(node) {
    if (isRecordEventReference(node.expression)) return true;
    if (ts.isIdentifier(node.expression) && functionAliases.has(node.expression.text)) return true;
    return ts.isCallExpression(node.expression) && expressionIsFunctionAlias(node.expression);
  }

  function visit(node) {
    if (ts.isCallExpression(node) && callIsEventBoundary(node)) {
      const options = node.arguments[2];
      if (!hasTenantProperty(options)) {
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
      const source = fs.readFileSync(file, 'utf8');
      findings.push(...(relative === CANONICAL_SERVICE
        ? auditCanonicalServiceWrites(source, relative)
        : auditSource(source, relative)));
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
  CANONICAL_SERVICE,
  CANONICAL_WRITE_METHODS,
  MODELS,
  auditCanonicalServiceWrites,
  auditEventBoundaries,
  auditRepository,
  auditSource,
};
