'use strict';

const cors = require('cors');
const express = require('express');
const {
  ONBOARDING_COMPLETED_TASKS_HEADER,
  ONBOARDING_PROGRESSED_TASKS_HEADER,
} = require('./onboarding-quest');
const {
  isSameOriginHostRequest,
} = require('../security/browser-origin-policy');

const HTTP_SECURITY_CONFIGURATION_ERROR =
  'HTTP_SECURITY_CONFIGURATION_INVALID';
const CORS_ORIGIN_DENIED = 'CORS_ORIGIN_DENIED';
const CSP_REPORT_PATH = '/__csp-report';
const CSP_REPORT_MAX_BYTES = 16 * 1024;
const CORS_METHODS = Object.freeze([
  'GET',
  'HEAD',
  'PUT',
  'PATCH',
  'POST',
  'DELETE',
]);
const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=(self)',
  'camera=()',
  'display-capture=()',
  'fullscreen=(self)',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'payment=()',
  'serial=(self)',
].join(', ');
const STRICT_TRANSPORT_SECURITY = 'max-age=31536000';
const parseCspReport = express.raw({
  inflate: false,
  limit: CSP_REPORT_MAX_BYTES,
  type: () => true,
});

function configurationError(reason) {
  const error = new Error(`HTTP security configuration is invalid: ${reason}`);
  error.code = HTTP_SECURITY_CONFIGURATION_ERROR;
  error.reason = reason;
  return error;
}

function parseBoolean(environment, name) {
  const value = environment[name];
  if (value == null || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw configurationError(`${name.toLowerCase()}_must_be_boolean`);
}

function websocketOrigin(origin) {
  const parsed = new URL(origin);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return parsed.origin;
}

function buildContentSecurityPolicyReportOnly(originPolicy) {
  const connectSources = [...new Set([
    "'self'",
    ...originPolicy.allowedOrigins,
    ...originPolicy.allowedOrigins.map(websocketOrigin),
  ])];
  const directives = [
    ['default-src', "'self'"],
    ['base-uri', "'self'"],
    ['object-src', "'none'"],
    ['frame-ancestors', "'none'"],
    ['frame-src', "'none'"],
    ['form-action', "'self'"],
    ['script-src', "'self'"],
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:'],
    ['font-src', "'self'", 'data:'],
    ['media-src', "'self'", 'blob:'],
    ['worker-src', "'self'", 'blob:'],
    ['manifest-src', "'self'"],
    ['connect-src', ...connectSources],
    ['report-uri', CSP_REPORT_PATH],
  ];

  return directives
    .map(([directive, ...values]) => `${directive} ${values.join(' ')}`)
    .join('; ');
}

function discardCspReport(req, res) {
  parseCspReport(req, res, (error) => {
    if (error) {
      const status = error.type === 'entity.too.large' ? 413 : 400;
      res.status(status).json({
        code: 'CSP_REPORT_REJECTED',
        error: 'CSP report rejected',
        status,
      });
      return;
    }
    res.status(204).end();
  });
}

function resolveHstsEnabled(originPolicy, environment) {
  const enabled = parseBoolean(environment, 'SECURITY_HSTS_ENABLED');
  const tlsReady = parseBoolean(environment, 'SECURITY_HSTS_TLS_READY');
  if (!enabled) return false;
  if (environment.NODE_ENV !== 'production') {
    throw configurationError('hsts_requires_production');
  }
  if (!tlsReady) {
    throw configurationError('hsts_requires_tls_ready');
  }
  if (originPolicy.allowedOrigins.some((origin) => !origin.startsWith('https://'))) {
    throw configurationError('hsts_requires_https_origins');
  }
  return true;
}

function createSecurityHeadersMiddleware(
  originPolicy,
  environment = process.env,
) {
  const hstsEnabled = resolveHstsEnabled(originPolicy, environment);
  const cspReportOnly = buildContentSecurityPolicyReportOnly(originPolicy);

  return function securityHeaders(_req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    res.setHeader('Content-Security-Policy-Report-Only', cspReportOnly);
    if (hstsEnabled) {
      res.setHeader('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY);
    }
    next();
  };
}

function createBrowserCorsMiddleware(originPolicy) {
  const allowedCors = cors({
    credentials: true,
    exposedHeaders: [
      ONBOARDING_COMPLETED_TASKS_HEADER,
      ONBOARDING_PROGRESSED_TASKS_HEADER,
    ],
    methods: CORS_METHODS,
    origin(origin, callback) {
      callback(null, originPolicy.isAllowed(origin));
    },
  });

  return function browserCors(req, res, next) {
    const origin = req.get('Origin');
    res.vary('Origin');
    if (!origin) return next();
    if (originPolicy.isAllowed(origin)) return allowedCors(req, res, next);

    // The operator host is intentionally not a product CORS origin. Its browser
    // requests remain same-origin through the dedicated Nginx Host boundary and
    // receive no CORS response headers from the application.
    if (isSameOriginHostRequest(origin, req.get('Host'))) return next();

    return res.status(403).json({
      code: CORS_ORIGIN_DENIED,
      error: 'Browser origin is not allowed',
      status: 403,
    });
  };
}

module.exports = {
  CORS_METHODS,
  CORS_ORIGIN_DENIED,
  CSP_REPORT_MAX_BYTES,
  CSP_REPORT_PATH,
  HTTP_SECURITY_CONFIGURATION_ERROR,
  PERMISSIONS_POLICY,
  STRICT_TRANSPORT_SECURITY,
  buildContentSecurityPolicyReportOnly,
  createBrowserCorsMiddleware,
  createSecurityHeadersMiddleware,
  discardCspReport,
  resolveHstsEnabled,
};
