import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { AccountRole } from '../constants/account-roles';

const authService = require('../services/auth.service') as {
  verifyToken: (token: string) => { accountId?: number } | null;
  getAccountById: (accountId: number) => Promise<Request['account'] | null>;
};
const { sendError } = require('../utils/api-error') as {
  sendError: (res: Response, error: { statusCode: number }, fallback: string) => void;
};

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization || '';
    const token = header.replace(/^Bearer\s+/i, '').trim();
    const payload = token ? authService.verifyToken(token) : null;

    if (!payload?.accountId) {
      return sendError(res, { statusCode: 401 }, 'Unauthorized');
    }

    const account = await authService.getAccountById(payload.accountId);
    if (
      !account ||
      account.status !== 'active' ||
      (account.Staff && account.Staff.status !== 'active')
    ) {
      return sendError(res, { statusCode: 401 }, 'Unauthorized');
    }

    req.account = account;
    next();
  } catch {
    sendError(res, { statusCode: 401 }, 'Unauthorized');
  }
}

function requireRole(...roles: AccountRole[]): RequestHandler {
  return (req, res, next) => {
    if (!req.account || !roles.includes(req.account.role)) {
      return sendError(res, { statusCode: 403 }, 'Forbidden');
    }

    next();
  };
}

module.exports = {
  requireAuth,
  requireRole,
};
