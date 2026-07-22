'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '../..');
const CLIENT_ROOT = path.join(ROOT, 'client/src');
const SERVER_ROOT = path.join(ROOT, 'server');
const CACHE_DATA_CALLS = new Set([
  'cacheKey',
  'deleteByPrefix',
  'deleteKeys',
  'deleteTenantByPrefix',
  'getJson',
  'rememberJson',
  'rememberTenantJson',
  'setJson',
  'tenantCacheKey',
]);
const CACHE_DATA_FILES = new Set([
  'server/src/services/catalog.service.js',
  'server/src/services/references.service.js',
]);
const QUERY_CLIENT_METHODS = new Set([
  'cancelQueries',
  'fetchQuery',
  'getQueryData',
  'invalidateQueries',
  'prefetchQuery',
  'removeQueries',
  'resetQueries',
  'setQueryData',
]);

function walk(root) {
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (['dist', 'node_modules'].includes(entry.name)) continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walk(absolute));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) result.push(absolute);
  }
  return result;
}

function propertyName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }
  return null;
}

function objectHasProperty(node, name) {
  return (
    ts.isObjectLiteralExpression(node) &&
    node.properties.some(
      (property) =>
        (ts.isShorthandPropertyAssignment(property) && property.name.text === name) ||
        (ts.isPropertyAssignment(property) &&
          ((ts.isIdentifier(property.name) && property.name.text === name) ||
            (ts.isStringLiteralLike(property.name) && property.name.text === name))),
    )
  );
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function finding(sourceFile, node, type, file) {
  return { file, line: lineOf(sourceFile, node), type };
}

function auditClientSource(source, file = '<memory>') {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings = [];

  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === 'queryKey') ||
        (ts.isStringLiteralLike(node.name) && node.name.text === 'queryKey')) &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      findings.push(finding(sourceFile, node, 'Ad hoc TanStack queryKey array', file));
    }

    if (ts.isCallExpression(node)) {
      const method = propertyName(node.expression);
      if (QUERY_CLIENT_METHODS.has(method)) {
        const first = node.arguments[0];
        if (first && ts.isArrayLiteralExpression(first)) {
          findings.push(finding(sourceFile, node, 'Ad hoc direct queryClient key array', file));
        }
        if (first && ts.isObjectLiteralExpression(first)) {
          const queryKey = first.properties.find(
            (property) =>
              ts.isPropertyAssignment(property) &&
              ts.isIdentifier(property.name) &&
              property.name.text === 'queryKey',
          );
          if (
            queryKey &&
            ts.isPropertyAssignment(queryKey) &&
            ts.isArrayLiteralExpression(queryKey.initializer)
          ) {
            findings.push(finding(sourceFile, node, 'Ad hoc direct queryClient key array', file));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function auditServerSource(source, file = '<memory>') {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const findings = [];

  function visit(node) {
    if (!ts.isCallExpression(node)) {
      ts.forEachChild(node, visit);
      return;
    }

    const method = propertyName(node.expression);
    if (CACHE_DATA_CALLS.has(method)) {
      if (!CACHE_DATA_FILES.has(file)) {
        findings.push(finding(sourceFile, node, 'Unclassified server cache data call site', file));
      }
      if (['deleteTenantByPrefix', 'rememberTenantJson', 'tenantCacheKey'].includes(method)) {
        if (!objectHasProperty(node.arguments[0], 'tenant')) {
          findings.push(finding(sourceFile, node, 'Tenant cache call lacks tenant context', file));
        }
      }
    }

    if (method === 'publishRealtimeChange' && file !== 'server/src/realtime/publisher.js') {
      if (node.arguments.length < 4) {
        findings.push(finding(sourceFile, node, 'Tenant realtime publish lacks context argument', file));
      }
    }
    if (method === 'publishTenantSocketEvent' && node.arguments.length < 5) {
      findings.push(finding(sourceFile, node, 'Tenant socket event lacks envelope context', file));
    }
    if (method === 'publishLegacyRealtimeChange' && file !== 'server/bot.js') {
      findings.push(finding(sourceFile, node, 'Legacy realtime publish outside explicit runner path', file));
    }
    if (method === 'emit') {
      const first = node.arguments[0];
      const eventName = first && ts.isStringLiteralLike(first) ? first.text : null;
      if (
        ['crm:changed', 'scan_result'].includes(eventName) &&
        !['server/src/realtime/publisher.js', 'server/src/controllers/access.controller.js'].includes(file)
      ) {
        findings.push(finding(sourceFile, node, 'Direct tenant business socket emit', file));
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function auditRepository() {
  const findings = [];
  for (const file of walk(CLIENT_ROOT)) {
    const relative = path.relative(ROOT, file);
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relative)) continue;
    if (relative === 'client/src/api/query-keys.ts') continue;
    findings.push(...auditClientSource(fs.readFileSync(file, 'utf8'), relative));
  }
  for (const file of walk(path.join(SERVER_ROOT, 'src')).concat([path.join(SERVER_ROOT, 'bot.js')])) {
    const relative = path.relative(ROOT, file);
    if (relative === 'server/src/services/cache.service.ts') continue;
    findings.push(...auditServerSource(fs.readFileSync(file, 'utf8'), relative));
  }
  return findings;
}

if (require.main === module) {
  const findings = auditRepository();
  if (findings.length > 0) {
    console.error('Tenant cache/realtime audit failed.');
    findings.forEach((item) =>
      console.error(`- ${item.file}:${item.line} ${item.type}`),
    );
    process.exitCode = 1;
  } else {
    console.log('Tenant cache/realtime audit passed.');
    console.log('- frontend tenant query keys: centralized factory');
    console.log('- cached server domains: references, catalog');
    console.log('- tenant business emitters: scoped publisher only');
  }
}

module.exports = {
  auditClientSource,
  auditRepository,
  auditServerSource,
};
