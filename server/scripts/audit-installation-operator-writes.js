#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SERVER_ROOT = path.resolve(__dirname, '..');
const SEARCH_ROOTS = Object.freeze(['src', 'scripts', 'seeders']);
const ROOTS = Object.freeze({
  InstallationMutationOperation: 'InstallationMutationOperations',
  InstallationOperatorSession: 'InstallationOperatorSessions',
});
const CANONICAL_WRITERS = Object.freeze({
  InstallationMutationOperation: Object.freeze({
    file: 'src/services/installation-management.service.js',
    instance: new Set(),
    static: new Set(['create']),
  }),
  InstallationOperatorSession: Object.freeze({
    file: 'src/services/installation-operator-auth.service.js',
    instance: new Set(['update']),
    static: new Set(['create']),
  }),
});
const STATIC_WRITE_METHODS = new Set([
  'bulkCreate', 'create', 'destroy', 'findCreateFind', 'findOrCreate',
  'restore', 'sync', 'truncate', 'update', 'upsert',
]);
const INSTANCE_WRITE_METHODS = new Set(['destroy', 'restore', 'save', 'update']);
const INSTANCE_FACTORY_METHODS = new Set([
  'build', 'create', 'findByPk', 'findCreateFind', 'findOne', 'findOrBuild', 'findOrCreate',
]);
const QUERY_INTERFACE_WRITE_METHODS = new Set([
  'bulkDelete', 'bulkInsert', 'bulkUpdate', 'delete', 'insert',
  'truncate', 'update', 'upsert',
]);
const RAW_MUTATION = new RegExp(
  String.raw`\b(?:insert\s+(?:ignore\s+)?into|replace\s+into|update(?:\s+low_priority|\s+ignore)*|delete(?:\s+\w+)?\s+from|truncate(?:\s+table)?)\s+(?:\x60[^\x60]+\x60\.)?\x60?(InstallationOperatorSessions|InstallationMutationOperations)\x60?\b`,
  'i',
);

function listSourceFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listSourceFiles(absolute));
    if (entry.isFile() && /\.(?:[cm]?js|[cm]?ts|tsx)$/u.test(entry.name)) files.push(absolute);
  }
  return files;
}

function scriptKind(file) {
  if (/\.tsx$/u.test(file)) return ts.ScriptKind.TSX;
  if (/\.(?:ts|mts|cts)$/u.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function unwrap(node) {
  let current = node;
  while (current && (
    ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) || ts.isNonNullExpression(current) ||
    ts.isTypeAssertionExpression(current)
  )) current = current.expression;
  return current;
}

function propertyName(node) {
  const current = unwrap(node);
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isElementAccessExpression(current)) {
    const argument = unwrap(current.argumentExpression);
    if (ts.isStringLiteralLike(argument)) return argument.text;
  }
  return null;
}

function receiver(node) {
  const current = unwrap(node);
  return ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)
    ? unwrap(current.expression)
    : null;
}

function boundTarget(node) {
  const current = unwrap(node);
  return ts.isCallExpression(current) && propertyName(current.expression) === 'bind'
    ? receiver(current.expression)
    : current;
}

function callTarget(node) {
  const expression = unwrap(node.expression);
  const method = propertyName(expression);
  return { expression, method, receiver: method ? receiver(expression) : null };
}

function visit(node, callback) {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function modelRoot(node, modelAliases) {
  const current = unwrap(node);
  if (!current) return null;
  if (ts.isIdentifier(current) && modelAliases.has(current.text)) {
    return modelAliases.get(current.text);
  }
  const name = propertyName(current);
  return Object.hasOwn(ROOTS, name) ? name : null;
}

function instanceRoot(node, instanceAliases) {
  const current = unwrap(node);
  return current && ts.isIdentifier(current) ? instanceAliases.get(current.text) || null : null;
}

function factoryRoot(node, aliases) {
  const current = unwrap(node);
  if (!ts.isCallExpression(current)) return null;
  const target = callTarget(current);
  if (INSTANCE_FACTORY_METHODS.has(target.method)) {
    return modelRoot(target.receiver, aliases.modelAliases);
  }
  return ts.isIdentifier(target.expression)
    ? aliases.factoryAliases.get(target.expression.text)?.root || null
    : null;
}

function resolveString(node, aliases, seen = new Set()) {
  const current = unwrap(node);
  if (!current) return null;
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isIdentifier(current)) {
    if (seen.has(current.text)) return null;
    seen.add(current.text);
    const target = aliases.get(current.text);
    return target ? resolveString(target, aliases, seen) : null;
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveString(current.left, aliases, new Set(seen));
    const right = resolveString(current.right, aliases, new Set(seen));
    return left === null || right === null ? null : left + right;
  }
  if (ts.isTemplateExpression(current)) {
    let result = current.head.text;
    for (const span of current.templateSpans) {
      const part = resolveString(span.expression, aliases, new Set(seen));
      if (part === null) return null;
      result += part + span.literal.text;
    }
    return result;
  }
  return null;
}

