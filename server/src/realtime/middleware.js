const { matchRealtimeChange } = require('./route-map');
const { publishRealtimeChange } = require('./publisher');

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function shouldPublish(req, res, responseBody) {
  if (!MUTATION_METHODS.has(req.method)) return false;
  if (res.statusCode < 200 || res.statusCode >= 300) return false;

  const path = String(req.originalUrl || req.url || '');
  if (path.includes('/webhooks/evotor') && responseBody === 'Already processed') {
    return false;
  }

  if (
    path.includes('/scanner-events') &&
    responseBody &&
    typeof responseBody === 'object' &&
    responseBody.status === 'duplicate'
  ) {
    return false;
  }

  return true;
}

function captureResponseBody(res) {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  let jsonCaptured = false;

  res.json = (body) => {
    jsonCaptured = true;
    res.locals.realtimeResponseBody = body;
    return originalJson(body);
  };

  res.send = (body) => {
    if (!jsonCaptured) {
      res.locals.realtimeResponseBody = body;
    }
    return originalSend(body);
  };
}

function buildRealtimeFanoutChanges(change) {
  if (
    change?.domain === 'visits_analytics'
    || !change?.hints?.queryGroups?.includes('visitsAnalytics')
  ) {
    return [];
  }

  return [{
    action: 'recalculated',
    domain: 'visits_analytics',
    entity: 'analytics_dependency',
    entityId: null,
    hints: {
      queryGroups: ['visitsAnalytics'],
      routes: ['/admin/visits-analytics'],
    },
    source: 'system',
  }];
}

function realtimeMutations() {
  return (req, res, next) => {
    if (!MUTATION_METHODS.has(req.method)) {
      next();
      return;
    }

    captureResponseBody(res);

    res.on('finish', () => {
      const responseBody = res.locals.realtimeResponseBody;
      if (!shouldPublish(req, res, responseBody)) return;

      const change = matchRealtimeChange(req, responseBody);
      if (!change) return;

      const io = req.app.get('io');
      publishRealtimeChange(
        io,
        {
          ...change,
          source: change.source || 'api',
          trainingMode: Boolean(req.trainingMode?.requested),
          trainingRole: req.trainingMode?.role || null,
        },
        req.account,
      );
      buildRealtimeFanoutChanges(change).forEach((fanout) => {
        publishRealtimeChange(io, fanout, null);
      });
    });

    next();
  };
}

module.exports = {
  buildRealtimeFanoutChanges,
  realtimeMutations,
};
