import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:5174';
const OUTPUT_DIR =
  process.env.QA_OUTPUT_DIR || '/private/tmp/transcription-quality-live-qa';
const CALL_ID = 107;

const now = '2026-07-07T09:15:00.000Z';

const accounts = {
  owner: {
    Staff: {
      id: 1,
      name: 'QA Owner',
      phone: '+7 (999) 000-00-01',
      role: 'owner',
      status: 'active',
    },
    email: 'owner@padelpark.qa',
    id: 1,
    role: 'owner',
    staffId: 1,
    status: 'active',
  },
  viewer: {
    Staff: {
      id: 2,
      name: 'QA Viewer',
      phone: '+7 (999) 000-00-02',
      role: 'viewer',
      status: 'active',
    },
    email: 'viewer@padelpark.qa',
    id: 2,
    role: 'viewer',
    staffId: 2,
    status: 'active',
  },
};

const transcription = {
  attemptCount: 1,
  aiCorrections: [
    {
      changes: ['корт заманировать -> корт забронировать'],
      confidence: 'high',
      endMs: 8600,
      normalized: 'корт забронировать',
      original: 'корт заманировать',
      segmentId: 's2',
      speaker: 'client',
      startMs: 4200,
      type: 'llm_edit',
    },
  ],
  aiMetadata: {
    acceptedSegmentIds: ['s1', 's2', 's3'],
    model: 'qwen2.5:7b',
    provider: 'ollama',
    status: 'completed',
  },
  aiTranscriptSegments: [
    {
      channel: 'left',
      changes: [],
      confidence: 'high',
      editedText: 'Добрый день, Падел Парк. Падел-теннис, администратор слушает.',
      endMs: 3200,
      segmentId: 's1',
      sortOrder: 0,
      sourceText: 'Добрый день, Падел Парк. Падел-теннис, администратор слушает.',
      speaker: 'administrator',
      startMs: 0,
      text: 'Добрый день, Падел Парк. Падел-теннис, администратор слушает.',
    },
    {
      channel: 'right',
      changes: ['корт заманировать -> корт забронировать'],
      confidence: 'high',
      editedText: 'Здравствуйте, хочу корт забронировать на вторник.',
      endMs: 8600,
      segmentId: 's2',
      sortOrder: 1,
      sourceText: 'Здравствуйте, хочу корт заманировать на вторник.',
      speaker: 'client',
      startMs: 4200,
      text: 'Здравствуйте, хочу корт забронировать на вторник.',
    },
    {
      channel: 'left',
      changes: [],
      confidence: null,
      editedText: 'Угу.',
      endMs: 11200,
      segmentId: 's3',
      sortOrder: 2,
      sourceText: 'Угу.',
      speaker: 'administrator',
      startMs: 10900,
      text: 'Угу.',
    },
  ],
  aiTranscriptText: [
    'Добрый день, Падел Парк. Падел-теннис, администратор слушает.',
    'Здравствуйте, хочу корт забронировать на вторник.',
    'Угу.',
  ].join('\n'),
  completedAt: now,
  corrections: [
    {
      endMs: 2300,
      original: 'Павел Тренисках',
      normalized: 'падел-теннис',
      rule: 'padel_tennis_alias',
      segmentIndex: 0,
      startMs: 900,
    },
    {
      endMs: 6500,
      original: 'маленький код',
      normalized: 'маленький корт',
      rule: 'court_size_context',
      segmentIndex: 1,
      startMs: 5400,
    },
    {
      original: 'Угу x8',
      normalized: 'Угу',
      rule: 'repeated_filler_collapse',
      segmentIndex: null,
    },
  ],
  createdAt: '2026-07-07T09:12:00.000Z',
  id: 5105,
  language: 'ru',
  rawTranscriptText: [
    '[00:00.000] left: Добрый день, Падел Парк. Павел Тренисках, администратор слушает.',
    '[00:04.200] right: Здравствуйте, хочу корт заманировать на вторник.',
    '[00:10.900] left: Угу. Угу. Угу. Угу. Угу. Угу. Угу. Угу.',
  ].join('\n'),
  segments: [
    {
      channel: 'left',
      confidence: 0.93,
      endMs: 3200,
      id: 1,
      sortOrder: 0,
      speaker: 'administrator',
      startMs: 0,
      text: 'Добрый день, Падел Парк. Падел-теннис, администратор слушает.',
    },
    {
      channel: 'right',
      confidence: 0.91,
      endMs: 8600,
      id: 2,
      sortOrder: 1,
      speaker: 'client',
      startMs: 4200,
      text: 'Здравствуйте, хочу корт заманировать на вторник.',
    },
    {
      channel: 'left',
      confidence: 0,
      endMs: 11200,
      id: 3,
      sortOrder: 2,
      speaker: 'administrator',
      startMs: 10900,
      text: 'Угу.',
    },
  ],
  status: 'completed',
  telephonyCallId: CALL_ID,
  transcriptText: [
    'Добрый день, Падел Парк. Падел-теннис, администратор слушает.',
    'Здравствуйте, хочу корт заманировать на вторник.',
    'Угу.',
  ].join('\n'),
  updatedAt: now,
};

