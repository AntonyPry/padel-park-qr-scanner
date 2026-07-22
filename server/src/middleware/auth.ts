import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { AccountRole } from '../constants/account-roles';

const authService = require('../services/auth.service') as {
  authenticateBearerToken: (token: string) => Promise<{
    account: Request['account'];
    authentication: Request['authentication'];
  } | null>;
  extractBearerToken: (request: Request) => string;
};
const { isTenantContextEnabled } = require('./tenant-context') as {
  isTenantContextEnabled: () => boolean;
};
const { sendError } = require('../utils/api-error') as {
  sendError: (res: Response, error: { statusCode: number }, fallback: string) => void;
};

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = authService.extractBearerToken(req);
    const principal = token
      ? await authService.authenticateBearerToken(token)
      : null;

    if (!principal?.account || !principal.authentication) {
      return sendError(res, { statusCode: 401 }, 'Unauthorized');
    }

    req.account = principal.account;
    req.authentication = principal.authentication;
    next();
  } catch {
    sendError(res, { statusCode: 401 }, 'Unauthorized');
  }
}

function requireRole(...roles: AccountRole[]): RequestHandler {
  return (req, res, next) => {
    let authorizationRole = req.account?.role;
    if (isTenantContextEnabled() && req.tenantRoute?.classification !== 'global') {
      if (!req.tenant) {
        return sendError(
          res,
          { statusCode: 403 },
          'Tenant context is required for authorization',
        );
      }
      authorizationRole =
        req.tenant.scope === 'club'
          ? req.tenant.effectiveRole || undefined
          : req.tenant.membershipRole || undefined;
    }

    if (!authorizationRole || !roles.includes(authorizationRole)) {
      return sendError(res, { statusCode: 403 }, 'Forbidden');
    }

    next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
};
