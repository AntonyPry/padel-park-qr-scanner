import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { AccountRole } from '../constants/account-roles';

const { ACCOUNT_ROLE_VALUES } = require('../constants/account-roles') as {
  ACCOUNT_ROLE_VALUES: AccountRole[];
};

function normalizeHeaderRole(value: string | undefined) {
  if (!value) return undefined;
  return ACCOUNT_ROLE_VALUES.includes(value as AccountRole)
    ? (value as AccountRole)
    : undefined;
}

function captureTrainingMode(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const requested = req.get('x-training-mode') === 'true';
    req.trainingMode = {
      requested,
      role: normalizeHeaderRole(req.get('x-training-role')),
    };

    next();
  };
}

module.exports = {
  captureTrainingMode,
};