const privilegedCall = {
  callStatus: 'completed',
  client: {
    id: 3401,
    name: 'Анна QA',
    phone: '+7 (999) 111-22-33',
    source: 'QA fixture',
    status: 'active',
  },
  clientPhone: '+7 (999) 111-22-33',
  direction: 'inbound',
  durationSeconds: 126,
  endedAt: '2026-07-07T09:14:06.000Z',
  followUpCallTask: null,
  id: CALL_ID,
  interest: 'training',
  isNewClient: false,
  nextActionAt: null,
  nextActionText: null,
  processedAt: now,
  processedByAccount: {
    id: 1,
    name: 'QA Owner',
    role: 'owner',
  },
  processingStatus: 'processed',
  recordingExpiresAt: '2026-07-07T10:15:00.000Z',
  recordingFileSize: 204800,
  recordingFileType: 'audio/mpeg',
  recordingStatus: 'available',
  recordingSyncedAt: now,
  recordingUrl: 'https://recording.example/qa-call-107.mp3',
  result: 'booked',
  staff: {
    id: 11,
    name: 'Мария Администратор',
    role: 'admin',
  },
  startedAt: '2026-07-07T09:12:00.000Z',
  summary: 'Клиент хочет пробное занятие и маленький корт во вторник.',
  transcription,
};

function viewerCall() {
  const {
    recordingExpiresAt,
    recordingFileSize,
    recordingFileType,
    recordingStatus,
    recordingSyncedAt,
    recordingUrl,
    transcription: hiddenTranscription,
    ...safeCall
  } = privilegedCall;

  void recordingExpiresAt;
  void recordingFileSize;
  void recordingFileType;
  void recordingStatus;
  void recordingSyncedAt;
  void recordingUrl;
  void hiddenTranscription;

  return safeCall;
}

function reportFixture() {
  return {
    byInterest: [{ count: 1, key: 'training', label: 'Тренировка' }],
    byOperator: [
      {
        account: { id: 1, name: 'QA Owner', role: 'owner' },
        booked: 1,
        bookingConversion: 1,
        count: 1,
        key: '1',
        label: 'QA Owner',
        processed: 1,
      },
    ],
    byProcessing: [{ count: 1, key: 'processed', label: 'Обработан' }],
    byResult: [{ count: 1, key: 'booked', label: 'Записался' }],
    generatedAt: now,
    range: {
      from: '2026-07-01',
      to: '2026-07-07',
    },
    totals: {
      active: 0,
      averageDurationSeconds: 126,
      booked: 1,
      bookingConversion: 1,
      ignored: 0,
      inbound: 1,
      missed: 0,
      outbound: 0,
      overdueNextActions: 0,
      processed: 1,
      processingRate: 1,
      recordingCoverage: 1,
      recordingsAvailable: 1,
      total: 1,
      unknownClientRate: 0,
      unknownClients: 0,
    },
  };
}

function configFixture() {
  return {
    apiBaseUrl: 'mock://beeline',
    apiTokenConfigured: true,
    callbackUrl: 'https://crm.example.test/api/telephony/beeline/webhook',
    latestSubscription: null,
    recordsPath: '/records',
    statisticsPath: '/statistics',
    subscriptionAutoRenewEnabled: true,
    subscriptionPath: '/xsi',
    subscriptionRenewBeforeSeconds: 600,
    webhookSecretConfigured: true,
    webhookSecretRequired: true,
  };
}

function json(route, body, status = 200) {
  return route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    status,
  });
}

