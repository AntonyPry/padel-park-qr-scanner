const {
  redactRequestTarget,
} = require('../provider-integrations/beeline-callback');

function requestTiming(req, res, next) {
  const startedAt = process.hrtime.bigint();

  const originalWriteHead = res.writeHead;
  res.writeHead = function writeHeadWithTiming(...args) {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    if (!res.headersSent) {
      res.setHeader('X-Response-Time-Ms', durationMs.toFixed(1));
    }

    const slowThresholdMs = Number(process.env.SLOW_API_LOG_MS || 1000);
    if (
      Number.isFinite(slowThresholdMs) &&
      slowThresholdMs > 0 &&
      durationMs >= slowThresholdMs
    ) {
      console.warn(
        `[slow-api] ${req.method} ${redactRequestTarget(req.originalUrl)} ${res.statusCode} ${durationMs.toFixed(1)}ms`,
      );
    }

    return originalWriteHead.apply(this, args);
  };

  next();
}

module.exports = {
  requestTiming,
};
