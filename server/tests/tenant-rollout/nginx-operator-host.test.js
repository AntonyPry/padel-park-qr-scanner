'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '../../..');
const operatorConfig = fs.readFileSync(
  path.join(repositoryRoot, 'deploy/nginx/ops.setly.tech.conf'),
  'utf8',
);
const productConfig = fs.readFileSync(
  path.join(repositoryRoot, 'deploy/nginx/setly.tech.conf'),
  'utf8',
);

const requiredOperatorRootAssets = Object.freeze([
  '/setly-mark.png',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/apple-touch-icon.png',
]);

function exactLocationBlocks(config) {
  return new Map([...config.matchAll(/location\s+=\s+(\/[^\s{]*)\s*\{([^{}]*)\}/g)]
    .map((match) => [match[1], match[2].trim()]));
}

function operatorApiPattern(config) {
  const match = config.match(
    /location\s+~\s+(\^\/api\/installation\/provisioning\/[^\s{]+)\s*\{/,
  );
  assert.ok(match, 'operator API allowlist location must exist');
  return new RegExp(match[1]);
}

function operatorDisposition(requestTarget) {
  const pathname = new URL(requestTarget, 'https://ops.setly.tech').pathname;
  const exact = exactLocationBlocks(operatorConfig);
  if (exact.has(pathname)) return exact.get(pathname);
  if (pathname.startsWith('/assets/')) return 'try_files $uri =404;';
  if (operatorApiPattern(operatorConfig).test(pathname)) return 'proxy_pass';
  return 'return 404;';
}

test('operator host allows only the accepted SPA assets at the root', () => {
  const exact = exactLocationBlocks(operatorConfig);
  const rootStaticLocations = [...exact.entries()]
    .filter(([, body]) => body === 'try_files $uri =404;')
    .map(([location]) => location)
    .sort();

  assert.deepEqual(rootStaticLocations, [
    '/apple-touch-icon.png',
    '/favicon-16x16.png',
    '/favicon-32x32.png',
    '/favicon.ico',
    '/setly-mark.png',
  ]);

  for (const asset of requiredOperatorRootAssets) {
    assert.equal(
      operatorDisposition(`${asset}?v=20260714`),
      'try_files $uri =404;',
      `${asset} must remain available with version query strings`,
    );
    assert.equal(
      fs.existsSync(path.join(repositoryRoot, 'client/public', asset.slice(1))),
      true,
      `${asset} must exist in client/public`,
    );
  }

  assert.equal(operatorDisposition('/favicon.ico'), 'try_files $uri =404;');
  assert.equal(operatorDisposition('/assets/index-abc123.js'), 'try_files $uri =404;');
});

test('operator and product hosts preserve their deny-by-default boundary', () => {
  const allowedOperatorRequests = [
    '/',
    '/installation',
    '/installation/provisioning',
    '/api/health',
    '/api/installation/provisioning/status',
    '/api/installation/provisioning/session',
    '/api/installation/provisioning/snapshot',
    '/api/installation/provisioning/organizations',
    '/api/installation/provisioning/organizations/1/activation/reissue',
  ];
  for (const requestTarget of allowedOperatorRequests) {
    assert.notEqual(operatorDisposition(requestTarget), 'return 404;', requestTarget);
  }

  const deniedOperatorRequests = [
    '/robots.txt',
    '/manifest.webmanifest',
    '/setly-mark.svg',
    '/favicon-64x64.png',
    '/admin',
    '/login',
    '/activate-owner',
    '/socket.io/',
    '/api/auth/login',
    '/api/installation/provisioning/activation/status',
    '/api/installation/provisioning/activation/consume',
    '/api/installation/provisioning/organizations/1',
  ];
  for (const requestTarget of deniedOperatorRequests) {
    assert.equal(operatorDisposition(requestTarget), 'return 404;', requestTarget);
  }

  assert.match(operatorConfig, /if \(\$host != ops\.setly\.tech\) \{\s*return 444;/);
  assert.match(operatorConfig, /location \/ \{\s*return 404;/);
  assert.doesNotMatch(operatorConfig, /location \^~ \/api\//);
  assert.doesNotMatch(operatorConfig, /location \/socket\.io\//);

  assert.match(productConfig, /location = \/installation \{\s*return 404;/);
  assert.match(productConfig, /location \^~ \/installation\/ \{\s*return 404;/);
  assert.match(
    productConfig,
    /location ~ \^\/api\/installation\/provisioning\/[^{]+\{\s*return 404;/,
  );
  assert.match(productConfig, /location \/api\/ \{[^}]*proxy_pass/s);
  assert.match(productConfig, /location \/socket\.io\/ \{[^}]*proxy_pass/s);
  assert.match(productConfig, /location \/ \{\s*try_files \$uri \$uri\/ \/index\.html;/);
  assert.doesNotMatch(productConfig, /location = \/activate-owner\s*\{\s*return 404;/);
});

test('product host isolates every sensitive Beeline ingress from access and error logs', () => {
  assert.match(productConfig, /map \$uri \$setly_safe_request_uri/u);
  assert.ok(productConfig.includes('~*^/api/integrations/beeline/events(?:/|$)'));
  assert.ok(productConfig.includes('/api/integrations/beeline/events/[redacted]'));
  assert.match(productConfig, /log_format setly_redacted/u);
  assert.match(productConfig, /access_log \/var\/log\/nginx\/access\.log setly_redacted;/u);
  assert.doesNotMatch(productConfig, /log_format setly_redacted[^;]*\$request(?:\s|'|$)/u);
  assert.doesNotMatch(productConfig, /log_format setly_redacted[^;]*\$request_uri/u);

  const sensitiveLocation = productConfig.match(
    /location ~\* \^\/api\/integrations\/beeline\/events\(\?:\/\|\$\) \{([^}]*)\}/s,
  );
  assert.ok(sensitiveLocation, 'dedicated sensitive Beeline ingress location must exist');
  assert.match(sensitiveLocation[1], /error_log \/dev\/null crit;/u);

  const genericApiLocation = productConfig.match(/location \/api\/ \{([^}]*)\}/s);
  assert.ok(genericApiLocation, 'ordinary API proxy location must exist');
  assert.doesNotMatch(genericApiLocation[1], /error_log/u);

  const preservedProxyDirectives = [
    'proxy_pass http://127.0.0.1:3000;',
    'proxy_http_version 1.1;',
    'proxy_set_header Host $host;',
    'proxy_set_header X-Real-IP $remote_addr;',
    'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    'proxy_set_header X-Forwarded-Proto $scheme;',
    'proxy_read_timeout 300s;',
  ];
  for (const directive of preservedProxyDirectives) {
    assert.ok(sensitiveLocation[1].includes(directive), directive);
    assert.ok(genericApiLocation[1].includes(directive), directive);
  }
});
