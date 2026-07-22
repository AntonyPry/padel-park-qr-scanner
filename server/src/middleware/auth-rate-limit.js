'use strict';

const {
  createAuthRateLimiter,
} = require('../services/auth-rate-limit.service');
const { sendError } = require('../utils/api-error');

const GENERIC_MESSAGE = 'Слишком много попыток. Повторите позже';

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

module.exports = {
  limitCredentialEntry,
};
