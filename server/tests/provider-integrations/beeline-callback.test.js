'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  assertCapabilityConnection,
  buildCapabilityCallbackUrl,
  generateCallbackToken,
  redactCapabilityValue,
  redactRequestTarget,
} = require('../../src/provider-integrations/beeline-callback');
const {
  createAuthenticatedIngressContext,
  requireAuthenticatedIngressContext,
} = require('../../src/provider-integrations/ingress-context');
const { requestTiming } = require('../../src/middleware/performance');
const telephonyService = require('../../src/services/telephony.service');

function connection(token) {
  return Object.freeze({
    config: Object.freeze({
      callbackBaseUrl: 'https://setly.tech/api/integrations/beeline/events',
      webhookAuthMode: 'capability_uri',
    }),
    provider: 'beeline',
    publicId: 'ic_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    secrets: Object.freeze({ apiToken: 'api-secret', callbackToken: token }),
  });
}

test('Beeline callback capability is 256-bit, timing-safe verified and redacted deeply', () => {
  const token = generateCallbackToken();
  const current = connection(token);
  const callbackUrl = buildCapabilityCallbackUrl(current);
  assert.match(token, /^[a-f0-9]{64}$/u);
  assert.equal(assertCapabilityConnection(current, token), current);
  const wrongToken = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
  assert.throws(
    () => assertCapabilityConnection(current, wrongToken),
    (error) => error.code === 'BEELINE_CALLBACK_CAPABILITY_MISMATCH',
  );
  const redacted = redactCapabilityValue({
    callbackUrl,
    nested: [`echo:${token}`, { url: callbackUrl }],
  }, token);
  assert.equal(JSON.stringify(redacted).includes(token), false);
  assert.equal(redacted.callbackUrl, 'https://setly.tech/api/integrations/beeline/events/[redacted]');
  assert.equal(
    redactRequestTarget(`/api/integrations/beeline/events/${current.publicId}/${token}?x=1`),
    '/api/integrations/beeline/events/[redacted]?x=1',
  );
  assert.equal(
    redactRequestTarget(`/api/integrations/beeline/events?callbackToken=${token}&x=1`),
    '/api/integrations/beeline/events?callbackToken=[redacted]&x=1',
  );
});

test('HTTP service boundary accepts only an unforgeable authenticated ingress context', () => {
  const current = connection(generateCallbackToken());
  const context = createAuthenticatedIngressContext(current);
  assert.equal(requireAuthenticatedIngressContext(context, 'beeline'), current);
  assert.throws(
    () => requireAuthenticatedIngressContext({ connection: current }, 'beeline'),
    (error) => error.code === 'PROVIDER_INGRESS_AUTHENTICATION_REQUIRED',
  );
  assert.throws(
    () => requireAuthenticatedIngressContext(context, 'evotor'),
    (error) => error.code === 'PROVIDER_INGRESS_AUTHENTICATION_REQUIRED',
  );
});

test('trusted statistics ingestion is private and direct callers cannot forge HTTP auth', async () => {
  assert.equal(telephonyService.ingestTrustedStatisticsRow, undefined);
  await assert.rejects(
    telephonyService.receiveBeelineEvent({
      body: { eventType: 'statistics' },
      ingressContext: { connection: connection(generateCallbackToken()) },
    }),
    (error) => error.code === 'PROVIDER_INGRESS_AUTHENTICATION_REQUIRED',
  );
});

test('slow request logging never emits the callback capability', () => {
  const token = generateCallbackToken();
  const previousThreshold = process.env.SLOW_API_LOG_MS;
  const originalWarn = console.warn;
  const logs = [];
  process.env.SLOW_API_LOG_MS = '0.000001';
  console.warn = (...args) => logs.push(args.join(' '));
  try {
    const response = {
      headersSent: false,
      setHeader() {},
      statusCode: 200,
      writeHead() {},
    };
    requestTiming({
      method: 'POST',
      originalUrl: `/api/integrations/beeline/events/ic_${'a'.repeat(32)}/${token}`,
    }, response, () => {});
    response.writeHead(200);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].includes(token), false);
    assert.match(logs[0], /beeline\/events\/\[redacted\]/u);
  } finally {
    console.warn = originalWarn;
    if (previousThreshold === undefined) delete process.env.SLOW_API_LOG_MS;
    else process.env.SLOW_API_LOG_MS = previousThreshold;
  }
});
