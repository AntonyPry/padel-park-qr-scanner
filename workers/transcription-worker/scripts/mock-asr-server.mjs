import http from 'node:http';

function readArg(name, fallback) {
  const flagIndex = process.argv.indexOf(`--${name}`);
  if (flagIndex >= 0 && process.argv[flagIndex + 1]) {
    return process.argv[flagIndex + 1];
  }

  const envName = `MOCK_ASR_${name.toUpperCase()}`;
  return process.env[envName] || fallback;
}

const host = readArg('host', '127.0.0.1');
const port = Number(readArg('port', '19001'));

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function drainRequest(request) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    request.on('data', (chunk) => {
      bytes += chunk.length;
    });
    request.on('end', () => resolve(bytes));
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || host}`);

  if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/docs')) {
    return sendJson(response, 200, {
      ok: true,
      service: 'padel-park-mock-asr',
    });
  }

  if (request.method === 'POST' && url.pathname === '/asr') {
    const bytes = await drainRequest(request);
    const initialPrompt = url.searchParams.get('initial_prompt') || '';

    return sendJson(response, 200, {
      language: url.searchParams.get('language') || 'ru',
      mock: true,
      receivedBytes: bytes,
      receivedInitialPrompt: initialPrompt,
      segments: [
        {
          confidence: 0.91,
          end: 3.2,
          start: 0,
          text: 'Добрый день, Падел Парк. Павел Тренисках, администратор слушает.',
        },
        {
          confidence: 0.89,
          end: 8.6,
          start: 4.2,
          text: 'Здравствуйте, хочу забронировать маленький код на вторник.',
        },
        {
          confidence: 0.54,
          end: 11.2,
          start: 10.9,
          text: 'Угу. Угу. Угу. Угу. Угу. Угу. Угу. Угу.',
        },
      ],
      text: [
        'Добрый день, Падел Парк. Павел Тренисках, администратор слушает.',
        'Здравствуйте, хочу забронировать маленький код на вторник.',
        'Угу. Угу. Угу. Угу. Угу. Угу. Угу. Угу.',
      ].join(' '),
      vad_filter: url.searchParams.get('vad_filter'),
      word_timestamps: url.searchParams.get('word_timestamps'),
    });
  }

  return sendJson(response, 404, {
    error: 'Not found',
    method: request.method,
    path: url.pathname,
  });
});

server.listen(port, host, () => {
  console.log(
    JSON.stringify({
      asrUrl: `http://${host}:${port}`,
      health: `http://${host}:${port}/health`,
      message: 'Mock ASR endpoint is ready',
    }),
  );
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
