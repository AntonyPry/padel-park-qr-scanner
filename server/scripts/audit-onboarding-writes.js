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
  const factoryAliases = new Set();
  const objectAliases = new Map();
  const stringAliases = new Map();

  function unwrapExpression(node) {
    let current = node;
    while (
      current && (
        ts.isParenthesizedExpression(current) ||
        ts.isAsExpression(current) ||
        ts.isNonNullExpression(current) ||
        ts.isTypeAssertionExpression(current)
      )
    ) {
      current = current.expression;
    }
    return current;
  }

  function resolveStaticString(node, seen = new Set()) {
    const expression = unwrapExpression(node);
    if (!expression) return null;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.text;
    }
    if (!ts.isIdentifier(expression) || seen.has(expression.text)) return null;
    seen.add(expression.text);
    const value = stringAliases.get(expression.text);
    return typeof value === 'string' ? value : null;
  }

  function staticPropertyName(node) {
    if (!node) return null;
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text;
    }
    if (ts.isComputedPropertyName(node)) return resolveStaticString(node.expression);
    return null;
  }

  function memberName(node) {
    const expression = unwrapExpression(node);
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    if (ts.isElementAccessExpression(expression)) {
      return resolveStaticString(expression.argumentExpression);
    }
    return null;
  }

  function isRecordEventReference(node) {
    const expression = unwrapExpression(node);
    return (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) &&
      memberName(expression) === 'recordEventSafe';
  }

  function expressionIsFunctionAlias(node) {
    const expression = unwrapExpression(node);
    if (!expression) return false;
    if (isRecordEventReference(expression)) return true;
    if (ts.isIdentifier(expression)) return functionAliases.has(expression.text);
    if (!ts.isCallExpression(expression)) return false;
    const callee = unwrapExpression(expression.expression);
    if (
      (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
      memberName(callee) === 'bind'
    ) {
      return expressionIsFunctionAlias(callee.expression);
    }
    return expressionIsFactoryAlias(callee);
  }

  function expressionMayBeFunctionAlias(node) {
    const expression = unwrapExpression(node);
    if (!expression) return false;
    if (ts.isConditionalExpression(expression)) {
      return expressionMayBeFunctionAlias(expression.whenTrue) ||
        expressionMayBeFunctionAlias(expression.whenFalse);
    }
    if (ts.isBinaryExpression(expression) && [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(expression.operatorToken.kind)) {
      return expressionMayBeFunctionAlias(expression.left) ||
        expressionMayBeFunctionAlias(expression.right);
    }
    return expressionIsFunctionAlias(expression);
  }

  function factoryReturnsFunctionAlias(node) {
    const expression = unwrapExpression(node);
    if (!expression || (!ts.isArrowFunction(expression) &&
      !ts.isFunctionExpression(expression) && !ts.isFunctionDeclaration(expression))) {
      return false;
    }
    if (ts.isArrowFunction(expression) && !ts.isBlock(expression.body)) {
      return expressionMayBeFunctionAlias(expression.body);
    }
    const returns = [];
    function visitReturn(child) {
      if (child !== expression.body && ts.isFunctionLike(child)) return;
      if (ts.isReturnStatement(child)) {
        returns.push(child.expression || null);
        return;
      }
      ts.forEachChild(child, visitReturn);
    }
    visitReturn(expression.body);
    return returns.some((returned) => returned && expressionMayBeFunctionAlias(returned));
  }

  function expressionIsFactoryAlias(node) {
    const expression = unwrapExpression(node);
    if (!expression) return false;
    if (ts.isIdentifier(expression)) return factoryAliases.has(expression.text);
    if (factoryReturnsFunctionAlias(expression)) return true;
    if (!ts.isCallExpression(expression)) return false;
    const callee = unwrapExpression(expression.expression);
    return (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
      memberName(callee) === 'bind' && expressionIsFactoryAlias(callee.expression);
  }

  function addRecordBinding(pattern) {
    let changed = false;
    if (ts.isObjectBindingPattern(pattern)) {
      for (const element of pattern.elements) {
        const property = staticPropertyName(element.propertyName) ||
          (ts.isIdentifier(element.name) ? element.name.text : null);
        if (property === 'recordEventSafe' && ts.isIdentifier(element.name) &&
          !functionAliases.has(element.name.text)) {
          functionAliases.add(element.name.text);
          changed = true;
        }
      }
    } else if (ts.isObjectLiteralExpression(pattern)) {
      for (const property of pattern.properties) {
        let target = null;
        if (ts.isPropertyAssignment(property)) target = unwrapExpression(property.initializer);
        else if (ts.isShorthandPropertyAssignment(property)) target = property.name;
        if (staticPropertyName(property.name) === 'recordEventSafe' &&
          target && ts.isIdentifier(target) && !functionAliases.has(target.text)) {
          functionAliases.add(target.text);
          changed = true;
        }
      }
    }
    return changed;
  }

  function collectStaticStringAlias(name, initializer, invalidateUnknown) {
    const expression = unwrapExpression(initializer);
    let value;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
      value = expression.text;
    } else if (ts.isIdentifier(expression) && stringAliases.has(expression.text)) {
      value = stringAliases.get(expression.text);
    } else if (invalidateUnknown) {
      value = null;
    } else {
      return false;
    }
    if (!stringAliases.has(name.text)) {
      stringAliases.set(name.text, value);
      return true;
    }
    const existing = stringAliases.get(name.text);
    if (existing !== null && (value === null || existing !== value)) {
      stringAliases.set(name.text, null);
      return true;
    }
    return false;
  }

  function collectStaticStrings(node) {
    let changed = false;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
      collectStaticStringAlias(node.name, node.initializer, false)) {
      changed = true;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const name = unwrapExpression(node.left);
      if (ts.isIdentifier(name) &&
        collectStaticStringAlias(name, unwrapExpression(node.right), true)) {
        changed = true;
      }
    }
    ts.forEachChild(node, (child) => {
      if (collectStaticStrings(child)) changed = true;
    });
    return changed;
  }

  for (let iteration = 0; iteration < 20; iteration += 1) {
    if (!collectStaticStrings(parsed)) break;
  }

  function collectNamedAlias(name, initializer) {
    if (!ts.isIdentifier(name) || !initializer) return false;
    let changed = false;
    if (expressionIsFunctionAlias(initializer) && !functionAliases.has(name.text)) {
      functionAliases.add(name.text);
      changed = true;
    }
    if (expressionIsFactoryAlias(initializer) && !factoryAliases.has(name.text)) {
      factoryAliases.add(name.text);
      changed = true;
    }
    if (ts.isObjectLiteralExpression(initializer) || ts.isIdentifier(initializer)) {
      const value = ts.isIdentifier(initializer) ? objectAliases.get(initializer.text) : initializer;
      if (value && objectAliases.get(name.text) !== value) {
        objectAliases.set(name.text, value);
        changed = true;
      }
    }
    return changed;
  }

  function collectAliases(node) {
    let changed = false;
    if (ts.isVariableDeclaration(node)) {
      if (collectNamedAlias(node.name, node.initializer)) changed = true;
      if (addRecordBinding(node.name)) changed = true;
    }
    if (ts.isFunctionDeclaration(node) && node.name &&
      factoryReturnsFunctionAlias(node) && !factoryAliases.has(node.name.text)) {
      factoryAliases.add(node.name.text);
      changed = true;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      if (collectNamedAlias(unwrapExpression(node.left), unwrapExpression(node.right))) changed = true;
      if (addRecordBinding(unwrapExpression(node.left))) changed = true;
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
    return expressionIsFunctionAlias(node.expression);
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
