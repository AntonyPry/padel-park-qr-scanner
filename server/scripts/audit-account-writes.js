#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SERVER_ROOT = path.resolve(__dirname, '..');
const SEARCH_ROOTS = ['src', 'scripts', 'seeders'];
const ALLOWLIST = new Set([
  'src/services/account-lifecycle.service.js',
  'src/services/account-metadata.service.js',
  'src/services/account-seeder-adapter.js',
]);

const ACCOUNT_STATIC_WRITE_METHODS = new Set([
  'bulkCreate',
  'create',
  'decrement',
  'drop',
  'destroy',
  'findCreateFind',
  'findOrCreate',
  'increment',
  'restore',
  'sync',
  'truncate',
  'update',
  'upsert',
]);
const ACCOUNT_INSTANCE_WRITE_METHODS = new Set([
  'decrement',
  'destroy',
  'increment',
  'restore',
  'save',
  'update',
]);
const ACCOUNT_INSTANCE_FACTORY_METHODS = new Set([
  'build',
  'create',
  'findByPk',
  'findCreateFind',
  'findOne',
  'findOrBuild',
  'findOrCreate',
]);
const QUERY_INTERFACE_WRITE_METHODS = new Set([
  'bulkDelete',
  'bulkInsert',
  'bulkUpdate',
  'delete',
  'insert',
  'update',
  'upsert',
]);
const ACCOUNT_RAW_SQL_WRITE =
  /\b(?:insert\s+(?:ignore\s+)?into|replace\s+into|update(?:\s+low_priority|\s+ignore)*|delete(?:\s+\w+)?\s+from|truncate(?:\s+table)?)\s+(?:`[^`]+`\.)?`?Accounts`?\b/i;

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

function scriptKind(file) {
  if (/\.tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.(?:ts|mts|cts)$/.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (ts.isAwaitExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isTypeAssertionExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function staticPropertyName(node) {
  const current = unwrapExpression(node);
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isElementAccessExpression(current)) {
    const argument = unwrapExpression(current.argumentExpression);
    if (ts.isStringLiteralLike(argument)) return argument.text;
  }
  return null;
}

function propertyReceiver(node) {
  const current = unwrapExpression(node);
  if (
    ts.isPropertyAccessExpression(current) ||
    ts.isElementAccessExpression(current)
  ) {
    return unwrapExpression(current.expression);
  }
  return null;
}

function boundTarget(node) {
  const current = unwrapExpression(node);
  if (
    ts.isCallExpression(current) &&
    staticPropertyName(current.expression) === 'bind'
  ) {
    return propertyReceiver(current.expression);
  }
  return current;
}

function bindingIdentifier(node) {
  return ts.isIdentifier(node) ? node.text : null;
}

function isAccountNamedIdentifier(node) {
  return (
    ts.isIdentifier(node) &&
    (node.text === 'account' || /Account$/.test(node.text))
  );
}

function isAccountModelExpression(node, modelAliases) {
  const current = unwrapExpression(node);
  if (!current) return false;
  if (ts.isIdentifier(current) && modelAliases.has(current.text)) return true;
  return staticPropertyName(current) === 'Account';
}

function isAccountInstanceExpression(node, instanceAliases, modelAliases) {
  const current = unwrapExpression(node);
  if (!current) return false;
  if (ts.isIdentifier(current)) {
    return (
      instanceAliases.has(current.text) ||
      (!modelAliases.has(current.text) && isAccountNamedIdentifier(current))
    );
  }
  return staticPropertyName(current) === 'account';
}

function callTarget(node) {
  const expression = unwrapExpression(node.expression);
  const method = staticPropertyName(expression);
  return {
    expression,
    method,
    receiver: method ? propertyReceiver(expression) : null,
  };
}

function isAccountFactoryCall(node, modelAliases) {
  const current = unwrapExpression(node);
  if (!ts.isCallExpression(current)) return false;
  const target = callTarget(current);
  return (
    ACCOUNT_INSTANCE_FACTORY_METHODS.has(target.method) &&
    isAccountModelExpression(target.receiver, modelAliases)
  );
}

function resolveStaticString(node, stringAliases, seen = new Set()) {
  const current = unwrapExpression(node);
  if (!current) return null;
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isIdentifier(current)) {
    if (seen.has(current.text)) return null;
    seen.add(current.text);
    const value = stringAliases.get(current.text);
    return value === undefined
      ? null
      : resolveStaticString(value, stringAliases, seen);
  }
  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = resolveStaticString(current.left, stringAliases, new Set(seen));
    const right = resolveStaticString(current.right, stringAliases, new Set(seen));
    return left === null || right === null ? null : left + right;
  }
  if (ts.isTemplateExpression(current)) {
    let value = current.head.text;
    for (const span of current.templateSpans) {
      const expression = resolveStaticString(
        span.expression,
        stringAliases,
        new Set(seen),
      );
      if (expression === null) return null;
      value += expression + span.literal.text;
    }
    return value;
  }
  return null;
}

function resolveTableName(node, stringAliases) {
  const direct = resolveStaticString(node, stringAliases);
  if (direct !== null) return direct;
  const current = unwrapExpression(node);
  if (!ts.isObjectLiteralExpression(current)) return null;
  for (const property of current.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name.getText().replace(/^['"]|['"]$/g, '');
    if (!['modelName', 'tableName'].includes(name)) continue;
    const value = resolveStaticString(property.initializer, stringAliases);
    if (value !== null) return value;
  }
  return null;
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function collectAliases(sourceFile) {
  const modelAliases = new Set(['Account']);
  const instanceAliases = new Set();
  const staticWriteAliases = new Map();
  const instanceWriteAliases = new Map();
  const rawQueryAliases = new Set();
  const stringAliases = new Map();

  const collectBinding = (name, initializer) => {
    if (!initializer) return false;
    let changed = false;
    const current = unwrapExpression(initializer);
    const identifier = bindingIdentifier(name);

    if (identifier) {
      if (isAccountModelExpression(current, modelAliases)) {
        const size = modelAliases.size;
        modelAliases.add(identifier);
        changed ||= modelAliases.size !== size;
      }
      if (
        isAccountFactoryCall(current, modelAliases) ||
        isAccountInstanceExpression(current, instanceAliases, modelAliases)
      ) {
        const size = instanceAliases.size;
        instanceAliases.add(identifier);
        changed ||= instanceAliases.size !== size;
      }

      const target = boundTarget(current);
      const method = staticPropertyName(target);
      const receiver = method ? propertyReceiver(target) : null;
      if (
        method &&
        ACCOUNT_STATIC_WRITE_METHODS.has(method) &&
        isAccountModelExpression(receiver, modelAliases)
      ) {
        if (!staticWriteAliases.has(identifier)) changed = true;
        staticWriteAliases.set(identifier, method);
      }
      if (
        method &&
        ACCOUNT_INSTANCE_WRITE_METHODS.has(method) &&
        isAccountInstanceExpression(receiver, instanceAliases, modelAliases)
      ) {
        if (!instanceWriteAliases.has(identifier)) changed = true;
        instanceWriteAliases.set(identifier, method);
      }
      if (method === 'query') {
        const size = rawQueryAliases.size;
        rawQueryAliases.add(identifier);
        changed ||= rawQueryAliases.size !== size;
      }
      if (
        ts.isStringLiteralLike(current) ||
        ts.isTemplateExpression(current) ||
        ts.isBinaryExpression(current) ||
        (ts.isIdentifier(current) && stringAliases.has(current.text))
      ) {
        if (!stringAliases.has(identifier)) changed = true;
        stringAliases.set(identifier, current);
      }
      return changed;
    }

    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        const local = bindingIdentifier(element.name);
        if (!local) continue;
        const property = element.propertyName
          ? element.propertyName.getText(sourceFile).replace(/^['"]|['"]$/g, '')
          : local;
        if (property === 'Account') {
          const size = modelAliases.size;
          modelAliases.add(local);
          changed ||= modelAliases.size !== size;
        }
        if (
          isAccountModelExpression(current, modelAliases) &&
          ACCOUNT_STATIC_WRITE_METHODS.has(property)
        ) {
          if (!staticWriteAliases.has(local)) changed = true;
          staticWriteAliases.set(local, property);
        }
        if (
          isAccountInstanceExpression(current, instanceAliases, modelAliases) &&
          ACCOUNT_INSTANCE_WRITE_METHODS.has(property)
        ) {
          if (!instanceWriteAliases.has(local)) changed = true;
          instanceWriteAliases.set(local, property);
        }
        if (property === 'query') {
          const size = rawQueryAliases.size;
          rawQueryAliases.add(local);
          changed ||= rawQueryAliases.size !== size;
        }
      }
    }

    if (ts.isArrayBindingPattern(name) && isAccountFactoryCall(current, modelAliases)) {
      const first = name.elements[0];
      if (first && ts.isBindingElement(first) && ts.isIdentifier(first.name)) {
        const size = instanceAliases.size;
        instanceAliases.add(first.name.text);
        changed ||= instanceAliases.size !== size;
      }
    }
    return changed;
  };

  while (true) {
    let changed = false;
    visit(sourceFile, (node) => {
      if (ts.isVariableDeclaration(node)) {
        const bindingChanged = collectBinding(node.name, node.initializer);
        changed = bindingChanged || changed;
      }
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        const assignmentChanged = collectBinding(node.left, node.right);
        changed = assignmentChanged || changed;
      }
    });
    if (!changed) break;
  }

  return {
    instanceAliases,
    instanceWriteAliases,
    modelAliases,
    rawQueryAliases,
    staticWriteAliases,
    stringAliases,
  };
}

function auditSource(source, file = '<memory>') {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    return sourceFile.parseDiagnostics.map((diagnostic) => ({
      file,
      line:
        sourceFile.getLineAndCharacterOfPosition(diagnostic.start || 0).line + 1,
      match: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
      type: 'Account audit parse failure',
    }));
  }

  const aliases = collectAliases(sourceFile);
  const findings = [];
  const seen = new Set();
  const addFinding = (node, type) => {
    const start = node.getStart(sourceFile);
    const key = `${start}:${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      file,
      line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
      match: node.getText(sourceFile).slice(0, 240),
      type,
    });
  };

  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    const target = callTarget(node);

    if (
      target.method &&
      ACCOUNT_STATIC_WRITE_METHODS.has(target.method) &&
      isAccountModelExpression(target.receiver, aliases.modelAliases)
    ) {
      addFinding(node, 'Account static write');
    } else if (
      ts.isIdentifier(target.expression) &&
      aliases.staticWriteAliases.has(target.expression.text)
    ) {
      addFinding(node, 'Account static write alias');
    }

    if (
      target.method &&
      ACCOUNT_INSTANCE_WRITE_METHODS.has(target.method) &&
      isAccountInstanceExpression(
        target.receiver,
        aliases.instanceAliases,
        aliases.modelAliases,
      )
    ) {
      addFinding(node, 'Account instance write');
    } else if (
      ts.isIdentifier(target.expression) &&
      aliases.instanceWriteAliases.has(target.expression.text)
    ) {
      addFinding(node, 'Account instance write alias');
    }

    if (
      target.method &&
      QUERY_INTERFACE_WRITE_METHODS.has(target.method) &&
      node.arguments
        .slice(0, 2)
        .some(
          (argument) =>
            resolveTableName(argument, aliases.stringAliases) === 'Accounts',
        )
    ) {
      addFinding(node, 'Accounts query-interface write');
    }

    const isRawQuery =
      target.method === 'query' ||
      (ts.isIdentifier(target.expression) &&
        aliases.rawQueryAliases.has(target.expression.text));
    if (isRawQuery) {
      const sql = resolveStaticString(node.arguments[0], aliases.stringAliases);
      if (sql && ACCOUNT_RAW_SQL_WRITE.test(sql)) {
        addFinding(node, 'Accounts raw SQL write');
      }
    }
  });

  return findings;
}

function auditRepository({ serverRoot = SERVER_ROOT } = {}) {
  const findings = [];
  for (const root of SEARCH_ROOTS) {
    const directory = path.join(serverRoot, root);
    for (const file of listSourceFiles(directory)) {
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
  ACCOUNT_INSTANCE_WRITE_METHODS,
  ACCOUNT_STATIC_WRITE_METHODS,
  ALLOWLIST,
  QUERY_INTERFACE_WRITE_METHODS,
  auditRepository,
  auditSource,
};
