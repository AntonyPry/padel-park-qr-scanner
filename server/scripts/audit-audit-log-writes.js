#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SERVER_ROOT = path.resolve(__dirname, '..');
const SEARCH_ROOTS = Object.freeze(['src', 'scripts', 'seeders']);
const WRITE_METHODS = new Set([
  'bulkCreate',
  'create',
  'destroy',
  'findOrCreate',
  'restore',
  'truncate',
  'update',
  'upsert',
]);
const ALLOWED_MODEL_WRITES = Object.freeze({
  'src/services/audit.service.js': new Set(['create']),
});
const RAW_AUDIT_MUTATION = /\b(?:delete\s+from|insert\s+into|replace\s+into|update)\s+`?AuditLogs`?\b/i;

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

function propertyChain(node) {
  const names = [];
  let current = node;
  while (ts.isPropertyAccessExpression(current)) {
    names.unshift(current.name.text);
    current = current.expression;
  }
  if (ts.isIdentifier(current)) names.unshift(current.text);
  return names;
}

function staticText(node) {
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function location(sourceFile, node) {
  const point = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { column: point.character + 1, line: point.line + 1 };
}

function auditSource(source, file = '<memory>') {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings = [];

  function add(node, type, match) {
    findings.push({ file, ...location(sourceFile, node), match, type });
  }

  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const chain = propertyChain(node.expression);
      const method = chain.at(-1);
      if (WRITE_METHODS.has(method) && chain.includes('AuditLog')) {
        const allowed = ALLOWED_MODEL_WRITES[file]?.has(method) === true;
        if (!allowed) add(node, 'model-write', chain.join('.'));
      }

      if (method === 'query' && node.arguments.length > 0) {
        const sql = staticText(node.arguments[0]);
        if (sql && RAW_AUDIT_MUTATION.test(sql)) {
          add(node, 'raw-sql-write', sql.trim().replace(/\s+/g, ' ').slice(0, 180));
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
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
    findings.forEach((finding) => {
      console.error(
        `- ${finding.file}:${finding.line}:${finding.column} ${finding.type}: ${finding.match}`,
      );
    });
    process.exitCode = 1;
    return;
  }
  console.log('AuditLog AST direct-write audit passed.');
}

if (require.main === module) main();

module.exports = {
  ALLOWED_MODEL_WRITES,
  RAW_AUDIT_MUTATION,
  WRITE_METHODS,
  auditRepository,
  auditSource,
};
