import type { NextFunction, Request, Response } from 'express';

const auditService = require('../services/audit.service') as {
  record: (payload: {
    account: Request['account'];
    method: string;
    path: string;
    statusCode: number;
    tenant: Request['tenant'];
    tenantScope: Request['tenantRoute'] extends { classification: infer Scope }
      ? Scope
      : string | undefined;
    metadata: {
      body: unknown;
      durationMs: number;
      params: Request['params'];
      query: Request['query'];
    };
  }) => Promise<{
    actor?: Request['account'] | null;
    auditLogId?: number | null;
    recorded: boolean;
    tenant?: Request['tenant'] | null;
  }>;
};
const { publishRealtimeChange } = require('../realtime/publisher') as {
  publishRealtimeChange: (
    io: unknown,
    payload: Record<string, unknown>,
    account: Request['account'] | null,
    tenant: Request['tenant'],
  ) => Promise<unknown>;
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
      tenant: req.tenant,
      tenantScope: req.tenantRoute?.classification,
      metadata: {
        body: req.body,
        durationMs: Date.now() - startedAt,
        params: req.params,
        query: req.query,
      },
    }).then(async (result) => {
      if (!result.recorded || !result.tenant) return;
      await publishRealtimeChange(
        req.app.get('io'),
        {
          action: 'created',
          domain: 'audit',
          entity: 'audit_log',
          entityId: result.auditLogId,
          hints: {
            queryGroups: ['audit'],
            routes: ['/admin/audit'],
          },
          source: 'system',
        },
        result.actor,
        result.tenant,
      );
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[audit] scoped realtime publish failed', message);
    });
  });

  next();
}

module.exports = {
  auditMutations,
};