async function mockApi(route, role, requests, errors) {
  const request = route.request();
  const url = new URL(request.url());
  const pathName = url.pathname;
  const method = request.method();
  requests.push(`${method} ${pathName}${url.search}`);

  if (pathName === '/api/auth/status') {
    return json(route, { setupRequired: false });
  }

  if (pathName === '/api/auth/me') {
    return json(route, { account: accounts[role] });
  }

  if (pathName === '/api/onboarding/training-mode') {
    return json(route, {
      disabledAt: null,
      enabledAt: null,
      isEnabled: false,
      role: null,
    });
  }

  if (pathName === '/api/telephony/stats') {
    return json(route, {
      active: 0,
      ignored: 0,
      missed: 0,
      processed: 1,
      recordingsAvailable: role === 'viewer' ? 0 : 1,
      total: 1,
      unknownClients: 0,
    });
  }

  if (pathName === '/api/telephony/report') {
    return json(route, reportFixture());
  }

  if (pathName === '/api/telephony/config') {
    return json(route, configFixture());
  }

  if (pathName === '/api/telephony/raw-events') {
    return json(route, { items: [], page: 1, pageSize: 5, total: 0 });
  }

  if (pathName === '/api/telephony/calls') {
    const call = role === 'viewer' ? viewerCall() : privilegedCall;
    return json(route, { items: [call], page: 1, pageSize: 20, total: 1 });
  }

  if (pathName === `/api/telephony/calls/${CALL_ID}`) {
    const call = role === 'viewer' ? viewerCall() : privilegedCall;
    return json(route, call);
  }

  if (pathName === '/api/references/client-sources') {
    return json(route, [
      {
        createdAt: now,
        id: 1,
        name: 'QA fixture',
        sortOrder: 1,
        status: 'active',
        updatedAt: now,
      },
    ]);
  }

  if (pathName === '/api/clients') {
    return json(route, {
      items: [],
      page: 1,
      pageSize: 8,
      sources: [],
      total: 0,
      totalPages: 1,
    });
  }

  errors.push(`Unhandled API request: ${method} ${pathName}${url.search}`);
  return json(route, { error: 'Unhandled mock API request' }, 500);
}

async function visibleText(page, text) {
  const locator = page.getByText(text).filter({ visible: true }).first();
  try {
    await locator.waitFor({ state: 'visible', timeout: 10000 });
  } catch (error) {
    const bodyText = await page.locator('body').innerText().catch(() => '');
    throw new Error(
      `Text "${text}" was not visible at ${page.url()}. Body excerpt: ${bodyText.slice(0, 1200)}`,
      { cause: error },
    );
  }
}

async function assertNotVisible(page, locator, label) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) {
      throw new Error(`${label} is visible for viewer`);
    }
  }
}

async function assertNoPageOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  }));

  if (
    overflow.documentScrollWidth > overflow.clientWidth + 1 ||
    overflow.bodyScrollWidth > overflow.clientWidth + 1
  ) {
    throw new Error(
      `${label} has horizontal overflow: ${JSON.stringify(overflow)}`,
    );
  }

  return overflow;
}

function isExpectedMockSocketIoFailure(text) {
  return text.includes('127.0.0.1:3004/socket.io') && text.includes('ERR_CONNECTION_REFUSED');
}