function resolveTable(node, aliases) {
  const direct = resolveString(node, aliases);
  if (direct !== null) return direct;
  let current = unwrap(node);
  if (ts.isIdentifier(current) && aliases.has(current.text)) {
    current = unwrap(aliases.get(current.text));
  }
  if (!ts.isObjectLiteralExpression(current)) return null;
  for (const property of current.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = property.name.getText().replace(/^['"]|['"]$/gu, '');
    if (!['modelName', 'tableName'].includes(name)) continue;
    const resolved = resolveString(property.initializer, aliases);
    if (resolved !== null) return resolved;
  }
  return null;
}

function collectAliases(sourceFile) {
  const aliases = {
    factoryAliases: new Map(),
    instanceAliases: new Map(),
    instanceWriteAliases: new Map(),
    modelAliases: new Map(Object.keys(ROOTS).map((name) => [name, name])),
    queryInterfaceWriteAliases: new Map(),
    rawQueryAliases: new Set(),
    staticWriteAliases: new Map(),
    stringAliases: new Map(),
  };
  const collect = (name, initializer) => {
    if (!initializer) return false;
    const current = unwrap(initializer);
    let changed = false;
    if (ts.isIdentifier(name)) {
      const local = name.text;
      const root = modelRoot(current, aliases.modelAliases);
      if (root && aliases.modelAliases.get(local) !== root) {
        aliases.modelAliases.set(local, root);
        changed = true;
      }
      const createdRoot = factoryRoot(current, aliases) || instanceRoot(current, aliases.instanceAliases);
      if (createdRoot && aliases.instanceAliases.get(local) !== createdRoot) {
        aliases.instanceAliases.set(local, createdRoot);
        changed = true;
      }
      const target = boundTarget(current);
      const method = propertyName(target);
      const targetReceiver = method ? receiver(target) : null;
      const model = modelRoot(targetReceiver, aliases.modelAliases);
      const instance = instanceRoot(targetReceiver, aliases.instanceAliases);
      if (method && INSTANCE_FACTORY_METHODS.has(method) && model) {
        aliases.factoryAliases.set(local, { method, root: model });
      }
      if (method && STATIC_WRITE_METHODS.has(method) && model) {
        aliases.staticWriteAliases.set(local, { method, root: model });
      }
      if (method && INSTANCE_WRITE_METHODS.has(method) && instance) {
        aliases.instanceWriteAliases.set(local, { method, root: instance });
      }
      if (method && QUERY_INTERFACE_WRITE_METHODS.has(method)) {
        aliases.queryInterfaceWriteAliases.set(local, method);
      }
      if (method === 'query') aliases.rawQueryAliases.add(local);
      if (ts.isStringLiteralLike(current) || ts.isTemplateExpression(current) ||
          ts.isBinaryExpression(current) || ts.isObjectLiteralExpression(current) ||
          (ts.isIdentifier(current) && aliases.stringAliases.has(current.text))) {
        aliases.stringAliases.set(local, current);
      }
      return changed;
    }
    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const local = element.name.text;
        const property = element.propertyName
          ? element.propertyName.getText(sourceFile).replace(/^['"]|['"]$/gu, '')
          : local;
        if (Object.hasOwn(ROOTS, property)) aliases.modelAliases.set(local, property);
        const root = modelRoot(current, aliases.modelAliases);
        const instance = instanceRoot(current, aliases.instanceAliases);
        if (root && STATIC_WRITE_METHODS.has(property)) {
          aliases.staticWriteAliases.set(local, { method: property, root });
        }
        if (root && INSTANCE_FACTORY_METHODS.has(property)) {
          aliases.factoryAliases.set(local, { method: property, root });
        }
        if (instance && INSTANCE_WRITE_METHODS.has(property)) {
          aliases.instanceWriteAliases.set(local, { method: property, root: instance });
        }
        if (QUERY_INTERFACE_WRITE_METHODS.has(property)) {
          aliases.queryInterfaceWriteAliases.set(local, property);
        }
        if (property === 'query') aliases.rawQueryAliases.add(local);
      }
    }
    if (ts.isArrayBindingPattern(name)) {
      const root = factoryRoot(current, aliases);
      const first = name.elements[0];
      if (root && first && ts.isBindingElement(first) && ts.isIdentifier(first.name)) {
        aliases.instanceAliases.set(first.name.text, root);
      }
    }
    return changed;
  };
  while (true) {
    let changed = false;
    visit(sourceFile, (node) => {
      if (ts.isVariableDeclaration(node)) changed = collect(node.name, node.initializer) || changed;
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isIdentifier(node.left)) changed = collect(node.left, node.right) || changed;
    });
    if (!changed) break;
  }
  return aliases;
}

function canonical(file, root, kind, method) {
  const writer = CANONICAL_WRITERS[root];
  return writer && file === writer.file && writer[kind].has(method);
}

function auditSource(source, file = '<memory>') {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
  if (sourceFile.parseDiagnostics.length > 0) {
    return sourceFile.parseDiagnostics.map((diagnostic) => ({
      file,
      line: sourceFile.getLineAndCharacterOfPosition(diagnostic.start || 0).line + 1,
      match: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
      type: 'installation operator audit parse failure',
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
    let staticWrite = null;
    if (target.method && STATIC_WRITE_METHODS.has(target.method)) {
      const root = modelRoot(target.receiver, aliases.modelAliases);
      if (root) staticWrite = { method: target.method, root };
    } else if (ts.isIdentifier(target.expression)) {
      staticWrite = aliases.staticWriteAliases.get(target.expression.text) || null;
    }
    if (staticWrite && !canonical(file, staticWrite.root, 'static', staticWrite.method)) {
      add(node, `${staticWrite.root} static write`);
    }
    let instanceWrite = null;
    if (target.method && INSTANCE_WRITE_METHODS.has(target.method)) {
      const root = instanceRoot(target.receiver, aliases.instanceAliases);
      if (root) instanceWrite = { method: target.method, root };
    } else if (ts.isIdentifier(target.expression)) {
      instanceWrite = aliases.instanceWriteAliases.get(target.expression.text) || null;
    }
    if (instanceWrite && !canonical(file, instanceWrite.root, 'instance', instanceWrite.method)) {
      add(node, `${instanceWrite.root} instance write`);
    }
    let queryInterfaceMethod = null;
    if (target.method && QUERY_INTERFACE_WRITE_METHODS.has(target.method)) {
      queryInterfaceMethod = target.method;
    } else if (ts.isIdentifier(target.expression)) {
      queryInterfaceMethod = aliases.queryInterfaceWriteAliases.get(target.expression.text) || null;
    }
    if (queryInterfaceMethod && node.arguments.slice(0, 2).some((argument) =>
      Object.values(ROOTS).includes(resolveTable(argument, aliases.stringAliases)))) {
      add(node, 'installation operator query-interface write');
    }
    const raw = target.method === 'query' ||
      (ts.isIdentifier(target.expression) && aliases.rawQueryAliases.has(target.expression.text));
    if (raw) {
      const sql = resolveString(node.arguments[0], aliases.stringAliases);
      if (sql && RAW_MUTATION.test(sql)) add(node, 'installation operator raw SQL write');
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
    console.error('Unauthorized installation operator direct writes found:');
    for (const finding of findings) {
      console.error(`- ${finding.file}:${finding.line} ${finding.type}: ${finding.match}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('Installation operator AST direct-write audit passed.');
}

if (require.main === module) main();

module.exports = {
  CANONICAL_WRITERS,
  INSTANCE_WRITE_METHODS,
  QUERY_INTERFACE_WRITE_METHODS,
  RAW_MUTATION,
  ROOTS,
  STATIC_WRITE_METHODS,
  auditRepository,
  auditSource,
};
