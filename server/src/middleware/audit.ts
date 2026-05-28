import type { NextFunction, Request, Response } from 'express';

const auditService = require('../services/audit.service') as {
  record: (payload: {
    account: Request['account'];
    method: string;
    path: string;
    statusCode: number;
    metadata: {
      body: unknown;
      durationMs: number;
      params: Request['params'];
      query: Request['query'];
    };
  }) => Promise<unknown>;
};

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function auditMutations(req: Request, res: Response, next: NextFunction) {
  if (!MUTATION_METHODS.has(req.method)) {
    next();
    return;
  }

  const startedAt = Date.now();

  res.on('finish', () => {
    void auditService.record({
      account: req.account,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      metadata: {
        body: req.body,
        durationMs: Date.now() - startedAt,
        params: req.params,
        query: req.query,
      },
    });
  });

  next();
}

module.exports = {
  auditMutations,
};