async function runScenario(browser, { label, role, viewport, openTranscript }) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport,
  });
  const requests = [];
  const errors = [];

  await context.addInitScript((token) => {
    localStorage.setItem('padel_park_auth_token', token);
  }, `qa-${role}-token`);

  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      return mockApi(route, role, requests, errors);
    }

    return route.continue();
  });

  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = message.text();
      if (!isExpectedMockSocketIoFailure(text)) {
        errors.push(`console error: ${text}`);
      }
    }
  });
  page.on('pageerror', (error) => {
    errors.push(`page error: ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    const errorText = request.failure()?.errorText || '';
    if (isExpectedMockSocketIoFailure(`${url} ${errorText}`)) {
      return;
    }

    errors.push(
      `request failed: ${request.method()} ${url} ${errorText}`,
    );
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      errors.push(`bad response: ${response.status()} ${response.url()}`);
    }
  });

  const screenshotPath = path.join(OUTPUT_DIR, `${label}.png`);
  const screenshots = [screenshotPath];
  let overflow = null;

  try {
    await page.goto('/admin/telephony', { waitUntil: 'domcontentloaded' });
    await visibleText(page, 'Анна QA');

    if (openTranscript) {
      const openButton = page.getByRole('button', {
        name: 'Открыть транскрипцию',
      }).filter({ visible: true }).first();
      await openButton.waitFor({ state: 'visible', timeout: 10000 });
      await openButton.click();

      await visibleText(page, 'AI-редактура');
      await visibleText(page, 'Очищенная транскрибация');
      await visibleText(page, 'Raw ASR');
      await visibleText(page, 'Автоматические правки');
      await visibleText(page, 'Администратор');
      await visibleText(page, 'Клиент');
      await visibleText(page, 'Падел-теннис, администратор слушает.');
      await visibleText(page, 'корт забронировать');
      await assertNotVisible(
        page,
        page.getByText('Оценка ASR: 0%', { exact: true }),
        'fake zero confidence',
      );
      await assertNotVisible(
        page,
        page.getByText('Уверенность: 0%', { exact: true }),
        'zero confidence',
      );
      await assertNotVisible(
        page,
        page.getByText('Контекст', { exact: false }),
        'prompt leak artifact',
      );
      await assertNotVisible(
        page,
        page.getByText('Продолжение следует', { exact: false }),
        'subtitle artifact',
      );
      await assertNotVisible(
        page,
        page.getByText('Редактор', { exact: false }),
        'editor artifact',
      );
      await assertNotVisible(
        page,
        page.getByText('Корректор', { exact: false }),
        'corrector artifact',
      );
      await page.getByRole('tab', { name: 'Очищенная транскрибация' }).click();
      await visibleText(page, 'корт заманировать');
      await page.getByRole('tab', { name: 'Автоматические правки' }).click();
      await visibleText(page, 'корт заманировать -> корт забронировать');
    } else {
      await assertNotVisible(
        page,
        page.getByRole('button', { name: 'Открыть транскрипцию' }),
        'transcription button',
      );
      await assertNotVisible(
        page,
        page.getByLabel('Открыть запись звонка'),
        'recording button',
      );
      await assertNotVisible(
        page,
        page.getByText('Raw ASR', { exact: true }),
        'raw transcript',
      );
      await assertNotVisible(
        page,
        page.getByText('Автоматические правки', { exact: true }),
        'corrections',
      );
      await assertNotVisible(
        page,
        page.getByText('С записью', { exact: true }),
        'recording metric',
      );

      const sentRecordingFilter = requests.some((entry) =>
        entry.includes('recordingStatus='),
      );
      if (sentRecordingFilter) {
        throw new Error('viewer sent recordingStatus filter in telephony calls query');
      }
    }

    overflow = await assertNoPageOverflow(page, label);
    await page.screenshot({ fullPage: true, path: screenshotPath });

    if (openTranscript && viewport.width <= 480) {
      const corrections = page
        .getByText('Автоматические правки')
        .filter({ visible: true })
        .first();
      await corrections.scrollIntoViewIfNeeded();
      const correctionsScreenshotPath = path.join(
        OUTPUT_DIR,
        `${label}-corrections.png`,
      );
      await page.screenshot({ fullPage: true, path: correctionsScreenshotPath });
      screenshots.push(correctionsScreenshotPath);
    }
  } catch (error) {
    const failureScreenshotPath = path.join(OUTPUT_DIR, `${label}-failed.png`);
    await page.screenshot({ fullPage: true, path: failureScreenshotPath }).catch(() => {});
    await context.close();
    throw new Error(
      [
        `${label} failed: ${error.message}`,
        `failureScreenshot: ${failureScreenshotPath}`,
        `capturedErrors: ${errors.length ? errors.join(' | ') : 'none'}`,
        `requests: ${requests.length ? requests.join(' | ') : 'none'}`,
      ].join('\n'),
      { cause: error },
    );
  }

  await context.close();

  if (errors.length > 0) {
    throw new Error(`${label} failed:\n${errors.join('\n')}`);
  }

  return {
    label,
    overflow,
    requests,
    screenshot: screenshotPath,
    screenshots,
  };
}

await mkdir(OUTPUT_DIR, { recursive: true });

const browser = await chromium.launch();
try {
  const results = [];
  results.push(
    await runScenario(browser, {
      label: 'telephony-transcription-owner-desktop',
      openTranscript: true,
      role: 'owner',
      viewport: { height: 900, width: 1440 },
    }),
  );
  results.push(
    await runScenario(browser, {
      label: 'telephony-transcription-owner-mobile390',
      openTranscript: true,
      role: 'owner',
      viewport: { height: 844, width: 390 },
    }),
  );
  results.push(
    await runScenario(browser, {
      label: 'telephony-transcription-viewer-desktop',
      openTranscript: false,
      role: 'viewer',
      viewport: { height: 900, width: 1440 },
    }),
  );
  results.push(
    await runScenario(browser, {
      label: 'telephony-transcription-viewer-mobile390',
      openTranscript: false,
      role: 'viewer',
      viewport: { height: 844, width: 390 },
    }),
  );

  console.log(
    JSON.stringify(
      {
        baseUrl: BASE_URL,
        callId: CALL_ID,
        outputDir: OUTPUT_DIR,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
