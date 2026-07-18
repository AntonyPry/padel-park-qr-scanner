#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SERVER_ROOT = path.resolve(__dirname, '..');
const SEARCH_ROOTS = Object.freeze(['src', 'scripts', 'seeders']);
const CANONICAL_CREATE_FILE = 'src/services/audit.service.js';
const STATIC_WRITE_METHODS = new Set([
  'bulkCreate',
  'create',
  'destroy',
  'findCreateFind',
  'findOrCreate',
  'restore',
  'sync',
  'truncate',
  'update',
  'upsert',
]);
const INSTANCE_WRITE_METHODS = new Set([
  'destroy',
  'restore',
  'save',
  'update',
]);
const INSTANCE_FACTORY_METHODS = new Set([
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
  'truncate',
  'update',
  'upsert',
]);
const RAW_AUDIT_MUTATION =
  /\b(?:insert\s+(?:ignore\s+)?into|replace\s+into|update(?:\s+low_priority|\s+ignore)*|delete(?:\s+\w+)?\s+from|truncate(?:\s+table)?)\s+(?:`[^`]+`\.)?`?AuditLogs`?\b/i;

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
  if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    return unwrapExpression(current.expression);
  }
  return null;
}

function boundTarget(node) {
  const current = unwrapExpression(node);
  if (ts.isCallExpression(current) && staticPropertyName(current.expression) === 'bind') {
    return propertyReceiver(current.expression);
  }
  return current;
}

function bindingIdentifier(node) {
  return ts.isIdentifier(node) ? node.text : null;
}

function isAuditModelExpression(node, modelAliases) {
  const current = unwrapExpression(node);
  if (!current) return false;
  if (ts.isIdentifier(current) && modelAliases.has(current.text)) return true;
  return staticPropertyName(current) === 'AuditLog';
}

function isAuditInstanceExpression(node, instanceAliases) {
  const current = unwrapExpression(node);
  return Boolean(current && ts.isIdentifier(current) && instanceAliases.has(current.text));
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

function isAuditFactoryCall(node, modelAliases, factoryAliases = new Map()) {
  const current = unwrapExpression(node);
  if (!ts.isCallExpression(current)) return false;
  const target = callTarget(current);
  return (
    INSTANCE_FACTORY_METHODS.has(target.method) &&
      isAuditModelExpression(target.receiver, modelAliases)
  ) || (
    ts.isIdentifier(target.expression) && factoryAliases.has(target.expression.text)
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
    return value === undefined ? null : resolveStaticString(value, stringAliases, seen);
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveStaticString(current.left, stringAliases, new Set(seen));
    const right = resolveStaticString(current.right, stringAliases, new Set(seen));
    return left === null || right === null ? null : left + right;
  }
  if (ts.isTemplateExpression(current)) {
    let value = current.head.text;
    for (const span of current.templateSpans) {
      const expression = resolveStaticString(span.expression, stringAliases, new Set(seen));
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
  const modelAliases = new Set(['AuditLog']);
  const instanceAliases = new Set();
  const factoryAliases = new Map();
  const staticWriteAliases = new Map();
  const instanceWriteAliases = new Map();
  const queryInterfaceWriteAliases = new Map();
  const rawQueryAliases = new Set();
  const stringAliases = new Map();

  const collectBinding = (name, initializer) => {
    if (!initializer) return false;
    let changed = false;
    const current = unwrapExpression(initializer);
    const identifier = bindingIdentifier(name);
    if (identifier) {
      if (isAuditModelExpression(current, modelAliases)) {
        const before = modelAliases.size;
        modelAliases.add(identifier);
        changed ||= modelAliases.size !== before;
      }
      if (isAuditFactoryCall(current, modelAliases, factoryAliases) ||
          isAuditInstanceExpression(current, instanceAliases)) {
        const before = instanceAliases.size;
        instanceAliases.add(identifier);
        changed ||= instanceAliases.size !== before;
      }
      const target = boundTarget(current);
      const method = staticPropertyName(target);
      const receiver = method ? propertyReceiver(target) : null;
      if (method && INSTANCE_FACTORY_METHODS.has(method) &&
          isAuditModelExpression(receiver, modelAliases)) {
        if (!factoryAliases.has(identifier)) changed = true;
        factoryAliases.set(identifier, method);
      }
      if (method && STATIC_WRITE_METHODS.has(method) &&
          isAuditModelExpression(receiver, modelAliases)) {
        if (!staticWriteAliases.has(identifier)) changed = true;
        staticWriteAliases.set(identifier, method);
      }
      if (method && INSTANCE_WRITE_METHODS.has(method) &&
          isAuditInstanceExpression(receiver, instanceAliases)) {
        if (!instanceWriteAliases.has(identifier)) changed = true;
        instanceWriteAliases.set(identifier, method);
      }
      if (method && QUERY_INTERFACE_WRITE_METHODS.has(method)) {
        if (!queryInterfaceWriteAliases.has(identifier)) changed = true;
        queryInterfaceWriteAliases.set(identifier, method);
      }
      if (method === 'query') {
        const before = rawQueryAliases.size;
        rawQueryAliases.add(identifier);
        changed ||= rawQueryAliases.size !== before;
      }
      if (ts.isStringLiteralLike(current) || ts.isTemplateExpression(current) ||
          ts.isBinaryExpression(current) ||
          (ts.isIdentifier(current) && stringAliases.has(current.text))) {
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
        if (property === 'AuditLog') {
          const before = modelAliases.size;
          modelAliases.add(local);
          changed ||= modelAliases.size !== before;
        }
        if (isAuditModelExpression(current, modelAliases) && STATIC_WRITE_METHODS.has(property)) {
          if (!staticWriteAliases.has(local)) changed = true;
          staticWriteAliases.set(local, property);
        }
        if (isAuditModelExpression(current, modelAliases) &&
            INSTANCE_FACTORY_METHODS.has(property)) {
          if (!factoryAliases.has(local)) changed = true;
          factoryAliases.set(local, property);
        }
        if (isAuditInstanceExpression(current, instanceAliases) &&
            INSTANCE_WRITE_METHODS.has(property)) {
          if (!instanceWriteAliases.has(local)) changed = true;
          instanceWriteAliases.set(local, property);
        }
        if (QUERY_INTERFACE_WRITE_METHODS.has(property)) {
          if (!queryInterfaceWriteAliases.has(local)) changed = true;
          queryInterfaceWriteAliases.set(local, property);
        }
        if (property === 'query') {
          const before = rawQueryAliases.size;
          rawQueryAliases.add(local);
          changed ||= rawQueryAliases.size !== before;
        }
      }
    }

    if (ts.isArrayBindingPattern(name) &&
        isAuditFactoryCall(current, modelAliases, factoryAliases)) {
      const first = name.elements[0];
      if (first && ts.isBindingElement(first) && ts.isIdentifier(first.name)) {
        const before = instanceAliases.size;
        instanceAliases.add(first.name.text);
        changed ||= instanceAliases.size !== before;
      }
    }
    return changed;
  };

  while (true) {
    let changed = false;
    visit(sourceFile, (node) => {
      if (ts.isVariableDeclaration(node)) {
        changed = collectBinding(node.name, node.initializer) || changed;
      }
      if (ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(node.left)) {
        changed = collectBinding(node.left, node.right) || changed;
      }
    });
    if (!changed) break;
  }

  return {
    factoryAliases,
    instanceAliases,
    instanceWriteAliases,
    modelAliases,
    queryInterfaceWriteAliases,
    rawQueryAliases,
    staticWriteAliases,
    stringAliases,
  };
}

function canonicalCreateAllowed(file, method) {
  return file === CANONICAL_CREATE_FILE && method === 'create';
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
      line: sourceFile.getLineAndCharacterOfPosition(diagnostic.start || 0).line + 1,
      match: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
      type: 'AuditLog audit parse failure',
    }));
  }

  const aliases = collectAliases(sourceFile);
  const findings = [];
  const seen = new Set();
  const add = (node, type) => {
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
    let staticMethod = null;
    if (target.method && STATIC_WRITE_METHODS.has(target.method) &&
        isAuditModelExpression(target.receiver, aliases.modelAliases)) {
      staticMethod = target.method;
    } else if (ts.isIdentifier(target.expression)) {
      staticMethod = aliases.staticWriteAliases.get(target.expression.text) || null;
    }
    if (staticMethod && !canonicalCreateAllowed(file, staticMethod)) {
      add(node, 'AuditLog static write');
    }

    if (target.method && INSTANCE_WRITE_METHODS.has(target.method) &&
        isAuditInstanceExpression(target.receiver, aliases.instanceAliases)) {
      add(node, 'AuditLog instance write');
    } else if (ts.isIdentifier(target.expression) &&
        aliases.instanceWriteAliases.has(target.expression.text)) {
      add(node, 'AuditLog instance write alias');
    }

    let queryInterfaceMethod = null;
    if (target.method && QUERY_INTERFACE_WRITE_METHODS.has(target.method)) {
      queryInterfaceMethod = target.method;
    } else if (ts.isIdentifier(target.expression)) {
      queryInterfaceMethod = aliases.queryInterfaceWriteAliases.get(target.expression.text) || null;
    }
    if (queryInterfaceMethod && node.arguments.slice(0, 2).some((argument) =>
      resolveTableName(argument, aliases.stringAliases) === 'AuditLogs')) {
      add(node, 'AuditLogs query-interface write');
    }

    const isRawQuery = target.method === 'query' ||
      (ts.isIdentifier(target.expression) && aliases.rawQueryAliases.has(target.expression.text));
    if (isRawQuery) {
      const sql = resolveStaticString(node.arguments[0], aliases.stringAliases);
      if (sql && RAW_AUDIT_MUTATION.test(sql)) add(node, 'AuditLogs raw SQL write');
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
      findings.push(...auditSource(fs.readFileSync(file, 'utf8'), relative));
    }
  }
  return findings;
}

function main() {
  const findings = auditRepository();
  if (findings.length > 0) {
    console.error('Unauthorized AuditLog direct writes found:');
    for (const finding of findings) {
      console.error(`- ${finding.file}:${finding.line} ${finding.type}: ${finding.match}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('AuditLog AST direct-write audit passed.');
}

if (require.main === module) main();

module.exports = {
  CANONICAL_CREATE_FILE,
  INSTANCE_WRITE_METHODS,
  QUERY_INTERFACE_WRITE_METHODS,
  RAW_AUDIT_MUTATION,
  STATIC_WRITE_METHODS,
  auditRepository,
  auditSource,
};
