#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  endpointContracts,
  getOpenApiDocument,
  schemaToJsonSchema,
} = require('../src/contracts/openapi');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const DOCS_OPENAPI_PATH = path.join(ROOT_DIR, 'docs', 'openapi.json');
const CLIENT_GENERATED_PATH = path.join(ROOT_DIR, 'client', 'src', 'api', 'generated.ts');

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function quote(value) {
  return JSON.stringify(value);
}

function isIdentifier(value) {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}

function propertyKey(value) {
  return isIdentifier(value) ? value : quote(value);
}

function toPascalCase(value) {
  return value
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join('');
}

function endpointTypeName(endpointId, suffix) {
  return `${toPascalCase(endpointId)}${suffix}`;
}

function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object') return undefined;
  return schema;
}

function schemaType(schema, depth = 0) {
  const normalized = normalizeSchema(schema);
  if (!normalized) return 'unknown';

  if (normalized.const !== undefined) return quote(normalized.const);

  if (Array.isArray(normalized.enum) && normalized.enum.length > 0) {
    return normalized.enum.map(quote).join(' | ');
  }

  if (Array.isArray(normalized.anyOf)) {
    return normalized.anyOf.map((item) => schemaType(item, depth)).join(' | ');
  }

  if (Array.isArray(normalized.oneOf)) {
    return normalized.oneOf.map((item) => schemaType(item, depth)).join(' | ');
  }

  if (Array.isArray(normalized.allOf)) {
    return normalized.allOf.map((item) => schemaType(item, depth)).join(' & ');
  }

  if (Array.isArray(normalized.type)) {
    return normalized.type
      .map((type) => schemaType({ ...normalized, type }, depth))
      .join(' | ');
  }

  if (normalized.properties && !normalized.type) {
    return objectType(normalized, depth);
  }

  switch (normalized.type) {
    case 'array':
      return `Array<${schemaType(normalized.items, depth)}>`;
    case 'boolean':
      return 'boolean';
    case 'integer':
    case 'number':
      return 'number';
    case 'null':
      return 'null';
    case 'object':
      return objectType(normalized, depth);
    case 'string':
      return 'string';
    default:
      if (normalized.items) return `Array<${schemaType(normalized.items, depth)}>`;
      return 'unknown';
  }
}

function objectType(schema, depth) {
  const properties = schema.properties || {};
  const propertyNames = Object.keys(properties);
  const required = new Set(schema.required || []);
  const indent = '  '.repeat(depth + 1);
  const closingIndent = '  '.repeat(depth);

  if (propertyNames.length === 0) {
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      return `Record<string, ${schemaType(schema.additionalProperties, depth)}>`;
    }
    return 'Record<string, unknown>';
  }

  const lines = propertyNames.map((name) => {
    const optional = required.has(name) ? '' : '?';
    return `${indent}${propertyKey(name)}${optional}: ${schemaType(properties[name], depth + 1)};`;
  });

  if (schema.additionalProperties && schema.additionalProperties !== false) {
    const additionalType =
      typeof schema.additionalProperties === 'object'
        ? schemaType(schema.additionalProperties, depth + 1)
        : 'unknown';
    lines.push(`${indent}[key: string]: ${additionalType};`);
  }

  return `{\n${lines.join('\n')}\n${closingIndent}}`;
}

function schemaAlias(endpoint, field, suffix) {
  const schema = endpoint[field];
  if (!schema) return undefined;
  const jsonSchema = schemaToJsonSchema(schema);
  return {
    name: endpointTypeName(endpoint.id, suffix),
    type: schemaType(jsonSchema),
  };
}

function generateClientTypes() {
  const aliases = [];
  const requestMapLines = [];

  for (const endpoint of endpointContracts) {
    const params = schemaAlias(endpoint, 'params', 'Params');
    const query = schemaAlias(endpoint, 'query', 'Query');
    const body = schemaAlias(endpoint, 'body', 'Body');

    for (const alias of [params, query, body].filter(Boolean)) {
      aliases.push(`export type ${alias.name} = ${alias.type};`);
    }

    requestMapLines.push(
      `  ${quote(endpoint.id)}: ApiEndpointRequest<${params?.name || 'undefined'}, ${query?.name || 'undefined'}, ${body?.name || 'undefined'}>;`,
    );
  }

  const endpointMap = endpointContracts
    .map((endpoint) => {
      const clientResponseType =
        endpoint.responseType && endpoint.responseType !== 'json' ? 'blob' : 'json';
      return `  ${quote(endpoint.id)}: { method: ${quote(endpoint.method.toUpperCase())}, path: ${quote(endpoint.path)}, responseType: ${quote(clientResponseType)} },`;
    })
    .join('\n');

  return [
    '// This file is generated by server/scripts/generate-openapi.js.',
    '// Do not edit it manually.',
    '',
    'export const apiEndpoints = {',
    endpointMap,
    '} as const;',
    '',
    'export type ApiEndpointId = keyof typeof apiEndpoints;',
    '',
    'export type ApiEndpointRequest<P = undefined, Q = undefined, B = undefined> =',
    '  (P extends undefined ? { params?: never } : { params: P }) &',
    '  (Q extends undefined ? { query?: never } : { query?: Q }) &',
    '  (B extends undefined ? { body?: never } : { body: B });',
    '',
    ...aliases,
    '',
    'export interface ApiEndpointRequestMap {',
    ...requestMapLines,
    '}',
    '',
  ].join('\n');
}

ensureDir(DOCS_OPENAPI_PATH);
ensureDir(CLIENT_GENERATED_PATH);

fs.writeFileSync(DOCS_OPENAPI_PATH, `${JSON.stringify(getOpenApiDocument(), null, 2)}\n`);
fs.writeFileSync(CLIENT_GENERATED_PATH, generateClientTypes());

console.log(`OpenAPI written to ${path.relative(ROOT_DIR, DOCS_OPENAPI_PATH)}`);
console.log(`Typed API client contract written to ${path.relative(ROOT_DIR, CLIENT_GENERATED_PATH)}`);
