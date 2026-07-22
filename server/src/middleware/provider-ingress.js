'use strict';

const {
  resolveIngressConnection,
} = require('../provider-integrations/connection-service');
const {
  isTenantProviderIntegrationsEnabled,
} = require('../tenant-context/capabilities');
const {
  assertCapabilityConnection,
  assertSharedHeaderConnection,
} = require('../provider-integrations/beeline-callback');
const {
  recordRejectedIngress,
} = require('../provider-integrations/diagnostics');
const {
  assertIngressSecret,
  assertLegacyDownstreamReady,
} = require('../provider-integrations/runtime');
const {
  createAuthenticatedIngressContext,
} = require('../provider-integrations/ingress-context');
const {
  requireExactSingletonDefault,
} = require('../tenant-enforcement/legacy-singleton');

function beelineSecret(req) {
  return req.headers['x-beeline-webhook-secret'] ||
    req.headers['x-webhook-secret'] ||
    req.headers['x-integration-secret'] ||
    '';
}

function evotorSecret(req) {
  const value = req.headers['x-evotor-token'] || req.headers.authorization || '';
  return String(value).replace(/^Bearer\s+/iu, '').trim();
}

function rejectResponse(res, error) {
  const statusCode = Number(error?.statusCode) || 500;
  return res.status(statusCode).send(statusCode < 500 ? 'Rejected' : 'Server Error');
}

function connectionFirstIngress(provider, getSecret) {
  return async function resolveConnectionBeforeBody(req, res, next) {
    if (provider !== 'beeline' && !isTenantProviderIntegrationsEnabled()) {
      try {
        await requireExactSingletonDefault();
        return next();
      } catch (error) {
        return rejectResponse(res, error);
      }
    }
    try {
      const publicId = req.params.connectionPublicId;
      const connection = await resolveIngressConnection({
        provider,
        publicId,
        requestId: req.headers['x-request-id'],
        sourceIp: req.ip,
      });
      try {
        if (provider === 'beeline') {
          assertSharedHeaderConnection(connection, getSecret(req));
        } else {
          assertIngressSecret(connection, getSecret(req));
        }
      } catch (error) {
        await recordRejectedIngress({
          provider,
          publicId,
          reasonCode: 'CONNECTION_SECRET_MISMATCH',
          requestId: req.headers['x-request-id'],
          sourceIp: req.ip,
        });
        throw error;
      }
      await assertLegacyDownstreamReady(connection);
      req.providerConnection = connection;
      req.providerIngressContext = createAuthenticatedIngressContext(connection);
      return next();
    } catch (error) {
      return rejectResponse(res, error);
    }
  };
}

async function beelineCapabilityIngress(req, res, next) {
  const publicId = req.params.connectionPublicId;
  try {
    const connection = await resolveIngressConnection({
      provider: 'beeline',
      publicId,
      requestId: req.headers['x-request-id'],
      sourceIp: req.ip,
    });
    try {
      assertCapabilityConnection(connection, req.params.callbackToken);
    } catch (error) {
      await recordRejectedIngress({
        provider: 'beeline',
        publicId,
        reasonCode: 'CONNECTION_CAPABILITY_MISMATCH',
        requestId: req.headers['x-request-id'],
        sourceIp: req.ip,
      });
      throw error;
    }
    await assertLegacyDownstreamReady(connection);
    req.providerConnection = connection;
    req.providerIngressContext = createAuthenticatedIngressContext(connection);
    return next();
  } catch (error) {
    return rejectResponse(res, error);
  }
}

function rejectLegacyBeelineIngress(_req, res) {
  return res.status(404).send('Rejected');
}

module.exports = {
  beelineCapabilityIngress,
  beelineConnectionFirstIngress: connectionFirstIngress('beeline', beelineSecret),
  connectionFirstIngress,
  evotorConnectionFirstIngress: connectionFirstIngress('evotor', evotorSecret),
  rejectLegacyBeelineIngress,
};
