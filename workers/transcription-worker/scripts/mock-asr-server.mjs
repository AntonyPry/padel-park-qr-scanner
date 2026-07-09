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
          words: [
            { end: 0.35, start: 0.0, word: 'Добрый' },
            { end: 0.7, start: 0.36, word: 'день,' },
            { end: 1.15, start: 0.78, word: 'Падел' },
            { end: 1.55, start: 1.16, word: 'Парк.' },
            { end: 2.0, start: 1.7, word: 'Павел' },
            { end: 2.45, start: 2.02, word: 'Тренисках,' },
            { end: 2.85, start: 2.5, word: 'администратор' },
            { end: 3.2, start: 2.86, word: 'слушает.' },
          ],
        },
        {
          confidence: 0.89,
          end: 8.6,
          start: 4.2,
          text: 'Здравствуйте, хочу забронировать маленький код на вторник.',
          words: [
            { end: 4.65, start: 4.2, word: 'Здравствуйте,' },
            { end: 5.05, start: 4.72, word: 'хочу' },
            { end: 5.65, start: 5.08, word: 'забронировать' },
            { end: 6.25, start: 5.9, word: 'маленький' },
            { end: 6.55, start: 6.28, word: 'код' },
            { end: 7.0, start: 6.7, word: 'на' },
            { end: 8.6, start: 8.0, word: 'вторник.' },
          ],
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
