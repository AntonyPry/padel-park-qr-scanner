'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '../../..');

function findNginx() {
  const candidates = [
    process.env.NGINX_BIN,
    '/opt/homebrew/bin/nginx',
    '/usr/local/sbin/nginx',
    '/usr/sbin/nginx',
    ...String(process.env.PATH || '').split(path.delimiter).map((entry) => path.join(entry, 'nginx')),
  ].filter(Boolean);

  return candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) || null;
}

async function reservePorts(count) {
  const servers = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = net.createServer();
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    }
    return servers.map((server) => server.address().port);
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

function nginxString(value) {
  return JSON.stringify(value);
}

function materializeVhost(source, { listenPort, upstreamPort, accessLogPath }) {
  let result = source
    .replace('listen 80;', `listen 127.0.0.1:${listenPort};`)
    .replace('listen [::]:80;', '')
    .replaceAll(
      'proxy_pass http://127.0.0.1:3000;',
      `proxy_pass http://127.0.0.1:${upstreamPort};`,
    );
  if (accessLogPath) {
    result = result.replace(
      'access_log /var/log/nginx/access.log setly_redacted;',
      `access_log ${nginxString(accessLogPath)} setly_redacted;`,
    );
  }
  return result;
}

async function waitForListener(port, child, stderr) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`nginx exited before listening: ${stderr()}`);
    }
    const connected = await new Promise((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`nginx did not listen on ${port}: ${stderr()}`);
}

async function request(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({
      host: '127.0.0.1',
      port,
      path: requestPath,
      method: 'GET',
      headers: { Host: 'setly.tech', ...headers },
    }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    outgoing.setTimeout(3_000, () => outgoing.destroy(new Error('request timeout')));
    outgoing.once('error', reject);
    outgoing.end();
  });
}

async function stopNginx(child) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  await exited;
}

test('real Nginx never logs sensitive Beeline request targets on upstream failure', {
  timeout: 15_000,
}, async (t) => {
  const nginx = findNginx();
  if (!nginx) {
    t.skip('real nginx binary is unavailable');
    return;
  }

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'setly-nginx-sensitive-'));
  const accessLogPath = path.join(tempDirectory, 'product-access.log');
  const errorLogPath = path.join(tempDirectory, 'nginx-error.log');
  const pidPath = path.join(tempDirectory, 'nginx.pid');
  const productPath = path.join(tempDirectory, 'setly.tech.conf');
  const operatorPath = path.join(tempDirectory, 'ops.setly.tech.conf');
  const nginxConfigPath = path.join(tempDirectory, 'nginx.conf');
  let child = null;
  let stderr = '';

  try {
    const [productPort, operatorPort, unavailableUpstreamPort] = await reservePorts(3);
    const productSource = fs.readFileSync(
      path.join(repositoryRoot, 'deploy/nginx/setly.tech.conf'),
      'utf8',
    );
    const operatorSource = fs.readFileSync(
      path.join(repositoryRoot, 'deploy/nginx/ops.setly.tech.conf'),
      'utf8',
    );
    fs.writeFileSync(productPath, materializeVhost(productSource, {
      listenPort: productPort,
      upstreamPort: unavailableUpstreamPort,
      accessLogPath,
    }));
    fs.writeFileSync(operatorPath, materializeVhost(operatorSource, {
      listenPort: operatorPort,
      upstreamPort: unavailableUpstreamPort,
    }));
    fs.writeFileSync(nginxConfigPath, [
      'worker_processes 1;',
      `pid ${nginxString(pidPath)};`,
      `error_log ${nginxString(errorLogPath)} info;`,
      'events { worker_connections 32; }',
      'http {',
      '  access_log off;',
      `  include ${nginxString(productPath)};`,
      `  include ${nginxString(operatorPath)};`,
      '}',
      '',
    ].join('\n'));

    const syntax = spawnSync(nginx, [
      '-p', `${tempDirectory}/`,
      '-c', nginxConfigPath,
      '-t',
    ], { encoding: 'utf8' });
    assert.equal(
      syntax.status,
      0,
      `combined setly.tech + ops.setly.tech nginx -t failed:\n${syntax.stderr}`,
    );

    child = spawn(nginx, [
      '-p', `${tempDirectory}/`,
      '-c', nginxConfigPath,
      '-g', 'daemon off; master_process off;',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    await waitForListener(productPort, child, () => stderr);

    const capability = 'a'.repeat(64);
    const sensitiveRequests = [
      {
        path: `/api/integrations/beeline/events/ic_${'b'.repeat(32)}/${capability}?token=CANONICAL_QUERY_ATTACKER`,
        secrets: [capability, `ic_${'b'.repeat(32)}`, 'CANONICAL_QUERY_ATTACKER'],
      },
      {
        path: '/api/integrations/beeline/events/ic_SHARED_HEADER_PUBLIC?token=SHARED_QUERY_ATTACKER',
        headers: { 'x-beeline-webhook-secret': 'SHARED_HEADER_ATTACKER' },
        secrets: ['ic_SHARED_HEADER_PUBLIC', 'SHARED_QUERY_ATTACKER', 'SHARED_HEADER_ATTACKER'],
      },
      {
        path: '/api/integrations/beeline/events?secret=BARE_QUERY_ATTACKER',
        secrets: ['BARE_QUERY_ATTACKER'],
      },
      {
        path: '/api/integrations/beeline/events/ATTACKER_PUBLIC/ATTACKER_CAPABILITY?token=ATTACKER_QUERY',
        secrets: ['ATTACKER_PUBLIC', 'ATTACKER_CAPABILITY', 'ATTACKER_QUERY'],
      },
      {
        path: '/api/Integrations/Beeline/Events/MIXED_CASE_PUBLIC/MIXED_CASE_CAPABILITY?token=MIXED_CASE_QUERY',
        secrets: ['MIXED_CASE_PUBLIC', 'MIXED_CASE_CAPABILITY', 'MIXED_CASE_QUERY'],
      },
    ];

    for (const fixture of sensitiveRequests) {
      assert.equal(await request(productPort, fixture.path, fixture.headers), 502);
    }
    assert.equal(
      await request(
        productPort,
        '/api/unrelated-upstream-failure?marker=ORDINARY_API_ERROR_VISIBLE',
      ),
      502,
    );

    await stopNginx(child);
    child = null;

    const accessLog = fs.readFileSync(accessLogPath, 'utf8');
    const errorLog = fs.readFileSync(errorLogPath, 'utf8');
    const redactedEntries = accessLog.match(
      /GET \/api\/integrations\/beeline\/events\/\[redacted\] HTTP\/1\.1/g,
    ) || [];
    assert.equal(redactedEntries.length, sensitiveRequests.length, accessLog);
    assert.match(accessLog, /GET \/api\/unrelated-upstream-failure HTTP\/1\.1/u);
    assert.match(errorLog, /\/api\/unrelated-upstream-failure/u);
    assert.match(errorLog, /ORDINARY_API_ERROR_VISIBLE/u);
    assert.doesNotMatch(errorLog, /\/api\/integrations\/beeline\/events/u);

    for (const fixture of sensitiveRequests) {
      for (const secret of fixture.secrets) {
        assert.equal(accessLog.includes(secret), false, `access log leaked ${secret}`);
        assert.equal(errorLog.includes(secret), false, `error log leaked ${secret}`);
      }
    }
  } finally {
    await stopNginx(child);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});
