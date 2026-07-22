'use strict';

const {
  AUTH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  UNSAFE_METHODS,
  constantTimeEqual,
  getCookie,
} = require('../security/browser-session');
const { isSameOriginHostRequest } = require('../security/browser-origin-policy');

const BROWSER_SESSION_PROTECTION_DENIED = 'BROWSER_SESSION_PROTECTION_DENIED';

function deny(res) {
  return res.status(403).json({
    code: BROWSER_SESSION_PROTECTION_DENIED,
    error: 'Browser session protection failed',
    status: 403,
  });
}

function createBrowserSessionProtection(originPolicy) {
  return function browserSessionProtection(req, res, next) {
    // CSP reports are telemetry, not application state changes. They must be
    // accepted/discarded independently of an ambient normal-user cookie.
    if (req.path === '/__csp-report') return next();
    if (!UNSAFE_METHODS.has(String(req.method || '').toUpperCase())) return next();

    const authCookie = getCookie(req, AUTH_COOKIE_NAME);
    if (!authCookie) return next();

    const origin = req.get('Origin');
    if (!origin || (!originPolicy.isAllowed(origin) && !isSameOriginHostRequest(origin, req.get('Host')))) {
      return deny(res);
    }

    const csrfCookie = getCookie(req, CSRF_COOKIE_NAME);
    const csrfHeader = req.get(CSRF_HEADER_NAME) || '';
    if (!constantTimeEqual(csrfCookie, csrfHeader)) return deny(res);

    return next();
  };
}

module.exports = {
  BROWSER_SESSION_PROTECTION_DENIED,
  createBrowserSessionProtection,
};
