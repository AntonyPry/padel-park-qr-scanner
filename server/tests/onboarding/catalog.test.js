const assert = require('node:assert/strict');
const test = require('node:test');
const { ACCOUNT_ROLE_VALUES } = require('../../src/constants/account-roles');
const {
  findOnboardingTask,
  getOnboardingPath,
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

    assert.equal(knowledgeTasks.length, 22);
    assert.deepEqual(
      knowledgeTasks.map((task) => task.route).sort(),
      expectedKnowledgeRoutes,
    );

    for (const task of knowledgeTasks) {
      assert.equal(task.kind, 'review');
      assert.equal(task.trainingMode.recommended, false);
      if (
        [
          '/admin/certificates',
          '/admin/corporate-clients',
          '/admin/methodology',
          '/admin/methodology-analytics',
          '/admin/prepayments',
        ].includes(task.route)
      ) {
        assert.equal(task.lesson.screenshots.length, 0);
      } else {
        assert.equal(task.lesson.screenshots.length, 1);
        assert.equal(
          task.lesson.screenshots[0].src,
          `/onboarding/knowledge/${task.key.split('.').at(-1)}/overview.png`,
        );
      }
      assert.equal(
        task.lesson.blocks.every((block) => block.type === 'paragraph'),
        true,
      );
      assert.equal(
        task.lesson.blocks.filter((block) => Number.isInteger(block.screenshotIndex))
          .length,
        task.lesson.screenshots.length > 0 ? 1 : 0,
      );
      assert.equal(task.lesson.blocks.length >= 10, true);
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
      block.text.includes('После завершения CRM создает или обновляет тренировочные записи'),
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
