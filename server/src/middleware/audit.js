const auditService = require('../services/audit.service');

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function auditMutations(req, res, next) {
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
