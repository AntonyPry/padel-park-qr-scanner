const assert = require('node:assert/strict');
const test = require('node:test');
const { ACCOUNT_ROLE_VALUES } = require('../../src/constants/account-roles');
const {
  findOnboardingTask,
  getOnboardingPath,
  listOnboardingPaths,
  ONBOARDING_CLIENT_CHECKPOINT_EVENTS,
  validateOnboardingCatalog,
} = require('../../src/onboarding/catalog');

function getTaskVisibleText(task) {
  return [
    task.title,
    task.description,
    task.lesson?.title,
    task.lesson?.summary,
    ...(task.lesson?.blocks || []).flatMap((block) => [
      block.title,
      block.text,
      ...(block.items || []),
    ]),
    ...(task.requirements || []),
  ]
    .filter(Boolean)
    .join('\n');
}

function getTaskScreenshotText(task) {
  return (task.lesson?.screenshots || [])
    .flatMap((screenshot) => [
      screenshot.src,
      screenshot.alt,
      screenshot.caption,
      ...(screenshot.callouts || []).map((callout) => callout.text),
    ])
    .filter(Boolean)
    .join('\n');
}

function assertFirstOpenScreenBlock(task) {
  const firstBlock = task.lesson.blocks[0];
  const visibleText = [
    firstBlock.title,
    firstBlock.text,
    ...(firstBlock.items || []),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  assert.equal(firstBlock.type, 'overview', `${task.key} first block type`);
  assert.equal(
    firstBlock.title.startsWith('Открой'),
    true,
    `${task.key} first block should tell which screen to open`,
  );
  assert.equal(
    firstBlock.text,
    'Сначала открой этот экран в CRM. Это стартовая точка урока; дальше будут конкретные действия и проверка результата.',
    `${task.key} first block text`,
  );
  assert.equal(
    /\bобщий\s+ориентир\b/.test(visibleText) ||
      visibleText.includes(['какой экран', 'должен быть открыт'].join(' ')),
    false,
    `${task.key} first block should not use service wording`,
  );
  assert.equal(firstBlock.screenshotIndex, 0);
  assert.equal(Array.isArray(firstBlock.screenshotIndices), false);
}

function calloutsPartiallyOverlap(first, second) {
  const firstRight = first.x + (first.width || 8);
  const firstBottom = first.y + (first.height || 8);
  const secondRight = second.x + (second.width || 8);
  const secondBottom = second.y + (second.height || 8);
  const overlaps =
    Math.max(first.x, second.x) < Math.min(firstRight, secondRight) &&
    Math.max(first.y, second.y) < Math.min(firstBottom, secondBottom);

  if (!overlaps) return false;

  const firstContainsSecond =
    first.x <= second.x &&
    first.y <= second.y &&
    firstRight >= secondRight &&
    firstBottom >= secondBottom;
  const secondContainsFirst =
    second.x <= first.x &&
    second.y <= first.y &&
    secondRight >= firstRight &&
    secondBottom >= firstBottom;

  return !firstContainsSecond && !secondContainsFirst;
}

function allowsEmbeddedScreenshotCallouts(task) {
  return task.route === '/admin/visits-analytics';
}

function screenshotCalloutsAreValid(task) {
  return task.lesson.screenshots.every((screenshot) => {
    if (!Array.isArray(screenshot.callouts)) {
      return screenshot.calloutsEmbedded !== true;
    }

    return (
      allowsEmbeddedScreenshotCallouts(task) &&
      screenshot.calloutsEmbedded === true &&
      screenshot.callouts.every((callout) => callout.label && callout.text)
    );
  });
}

test('onboarding catalog has a valid path for every account role', () => {
  assert.deepEqual(validateOnboardingCatalog(), []);

  for (const role of ACCOUNT_ROLE_VALUES) {
    const path = getOnboardingPath(role);
    assert.equal(path.role, role);
    assert.equal(Boolean(path.levelLabel), true);
    assert.equal(Boolean(path.completionBadge), true);
    assert.equal(path.missions.length > 0, true);
  }
});

test('onboarding task keys are role-prefixed and discoverable', () => {
  const match = findOnboardingTask('admin', 'admin.booking.create-phone');

  assert.equal(match.task.route, '/admin/bookings');
  assert.equal(match.task.checkpoint.event, 'booking.created');
  assert.deepEqual(match.task.skills, ['Бронирования', 'Телефон']);
  assert.equal(match.task.badge, 'Телефонная бронь');
  assert.equal(match.path.role, 'admin');
  assert.equal(match.mission.key, 'admin.bookings');
});

test('pilot action instructions use section-first action steps format', () => {
  const pilotTasks = [
    {
      key: 'admin.client.create',
      missingScreenshotCount: 0,
      role: 'admin',
      screenshotCount: 3,
      expectedRoute: '/admin/clients',
    },
    {
      key: 'admin.booking.create-phone',
      missingScreenshotCount: 0,
      role: 'admin',
      screenshotCount: 3,
      expectedRoute: '/admin/bookings',
    },
    {
      key: 'admin.subscription.redemption-review',
      missingScreenshotCount: 0,
      role: 'admin',
      screenshotCount: 3,
      expectedRoute: '/admin/clients',
    },
  ];
  const forbiddenPilotSnippets = [
    'Иван Иванович Тестов',
    '+79000000999',
    '[training]',
    'Placeholder',
    'placeholder.svg',
    'result-placeholder',
    'open-client-placeholder',
    'redeem-placeholder',
    'history-placeholder',
  ];

  for (const { expectedRoute, key, missingScreenshotCount, role, screenshotCount } of pilotTasks) {
    const { task } = findOnboardingTask(role, key);
    const blocks = task.lesson.blocks;
    const screenshotText = getTaskScreenshotText(task);
    const visibleText = getTaskVisibleText(task);
    const screenshotBackedBlocks = blocks.filter((block) =>
      Array.isArray(block.screenshotIndices) ||
      Number.isInteger(block.screenshotIndex),
    );
    const missingScreenshotBlocks = blocks.filter((block) =>
      block.missingScreenshot,
    );

    assert.equal(task.kind, 'action');
    assert.equal(task.route, expectedRoute);
    assert.equal(task.practice?.enabled, false);
    assert.equal(task.lesson.format, 'section-first-cards');
    assert.equal(blocks.length, 4);
    assert.equal(task.lesson.screenshots.length, screenshotCount);
    assert.equal(missingScreenshotBlocks.length, missingScreenshotCount);
    assert.equal(
      blocks.every((block) => !block.missingScreenshot),
      true,
    );
    assert.equal(
      new Set(task.lesson.screenshots.map((screenshot) => screenshot.src)).size,
      task.lesson.screenshots.length,
    );
    assertFirstOpenScreenBlock(task);
    assert.equal(blocks[1].title.startsWith('Что нажать:'), true);
    assert.equal(blocks[2].title.startsWith('Что заполнить:'), true);
    assert.equal(blocks[3].title.startsWith('Как проверить результат:'), true);
    assert.equal(blocks[2].items.some((item) => /Сохран|Создать бронь|спис/i.test(item)), true);
    assert.equal(blocks.slice(1).every((block) => block.type === 'step'), true);
    assert.equal(blocks[1].screenshotRequired, false);
    assert.equal(Number.isInteger(blocks[1].screenshotIndex), false);
    assert.equal(blocks[2].screenshotIndex, 1);
    assert.equal(blocks[3].screenshotIndex, 2);
    assert.equal(
      blocks.every((block) => !Array.isArray(block.screenshotIndices)),
      true,
    );
    assert.equal(
      task.lesson.screenshots.every((screenshot) => screenshot.src.endsWith('.png')),
      true,
    );
    assert.equal(
      task.lesson.screenshots.some((screenshot) => screenshot.kind === 'overview'),
      true,
    );
    assert.equal(
      task.lesson.screenshots.some((screenshot) => screenshot.kind === 'crop'),
      false,
    );
    assert.equal(
      task.lesson.screenshots.every(
        (screenshot) =>
          !Array.isArray(screenshot.callouts) && screenshot.calloutsEmbedded !== true,
      ),
      true,
      `${key} pilot screenshots should use clean overview screenshots instead of callouts`,
    );
    assert.equal(
      screenshotBackedBlocks.every((block) => {
        const indices = Array.isArray(block.screenshotIndices)
          ? block.screenshotIndices
          : [block.screenshotIndex];
        return indices.every((index) => {
          const screenshot = task.lesson.screenshots[index];
          return screenshot?.src?.endsWith('.png') && screenshot.caption;
        });
      }),
      true,
    );
    assert.equal(screenshotText.includes('Попробовать'), false);
    assert.equal(screenshotText.includes('quest'), false);

    for (const snippet of forbiddenPilotSnippets) {
      assert.equal(
        visibleText.includes(snippet) || screenshotText.includes(snippet),
        false,
        `${key} should not contain pilot-format forbidden snippet: ${snippet}`,
      );
    }
  }
});

test('non-owner action lessons use screenshot-backed section-first steps', () => {
  const taskTargets = [
    ['admin', 'admin.booking.training-plan-link'],
    ['admin', 'admin.prepayments.dashboard-review'],
    ['admin', 'admin.certificate.redemption-review'],
    ['accountant', 'accountant.prepayments.dashboard-review'],
    ['accountant', 'accountant.corporate.deposit-review'],
    ['accountant', 'accountant.corporate.export-review'],
    ['trainer', 'trainer.methodology.review-base'],
    ['trainer', 'trainer.client.skill-map-review'],
    ['trainer', 'trainer.training-note.structured-record'],
    ['trainer', 'trainer.recommendation.personal-review'],
    ['trainer', 'trainer.recommendation.group-review'],
    ['trainer', 'trainer.training-plan.lifecycle'],
  ];
  const forbiddenSnippets = [
    'экран показывает',
    'как работает CRM',
    'QA DND',
    '[training]',
    'увеличенное использовано',
  ];

  for (const [role, key] of taskTargets) {
    const { task } = findOnboardingTask(role, key);
    const blocks = task.lesson.blocks;
    const visibleText = getTaskVisibleText(task).toLowerCase();
    const screenshotText = getTaskScreenshotText(task).toLowerCase();

    assert.equal(task.lesson.format, 'section-first-cards', key);
    assert.equal(task.lesson.screenshots.length >= 1, true, key);
    assert.equal(task.lesson.screenshots[0].src.startsWith('/onboarding/'), true, key);
    assertFirstOpenScreenBlock(task);
    assert.equal(
      blocks.slice(1).some((block) => block.title?.startsWith('Что нажать:')),
      true,
      `${key} should explain what to open or click`,
    );
    assert.equal(
      blocks.slice(1).some((block) => /Что (заполнить|сверить|можно менять)/.test(block.title || '')),
      true,
      `${key} should explain what to fill or verify`,
    );
    assert.equal(
      blocks.slice(1).some((block) => block.title?.startsWith('Как проверить')),
      true,
      `${key} should explain how to verify result`,
    );

    for (const snippet of forbiddenSnippets) {
      const normalizedSnippet = snippet.toLowerCase();
      assert.equal(
        visibleText.includes(normalizedSnippet) ||
          screenshotText.includes(normalizedSnippet),
        false,
        `${key} should not contain outdated wording: ${snippet}`,
      );
    }
  }
});

test('screenshot-backed lessons start with a concrete open-screen card', () => {
  for (const pathConfig of listOnboardingPaths()) {
    for (const mission of pathConfig.missions) {
      for (const task of mission.tasks) {
        const screenshots = task.lesson?.screenshots || [];
        if (screenshots.length === 0) continue;

        assert.equal(
          task.lesson.format,
          'section-first-cards',
          `${task.key} should use section-first instruction format`,
        );
        assertFirstOpenScreenBlock(task);
        assert.equal(
          screenshotCalloutsAreValid(task),
          true,
          `${task.key} should only expose approved embedded screenshot callouts`,
        );
      }
    }
  }
});

test('visits analytics onboarding covers deep analytics epic without new checkpoint events', () => {
  const manager = findOnboardingTask('manager', 'manager.visits-analytics.review').task;
  const owner = findOnboardingTask('owner', 'owner.operations.review-visits').task;
  const accountant = findOnboardingTask('accountant', 'accountant.visits-analytics.review').task;
  const viewer = findOnboardingTask('viewer', 'viewer.visits-analytics.review').task;
  const managerKnowledge = findOnboardingTask('manager', 'manager.knowledge.visits-analytics').task;
  const ownerKnowledge = findOnboardingTask('owner', 'owner.knowledge.visits-analytics').task;

  for (const task of [manager, owner, accountant, viewer]) {
    assert.equal(task.route, '/admin/visits-analytics');
    assert.equal(task.checkpoint.event, 'report.viewed');
    assert.deepEqual(task.checkpoint.conditions, { report: 'visits_analytics' });
    assert.equal(task.lesson.format, 'section-first-cards');
    assertFirstOpenScreenBlock(task);
    assert.equal(screenshotCalloutsAreValid(task), true);

    const text = [getTaskVisibleText(task), getTaskScreenshotText(task)].join('\n');
    const normalizedText = text.toLowerCase();
    for (const snippet of [
      'канонич',
      'scannedAt',
      'createdAt',
      'Учеб',
      'дубли',
      'eligible 30/60/90',
      'Недостаточно времени',
      'Мало данных',
      'M0',
      'active',
      'risk',
      'sleeping',
      'lost',
      'PAYBACK',
      'LTV 30/60/90/lifetime',
      'coverage',
      'Europe/Moscow',
    ]) {
      assert.equal(
        normalizedText.includes(snippet.toLowerCase()),
        true,
        `${task.key} should cover ${snippet}`,
      );
    }
  }

  for (const task of [manager, owner]) {
    const text = [getTaskVisibleText(task), getTaskScreenshotText(task)].join('\n');
    assert.equal(task.lesson.screenshots.length, 6);
    assert.equal(text.includes('source filter'), true, `${task.key} source filter`);
    assert.equal(text.includes('cohort filter'), true, `${task.key} cohort filter`);
    assert.equal(text.includes('lifecycle filter'), true, `${task.key} lifecycle filter`);
    assert.equal(text.includes('provenance'), true, `${task.key} provenance`);
    assert.equal(text.includes('Создай задачу обзвона'), true, `${task.key} call task handoff`);
  }

  for (const task of [accountant, viewer]) {
    const text = [getTaskVisibleText(task), getTaskScreenshotText(task)].join('\n');
    assert.equal(task.lesson.screenshots.length, 4);
    assert.equal(text.includes('Экспорт'), true, `${task.key} export`);
    assert.equal(text.includes('Создай задачу обзвона'), false, `${task.key} should not create call tasks`);
    assert.equal(text.includes('Кнопка создания базы'), false, `${task.key} should not describe base creation button`);
    assert.equal(text.includes('Создание клиентской базы доступно'), false, `${task.key} should not describe base creation`);
  }

  const visitsAnalyticsText = [
    manager,
    owner,
    accountant,
    viewer,
    managerKnowledge,
    ownerKnowledge,
  ]
    .flatMap((task) => [getTaskVisibleText(task), getTaskScreenshotText(task)])
    .join('\n');

  for (const forbiddenSnippet of [
    'окупаемость PAYBACK',
    'PAYBACK показывает окупаемость',
  ]) {
    assert.equal(
      visitsAnalyticsText.includes(forbiddenSnippet),
      false,
      `visits analytics onboarding should not say: ${forbiddenSnippet}`,
    );
  }

  for (const requiredSnippet of [
    'PAYBACK - возвратный чек',
    'уменьшает net-выручку',
    'Непривязанный PAYBACK остается в coverage',
    'Рост active - благоприятный',
    'Снижение risk, sleeping или lost - благоприятное',
    'Рост risk, sleeping или lost - неблагоприятный',
    'нулевое изменение нейтрально',
  ]) {
    assert.equal(
      visitsAnalyticsText.includes(requiredSnippet),
      true,
      `visits analytics onboarding should explain: ${requiredSnippet}`,
    );
  }
});

test('manager and owner have knowledge guides for every CRM section', () => {
  const expectedKnowledgeRoutes = [
    '/admin',
    '/admin/audit',
    '/admin/bookings',
    '/admin/call-tasks',
    '/admin/catalog',
    '/admin/certificates',
    '/admin/client-bases',
    '/admin/clients',
    '/admin/corporate-clients',
    '/admin/finances',
    '/admin/manager-control',
    '/admin/methodology',
    '/admin/methodology-analytics',
    '/admin/motivation',
    '/admin/onboarding',
    '/admin/prepayments',
    '/admin/references',
    '/admin/staff',
    '/admin/telephony',
    '/admin/trainer',
    '/admin/users',
    '/admin/utilization',
    '/admin/visits-analytics',
  ];
  const forbiddenEnglishSnippets = [
    'Что с этим делает владелец',
    'Что с этим делает менеджер',
    'Contact rate',
    'Completion rate',
    'Conversion rate',
    'Overdue rate',
    'Processing rate',
    'Booking conversion',
    'Recording coverage',
    'Unknown client rate',
    'Revenue =',
    'gross =',
    'Net =',
    'Margin =',
    'COGS',
    'OPEX',
    'P&L',
    'payroll',
    'bookedMinutes',
    'capacityMinutes',
    'plannedAmount',
    'paidAmount',
    'basePay',
    'calculatedBonus',
    'manualAdjustment',
    'base_hour_rate',
    'overtime_after_hours',
    'overtime_hour_rate',
    'owner role override',
    'Training mode',
    'target role',
    'taskKey',
    'KPI',
    'timeline',
    'snapshot',
    'no answer',
    'webhook',
    'follow-up',
    'CRM-note',
    'summary',
    'sandbox',
    'repeat flag',
    'E-step',
    'fallback',
    'planned',
    'completed',
    'isTraining',
  ];

  for (const role of ['manager', 'owner']) {
    const path = getOnboardingPath(role);
    const knowledgeTasks = path.missions
      .filter((mission) => mission.key.startsWith(`${role}.knowledge-`))
      .flatMap((mission) => mission.tasks);

    assert.equal(knowledgeTasks.length, expectedKnowledgeRoutes.length);
    assert.deepEqual(
      knowledgeTasks.map((task) => task.route).sort(),
      expectedKnowledgeRoutes,
    );

    for (const task of knowledgeTasks) {
      assert.equal(task.kind, 'review');
      assert.equal(task.trainingMode.recommended, false);
      assert.equal(task.lesson.screenshots.length, 1);
      assert.equal(
        task.lesson.screenshots[0].src,
        `/onboarding/knowledge/${task.key.split('.').at(-1)}/overview.png`,
      );
      assert.equal(task.lesson.format, 'section-first-cards');
      assertFirstOpenScreenBlock(task);
      assert.equal(
        task.lesson.blocks.slice(1).every((block) => block.type === 'paragraph'),
        true,
      );
      assert.equal(
        task.lesson.blocks.filter((block) => Number.isInteger(block.screenshotIndex))
          .length,
        task.lesson.screenshots.length > 0 ? 1 : 0,
      );
      assert.equal(task.lesson.blocks.length >= 11, true);
      assert.equal(
        task.lesson.blocks.at(-1).title,
        'Как пользоваться разделом в CRM',
      );

      const visibleLessonText = getTaskVisibleText(task);

      for (const snippet of forbiddenEnglishSnippets) {
        assert.equal(
          visibleLessonText.includes(snippet),
          false,
          `${task.key} should not expose raw English/internal wording: ${snippet}`,
        );
      }
    }
  }

  const telephony = findOnboardingTask('owner', 'owner.knowledge.telephony');
  assert.equal(telephony.task.route, '/admin/telephony');
  assert.equal(telephony.task.lesson.blocks.length >= 13, true);
  assert.equal(
    telephony.task.lesson.blocks.some((block) =>
      block.text.includes(
        'Доля обработанных = «Обработанные» / «Всего звонков» * 100%',
      ),
    ),
    true,
  );

  const methodology = findOnboardingTask('owner', 'owner.knowledge.methodology');
  assert.equal(methodology.task.route, '/admin/methodology');
  assert.equal(methodology.task.lesson.blocks.length >= 10, true);

  const methodologyAnalytics = findOnboardingTask(
    'manager',
    'manager.knowledge.methodology-analytics',
  );
  assert.equal(methodologyAnalytics.task.route, '/admin/methodology-analytics');
  assert.equal(
    methodologyAnalytics.task.lesson.blocks.some((block) =>
      block.text.includes(
        'Совпадение = «Количество упражнений из плана, которые есть в фактической записи» / «Количество упражнений в плане» * 100%',
      ),
    ),
    true,
  );
});

test('training methodology onboarding scenarios are wired by role', () => {
  const adminBookingPlan = findOnboardingTask('admin', 'admin.booking.training-plan-link');
  assert.equal(adminBookingPlan.task.route, '/admin/bookings');
  assert.equal(adminBookingPlan.task.checkpoint.event, 'booking.schedule_viewed');
  assert.deepEqual(adminBookingPlan.task.checkpoint.conditions, {
    taskKey: 'admin.booking.training-plan-link',
  });
  assert.equal(adminBookingPlan.task.trainingMode.recommended, false);

  const trainerPlan = findOnboardingTask('trainer', 'trainer.training-plan.lifecycle');
  assert.equal(trainerPlan.task.route, '/admin/trainer');
  assert.equal(trainerPlan.task.checkpoint.event, 'trainer.viewed');
  assert.deepEqual(trainerPlan.task.checkpoint.conditions, {
    taskKey: 'trainer.training-plan.lifecycle',
  });
  assert.equal(
    trainerPlan.task.lesson.blocks.some((block) =>
      block.text.includes('фактические упражнения попали в тренировочные записи участников'),
    ),
    true,
  );

  const managerAnalytics = findOnboardingTask(
    'manager',
    'manager.methodology.analytics-review',
  );
  assert.equal(managerAnalytics.task.route, '/admin/methodology-analytics');
  assert.equal(managerAnalytics.task.checkpoint.event, 'methodology.analytics_viewed');

  const ownerBase = findOnboardingTask('owner', 'owner.methodology.review-base');
  assert.equal(ownerBase.task.route, '/admin/methodology');
  assert.equal(ownerBase.task.checkpoint.event, 'methodology.viewed');
});

test('prepayments onboarding scenarios are wired by role', () => {
  const screenshotRefreshUpdatedAt = '2026-07-14T00:00:00.000+03:00';
  const prepaymentsOverviewSrc = '/onboarding/knowledge/prepayments/overview.png';
  const adminDashboard = findOnboardingTask(
    'admin',
    'admin.prepayments.dashboard-review',
  );
  assert.equal(adminDashboard.task.route, '/admin/prepayments');
  assert.equal(adminDashboard.task.checkpoint.event, 'prepayments.viewed');
  assert.deepEqual(adminDashboard.task.checkpoint.conditions, {
    taskKey: 'admin.prepayments.dashboard-review',
  });
  assert.equal(adminDashboard.task.trainingMode.recommended, false);
  assert.equal(adminDashboard.task.lesson.updatedAt, screenshotRefreshUpdatedAt);
  assert.equal(
    adminDashboard.task.lesson.screenshots.some(
      (screenshot) => screenshot.src === prepaymentsOverviewSrc,
    ),
    true,
  );

  const managerMapping = findOnboardingTask(
    'manager',
    'manager.prepayments.sale-mapping',
  );
  assert.equal(managerMapping.task.route, '/admin/catalog');
  assert.equal(managerMapping.task.checkpoint.event, 'catalog.viewed');
  assert.equal(
    managerMapping.task.lesson.blocks.some((block) =>
      block.text.includes('Тип продажи отвечает, нужно ли после продажи'),
    ),
    true,
  );

  const ownerCorporate = findOnboardingTask(
    'owner',
    'owner.corporate.lifecycle-review',
  );
  assert.equal(ownerCorporate.task.route, '/admin/corporate-clients');
  assert.equal(ownerCorporate.task.checkpoint.event, 'corporate_clients.viewed');
  assert.deepEqual(ownerCorporate.task.checkpoint.conditions, {
    taskKey: 'owner.corporate.lifecycle-review',
  });

  const accountantPrepayments = findOnboardingTask(
    'accountant',
    'accountant.prepayments.dashboard-review',
  );
  assert.equal(accountantPrepayments.task.route, '/admin/prepayments');
  assert.equal(accountantPrepayments.task.checkpoint.event, 'prepayments.viewed');
  assert.equal(
    accountantPrepayments.task.lesson.updatedAt,
    screenshotRefreshUpdatedAt,
  );
  assert.equal(
    accountantPrepayments.task.lesson.screenshots.some(
      (screenshot) => screenshot.src === prepaymentsOverviewSrc,
    ),
    true,
  );

  for (const [role, taskKey] of [
    ['manager', 'manager.knowledge.prepayments'],
    ['owner', 'owner.knowledge.prepayments'],
  ]) {
    const { task } = findOnboardingTask(role, taskKey);
    assert.equal(task.lesson.updatedAt, screenshotRefreshUpdatedAt);
    assert.equal(
      task.lesson.screenshots.some(
        (screenshot) => screenshot.src === prepaymentsOverviewSrc,
      ),
      true,
      `${taskKey} should use refreshed prepayments screenshot`,
    );
  }
});

test('manager control onboarding is wired for owner and manager daily review', () => {
  const managerTask = findOnboardingTask(
    'manager',
    'manager.manager-control.daily-review',
  );
  assert.equal(managerTask.task.route, '/admin/manager-control');
  assert.equal(managerTask.task.kind, 'review');
  assert.equal(managerTask.task.checkpoint.event, 'manager_control.viewed');
  assert.deepEqual(managerTask.task.checkpoint.conditions, {
    taskKey: 'manager.manager-control.daily-review',
  });
  assert.equal(managerTask.task.trainingMode.recommended, false);
  assert.equal(
    managerTask.task.lesson.blocks.some((block) =>
      block.text.includes('pending sales без клиента'),
    ),
    true,
  );

  const ownerTask = findOnboardingTask(
    'owner',
    'owner.manager-control.daily-review',
  );
  assert.equal(ownerTask.task.route, '/admin/manager-control');
  assert.equal(ownerTask.task.kind, 'review');
  assert.equal(ownerTask.task.checkpoint.event, 'manager_control.viewed');
  assert.deepEqual(ownerTask.task.checkpoint.conditions, {
    taskKey: 'owner.manager-control.daily-review',
  });

  const managerKnowledge = findOnboardingTask(
    'manager',
    'manager.knowledge.manager-control',
  );
  assert.equal(managerKnowledge.task.route, '/admin/manager-control');
  assert.equal(managerKnowledge.task.lesson.format, 'section-first-cards');
  assertFirstOpenScreenBlock(managerKnowledge.task);
});

test('prepayments training safety keeps unsafe financial flows review-first', () => {
  const unsafeUntilTrainingMarkersExist = [
    ['owner', 'owner.prepayments.dashboard-review'],
    ['owner', 'owner.subscriptions.lifecycle-review'],
    ['owner', 'owner.certificates.lifecycle-review'],
    ['manager', 'manager.prepayments.pending-sales'],
    ['manager', 'manager.prepayments.dashboard-review'],
    ['admin', 'admin.prepayments.dashboard-review'],
    ['admin', 'admin.subscription.redemption-review'],
    ['admin', 'admin.certificate.redemption-review'],
    ['accountant', 'accountant.prepayments.dashboard-review'],
    ['accountant', 'accountant.corporate.deposit-review'],
    ['accountant', 'accountant.corporate.export-review'],
  ];

  for (const [role, taskKey] of unsafeUntilTrainingMarkersExist) {
    const { task } = findOnboardingTask(role, taskKey);
    assert.equal(
      task.trainingMode?.recommended,
      false,
      `${taskKey} should not recommend training mode`,
    );
    assert.notEqual(
      task.checkpoint?.event,
      'booking.created',
      `${taskKey} should not use unrelated action checkpoint`,
    );
  }
});

test('prepayments role wording does not describe hidden dashboard sections', () => {
  const adminTasks = [
    findOnboardingTask('admin', 'admin.prepayments.dashboard-review').task,
    findOnboardingTask('admin', 'admin.subscription.redemption-review').task,
    findOnboardingTask('admin', 'admin.certificate.redemption-review').task,
  ];
  const accountantTasks = [
    findOnboardingTask('accountant', 'accountant.prepayments.dashboard-review').task,
    findOnboardingTask('accountant', 'accountant.corporate.deposit-review').task,
    findOnboardingTask('accountant', 'accountant.corporate.export-review').task,
  ];

  const adminText = adminTasks.map(getTaskVisibleText).join('\n');
  const accountantText = accountantTasks.map(getTaskVisibleText).join('\n');

  [
    'ожидающие продажи',
    'ожидающая привязка продажи',
    'очередь продаж',
    'корпоративные остатки',
    'корпоративный остаток',
    'корпоративными балансами',
  ].forEach((snippet) => {
    assert.equal(
      adminText.includes(snippet),
      false,
      `admin prepayments wording should not describe hidden section: ${snippet}`,
    );
  });

  [
    'ожидающие продажи',
    'очередь продаж',
    'активные абонементы',
    'активный абонемент',
    'активные сертификаты',
    'сертификаты и корпоративные',
  ].forEach((snippet) => {
    assert.equal(
      accountantText.includes(snippet),
      false,
      `accountant prepayments wording should not describe hidden section: ${snippet}`,
    );
  });

  assert.equal(adminText.includes('абонемент'), true);
  assert.equal(adminText.includes('сертификат'), true);
  assert.equal(accountantText.includes('корпоратив'), true);
  assert.equal(accountantText.includes('финансов'), true);
});

test('shift cash onboarding is wired by role with backend checkpoints', () => {
  const adminOpening = findOnboardingTask(
    'admin',
    'admin.shift-cash.opening-record',
  ).task;
  assert.equal(adminOpening.route, '/admin/motivation');
  assert.equal(adminOpening.kind, 'action');
  assert.equal(adminOpening.checkpoint.event, 'shift_cash.opening_recorded');
  assert.equal(adminOpening.trainingMode.recommended, true);

  const adminExpense = findOnboardingTask(
    'admin',
    'admin.shift-cash.expense-with-photo',
  ).task;
  assert.equal(adminExpense.route, '/admin/motivation');
  assert.equal(adminExpense.kind, 'action');
  assert.equal(adminExpense.checkpoint.event, 'shift_cash.attachment_uploaded');
  assert.equal(
    getTaskVisibleText(adminExpense).includes('фото чека'),
    true,
  );

  const managerClose = findOnboardingTask(
    'manager',
    'manager.shift-cash.reconciliation-review',
  ).task;
  assert.equal(managerClose.route, '/admin/motivation');
  assert.equal(managerClose.checkpoint.event, 'shift_cash.closed');
  assert.equal(managerClose.trainingMode.recommended, false);

  const ownerControl = findOnboardingTask(
    'owner',
    'owner.shift-cash.control-review',
  ).task;
  assert.equal(ownerControl.route, '/admin/motivation');
  assert.equal(ownerControl.checkpoint.event, 'shift_cash.closed');
  assert.equal(
    getTaskVisibleText(ownerControl).includes('Владелец может проходить обучение за роли'),
    true,
  );

  const accountantReview = findOnboardingTask(
    'accountant',
    'accountant.shift-cash.finance-review',
  ).task;
  assert.equal(accountantReview.route, '/admin/finances');
  assert.equal(accountantReview.checkpoint.event, 'finance.report_viewed');
  assert.equal(accountantReview.trainingMode.recommended, false);
  assert.equal(
    getTaskVisibleText(accountantReview).includes('не управляет кассой смены как администратор'),
    true,
  );

  for (const task of [
    adminOpening,
    adminExpense,
    managerClose,
    ownerControl,
    accountantReview,
  ]) {
    assert.equal(task.lesson.format, 'section-first-cards');
    assertFirstOpenScreenBlock(task);
    assert.equal(task.lesson.screenshots.length >= 2, true, task.key);
    assert.equal(
      task.lesson.screenshots.every((screenshot) =>
        screenshot.src.startsWith('/onboarding/'),
      ),
      true,
      task.key,
    );
  }

  for (const eventKey of [
    'shift_cash.opening_recorded',
    'shift_cash.attachment_uploaded',
    'shift_cash.closed',
  ]) {
    assert.equal(
      ONBOARDING_CLIENT_CHECKPOINT_EVENTS.includes(eventKey),
      false,
      `${eventKey} should require a backend product event`,
    );
  }
});
