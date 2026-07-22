'use strict';

const {
  createAuthRateLimiter,
} = require('../services/auth-rate-limit.service');
const { sendError } = require('../utils/api-error');

const GENERIC_MESSAGE = 'Слишком много попыток. Повторите позже';
const PROVIDER_RATE_LIMIT_MESSAGE = 'Too Many Requests';
const WORKER_RATE_LIMIT_MESSAGE = 'Worker request rate limited';

function limiterForRequest(req) {
  let limiter = req.app.get('authRateLimiter');
  if (!limiter) {
    limiter = createAuthRateLimiter();
    req.app.set('authRateLimiter', limiter);
  }
  return limiter;
}

function limitCredentialEntry(surface) {
  return async function authenticationRateLimit(req, res, next) {
    try {
      const decision = await limiterForRequest(req).consumeRequest(surface, req);
      if (!decision.blocked) return next();
      res.set('Retry-After', String(decision.retryAfterSeconds));
      return sendError(
        res,
        {
          code: 'AUTH_RATE_LIMITED',
          message: GENERIC_MESSAGE,
          statusCode: 429,
        },
        GENERIC_MESSAGE,
      );
    } catch (_error) {
      return sendError(
        res,
        {
          code: 'AUTH_RATE_LIMIT_UNAVAILABLE',
          message: 'Вход временно недоступен',
          statusCode: 503,
        },
        'Вход временно недоступен',
      );
    }
  };
}

function limitProviderIngress(surface) {
  return async function providerIngressRateLimit(req, res, next) {
    try {
      const decision = await limiterForRequest(req).consumeRequest(surface, req);
      if (!decision.blocked) return next();
      res.set('Retry-After', String(decision.retryAfterSeconds));
      return res.status(429).type('text/plain').send(PROVIDER_RATE_LIMIT_MESSAGE);
    } catch (_error) {
      return res.status(503).type('text/plain').send('Service Unavailable');
    }
  };
}

function limitWorkerIngress(surface) {
  return async function workerIngressRateLimit(req, res, next) {
    try {
      const decision = await limiterForRequest(req).consumeRequest(surface, req);
      if (!decision.blocked) return next();
      res.set('Retry-After', String(decision.retryAfterSeconds));
      return sendError(
        res,
        {
          code: 'WORKER_RATE_LIMITED',
          message: WORKER_RATE_LIMIT_MESSAGE,
          statusCode: 429,
        },
        WORKER_RATE_LIMIT_MESSAGE,
      );
    } catch (_error) {
      return sendError(
        res,
        {
          code: 'WORKER_RATE_LIMIT_UNAVAILABLE',
          message: 'Worker service temporarily unavailable',
          statusCode: 503,
        },
        'Worker service temporarily unavailable',
      );
    }
  };
}

module.exports = {
  limitCredentialEntry,
  limitProviderIngress,
  limitWorkerIngress,
};
