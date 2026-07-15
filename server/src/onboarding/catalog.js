const { ACCOUNT_ROLES, ACCOUNT_ROLE_VALUES } = require('../constants/account-roles');

const ONBOARDING_CONTENT_UPDATED_AT = '2026-06-08T00:00:00.000+03:00';

const ONBOARDING_ROUTES = [
  '/admin',
  '/admin/audit',
  '/admin/bookings',
  '/admin/call-tasks',
  '/admin/catalog',
  '/admin/client-bases',
  '/admin/clients',
  '/admin/certificates',
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

const ONBOARDING_CHECKPOINT_EVENTS = [
  'access.visit_created',
  'account.created',
  'audit.viewed',
  'booking.cancelled',
  'booking.created',
  'booking.moved',
  'booking.paid',
  'booking.schedule_viewed',
  'call_task.attempt_logged',
  'call_task.created',
  'call_task.report_viewed',
  'catalog.viewed',
  'catalog.category_updated',
  'catalog.rule_updated',
  'certificates.viewed',
  'client.created',
  'client.viewed',
  'clients.viewed',
  'client_base.created',
  'corporate_clients.viewed',
  'finance.record_created',
  'finance.report_viewed',
  'manager_control.viewed',
  'methodology.analytics_viewed',
  'methodology.viewed',
  'motivation.rule_updated',
  'payroll.reviewed',
  'prepayments.viewed',
  'reference.viewed',
  'report.exported',
  'report.viewed',
  'shift.approved',
  'shift_cash.attachment_uploaded',
  'shift_cash.closed',
  'shift_cash.opening_recorded',
  'training_level.updated',
  'training_note.created',
  'training_note.updated',
  'trainer.viewed',
  'utilization.viewed',
];

const ONBOARDING_CLIENT_CHECKPOINT_EVENTS = [
  'audit.viewed',
  'booking.schedule_viewed',
  'call_task.report_viewed',
  'catalog.viewed',
  'certificates.viewed',
  'clients.viewed',
  'corporate_clients.viewed',
  'finance.report_viewed',
  'manager_control.viewed',
  'methodology.analytics_viewed',
  'methodology.viewed',
  'prepayments.viewed',
  'reference.viewed',
  'report.viewed',
  'trainer.viewed',
  'utilization.viewed',
];

const ONBOARDING_ROUTE_START_COMMANDS = {
  '/admin': 'Открой раздел «Монитор входов»',
  '/admin/audit': 'Открой раздел «Журнал действий»',
  '/admin/bookings': 'Открой раздел «Бронирования»',
  '/admin/call-tasks': 'Открой раздел «Задачи обзвона»',
  '/admin/catalog': 'Открой раздел «Справочник товаров»',
  '/admin/certificates': 'Открой раздел «Сертификаты»',
  '/admin/client-bases': 'Открой раздел «Базы клиентов»',
  '/admin/clients': 'Открой раздел «Клиенты»',
  '/admin/corporate-clients': 'Открой раздел «Корпоративные клиенты»',
  '/admin/finances': 'Открой раздел «Финансы»',
  '/admin/manager-control': 'Открой раздел «Контроль менеджера»',
  '/admin/methodology': 'Открой раздел «Методика»',
  '/admin/methodology-analytics': 'Открой раздел «Аналитика методики»',
  '/admin/motivation': 'Открой раздел «Мотивация»',
  '/admin/onboarding': 'Открой раздел «Обучение»',
  '/admin/prepayments': 'Открой раздел «Предоплаты и списания»',
  '/admin/references': 'Открой раздел «Справочники CRM»',
  '/admin/staff': 'Открой раздел «Персонал»',
  '/admin/telephony': 'Открой раздел «Телефония»',
  '/admin/trainer': 'Открой раздел «Тренерский кабинет»',
  '/admin/users': 'Открой раздел «Пользователи»',
  '/admin/utilization': 'Открой раздел «Утилизация кортов»',
  '/admin/visits-analytics': 'Открой раздел «Аналитика посещений»',
};

const ONBOARDING_TASK_START_COMMANDS = {
  'admin.call-task.log-attempt': 'Открой задачу обзвона',
  'admin.subscription.redemption-review': 'Открой карточку клиента',
  'accountant.corporate.deposit-review': 'Открой карточку корпоративного клиента',
  'accountant.corporate.export-review': 'Открой карточку корпоративного клиента',
  'trainer.client.skill-map-review': 'Открой карточку игрока',
  'trainer.recommendation.group-review': 'Открой групповую рекомендацию',
  'trainer.recommendation.personal-review': 'Открой карточку игрока',
  'trainer.training-note.create': 'Открой карточку игрока',
  'trainer.training-note.structured-record': 'Открой карточку игрока',
  'trainer.training-note.update': 'Открой карточку игрока',
  'trainer.training-plan.lifecycle': 'Открой план тренировки',
};

function getSectionStartCommand(task) {
  return (
    ONBOARDING_TASK_START_COMMANDS[task.key] ||
    ONBOARDING_ROUTE_START_COMMANDS[task.route] ||
    `Открой «${task.title}»`
  );
}

function makeSectionOverviewBlock(task, screenshot) {
  const sectionName = screenshot?.alt || screenshot?.caption || task.title;

  return {
    title: getSectionStartCommand(task),
    type: 'overview',
    text:
      'Сначала открой этот экран в CRM. Это стартовая точка урока; дальше будут конкретные действия и проверка результата.',
    ...(sectionName ? { items: [sectionName] } : {}),
    screenshotIndex: 0,
  };
}

function cleanInstructionScreenshot(screenshot) {
  return {
    alt: screenshot.alt,
    caption: screenshot.caption,
    kind: 'overview',
    src: screenshot.src,
  };
}

function normalizeSectionFirstBlock(block) {
  const { screenshotIndex, screenshotIndices, ...rest } = block;

  if (Number.isInteger(screenshotIndex)) {
    if (screenshotIndex === 0) {
      return {
        ...rest,
        screenshotRequired: false,
      };
    }

    return {
      ...rest,
      screenshotIndex,
    };
  }

  if (Array.isArray(screenshotIndices)) {
    const nextIndices = screenshotIndices.filter(
      (index) => Number.isInteger(index) && index > 0,
    );

    if (nextIndices.length > 0) {
      return {
        ...rest,
        screenshotIndices: nextIndices,
      };
    }

    return {
      ...rest,
      screenshotRequired: false,
    };
  }

  return rest;
}

function convertLessonToSectionFirstFormat(task) {
  if (
    !task.lesson ||
    task.lesson.format === 'section-first-cards'
  ) {
    return;
  }

  const sourceScreenshots = Array.isArray(task.lesson.screenshots)
    ? task.lesson.screenshots
    : [];
  if (sourceScreenshots.length === 0) return;

  const screenshots = sourceScreenshots.map(cleanInstructionScreenshot);
  const blocks = (task.lesson.blocks || []).map(normalizeSectionFirstBlock);

  task.lesson = {
    ...task.lesson,
    blocks: [makeSectionOverviewBlock(task, screenshots[0]), ...blocks],
    format: 'section-first-cards',
    screenshots,
  };
}

function stampLessonUpdatedAt(task) {
  if (!task.lesson) return;

  task.lesson = {
    ...task.lesson,
    updatedAt:
      task.lesson.updatedAt ||
      task.updatedAt ||
      ONBOARDING_CONTENT_UPDATED_AT,
  };
}

const onboardingCatalog = {
  admin: {
    role: 'admin',
    title: 'Администратор: уверенная смена',
    description:
      'Базовый путь для администратора: клиенты, бронирования, оплата, отмены, звонки и контроль смены.',
    levelLabel: 'Базовый уровень',
    completionBadge: 'Смена под контролем',
    outcomes: [
      'Самостоятельно вести смену',
      'Создавать и сопровождать брони без помощи менеджера',
      'Фиксировать звонки и клиентские действия в CRM',
    ],
    missions: [
      {
        key: 'admin.shift-basics',
        title: 'Старт смены',
        description: 'Открыть монитор входов и зафиксировать рабочий контекст смены.',
        tasks: [
          {
            key: 'admin.access.create-visit',
            title: 'Создать вход гостя вручную',
            description: 'Найти или создать гостя в мониторе входов и зафиксировать посещение.',
            route: '/admin',
            kind: 'action',
            skills: ['Входы', 'Смена'],
            badge: 'Монитор входов',
            estimatedMinutes: 4,
            rewardXp: 30,
            checkpoint: { event: 'access.visit_created' },
            lesson: {
              title: 'Как вручную создать вход гостя',
              summary:
                'Ручной вход нужен, когда гостя надо провести без QR-скана или быстро восстановить посещение на смене.',
              blocks: [
                {
                  screenshotIndex: 0,
                  title: 'Открой монитор входов',
                  type: 'step',
                  text: 'Монитор входов показывает текущую смену, активные визиты и контекст по гостям. С него администратор начинает ручное оформление посещения.',
                },
                {
                  screenshotIndex: 1,
                  title: 'Проверь клиента и цель визита',
                  type: 'step',
                  text: 'Перед созданием визита найди существующего клиента или создай нового, затем укажи цель визита и номер ключа, если он используется на смене.',
                  items: [
                    'Не создавай дубль, если клиент уже есть в базе.',
                    'Цель визита влияет на аналитику посещений.',
                    'Номер ключа помогает корректно закрыть посещение позже.',
                  ],
                },
                {
                  title: 'Что проверить после создания',
                  type: 'paragraph',
                  text: 'После сохранения убедись, что визит появился в активных входах, а клиент, цель визита и время входа выглядят корректно.',
                },
              ],
              screenshots: [
                {
                  src: '/onboarding/admin/access-create-visit/monitor.png',
                  alt: 'Монитор входов администратора',
                  caption: 'Начинай ручной вход с монитора текущей смены.',
                },
                {
                  src: '/onboarding/admin/access-create-visit/manual-visit-context.png',
                  alt: 'Контекст ручного создания визита',
                  caption: 'Проверь клиента, цель визита и номер ключа перед сохранением.',
                },
              ],
            },
            trainingMode: { recommended: true },
          },
          {
            key: 'admin.client.create',
            title: 'Создать клиента из обращения',
            description: 'Добавить клиента с телефоном, источником и заметкой по первому контакту.',
            route: '/admin/clients',
            kind: 'action',
            skills: ['Клиенты', 'Коммуникация'],
            badge: 'Первичный контакт',
            estimatedMinutes: 5,
            rewardXp: 35,
            checkpoint: {
              event: 'client.created',
              conditions: { taskKey: 'admin.client.create' },
            },
            lesson: {
              title: 'Как создать клиента из первого обращения',
              summary:
                'Урок показывает, как открыть форму клиента, заполнить обязательный минимум и проверить сохраненную карточку.',
              blocks: [
                {
                  screenshotIndex: 0,
                  title: 'Что нажать: открыть форму клиента',
                  type: 'step',
                  text:
                    'Открой раздел «Клиенты» и нажми кнопку «Клиент» в правой верхней части страницы. Используй этот сценарий, когда человек впервые позвонил, написал или подошел на ресепшн.',
                  items: [
                    'Сначала проверь список и поиск, чтобы не создать дубль.',
                    'Кнопка «Клиент» открывает форму новой карточки.',
                  ],
                },
                {
                  screenshotIndex: 1,
                  title: 'Что заполнить: данные первого обращения',
                  type: 'step',
                  text:
                    'В форме внеси минимальный набор, по которому CRM сможет найти клиента и передать контекст следующему сотруднику.',
                  items: [
                    'Имя: полное имя клиента из обращения.',
                    'Телефон: номер, по которому можно связаться и проверить дубли.',
                    'Источник: канал, откуда пришел клиент.',
                    'Заметка: короткий контекст обращения для следующего сотрудника.',
                    'После заполнения нажми «Сохранить».',
                  ],
                },
                {
                  screenshotIndex: 2,
                  title: 'Как проверить результат: клиент сохранен',
                  type: 'step',
                  text:
                    'После сохранения вернись к списку клиентов и найди карточку по имени или телефону. Результат засчитан, если клиент найден, телефон отображается в едином формате, источник и заметка сохранились в карточке.',
                  items: [
                    'Если CRM предупреждает о дубле, не создавай вторую карточку.',
                    'Если источник не выбран, открой форму редактирования и поправь карточку сразу.',
                  ],
                },
              ],
              screenshots: [
                {
                  src: '/onboarding/admin/client-create/client-list.png',
                  alt: 'Список клиентов с кнопкой создания клиента',
                  caption:
                    'На скриншоте видны раздел «Клиенты», кнопка создания клиента и поиск для проверки дублей.',
                  calloutsEmbedded: true,
                  callouts: [
                    { height: 5.6, label: '1', labelX: 90.7, labelY: 1.6, text: 'Кнопка создания новой карточки клиента.', width: 8, x: 90.8, y: 1.8 },
                    { height: 6, label: '2', labelX: 5.4, labelY: 25.5, text: 'Поиск по базе перед созданием, чтобы не сделать дубль.', width: 53.4, x: 5.6, y: 27 },
                    { height: 6.6, label: '3', labelX: 59.8, labelY: 22.3, text: 'Фильтры источника, сегмента и статуса.', width: 34.4, x: 60, y: 26.9 },
                  ],
                },
                {
                  src: '/onboarding/admin/client-create/client-form.png',
                  alt: 'Форма создания клиента с ключевыми полями',
                  caption:
                    'На скриншоте видны ключевые поля формы: имя, телефон, источник, заметка и кнопка сохранения.',
                  calloutsEmbedded: true,
                  callouts: [
                    { height: 5.3, label: '1', labelX: 1.8, labelY: 17.8, text: 'Поле имени клиента.', width: 47.8, x: 2, y: 21 },
                    { height: 5.3, label: '2', labelX: 50.8, labelY: 17.8, text: 'Телефон для связи и проверки дублей.', width: 47.8, x: 51, y: 21 },
                    { height: 5.3, label: '3', labelX: 1.8, labelY: 29.7, text: 'Источник первого обращения.', width: 16.6, x: 2, y: 33 },
                    { height: 19.6, label: '4', labelX: 1.8, labelY: 66.8, text: 'Заметка с коротким контекстом обращения.', width: 96.4, x: 1.8, y: 70 },
                    { height: 5.4, label: '5', labelX: 1.8, labelY: 91.5, text: 'Кнопка сохранения карточки.', width: 96.4, x: 1.8, y: 92.7 },
                  ],
                },
                {
                  src: '/onboarding/admin/client-create/result-list.png',
                  alt: 'Список клиентов после сохранения карточки',
                  caption:
                    'На скриншоте видны сохраненная строка клиента, телефон, источник и действия для проверки карточки.',
                  calloutsEmbedded: true,
                  callouts: [
                    { height: 18.6, label: '1', labelX: 0.6, labelY: 10.8, text: 'Имя сохраненного клиента в списке.', width: 20.8, x: 0.8, y: 11.2 },
                    { height: 18.6, label: '2', labelX: 22.4, labelY: 10.8, text: 'Телефон в карточке клиента.', width: 15.8, x: 22.6, y: 11.2 },
                    { height: 18.6, label: '3', labelX: 38.7, labelY: 10.8, text: 'Источник, который помогает понять канал обращения.', width: 16.8, x: 38.9, y: 11.2 },
                    { height: 15.8, label: '4', labelX: 92.1, labelY: 14.4, text: 'Действия для открытия или проверки карточки.', width: 6.8, x: 92.3, y: 14.8 },
                  ],
                },
              ],
            },
            practice: {
              enabled: false,
            },
            trainingMode: { recommended: true },
          },
        ],
      },
      {
        key: 'admin.bookings',
        title: 'Бронирования',
        description: 'Полный цикл телефонной брони: создать, перенести, оплатить и отменить.',
        tasks: [
          {
            key: 'admin.booking.create-phone',
            title: 'Создать бронь по телефону',
            description: 'Создать бронь с источником phone, клиентом, временем, ресурсом и статусом.',
            route: '/admin/bookings',
            kind: 'action',
            skills: ['Бронирования', 'Телефон'],
            badge: 'Телефонная бронь',
            estimatedMinutes: 6,
            rewardXp: 45,
            checkpoint: {
              event: 'booking.created',
              conditions: { source: 'phone' },
            },
            lesson: {
              title: 'Как создать бронь по телефону',
              summary:
                'Урок показывает, как открыть расписание, заполнить телефонную бронь и проверить, что она появилась без конфликта.',
              blocks: [
                {
                  screenshotIndex: 0,
                  title: 'Что нажать: выбрать день и открыть бронь',
                  type: 'step',
                  text:
                    'Открой «Бронирование», выбери нужную дату и найди свободное время на подходящем корте. Создание можно начать кнопкой «Бронь» или свободным слотом, если экран поддерживает быстрый выбор.',
                  items: [
                    'Сверь дату с запросом клиента до открытия формы.',
                    'Проверь, что выбранный корт свободен на всю длительность занятия.',
                  ],
                },
                {
                  screenshotIndex: 1,
                  title: 'Что заполнить: параметры телефонной брони',
                  type: 'step',
                  text:
                    'В форме заполни данные, которые нужны смене для встречи клиента и контроля оплаты. Источник должен показывать, что бронь создана по телефону. Если CRM показывает предупреждение о конфликте, оплате, активном абонементе или сертификате, сначала разбери предупреждение, а потом сохраняй бронь.',
                  items: [
                    'Телефон и имя клиента: используй данные из звонка.',
                    'Дата, время, длительность и корт: должны совпадать с договоренностью.',
                    'Источник: «Телефон».',
                    'Статус, цена и оплата: ставь только фактическое состояние.',
                    'Если клиент найден, используй ссылку «Карточка клиента» для проверки истории и предоплат.',
                    'Для групповой тренировки добавь участников группы и проверь их список перед сохранением.',
                    'Комментарий: добавь важные детали, например просьбу перезвонить или подготовить инвентарь.',
                    'После заполнения нажми «Создать бронь».',
                  ],
                },
                {
                  screenshotIndex: 2,
                  title: 'Как проверить результат: бронь в расписании',
                  type: 'step',
                  text:
                    'После сохранения посмотри на сетку и список броней дня. Бронь должна стоять в правильном времени и корте, не пересекаться с соседними слотами, иметь понятный статус оплаты и показывать участников, если это групповая тренировка.',
                  items: [
                    'Если время или корт не совпали, открой бронь и исправь до подтверждения клиенту.',
                    'Если появилась накладка, не оставляй ее в расписании без решения менеджера.',
                  ],
                },
              ],
              screenshots: [
                {
                  src: '/onboarding/admin/booking-create-phone/schedule.png',
                  alt: 'Расписание бронирования',
                  caption:
                    'На скриншоте видны выбор даты, кнопка «Бронь» и сетка расписания: пустые места подходят для новой брони, занятые карточки не трогаем.',
                  calloutsEmbedded: true,
                  callouts: [
                    { height: 4.4, label: '1', labelX: 44, labelY: 4.2, text: 'Выбор даты расписания.', width: 11.6, x: 44.1, y: 4.4 },
                    { height: 4.6, label: '2', labelX: 41.8, labelY: 8.8, text: 'Кнопка создания брони.', width: 7.2, x: 42, y: 9.1 },
                  ],
                },
                {
                  src: '/onboarding/admin/booking-create-phone/booking-form.png',
                  alt: 'Форма создания брони',
                  caption:
                    'На скриншоте форма брони с датой, временем, длительностью, клиентом, источником и кнопкой создания.',
                  calloutsEmbedded: true,
                  callouts: [
                    { height: 4.2, label: '1', labelX: 19.8, labelY: 29.7, text: 'Дата и время брони.', width: 29.2, x: 20, y: 32 },
                    { height: 4.2, label: '2', labelX: 62.8, labelY: 24.4, text: 'Длительность занятия.', width: 7.2, x: 50.4, y: 32 },
                    { height: 12.2, label: '3', labelX: 19.8, labelY: 37.7, text: 'Клиент, корт и тип занятия.', width: 60.6, x: 20, y: 40.3 },
                    { height: 4.6, label: '4', labelX: 28, labelY: 51.8, text: 'Источник «Телефон» и параметры оплаты.', width: 45.8, x: 32, y: 55.2 },
                    { height: 4.8, label: '5', labelX: 71.8, labelY: 74.7, text: 'Кнопка создания брони.', width: 9.6, x: 72, y: 77 },
                  ],
                },
                {
                  src: '/onboarding/admin/booking-create-phone/result-schedule.png',
                  alt: 'Расписание после сохранения телефонной брони',
                  caption:
                    'На скриншоте видна карточка брони в сетке: время, статус, тип занятия и состояние оплаты.',
                  calloutsEmbedded: true,
                  callouts: [
                    { height: 20.4, label: '1', labelX: 22.6, labelY: 12.4, text: 'Карточка брони целиком: время, тип занятия и клиент.', width: 24, x: 22.5, y: 12.4 },
                    { height: 5.7, label: '2', labelX: 39.8, labelY: 15, text: 'Статус брони внутри карточки.', width: 5.1, x: 39.8, y: 15 },
                    { height: 28, label: '3', labelX: 0.9, labelY: 71.3, text: 'Та же бронь в списке дня: время, клиент, статус и оплата.', width: 22.2, x: 1, y: 71.5 },
                  ],
                },
              ],
            },
            practice: {
              enabled: false,
            },
            trainingMode: { recommended: true },
          },
          {
            key: 'admin.booking.mark-paid',
            title: 'Отметить оплату брони',
            description: 'Поставить корректный способ оплаты и убедиться, что статус стал оплаченным.',
            route: '/admin/bookings',
            kind: 'action',
            skills: ['Бронирования', 'Оплата'],
            badge: 'Оплата без хвостов',
            estimatedMinutes: 3,
            rewardXp: 35,
            checkpoint: { event: 'booking.paid' },
            lesson: {
              title: 'Как отметить оплату брони',
              summary:
                'Оплата должна фиксироваться сразу, чтобы расписание, финансы и конец смены сходились без ручных уточнений.',
              blocks: [
                {
                  screenshotIndex: 0,
                  title: 'Найди нужную бронь',
                  type: 'step',
                  text: 'Открой день бронирования и найди бронь клиента по времени, корту и имени. Можно открыть бронь целиком или использовать быстрый значок оплаты прямо на карточке в сетке, если запись видна и ты точно сверил клиента.',
                },
                {
                  screenshotIndex: 1,
                  title: 'Проверь сумму и способ оплаты',
                  type: 'step',
                  text: 'Перед подтверждением оплаты сверь сумму, способ оплаты и статус. Если клиент оплатил частично, не ставь полную оплату.',
                  items: [
                    'Способ оплаты должен совпадать с фактическим платежом.',
                    'Сумма не должна превышать стоимость брони.',
                    'После сверки нажми кнопку сохранения оплаты.',
                  ],
                },
                {
                  title: 'После оплаты',
                  type: 'paragraph',
                  text: 'Проверь, что у брони изменился статус оплаты, неоплаченная сумма исчезла или уменьшилась, а запись больше не попадает в список неоплаченных броней дня.',
                },
              ],
              screenshots: [
                {
                  src: '/onboarding/admin/booking-mark-paid/schedule.png',
                  alt: 'Расписание для поиска брони',
                  caption: 'Сначала найди точную бронь в расписании.',
                },
                {
                  src: '/onboarding/admin/booking-mark-paid/day-bookings.png',
                  alt: 'Список броней дня',
                  caption: 'Сверь статус, сумму и способ оплаты у нужной записи.',
                },
              ],
            },
            trainingMode: { recommended: true },
          },
          {
            key: 'admin.booking.training-plan-link',
            title: 'Понять план тренировки в брони',
            description:
              'Открыть тренировочную бронь и увидеть, как из нее создается план тренировки для ответственного тренера.',
            route: '/admin/bookings',
            kind: 'review',
            skills: ['Бронирования', 'Тренировки'],
            badge: 'Связь с планом',
            estimatedMinutes: 4,
            rewardXp: 25,
            checkpoint: {
              event: 'booking.schedule_viewed',
              conditions: { taskKey: 'admin.booking.training-plan-link' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'admin.booking.move',
            title: 'Перенести бронь',
            description: 'Перенести бронь на другое время или ресурс и проверить, что конфликтов нет.',
            route: '/admin/bookings',
            kind: 'action',
            skills: ['Бронирования', 'Расписание'],
            badge: 'Чистое расписание',
            estimatedMinutes: 4,
            rewardXp: 35,
            checkpoint: { event: 'booking.moved' },
            lesson: {
              title: 'Как перенести бронь без конфликта',
              summary:
                'Перенос брони нужен, когда клиент меняет время или корт, а администратор должен сохранить расписание чистым.',
              blocks: [
                {
                  screenshotIndex: 0,
                  title: 'Найди свободное место',
                  type: 'step',
                  text: 'Перед переносом открой сетку расписания и проверь, что новое время действительно свободно для нужного корта. Если CRM подсвечивает конфликт с другой бронью или блокировкой, не сохраняй перенос до выбора свободного слота.',
                },
                {
                  screenshotIndex: 1,
                  title: 'Перенеси только нужную запись',
                  type: 'step',
                  text: 'Переноси конкретную бронь клиента, не меняя соседние записи. Открыть нужную запись можно кликом по карточке или быстрым значком редактирования на карточке. После переноса проверь дату, время, корт и длительность.',
                  items: [
                    'Новая позиция не должна пересекаться с другими бронями.',
                    'Причина переноса помогает восстановить историю изменения.',
                    'Клиент должен получить подтверждение нового времени.',
                  ],
                },
                {
                  title: 'Контроль после переноса',
                  type: 'paragraph',
                  text: 'После сохранения посмотри на расписание еще раз: старая ячейка должна освободиться, новая должна содержать эту же бронь.',
                },
              ],
              screenshots: [
                {
                  src: '/onboarding/admin/booking-move/schedule-grid.png',
                  alt: 'Сетка расписания для переноса брони',
                  caption: 'Сначала найди свободный слот в сетке расписания.',
                },
                {
                  src: '/onboarding/admin/booking-move/day-bookings.png',
                  alt: 'Брони дня для проверки переноса',
                  caption: 'После изменения сверь бронь в списке дня.',
                },
              ],
            },
            trainingMode: { recommended: true },
          },
          {
            key: 'admin.booking.cancel',
            title: 'Отменить бронь с причиной',
            description: 'Отменить бронь, указать причину и проверить, что она исчезла из активного расписания.',
            route: '/admin/bookings',
            kind: 'action',
            skills: ['Бронирования', 'Конфликты'],
            badge: 'Корректная отмена',
            estimatedMinutes: 3,
            rewardXp: 30,
            checkpoint: { event: 'booking.cancelled' },
            lesson: {
              title: 'Как отменить бронь с причиной',
              summary:
                'Отмена должна освобождать расписание и оставлять понятную причину, чтобы команда видела историю договоренности.',
              blocks: [
                {
                  screenshotIndex: 0,
                  title: 'Выбери правильную бронь',
                  type: 'step',
                  text: 'Найди бронь в расписании или списке дня и сверь клиента, время и корт. Отменить можно из открытой формы или быстрым значком отмены на карточке, но только после проверки, что это нужная запись.',
                },
                {
                  screenshotIndex: 1,
                  title: 'Укажи причину отмены',
                  type: 'step',
                  text: 'При отмене запиши короткую причину: клиент перенес планы, ошибка записи, дубль или другое объяснение. После проверки нажми «Отменить бронь».',
                  items: [
                    'Причина помогает менеджеру разбирать спорные ситуации.',
                    'После отмены слот должен освободиться для новой брони.',
                    'Если была оплата, проверь дальнейший процесс возврата отдельно.',
                  ],
                },
                {
                  title: 'Что проверить в конце',
                  type: 'paragraph',
                  text: 'Убедись, что отмененная бронь больше не мешает активному расписанию, а история действия осталась в системе.',
                },
              ],
              screenshots: [
                {
                  src: '/onboarding/admin/booking-cancel/day-bookings.png',
                  alt: 'Список броней дня для выбора записи',
                  caption: 'Сначала выбери именно ту бронь, которую нужно отменить.',
                },
                {
                  src: '/onboarding/admin/booking-cancel/schedule.png',
                  alt: 'Расписание после отмены брони',
                  caption: 'После отмены проверь, что слот доступен для новой записи.',
                },
              ],
            },
            trainingMode: { recommended: true },
          },
        ],
      },
      {
        key: 'admin.calls',
        title: 'Звонки и задачи',
        description: 'Обрабатывать назначенные обзвоны и фиксировать результат контакта.',
        tasks: [
          {
            key: 'admin.call-task.log-attempt',
            title: 'Зафиксировать результат звонка',
            description: 'Открыть задачу обзвона, выбрать клиента, поставить статус и написать саммари.',
            route: '/admin/call-tasks',
            kind: 'action',
            skills: ['Обзвоны', 'Коммуникация'],
            badge: 'Контакт зафиксирован',
            estimatedMinutes: 5,
            rewardXp: 40,
            checkpoint: { event: 'call_task.attempt_logged' },
            lesson: {
              title: 'Как зафиксировать результат звонка',
              summary:
                'Каждый звонок должен оставлять след: статус клиента, короткое саммари и следующий срок контакта, если он нужен.',
              blocks: [
                {
                  screenshotIndex: 0,
                  title: 'Открой задачу обзвона',
                  type: 'step',
                  text: 'На странице задач обзвона выбери нужную задачу и проверь, что работаешь с актуальным списком клиентов.',
                },
                {
                  screenshotIndex: 1,
                  title: 'Запиши попытку по клиенту',
                  type: 'step',
                  text: 'Открой клиента внутри задачи, выбери итоговый статус звонка и напиши короткое саммари разговора.',
                  items: [
                    'Статус показывает, что делать с клиентом дальше.',
                    'Саммари должно быть коротким, но полезным для следующего контакта.',
                    'Если нужен повторный звонок, укажи корректный срок.',
                  ],
                },
                {
                  title: 'После сохранения',
                  type: 'paragraph',
                  text: 'Проверь, что попытка появилась в истории клиента задачи, а счетчики задачи обновились.',
                },
              ],
              screenshots: [
                {
                  src: '/onboarding/admin/call-task-log-attempt/tasks-list.png',
                  alt: 'Список задач обзвона',
                  caption: 'Начинай с выбора актуальной задачи обзвона.',
                },
                {
                  src: '/onboarding/admin/call-task-log-attempt/task-detail.png',
                  alt: 'Карточка задачи обзвона',
                  caption: 'Фиксируй статус, саммари и следующий срок контакта.',
                },
              ],
            },
            trainingMode: { recommended: true },
          },
        ],
      },
      {
        key: 'admin.prepayments',
        title: 'Предоплаты на смене',
        description:
          'Понимать активные абонементы, сертификаты и быстрые действия администратора без доступа к финансовым настройкам.',
        tasks: [
          {
            key: 'admin.prepayments.dashboard-review',
            title: 'Открыть сводку предоплат',
            description:
              'Посмотреть доступные администратору блоки: активные абонементы, сертификаты и переходы к разрешенным деталям.',
            route: '/admin/prepayments',
            kind: 'review',
            skills: ['Предоплаты', 'Смена'],
            badge: 'Предоплаты найдены',
            estimatedMinutes: 5,
            rewardXp: 30,
            checkpoint: {
              event: 'prepayments.viewed',
              conditions: { taskKey: 'admin.prepayments.dashboard-review' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'admin.subscription.redemption-review',
            title: 'Списать занятие по абонементу',
            description:
              'Открыть карточку клиента, выбрать активный абонемент, оформить списание и проверить остаток.',
            route: '/admin/clients',
            kind: 'action',
            skills: ['Абонементы', 'Клиенты'],
            badge: 'Абонемент списан',
            estimatedMinutes: 6,
            rewardXp: 35,
            checkpoint: {
              event: 'clients.viewed',
              conditions: { taskKey: 'admin.subscription.redemption-review' },
            },
            practice: {
              enabled: false,
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'admin.certificate.redemption-review',
            title: 'Понять списание сертификата',
            description:
              'Открыть сертификаты, найти сертификат по коду или клиенту и понять, как читается остаток и история списаний.',
            route: '/admin/certificates',
            kind: 'review',
            skills: ['Сертификаты', 'Списания'],
            badge: 'Сертификат понятен',
            estimatedMinutes: 5,
            rewardXp: 30,
            checkpoint: {
              event: 'certificates.viewed',
              conditions: { taskKey: 'admin.certificate.redemption-review' },
            },
            trainingMode: { recommended: false },
          },
        ],
      },
      {
        key: 'admin.shift-review',
        title: 'Контроль расписания',
        description: 'Передать смену без сюрпризов: проверить расписание, статусы и ближайшие риски.',
        tasks: [
          {
            key: 'admin.shift-cash.opening-record',
            title: 'Зафиксировать кассу на начало смены',
            description:
              'Открыть активную смену, внести купюры, мелочь и комментарий по стартовому остатку.',
            route: '/admin/motivation',
            kind: 'action',
            skills: ['Касса', 'Смена'],
            badge: 'Начало кассы',
            estimatedMinutes: 4,
            rewardXp: 35,
            checkpoint: { event: 'shift_cash.opening_recorded' },
            trainingMode: { recommended: true },
          },
          {
            key: 'admin.shift-cash.expense-with-photo',
            title: 'Добавить расход из кассы с фото',
            description:
              'Внести сумму, категорию, описание, фото чека и проверить, что расход уменьшил ожидаемый остаток.',
            route: '/admin/motivation',
            kind: 'action',
            skills: ['Касса', 'Расходы'],
            badge: 'Расход с чеком',
            estimatedMinutes: 5,
            rewardXp: 40,
            checkpoint: { event: 'shift_cash.attachment_uploaded' },
            trainingMode: { recommended: true },
          },
          {
            key: 'admin.booking.review-schedule',
            title: 'Проверить расписание на смену',
            description: 'Открыть брони, посмотреть ближайшие слоты и убедиться, что статусы понятны.',
            route: '/admin/bookings',
            kind: 'review',
            skills: ['Расписание', 'Смена'],
            badge: 'Смена сверена',
            estimatedMinutes: 3,
            rewardXp: 25,
            checkpoint: {
              event: 'booking.schedule_viewed',
              conditions: { taskKey: 'admin.booking.review-schedule' },
            },
            lesson: {
              title: 'Как проверить расписание на смену',
              summary:
                'Перед и во время смены администратор должен видеть ближайшие брони, спорные статусы и возможные накладки.',
              blocks: [
                {
                  screenshotIndex: 0,
                  title: 'Посмотри день целиком',
                  type: 'step',
                  text: 'Открой страницу бронирования и оцени загруженность дня: где плотные места, где есть свободные окна, какие корты требуют внимания. На карточках брони смотри быстрые значки редактирования, подтверждения, прихода, оплаты и отмены.',
                },
                {
                  screenshotIndex: 1,
                  title: 'Проверь ближайшие брони',
                  type: 'step',
                  text: 'В списке броней дня сверь ближайшие записи, статусы, оплату, комментарии, ссылку на карточку клиента и участников группы. Так проще предупредить проблему до прихода клиента.',
                  items: [
                    'Особое внимание уделяй неоплаченным и перенесенным броням.',
                    'Предупреждения в форме помогают увидеть конфликт, неполную оплату и активные предоплаты клиента.',
                    'Проверяй, что длительность и корт совпадают с договоренностью.',
                    'Спорные записи лучше уточнить у менеджера до пика смены.',
                  ],
                },
                {
                  title: 'Передача смены',
                  type: 'paragraph',
                  text: 'Если в расписании есть риски, передай их следующему сотруднику: клиент, время, корт и что именно нужно проконтролировать.',
                },
              ],
              screenshots: [
                {
                  src: '/onboarding/admin/booking-review-schedule/schedule.png',
                  alt: 'Обзор расписания на день',
                  caption: 'Сначала оцени день целиком в сетке бронирования.',
                },
                {
                  src: '/onboarding/admin/booking-review-schedule/day-bookings.png',
                  alt: 'Брони дня для проверки смены',
                  caption: 'Затем проверь ближайшие записи, статусы и оплату.',
                },
              ],
            },
            trainingMode: { recommended: false },
          },
        ],
      },
    ],
  },

  manager: {
    role: 'manager',
    title: 'Менеджер: операционное управление',
    description:
      'Путь менеджера: клиентские базы, обзвоны, сотрудники, смены, мотивация и контроль результата.',
    levelLabel: 'Операционный уровень',
    completionBadge: 'Оператор роста',
    outcomes: [
      'Создавать сегменты клиентов',
      'Запускать и контролировать обзвоны',
      'Видеть операционные риски до конца смены',
    ],
    missions: [
      {
        key: 'manager.client-growth',
        title: 'Клиентская база и обзвоны',
        description: 'Собрать сегмент, запустить задачу и прочитать отчет по результату.',
        tasks: [
          {
            key: 'manager.client-base.create',
            title: 'Создать базу клиентов',
            description: 'Настроить сохраненный фильтр и срок прозвона для выбранного сегмента.',
            route: '/admin/client-bases',
            kind: 'action',
            skills: ['Сегментация', 'Клиенты'],
            badge: 'Сегмент собран',
            estimatedMinutes: 6,
            rewardXp: 45,
            checkpoint: { event: 'client_base.created' },
            trainingMode: { recommended: true },
          },
          {
            key: 'manager.call-task.create',
            title: 'Создать задачу обзвона',
            description: 'Сформировать задачу из базы, назначить исполнителя и проверить состав клиентов.',
            route: '/admin/call-tasks',
            kind: 'action',
            skills: ['Обзвоны', 'Делегирование'],
            badge: 'Обзвон запущен',
            estimatedMinutes: 5,
            rewardXp: 45,
            checkpoint: { event: 'call_task.created' },
            trainingMode: { recommended: true },
          },
          {
            key: 'manager.call-task.read-report',
            title: 'Проверить отчет по обзвону',
            description: 'Посмотреть контактность, запись, просрочки и количество попыток.',
            route: '/admin/call-tasks',
            kind: 'review',
            skills: ['Аналитика', 'Обзвоны'],
            badge: 'Контроль контакта',
            estimatedMinutes: 4,
            rewardXp: 30,
            checkpoint: { event: 'call_task.report_viewed' },
            trainingMode: { recommended: false },
          },
        ],
      },
      {
        key: 'manager.team-control',
        title: 'Команда и мотивация',
        description: 'Проверить смены, роли, мотивацию и операционные права.',
        tasks: [
          {
            key: 'manager.shift.approve',
            title: 'Проверить смену сотрудника',
            description: 'Открыть персонал, сверить смену и перевести ее в нужный статус.',
            route: '/admin/staff',
            kind: 'review',
            skills: ['Команда', 'Смены'],
            badge: 'Смена проверена',
            estimatedMinutes: 5,
            rewardXp: 35,
            checkpoint: { event: 'shift.approved' },
            trainingMode: { recommended: true },
          },
          {
            key: 'manager.shift-cash.reconciliation-review',
            title: 'Проверить кассовую сверку смены',
            description:
              'Открыть кассу активной смены, сверить начальный остаток, расходы, ожидаемый остаток и закрытие с комментарием при расхождении.',
            route: '/admin/motivation',
            kind: 'review',
            skills: ['Касса', 'Контроль смены'],
            badge: 'Касса сверена',
            estimatedMinutes: 6,
            rewardXp: 40,
            checkpoint: { event: 'shift_cash.closed' },
            trainingMode: { recommended: false },
          },
          {
            key: 'manager.motivation.update',
            title: 'Обновить правило мотивации',
            description: 'Проверить базовые правила и безопасно изменить одно значение.',
            route: '/admin/motivation',
            kind: 'action',
            skills: ['Мотивация', 'Правила'],
            badge: 'Правило настроено',
            estimatedMinutes: 5,
            rewardXp: 40,
            checkpoint: { event: 'motivation.rule_updated' },
            trainingMode: { recommended: true },
          },
        ],
      },
      {
        key: 'manager.training-methodology',
        title: 'Методика тренировок',
        description:
          'Понять методическую базу, планы, рекомендации и аналитику старшего тренера.',
        tasks: [
          {
            key: 'manager.methodology.review-base',
            title: 'Разобрать базу навыков и упражнений',
            description:
              'Открыть методику и понять, как навыки, направления, ступени упражнений и упражнения связаны между собой.',
            route: '/admin/methodology',
            kind: 'review',
            skills: ['Методика', 'Упражнения'],
            badge: 'Методика понятна',
            estimatedMinutes: 6,
            rewardXp: 35,
            checkpoint: { event: 'methodology.viewed' },
            trainingMode: { recommended: false },
          },
          {
            key: 'manager.methodology.analytics-review',
            title: 'Проверить аналитику методики',
            description:
              'Открыть аналитику старшего тренера и понять покрытие навыков, качество планов и отклонения от рекомендаций.',
            route: '/admin/methodology-analytics',
            kind: 'review',
            skills: ['Методика', 'Контроль качества'],
            badge: 'Контроль методики',
            estimatedMinutes: 7,
            rewardXp: 40,
            checkpoint: { event: 'methodology.analytics_viewed' },
            trainingMode: { recommended: false },
          },
        ],
      },
      {
        key: 'manager.prepayments-control',
        title: 'Предоплаты, абонементы и корпоративные балансы',
        description:
          'Разобраться в настройках продаж, очереди привязки, абонементах, сертификатах и корпоративных балансах.',
        tasks: [
          {
            key: 'manager.prepayments.sale-mapping',
            title: 'Понять настройки продаж Эвотора',
            description:
              'Открыть каталог и увидеть, как товар Эвотора становится обычной продажей, абонементом или сертификатом.',
            route: '/admin/catalog',
            kind: 'review',
            skills: ['Каталог', 'Предоплаты'],
            badge: 'Правила продаж понятны',
            estimatedMinutes: 7,
            rewardXp: 35,
            checkpoint: {
              event: 'catalog.viewed',
              conditions: { taskKey: 'manager.prepayments.sale-mapping' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'manager.prepayments.pending-sales',
            title: 'Разобрать очередь привязки продаж',
            description:
              'Понять, почему продажа абонемента или сертификата может ждать ручной привязки к клиенту.',
            route: '/admin/prepayments',
            kind: 'review',
            skills: ['Очередь продаж', 'Клиенты'],
            badge: 'Очередь понятна',
            estimatedMinutes: 6,
            rewardXp: 35,
            checkpoint: {
              event: 'prepayments.viewed',
              conditions: { taskKey: 'manager.prepayments.pending-sales' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'manager.subscriptions.types-review',
            title: 'Понять типы абонементов',
            description:
              'Открыть справочник товаров и увидеть, как тип абонемента задает количество занятий, срок, цену и формат тренировки.',
            route: '/admin/catalog',
            kind: 'review',
            skills: ['Абонементы', 'Настройки'],
            badge: 'Типы абонементов',
            estimatedMinutes: 7,
            rewardXp: 35,
            checkpoint: {
              event: 'catalog.viewed',
              conditions: { taskKey: 'manager.subscriptions.types-review' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'manager.certificates.review',
            title: 'Понять сертификаты',
            description:
              'Открыть сертификаты и разобраться в коде, типе сертификата, остатке, сроке действия и истории списаний.',
            route: '/admin/certificates',
            kind: 'review',
            skills: ['Сертификаты', 'Контроль'],
            badge: 'Сертификаты понятны',
            estimatedMinutes: 6,
            rewardXp: 35,
            checkpoint: {
              event: 'certificates.viewed',
              conditions: { taskKey: 'manager.certificates.review' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'manager.corporate.review',
            title: 'Понять корпоративные балансы',
            description:
              'Открыть корпоративных клиентов и понять, как пополнение, списание и экспорт детализации связаны с балансом.',
            route: '/admin/corporate-clients',
            kind: 'review',
            skills: ['Корпоративные клиенты', 'Баланс'],
            badge: 'Корпоративный контур',
            estimatedMinutes: 7,
            rewardXp: 40,
            checkpoint: {
              event: 'corporate_clients.viewed',
              conditions: { taskKey: 'manager.corporate.review' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'manager.prepayments.dashboard-review',
            title: 'Прочитать единый экран предоплат',
            description:
              'Открыть сводный экран и понять статусы, фильтры, сроки и быстрые переходы по абонементам, сертификатам и корпоративным балансам.',
            route: '/admin/prepayments',
            kind: 'review',
            skills: ['Предоплаты', 'Контроль'],
            badge: 'Сводка прочитана',
            estimatedMinutes: 7,
            rewardXp: 40,
            checkpoint: {
              event: 'prepayments.viewed',
              conditions: { taskKey: 'manager.prepayments.dashboard-review' },
            },
            trainingMode: { recommended: false },
          },
        ],
      },
      {
        key: 'manager.operations-review',
        title: 'Операционный контроль',
        description: 'Сверить справочники, отчеты и загрузку, чтобы увидеть проблему до конца дня.',
        tasks: [
          {
            key: 'manager.manager-control.daily-review',
            title: 'Разобрать ежедневную очередь контроля',
            description:
              'Открыть контроль менеджера и проверить очереди по броням, звонкам, предоплатам и корпоративным остаткам.',
            route: '/admin/manager-control',
            kind: 'review',
            skills: ['Операционный контроль', 'Очередь дня'],
            badge: 'Очередь дня разобрана',
            estimatedMinutes: 6,
            rewardXp: 40,
            checkpoint: {
              event: 'manager_control.viewed',
              conditions: { taskKey: 'manager.manager-control.daily-review' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'manager.references.review',
            title: 'Проверить справочники клуба',
            description: 'Открыть справочники и убедиться, что ключевые значения доступны команде.',
            route: '/admin/references',
            kind: 'review',
            skills: ['Справочники', 'Контроль данных'],
            badge: 'Справочники сверены',
            estimatedMinutes: 3,
            rewardXp: 25,
            checkpoint: { event: 'reference.viewed' },
            trainingMode: { recommended: false },
          },
          {
            key: 'manager.visits-analytics.review',
            title: 'Разобрать глубокую аналитику посещений',
            description:
              'Прочитать четыре вкладки, собрать сегмент клиентов и передать его в задачу обзвона.',
            route: '/admin/visits-analytics',
            kind: 'review',
            skills: ['Посещения', 'Сегменты', 'Обзвон'],
            badge: 'Сегмент передан',
            estimatedMinutes: 10,
            rewardXp: 45,
            checkpoint: {
              event: 'report.viewed',
              conditions: { report: 'visits_analytics' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'manager.utilization.review',
            title: 'Найти провалы загрузки',
            description: 'Открыть утилизацию и отметить дни, где нужна акция, обзвон или перенос ресурсов.',
            route: '/admin/utilization',
            kind: 'review',
            skills: ['Утилизация', 'Операции'],
            badge: 'Провалы найдены',
            estimatedMinutes: 4,
            rewardXp: 30,
            checkpoint: { event: 'utilization.viewed' },
            trainingMode: { recommended: false },
          },
        ],
      },
    ],
  },

  owner: {
    role: 'owner',
    title: 'Владелец: контроль клуба',
    description:
      'Путь владельца: роли, аудит, финансы, утилизация, мотивация и обзор здоровья клуба.',
    levelLabel: 'Контрольный уровень',
    completionBadge: 'Панель владельца',
    outcomes: [
      'Понимать, кто и что может делать в CRM',
      'Контролировать деньги, загрузку и операционные изменения',
      'Проходить обучение за любую роль без потери прав владельца',
    ],
    missions: [
      {
        key: 'owner.access-governance',
        title: 'Доступы и контроль',
        description: 'Проверить пользователей, роли и журнал действий.',
        tasks: [
          {
            key: 'owner.account.create',
            title: 'Создать пользователя CRM',
            description: 'Добавить аккаунт, выбрать роль и привязать сотрудника при необходимости.',
            route: '/admin/users',
            kind: 'action',
            skills: ['Доступы', 'Команда'],
            badge: 'Доступ выдан',
            estimatedMinutes: 5,
            rewardXp: 45,
            checkpoint: { event: 'account.created' },
            trainingMode: { recommended: true },
          },
          {
            key: 'owner.audit.review',
            title: 'Проверить журнал действий',
            description: 'Найти изменения по пользователю или модулю и понять, кто выполнил действие.',
            route: '/admin/audit',
            kind: 'review',
            skills: ['Аудит', 'Риски'],
            badge: 'След найден',
            estimatedMinutes: 4,
            rewardXp: 30,
            checkpoint: { event: 'audit.viewed' },
            trainingMode: { recommended: false },
          },
          {
            key: 'owner.onboarding.review-training-data',
            title: 'Проверить учебные данные роли',
            description: 'Открыть обучение, выбрать роль и убедиться, что учебные записи отделены от боевых.',
            route: '/admin/onboarding',
            kind: 'review',
            skills: ['Обучение', 'Безопасность данных'],
            badge: 'Учебные данные',
            estimatedMinutes: 4,
            rewardXp: 35,
            checkpoint: {
              event: 'report.viewed',
              conditions: { report: 'onboarding_training_data' },
            },
            trainingMode: { recommended: false },
          },
        ],
      },
      {
        key: 'owner.training-methodology',
        title: 'Методика и качество тренировок',
        description:
          'Проверить, как CRM хранит методику, строит планы тренировок и показывает аналитику старшего тренера.',
        tasks: [
          {
            key: 'owner.methodology.review-base',
            title: 'Понять методическую базу CRM',
            description:
              'Открыть методику и увидеть, как навыки, упражнения, статусы и уровни используются в тренировочном контуре.',
            route: '/admin/methodology',
            kind: 'review',
            skills: ['Методика', 'Контроль данных'],
            badge: 'База методики',
            estimatedMinutes: 6,
            rewardXp: 40,
            checkpoint: { event: 'methodology.viewed' },
            trainingMode: { recommended: false },
          },
          {
            key: 'owner.methodology.analytics-review',
            title: 'Прочитать аналитику старшего тренера',
            description:
              'Открыть аналитику методики и проверить, как CRM считает покрытие навыков, выполнение планов и отклонения.',
            route: '/admin/methodology-analytics',
            kind: 'review',
            skills: ['Аналитика', 'Тренировки'],
            badge: 'Аналитика методики',
            estimatedMinutes: 7,
            rewardXp: 45,
            checkpoint: { event: 'methodology.analytics_viewed' },
            trainingMode: { recommended: false },
          },
        ],
      },
      {
        key: 'owner.prepayments-governance',
        title: 'Предоплаты и обязательства клуба',
        description:
          'Понять, где CRM показывает проданные, но еще не отработанные услуги: абонементы, сертификаты и корпоративные балансы.',
        tasks: [
          {
            key: 'owner.prepayments.dashboard-review',
            title: 'Прочитать сводку предоплат',
            description:
              'Открыть единый экран и проверить активные абонементы, сертификаты, очередь продаж и корпоративные остатки.',
            route: '/admin/prepayments',
            kind: 'review',
            skills: ['Предоплаты', 'Контроль'],
            badge: 'Обязательства видны',
            estimatedMinutes: 7,
            rewardXp: 45,
            checkpoint: {
              event: 'prepayments.viewed',
              conditions: { taskKey: 'owner.prepayments.dashboard-review' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'owner.prepayments.sale-mapping',
            title: 'Проверить правила продаж Эвотора',
            description:
              'Открыть каталог и понять, какие товары создают обычные продажи, абонементы или сертификаты.',
            route: '/admin/catalog',
            kind: 'review',
            skills: ['Каталог', 'Эвотор'],
            badge: 'Правила продаж',
            estimatedMinutes: 7,
            rewardXp: 40,
            checkpoint: {
              event: 'catalog.viewed',
              conditions: { taskKey: 'owner.prepayments.sale-mapping' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'owner.subscriptions.lifecycle-review',
            title: 'Понять жизненный цикл абонемента',
            description:
              'Открыть клиента и понять, как продажа превращается в активный абонемент, списания, остаток и статус.',
            route: '/admin/clients',
            kind: 'review',
            skills: ['Абонементы', 'Клиенты'],
            badge: 'Цикл абонемента',
            estimatedMinutes: 7,
            rewardXp: 40,
            checkpoint: {
              event: 'clients.viewed',
              conditions: { taskKey: 'owner.subscriptions.lifecycle-review' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'owner.certificates.lifecycle-review',
            title: 'Понять жизненный цикл сертификата',
            description:
              'Открыть сертификаты и увидеть код, тип, остаток, срок действия, списания и отмену ошибочного списания.',
            route: '/admin/certificates',
            kind: 'review',
            skills: ['Сертификаты', 'Контроль'],
            badge: 'Цикл сертификата',
            estimatedMinutes: 6,
            rewardXp: 40,
            checkpoint: {
              event: 'certificates.viewed',
              conditions: { taskKey: 'owner.certificates.lifecycle-review' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'owner.corporate.lifecycle-review',
            title: 'Понять корпоративный баланс',
            description:
              'Открыть корпоративных клиентов и проверить, как баланс складывается из пополнений, списаний, отмен и экспорта детализации.',
            route: '/admin/corporate-clients',
            kind: 'review',
            skills: ['Корпоративные клиенты', 'Финансы'],
            badge: 'Баланс понятен',
            estimatedMinutes: 8,
            rewardXp: 45,
            checkpoint: {
              event: 'corporate_clients.viewed',
              conditions: { taskKey: 'owner.corporate.lifecycle-review' },
            },
            trainingMode: { recommended: false },
          },
        ],
      },
      {
        key: 'owner.club-health',
        title: 'Здоровье клуба',
        description: 'Смотреть деньги, загрузку кортов и мотивацию команды.',
        tasks: [
          {
            key: 'owner.manager-control.daily-review',
            title: 'Проверить ежедневную очередь менеджера',
            description:
              'Открыть контроль менеджера и увидеть операционные хвосты дня: проблемные брони, звонки, предоплаты и корпоративные балансы.',
            route: '/admin/manager-control',
            kind: 'review',
            skills: ['Операционный контроль', 'Риски дня'],
            badge: 'Очередь рисков видна',
            estimatedMinutes: 6,
            rewardXp: 40,
            checkpoint: {
              event: 'manager_control.viewed',
              conditions: { taskKey: 'owner.manager-control.daily-review' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'owner.finance.review',
            title: 'Прочитать P&L',
            description: 'Открыть финансы, выбрать период и проверить доходы, расходы и маржу.',
            route: '/admin/finances',
            kind: 'review',
            skills: ['Финансы', 'Прибыль'],
            badge: 'P&L прочитан',
            estimatedMinutes: 5,
            rewardXp: 40,
            checkpoint: { event: 'finance.report_viewed' },
            trainingMode: { recommended: false },
          },
          {
            key: 'owner.shift-cash.control-review',
            title: 'Проверить контроль наличной кассы',
            description:
              'Открыть кассу смены, прочитать остатки, расходы, расхождение и убедиться, что кассовые расходы попали в финансовый контур.',
            route: '/admin/motivation',
            kind: 'review',
            skills: ['Касса', 'Финансы'],
            badge: 'Касса под контролем',
            estimatedMinutes: 6,
            rewardXp: 40,
            checkpoint: { event: 'shift_cash.closed' },
            trainingMode: { recommended: false },
          },
          {
            key: 'owner.utilization.review',
            title: 'Проверить утилизацию кортов',
            description: 'Посмотреть загрузку по дням и понять, где есть свободная емкость.',
            route: '/admin/utilization',
            kind: 'review',
            skills: ['Утилизация', 'Стратегия'],
            badge: 'Емкость найдена',
            estimatedMinutes: 4,
            rewardXp: 35,
            checkpoint: { event: 'utilization.viewed' },
            trainingMode: { recommended: false },
          },
          {
            key: 'owner.motivation.review',
            title: 'Проверить мотивацию',
            description: 'Открыть правила мотивации и понять, как начисления связаны с продажами.',
            route: '/admin/motivation',
            kind: 'review',
            skills: ['Мотивация', 'Контроль'],
            badge: 'Стимулы понятны',
            estimatedMinutes: 5,
            rewardXp: 35,
            checkpoint: { event: 'motivation.rule_updated' },
            trainingMode: { recommended: true },
          },
          {
            key: 'owner.operations.review-visits',
            title: 'Проверить посещения, источники и LTV',
            description:
              'Прочитать глубокую аналитику посещений, собрать клиентскую базу из сегмента и передать ее в обзвон.',
            route: '/admin/visits-analytics',
            kind: 'review',
            skills: ['Посещения', 'LTV', 'Сегменты'],
            badge: 'Трафик разобран',
            estimatedMinutes: 10,
            rewardXp: 45,
            checkpoint: {
              event: 'report.viewed',
              conditions: { report: 'visits_analytics' },
            },
            trainingMode: { recommended: false },
          },
        ],
      },
    ],
  },

  accountant: {
    role: 'accountant',
    title: 'Бухгалтер: финансовый контур',
    description:
      'Путь бухгалтера: P&L, ручные операции, категории, справочник товаров, экспорт и сверка начислений.',
    levelLabel: 'Финансовый уровень',
    completionBadge: 'Финансовый контур',
    outcomes: [
      'Вести ручные финансовые операции',
      'Поддерживать категории и товарные правила',
      'Готовить выгрузки и сверку начислений',
    ],
    missions: [
      {
        key: 'accountant.finance',
        title: 'Финансы и сверка',
        description: 'Проверять P&L, добавлять ручные операции и выгружать данные.',
        tasks: [
          {
            key: 'accountant.finance.review',
            title: 'Проверить P&L за период',
            description: 'Выбрать период, сверить доходы, расходы и итоговую прибыль.',
            route: '/admin/finances',
            kind: 'review',
            skills: ['Финансы', 'P&L'],
            badge: 'Баланс прочитан',
            estimatedMinutes: 5,
            rewardXp: 35,
            checkpoint: { event: 'finance.report_viewed' },
            trainingMode: { recommended: false },
          },
          {
            key: 'accountant.shift-cash.finance-review',
            title: 'Сверить кассовые расходы в P&L',
            description:
              'Открыть финансы, найти расход, созданный из кассы смены, и проверить категорию, сумму, дату и комментарий.',
            route: '/admin/finances',
            kind: 'review',
            skills: ['Касса', 'P&L'],
            badge: 'Расход сверён',
            estimatedMinutes: 5,
            rewardXp: 35,
            checkpoint: { event: 'finance.report_viewed' },
            trainingMode: { recommended: false },
          },
          {
            key: 'accountant.finance.manual-record',
            title: 'Создать ручную операцию',
            description: 'Добавить доход или расход с категорией, датой и комментарием.',
            route: '/admin/finances',
            kind: 'action',
            skills: ['Финансы', 'Ручные операции'],
            badge: 'Операция внесена',
            estimatedMinutes: 4,
            rewardXp: 40,
            checkpoint: { event: 'finance.record_created' },
            trainingMode: { recommended: true },
          },
          {
            key: 'accountant.finance.export',
            title: 'Сделать экспорт отчета',
            description: 'Скачать финансовую выгрузку за выбранный период.',
            route: '/admin/finances',
            kind: 'action',
            skills: ['Экспорт', 'Отчетность'],
            badge: 'Отчет выгружен',
            estimatedMinutes: 3,
            rewardXp: 30,
            checkpoint: { event: 'report.exported' },
            trainingMode: { recommended: false },
          },
          {
            key: 'accountant.visits-analytics.review',
            title: 'Сверить выручку и LTV посещений',
            description:
              'Открыть аналитику посещений, прочитать вкладки выручки и LTV, применить фильтры и экспортировать отчет без рабочих действий с базами.',
            route: '/admin/visits-analytics',
            kind: 'review',
            skills: ['Посещения', 'LTV', 'Сверка'],
            badge: 'LTV прочитан',
            estimatedMinutes: 8,
            rewardXp: 35,
            checkpoint: {
              event: 'report.viewed',
              conditions: { report: 'visits_analytics' },
            },
            trainingMode: { recommended: false },
          },
        ],
      },
      {
        key: 'accountant.catalog',
        title: 'Справочник и начисления',
        description: 'Поддерживать категории, товарные правила и сверку payroll.',
        tasks: [
          {
            key: 'accountant.catalog.update-category',
            title: 'Обновить финансовую категорию',
            description: 'Проверить категорию, группу P&L и процент комиссии.',
            route: '/admin/catalog',
            kind: 'action',
            skills: ['Каталог', 'Категории'],
            badge: 'Категория сверена',
            estimatedMinutes: 5,
            rewardXp: 35,
            checkpoint: { event: 'catalog.category_updated' },
            trainingMode: { recommended: true },
          },
          {
            key: 'accountant.catalog.update-rule',
            title: 'Проверить правило сопоставления',
            description: 'Сверить товарное правило, категорию P&L и корректность будущих начислений.',
            route: '/admin/catalog',
            kind: 'action',
            skills: ['Каталог', 'Правила'],
            badge: 'Правило сопоставлено',
            estimatedMinutes: 5,
            rewardXp: 35,
            checkpoint: { event: 'catalog.rule_updated' },
            trainingMode: { recommended: true },
          },
          {
            key: 'accountant.payroll.review',
            title: 'Проверить начисления сотрудникам',
            description: 'Открыть расчет начислений и сверить период перед оплатой.',
            route: '/admin/staff',
            kind: 'review',
            skills: ['Начисления', 'Сверка'],
            badge: 'Начисления проверены',
            estimatedMinutes: 6,
            rewardXp: 40,
            checkpoint: { event: 'payroll.reviewed' },
            trainingMode: { recommended: false },
          },
        ],
      },
      {
        key: 'accountant.prepayments',
        title: 'Предоплаты и корпоративные деньги',
        description:
          'Проверять, как корпоративные балансы связаны с финансовым контуром CRM.',
        tasks: [
          {
            key: 'accountant.prepayments.dashboard-review',
            title: 'Прочитать сводку корпоративных балансов',
            description:
              'Открыть единый экран предоплат и понять доступный бухгалтеру блок корпоративных остатков.',
            route: '/admin/prepayments',
            kind: 'review',
            skills: ['Корпоративные клиенты', 'Финансы'],
            badge: 'Корпоративные остатки',
            estimatedMinutes: 6,
            rewardXp: 35,
            checkpoint: {
              event: 'prepayments.viewed',
              conditions: { taskKey: 'accountant.prepayments.dashboard-review' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'accountant.corporate.deposit-review',
            title: 'Понять корпоративное пополнение',
            description:
              'Открыть корпоративного клиента и увидеть, как пополнение связано с ручной финансовой операцией и балансом.',
            route: '/admin/corporate-clients',
            kind: 'review',
            skills: ['Корпоративные клиенты', 'Пополнения'],
            badge: 'Пополнение понятно',
            estimatedMinutes: 6,
            rewardXp: 35,
            checkpoint: {
              event: 'corporate_clients.viewed',
              conditions: { taskKey: 'accountant.corporate.deposit-review' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'accountant.corporate.export-review',
            title: 'Понять экспорт корпоративной детализации',
            description:
              'Разобраться, какие строки попадают в выгрузку корпоративного клиента за период и как читать остаток после операций.',
            route: '/admin/corporate-clients',
            kind: 'review',
            skills: ['Экспорт', 'Корпоративные клиенты'],
            badge: 'Детализация понятна',
            estimatedMinutes: 5,
            rewardXp: 30,
            checkpoint: {
              event: 'corporate_clients.viewed',
              conditions: { taskKey: 'accountant.corporate.export-review' },
            },
            trainingMode: { recommended: false },
          },
        ],
      },
    ],
  },

  trainer: {
    role: 'trainer',
    title: 'Тренер: работа с игроком',
    description:
      'Путь тренера: безопасный просмотр клиента, дневник тренировок, упражнения и уровень игрока.',
    levelLabel: 'Тренерский уровень',
    completionBadge: 'Дневник игрока',
    outcomes: [
      'Вести тренировочные заметки',
      'Обновлять уровень игрока',
      'Работать с карточкой клиента без лишних персональных данных',
    ],
    missions: [
      {
        key: 'trainer.client-work',
        title: 'Карточка игрока',
        description: 'Найти игрока, посмотреть историю и добавить тренировочную запись.',
        tasks: [
          {
            key: 'trainer.client.open-card',
            title: 'Открыть карточку игрока',
            description: 'Найти клиента в тренерском кабинете и проверить доступные поля.',
            route: '/admin/trainer',
            kind: 'review',
            skills: ['Игроки', 'История'],
            badge: 'Карточка открыта',
            estimatedMinutes: 3,
            rewardXp: 25,
            checkpoint: { event: 'client.viewed' },
            trainingMode: { recommended: false },
          },
          {
            key: 'trainer.training-note.create',
            title: 'Добавить заметку тренировки',
            description: 'Записать дату, уровень, упражнения и короткий итог тренировки.',
            route: '/admin/trainer',
            kind: 'action',
            skills: ['Дневник', 'Упражнения'],
            badge: 'Тренировка записана',
            estimatedMinutes: 5,
            rewardXp: 45,
            checkpoint: {
              event: 'training_note.created',
              conditions: { structured: false },
            },
            trainingMode: { recommended: true },
          },
          {
            key: 'trainer.training-note.update',
            title: 'Уточнить заметку после тренировки',
            description: 'Открыть запись, поправить упражнения или вывод и сохранить понятную историю.',
            route: '/admin/trainer',
            kind: 'action',
            skills: ['Дневник', 'Коррекция'],
            badge: 'Заметка уточнена',
            estimatedMinutes: 3,
            rewardXp: 25,
            checkpoint: { event: 'training_note.updated' },
            trainingMode: { recommended: true },
          },
          {
            key: 'trainer.training-level.update',
            title: 'Обновить уровень игрока',
            description: 'Зафиксировать уровень после тренировки и оставить понятное обоснование.',
            route: '/admin/trainer',
            kind: 'action',
            skills: ['Уровень', 'Прогресс'],
            badge: 'Уровень обновлен',
            estimatedMinutes: 4,
            rewardXp: 35,
            checkpoint: { event: 'training_level.updated' },
            trainingMode: { recommended: true },
          },
        ],
      },
      {
        key: 'trainer.methodology-flow',
        title: 'Методика, навыки и планы',
        description:
          'Разобраться в базе упражнений, карте навыков, рекомендациях и жизненном цикле плана тренировки.',
        tasks: [
          {
            key: 'trainer.methodology.review-base',
            title: 'Посмотреть методическую базу',
            description:
              'Открыть навыки и упражнения, понять статусы, ступени упражнений и ограничения тренерской роли.',
            route: '/admin/methodology',
            kind: 'review',
            skills: ['Методика', 'Упражнения'],
            badge: 'База упражнений',
            estimatedMinutes: 5,
            rewardXp: 30,
            checkpoint: { event: 'methodology.viewed' },
            trainingMode: { recommended: false },
          },
          {
            key: 'trainer.client.skill-map-review',
            title: 'Прочитать карту навыков игрока',
            description:
              'Открыть игрока в тренерском кабинете и понять уровни навыков, флаг повтора, следующую ступень упражнения и историю изменений.',
            route: '/admin/trainer',
            kind: 'review',
            skills: ['Карта навыков', 'Прогресс'],
            badge: 'Карта прочитана',
            estimatedMinutes: 5,
            rewardXp: 30,
            checkpoint: {
              event: 'trainer.viewed',
              conditions: { taskKey: 'trainer.client.skill-map-review' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'trainer.training-note.structured-record',
            title: 'Зафиксировать тренировку структурно',
            description:
              'Записать упражнения из методической базы с оценкой, флагами повтора и итогом для карты навыков.',
            route: '/admin/trainer',
            kind: 'action',
            skills: ['Дневник', 'Карта навыков'],
            badge: 'Структурная запись',
            estimatedMinutes: 6,
            rewardXp: 45,
            checkpoint: {
              event: 'training_note.created',
              conditions: { structured: true },
            },
            trainingMode: { recommended: true },
          },
          {
            key: 'trainer.recommendation.personal-review',
            title: 'Разобрать персональную рекомендацию',
            description:
              'Открыть рекомендацию по игроку и понять, почему CRM выбрала навыки, блоки и упражнения.',
            route: '/admin/trainer',
            kind: 'review',
            skills: ['Рекомендации', 'Персональная тренировка'],
            badge: 'Рекомендация понятна',
            estimatedMinutes: 5,
            rewardXp: 30,
            checkpoint: {
              event: 'trainer.viewed',
              conditions: { taskKey: 'trainer.recommendation.personal-review' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'trainer.recommendation.group-review',
            title: 'Разобрать групповую рекомендацию',
            description:
              'Посмотреть, как CRM собирает общий план группы из навыков участников и оставляет ручные блоки там, где автоматический выбор небезопасен.',
            route: '/admin/trainer',
            kind: 'review',
            skills: ['Рекомендации', 'Группа'],
            badge: 'Группа разобрана',
            estimatedMinutes: 5,
            rewardXp: 30,
            checkpoint: {
              event: 'trainer.viewed',
              conditions: { taskKey: 'trainer.recommendation.group-review' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'trainer.training-plan.lifecycle',
            title: 'Понять запланированный и завершенный план',
            description:
              'Открыть планы тренировки, увидеть запланированные задания, замену упражнений и завершенный план с фактическими результатами.',
            route: '/admin/trainer',
            kind: 'review',
            skills: ['План тренировки', 'Факт занятия'],
            badge: 'Цикл плана',
            estimatedMinutes: 6,
            rewardXp: 35,
            checkpoint: {
              event: 'trainer.viewed',
              conditions: { taskKey: 'trainer.training-plan.lifecycle' },
            },
            trainingMode: { recommended: false },
          },
        ],
      },
    ],
  },

  viewer: {
    role: 'viewer',
    title: 'Наблюдатель: отчеты без правки данных',
    description:
      'Путь наблюдателя: аналитика входов, финансы на просмотр, утилизация, брони и справочники.',
    levelLabel: 'Обзорный уровень',
    completionBadge: 'Читатель отчетов',
    outcomes: [
      'Читать ключевые отчеты',
      'Понимать ограничения режима просмотра',
      'Не менять операционные данные',
    ],
    missions: [
      {
        key: 'viewer.reports',
        title: 'Отчеты и мониторинг',
        description: 'Открыть основные отчеты и научиться читать состояние клуба.',
        tasks: [
          {
            key: 'viewer.visits-analytics.review',
            title: 'Посмотреть глубокую аналитику посещений',
            description:
              'Выбрать период, применить фильтры, прочитать четыре вкладки и экспортировать отчет без рабочих действий с базами.',
            route: '/admin/visits-analytics',
            kind: 'review',
            skills: ['Отчеты', 'Посещения', 'LTV'],
            badge: 'Динамика прочитана',
            estimatedMinutes: 8,
            rewardXp: 30,
            checkpoint: {
              event: 'report.viewed',
              conditions: { report: 'visits_analytics' },
            },
            trainingMode: { recommended: false },
          },
          {
            key: 'viewer.finance.review',
            title: 'Посмотреть финансы без изменений',
            description: 'Открыть P&L и убедиться, что операции недоступны для редактирования.',
            route: '/admin/finances',
            kind: 'review',
            skills: ['Финансы', 'Чтение отчетов'],
            badge: 'Финансы просмотрены',
            estimatedMinutes: 4,
            rewardXp: 25,
            checkpoint: { event: 'finance.report_viewed' },
            trainingMode: { recommended: false },
          },
          {
            key: 'viewer.utilization.review',
            title: 'Посмотреть утилизацию',
            description: 'Проверить загрузку кортов и понять пики/провалы.',
            route: '/admin/utilization',
            kind: 'review',
            skills: ['Утилизация', 'Загрузка'],
            badge: 'Загрузка понятна',
            estimatedMinutes: 3,
            rewardXp: 25,
            checkpoint: { event: 'utilization.viewed' },
            trainingMode: { recommended: false },
          },
          {
            key: 'viewer.bookings.review',
            title: 'Посмотреть расписание броней',
            description: 'Открыть расписание и проверить, какие действия доступны только на просмотр.',
            route: '/admin/bookings',
            kind: 'review',
            skills: ['Расписание', 'Права просмотра'],
            badge: 'Режим просмотра',
            estimatedMinutes: 3,
            rewardXp: 20,
            checkpoint: { event: 'booking.schedule_viewed' },
            trainingMode: { recommended: false },
          },
        ],
      },
    ],
  },
};

function buildScreenshotPair({
  detailAlt,
  detailCaption,
  overviewAlt,
  overviewCaption,
  role,
  slug,
}) {
  return [
    {
      src: `/onboarding/${role}/${slug}/overview.png`,
      alt: overviewAlt,
      caption: overviewCaption,
    },
    {
      src: `/onboarding/${role}/${slug}/details.png`,
      alt: detailAlt,
      caption: detailCaption,
    },
  ];
}

function makeCardLesson({
  detailItems = [],
  detailText,
  detailTitle,
  finalText,
  finalTitle,
  overviewItems = [],
  overviewText,
  overviewTitle,
  screenshot,
  summary,
  title,
}) {
  return {
    title,
    summary,
    blocks: [
      {
        screenshotIndex: 0,
        title: overviewTitle,
        type: 'step',
        text: overviewText,
        ...(overviewItems.length > 0 ? { items: overviewItems } : {}),
      },
      {
        screenshotIndex: 1,
        title: detailTitle,
        type: 'step',
        text: detailText,
        ...(detailItems.length > 0 ? { items: detailItems } : {}),
      },
      {
        title: finalTitle,
        type: 'paragraph',
        text: finalText,
      },
    ],
    screenshots: buildScreenshotPair(screenshot),
  };
}

function makeTextLesson({ blocks, screenshots = [], summary, title, updatedAt }) {
  return {
    title,
    summary,
    ...(updatedAt ? { updatedAt } : {}),
    blocks: blocks.map((block) => {
      const normalizedBlock = {
        type: 'paragraph',
        ...block,
      };
      const hasExplicitScreenshot =
        Number.isInteger(normalizedBlock.screenshotIndex) ||
        Array.isArray(normalizedBlock.screenshotIndices) ||
        typeof normalizedBlock.screenshotRequired === 'boolean';

      if (
        screenshots.length > 0 &&
        normalizedBlock.type === 'step' &&
        !hasExplicitScreenshot
      ) {
        return {
          ...normalizedBlock,
          screenshotRequired: false,
        };
      }

      return normalizedBlock;
    }),
    screenshots,
  };
}

const VISITS_ANALYTICS_UPDATED_AT = '2026-07-13T00:00:00.000+03:00';
const PREPAYMENTS_SCREENSHOT_UPDATED_AT = '2026-07-14T00:00:00.000+03:00';
const SHIFT_CASH_UPDATED_AT = '2026-07-15T00:00:00.000+03:00';

function makeVisitsAnalyticsScreenshot(fileName, alt, caption, callouts) {
  return {
    src: `/onboarding/knowledge/visits-analytics/${fileName}`,
    alt,
    caption,
    calloutsEmbedded: true,
    callouts: callouts.map((text, index) => ({
      label: String(index + 1),
      text,
      x: 0,
      y: 0,
    })),
  };
}

const VISITS_ANALYTICS_SCREENSHOTS = {
  overview: makeVisitsAnalyticsScreenshot(
    'overview.png',
    'Раздел аналитики посещений с вкладкой обзора',
    'Вкладка «Обзор»: период, сравнение с предыдущим равным периодом, повторные визиты и распределения.',
    [
      'Переключатель вкладок отчета.',
      'Период отчета и базовые фильтры.',
      'Верхние метрики визитов, гостей и повторяемости.',
      'Графики и распределения для проверки источников и категорий визитов.',
    ],
  ),
  sourceQuality: makeVisitsAnalyticsScreenshot(
    'source-quality.png',
    'Качество источников в аналитике посещений',
    'Вкладка «Качество источников»: stable source key, зрелость окон 30/60/90, повторяемость и экспорт.',
    [
      'Вкладка качества источников.',
      'Источник с устойчивым ключом: id, legacy или «Не указан».',
      'Экспорт качества источников за выбранный срез.',
      'Создание клиентской базы доступно owner/manager для выбранного сегмента.',
    ],
  ),
  sourceQualityReadOnly: makeVisitsAnalyticsScreenshot(
    'source-quality-readonly.png',
    'Качество источников в режиме чтения',
    'Read-only режим: accountant/viewer могут менять фильтры и экспортировать отчет, но не создают клиентскую базу.',
    [
      'Вкладка качества источников.',
      'Источник и окна 30/60/90 для чтения повторяемости.',
      'Экспорт качества источников.',
      'Метрики чтения без кнопки создания клиентской базы.',
    ],
  ),
  cohortsLifecycle: makeVisitsAnalyticsScreenshot(
    'cohorts-lifecycle.png',
    'Когорты и жизненный цикл клиентов',
    'Вкладка «Когорты и жизненный цикл»: зрелые месяцы, статусы клиентов и сегменты для работы.',
    [
      'Вкладка когорт и жизненного цикла.',
      'Период, дата среза, источник и фильтры жизненного цикла.',
      'Статусы active, risk, sleeping, lost и динамика по зрелым месяцам.',
      'Создание базы по выбранной когорте или lifecycle-сегменту доступно owner/manager.',
    ],
  ),
  cohortsLifecycleReadOnly: makeVisitsAnalyticsScreenshot(
    'cohorts-lifecycle-readonly.png',
    'Когорты и жизненный цикл в режиме чтения',
    'Read-only режим: можно сверить когорты, статусы и экспорт, не создавая рабочие базы.',
    [
      'Вкладка когорт и жизненного цикла.',
      'Фильтры периода, источника и статуса клиента.',
      'Динамика статусов: рост active благоприятен, рост risk/sleeping/lost неблагоприятен.',
      'Зрелость окон: «Недостаточно времени» означает, что период еще нельзя честно сравнить.',
    ],
  ),
  revenueLtv: makeVisitsAnalyticsScreenshot(
    'revenue-ltv.png',
    'Выручка и LTV в аналитике посещений',
    'Вкладка «Выручка и LTV»: атрибуция выручки, возвратные чеки PAYBACK, LTV и покрытие данных.',
    [
      'Вкладка выручки и LTV.',
      'Дата среза, период и фильтры источника или когорты.',
      'Выручка, LTV 30/60/90/lifetime и возвраты PAYBACK.',
      'Coverage показывает, какую часть данных можно уверенно использовать в выводе.',
    ],
  ),
  segmentBaseCreate: makeVisitsAnalyticsScreenshot(
    'segment-base-create.png',
    'Создание клиентской базы из аналитики посещений',
    'Создание базы: название, provenance, количество клиентов, timezone и источник сегмента.',
    [
      'Название и описание будущей базы.',
      'Provenance: из какого аналитического сегмента собраны клиенты.',
      'Количество клиентов, дата среза и timezone Europe/Moscow.',
      'Кнопка создания базы после проверки состава.',
    ],
  ),
  segmentBaseHandoff: makeVisitsAnalyticsScreenshot(
    'segment-base-handoff.png',
    'Передача клиентской базы в задачу обзвона',
    'После создания базы проверь состав и передай ее в существующий сценарий задачи обзвона.',
    [
      'CRM подтверждает, что база создана.',
      'Открой базу, чтобы проверить provenance и количество клиентов.',
      'Создай задачу обзвона из этой базы через существующий flow обзвонов.',
    ],
  ),
};

function makeVisitsAnalyticsOpenBlock() {
  return {
    screenshotIndex: 0,
    title: 'Открой раздел «Аналитика посещений»',
    type: 'overview',
    text:
      'Сначала открой этот экран в CRM. Это стартовая точка урока; дальше будут конкретные действия и проверка результата.',
    items: [
      'На экране должны быть вкладки «Обзор», «Качество источников», «Когорты и жизненный цикл», «Выручка и LTV».',
    ],
  };
}

function makeVisitsAnalyticsManagerLesson({ summary, title }) {
  return {
    title,
    summary,
    format: 'section-first-cards',
    updatedAt: VISITS_ANALYTICS_UPDATED_AT,
    blocks: [
      makeVisitsAnalyticsOpenBlock(),
      {
        screenshotIndex: 0,
        title: 'Что сверить: вкладка «Обзор»',
        type: 'step',
        text:
          'Выбери период и прочитай базовые метрики. CRM считает визиты по каноническим клиентам: если карточки объединялись, визит относится к корневой карточке. Дата визита берется из scannedAt, а если ее нет - из createdAt. Учебные визиты, учебные клиенты и визиты-дубли исключаются.',
        items: [
          'New visits - первые визиты клиентов в выбранном периоде.',
          'Returning visits - визиты клиентов, которые уже были в клубе раньше.',
          'Repeat visits - повторные визиты в периоде.',
          'Repeat rate 30 считается только по зрелым окнам: клиент должен иметь достаточно времени после первого визита.',
          'Сравнение идет с предыдущим равным периодом, все даты читаются в timezone Europe/Moscow.',
        ],
      },
      {
        screenshotIndex: 1,
        title: 'Что сверить: качество источников',
        type: 'step',
        text:
          'Открой вкладку «Качество источников» и проверь, какие источники дают повторные визиты. Источник хранится устойчивым ключом: id:<id> для справочника, legacy:<значение> для старых строк, unspecified для пустого источника.',
        items: [
          'Eligible 30/60/90 - клиенты, у которых уже прошло достаточно дней для честной проверки возврата.',
          '«Недостаточно времени» значит, что окно еще не созрело.',
          '«Мало данных» значит, что выборка слишком маленькая для уверенного вывода.',
          'Один визит показывает слабый возврат, 3+ визита - устойчивую повторяемость.',
          'Среднее и медиана второго визита помогают понять, как быстро источник возвращает клиента.',
        ],
      },
      {
        screenshotIndex: 2,
        title: 'Что сверить: когорты и жизненный цикл',
        type: 'step',
        text:
          'Перейди во вкладку «Когорты и жизненный цикл». Когорты строятся от M0+: месяц первого визита считается M0, следующие календарные месяцы идут как M1, M2 и дальше. CRM учитывает только зрелые календарные месяцы, чтобы не сравнивать полный месяц с незавершенным.',
        items: [
          'Active - клиент недавно был в клубе.',
          'Risk - клиент начинает выпадать из привычного ритма.',
          'Sleeping - давно не было визитов, но клиент еще не потерян окончательно.',
          'Lost - клиент не возвращался достаточно долго.',
          'Рост active - благоприятный.',
          'Снижение risk, sleeping или lost - благоприятное.',
          'Рост risk, sleeping или lost - неблагоприятный и показывается красным; нулевое изменение нейтрально.',
        ],
      },
      {
        screenshotIndex: 3,
        title: 'Что сверить: выручка и LTV',
        type: 'step',
        text:
          'Открой вкладку «Выручка и LTV» и проверь, как CRM связывает деньги с визитами. Выручка атрибутируется к клиенту и источнику по доступным платежным данным. PAYBACK - возвратный чек: его сумма уменьшает net-выручку и, при надежной связи с клиентом, соответствующий LTV. LTV 30/60/90/lifetime - накопленная ценность клиента в разных окнах.',
        items: [
          'Source LTV показывает ценность источника, cohort LTV - ценность клиентов месяца первого визита.',
          'Coverage предупреждает, какая доля данных покрыта платежами и атрибуцией.',
          'Непривязанный PAYBACK остается в coverage как риск неполной атрибуции.',
          'Если coverage низкий, вывод по LTV нельзя читать как полный финансовый итог.',
        ],
      },
      {
        screenshotIndex: 4,
        title: 'Что нажать: создать клиентскую базу',
        type: 'step',
        text:
          'Для owner/manager выбери источник, когорту или lifecycle-статус и нажми создание базы из выбранного сегмента. Перед сохранением проверь название, описание, дату среза, timezone Europe/Moscow, фильтры и количество клиентов.',
        items: [
          'Используй source filter для работы с клиентами конкретного канала.',
          'Используй cohort filter для клиентов одного месяца первого визита.',
          'Используй lifecycle filter для риска, спящих или потерянных клиентов.',
          'Если count слишком маленький или слишком широкий, вернись к фильтрам до создания базы.',
        ],
      },
      {
        screenshotIndex: 5,
        title: 'Как проверить результат: база и обзвон',
        type: 'step',
        text:
          'После создания открой клиентскую базу и проверь provenance: выбранный источник, когорту или lifecycle-статус, дату среза и количество клиентов. Если состав верный, передай базу в существующую задачу обзвона.',
        items: [
          'В базе должно быть видно, из какого аналитического сегмента она создана.',
          'Количество клиентов в базе должно совпадать с preview/count из модального окна.',
          'Задача обзвона создается из готовой базы, а не из вкладки аналитики напрямую.',
        ],
      },
    ],
    screenshots: [
      VISITS_ANALYTICS_SCREENSHOTS.overview,
      VISITS_ANALYTICS_SCREENSHOTS.sourceQuality,
      VISITS_ANALYTICS_SCREENSHOTS.cohortsLifecycle,
      VISITS_ANALYTICS_SCREENSHOTS.revenueLtv,
      VISITS_ANALYTICS_SCREENSHOTS.segmentBaseCreate,
      VISITS_ANALYTICS_SCREENSHOTS.segmentBaseHandoff,
    ],
  };
}

function makeVisitsAnalyticsReadOnlyLesson({ roleLabel, summary, title }) {
  return {
    title,
    summary,
    format: 'section-first-cards',
    updatedAt: VISITS_ANALYTICS_UPDATED_AT,
    blocks: [
      makeVisitsAnalyticsOpenBlock(),
      {
        screenshotIndex: 0,
        title: 'Что сверить: вкладка «Обзор»',
        type: 'step',
        text:
          'Выбери период и прочитай базовые показатели без изменения данных CRM. Визит относится к каноническому клиенту, дата берется из scannedAt или, если ее нет, из createdAt. Учебные данные и визиты-дубли не попадают в расчет.',
        items: [
          'New, returning и repeat visits показывают структуру потока.',
          'Repeat rate 30 читается только по зрелым окнам.',
          'Сравнение идет с предыдущим равным периодом в timezone Europe/Moscow.',
        ],
      },
      {
        screenshotIndex: 1,
        title: 'Что сверить: качество источников',
        type: 'step',
        text:
          'На вкладке «Качество источников» проверь stable source key, окна eligible 30/60/90, количество клиентов с одним визитом и долю клиентов с 3+ визитами. В режиме чтения можно менять фильтры и экспортировать отчет.',
        items: [
          '«Недостаточно времени» означает незрелое окно наблюдения.',
          '«Мало данных» означает, что выборка не подходит для уверенного вывода.',
          'Среднее и медиана второго визита показывают скорость возврата клиентов источника.',
        ],
      },
      {
        screenshotIndex: 2,
        title: 'Что сверить: когорты и жизненный цикл',
        type: 'step',
        text:
          'Открой вкладку «Когорты и жизненный цикл» и проверь M0+ когорты, зрелые календарные месяцы и статусы active, risk, sleeping, lost. Динамику читай с учетом статуса: рост active благоприятен, а рост risk, sleeping или lost неблагоприятен.',
        items: [
          'M0 - месяц первого визита клиента.',
          'Незавершенный календарный месяц не равен зрелому месяцу.',
          'Статус клиента показывает давность и риск потери, а не причину сам по себе.',
          'Рост active - благоприятный.',
          'Снижение risk, sleeping или lost - благоприятное; нулевое изменение нейтрально.',
          'Рост risk, sleeping или lost - неблагоприятный и показывается красным.',
        ],
      },
      {
        screenshotIndex: 3,
        title: 'Что сверить: выручка и LTV',
        type: 'step',
        text:
          'На вкладке «Выручка и LTV» проверь revenue attribution, PAYBACK, LTV 30/60/90/lifetime, source LTV, cohort LTV и coverage. PAYBACK - возвратный чек: его сумма уменьшает net-выручку и, при надежной связи с клиентом, соответствующий LTV. Для роли read-only это отчет для сверки и экспорта, без запуска операционных действий.',
        items: [
          'Coverage ограничивает доверие к LTV: низкое покрытие значит неполный финансовый след.',
          'Привязанный возврат уменьшает LTV клиента или источника; непривязанный PAYBACK остается в coverage как риск неполной атрибуции.',
          `${roleLabel} не создает рабочие сегменты из этого экрана и не передает их в обзвон.`,
        ],
      },
      {
        screenshotRequired: false,
        title: 'Как проверить результат: отчет прочитан',
        type: 'step',
        text:
          'Результат засчитан, если выбранный период совпадает с задачей сверки, понятны фильтры, экспорт скачался при необходимости, а вывод не опирается на незрелые окна или низкий coverage.',
        items: [
          'Проверь, что фильтр источника, когорты или lifecycle-статуса совпадает с вопросом.',
          'Если видишь «Недостаточно времени» или «Мало данных», не делай окончательный вывод по этому срезу.',
          'Для передачи сегмента в работу передай owner/manager период, фильтр, count и причину отбора.',
        ],
      },
    ],
    screenshots: [
      VISITS_ANALYTICS_SCREENSHOTS.overview,
      VISITS_ANALYTICS_SCREENSHOTS.sourceQualityReadOnly,
      VISITS_ANALYTICS_SCREENSHOTS.cohortsLifecycleReadOnly,
      VISITS_ANALYTICS_SCREENSHOTS.revenueLtv,
    ],
  };
}

const roleInstructionLessons = {
  'admin.shift-cash.opening-record': makeTextLesson({
    title: 'Как зафиксировать кассу на начало смены',
    summary:
      'Начальный остаток нужен, чтобы Setly мог посчитать ожидаемую наличность к закрытию смены.',
    updatedAt: SHIFT_CASH_UPDATED_AT,
    blocks: [
      {
        screenshotIndex: 1,
        title: 'Что нажать: открыть кассу активной смены',
        type: 'step',
        text:
          'Открой «Мотивация» и найди блок «Касса» в активной смене. Если смена еще не начата, сначала начни смену по обычному процессу, затем вернись к блоку кассы.',
      },
      {
        screenshotIndex: 2,
        title: 'Что заполнить: остаток на начало',
        type: 'step',
        text:
          'В блоке «Остаток на начало смены» укажи сумму купюр, сумму мелочи и короткий комментарий, если нужно пояснить пересчет. После проверки нажми «Зафиксировать остаток».',
        items: [
          'Купюры и мелочь вводятся отдельно, а общий остаток считается автоматически.',
          'Комментарий нужен, если стартовая сумма отличается от ожидаемой или есть пояснение по пересчету.',
        ],
      },
      {
        screenshotIndex: 3,
        title: 'Как проверить результат',
        type: 'step',
        text:
          'После сохранения в блоке кассы должен появиться зафиксированный остаток на начало, имя сотрудника и время фиксации. Верхняя метрика «На начало» должна совпадать с суммой купюр и мелочи.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/shift-cash/full-cash-metrics.png',
        alt: 'Касса активной смены с верхними метриками',
        caption:
          'Касса активной смены: верхние метрики, зафиксированный стартовый остаток и форма расхода.',
      },
      {
        src: '/onboarding/shift-cash/full-cash-metrics.png',
        alt: 'Касса активной смены с верхними метриками',
        caption:
          'Касса активной смены: метрики, стартовый остаток и блок расходов смены.',
      },
      {
        src: '/onboarding/shift-cash/opening-form.png',
        alt: 'Форма фиксации остатка на начало смены',
        caption:
          'Форма фиксации остатка: купюры, мелочь, комментарий и кнопка «Зафиксировать остаток».',
      },
      {
        src: '/onboarding/shift-cash/opening-saved.png',
        alt: 'Сохраненный остаток на начало смены',
        caption:
          'Сохраненный стартовый остаток показывает суммы, сотрудника, время фиксации и комментарий.',
      },
    ],
  }),
  'admin.shift-cash.expense-with-photo': makeTextLesson({
    title: 'Как добавить расход из кассы с фото чека',
    summary:
      'Кассовый расход уменьшает ожидаемый остаток смены и создает связанную финансовую операцию в P&L.',
    updatedAt: SHIFT_CASH_UPDATED_AT,
    blocks: [
      {
        screenshotIndex: 1,
        title: 'Что нажать: открыть форму расхода',
        type: 'step',
        text:
          'Открой «Мотивация», найди блок «Касса» и перейди к форме «Добавить расход из кассы». Если начальный остаток еще не зафиксирован, сначала заполни его.',
      },
      {
        screenshotIndex: 2,
        title: 'Что заполнить: сумма, категория, описание и фото',
        type: 'step',
        text:
          'Укажи сумму расхода, выбери категорию, напиши понятное описание и добавь фото чека. После проверки нажми «Добавить расход».',
        items: [
          'Категория должна соответствовать статье расхода, потому что запись попадет в P&L.',
          'Описание должно объяснять, на что потрачены наличные.',
          'Фото чека можно снять камерой телефона или выбрать файлом.',
        ],
      },
      {
        screenshotIndex: 3,
        title: 'Как проверить результат',
        type: 'step',
        text:
          'После сохранения расход должен появиться в списке расходов смены, у строки должны быть категория, сумма, связанный Finance ID и прикрепленное фото чека. Сумма расходов должна увеличиться, а ожидаемый остаток наличности уменьшиться.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/shift-cash/full-cash-metrics.png',
        alt: 'Касса активной смены перед добавлением расхода',
        caption:
          'Касса активной смены перед добавлением расхода: метрики, стартовый остаток и форма расхода.',
      },
      {
        src: '/onboarding/shift-cash/full-cash-metrics.png',
        alt: 'Касса активной смены перед добавлением расхода',
        caption:
          'На экране видно, где в кассе смены находится форма добавления расхода.',
      },
      {
        src: '/onboarding/shift-cash/expense-form.png',
        alt: 'Форма добавления расхода из кассы',
        caption:
          'Форма расхода содержит сумму, категорию, описание, загрузку фото чека и кнопку «Добавить расход».',
      },
      {
        src: '/onboarding/shift-cash/expense-result-attached.png',
        alt: 'Сохраненный кассовый расход с прикрепленным чеком',
        caption:
          'В карточке видны категория, Finance ID, сумма расхода и превью чека.',
      },
    ],
  }),
  'manager.shift-cash.reconciliation-review': makeTextLesson({
    title: 'Как проверить кассовую сверку смены',
    summary:
      'Менеджер проверяет, что начальный остаток, наличные продажи, расходы и фактическая касса сходятся перед закрытием смены.',
    updatedAt: SHIFT_CASH_UPDATED_AT,
    blocks: [
      {
        screenshotIndex: 1,
        title: 'Что нажать: открыть кассу смены',
        type: 'step',
        text:
          'Открой «Мотивация» и найди блок «Касса». Проверь, что работаешь с нужной активной сменой и видишь верхние метрики: на начало, наличная выручка, расходы, ожидаемый остаток и факт.',
      },
      {
        screenshotIndices: [2, 3],
        title: 'Что сверить: остатки, расходы и ожидаемый итог',
        type: 'step',
        text:
          'Сверь зафиксированный начальный остаток, список расходов, фото чеков и ожидаемый остаток. Если расход отменен или исправлен, проверь, что статус и комментарий объясняют изменение.',
        items: [
          'Наличные продажи учитываются в ожидаемом остатке, безналичные продажи не входят в физическую кассу.',
          'PAYBACK уменьшает наличную выручку, если возврат был наличными.',
          'Расходы из кассы должны иметь категорию, понятное описание и фото чека, если чек есть.',
        ],
      },
      {
        screenshotIndex: 4,
        title: 'Как проверить результат: закрытие смены',
        type: 'step',
        text:
          'При закрытии смены введи фактические купюры и мелочь. Если появляется расхождение, комментарий становится обязательным: напиши причину и только после этого нажми «Сверить кассу и завершить».',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/shift-cash/full-cash-metrics.png',
        alt: 'Полные метрики кассы активной смены',
        caption:
          'Кассовый блок показывает метрики смены, стартовый остаток и зону расходов.',
      },
      {
        src: '/onboarding/shift-cash/full-cash-metrics.png',
        alt: 'Полные метрики кассы активной смены',
        caption:
          'Верхние метрики показывают старт, наличную выручку, расходы и ожидаемый остаток; ниже видны стартовый остаток и расходы.',
      },
      {
        src: '/onboarding/shift-cash/opening-saved.png',
        alt: 'Зафиксированный стартовый остаток смены',
        caption:
          'Сохраненный стартовый остаток показывает купюры, мелочь, сотрудника, время и комментарий фиксации.',
      },
      {
        src: '/onboarding/shift-cash/expense-result-attached.png',
        alt: 'Расход смены с прикрепленным чеком',
        caption:
          'Сохраненный расход показывает категорию, Finance ID, сумму и прикрепленный чек.',
      },
      {
        src: '/onboarding/shift-cash/close-dialog-variance-comment.png',
        alt: 'Диалог кассовой сверки с расхождением и обязательным комментарием',
        caption:
          'Диалог закрытия показывает ожидаемые суммы, фактические купюры и мелочь, расхождение, обязательный комментарий и кнопку завершения сверки.',
      },
    ],
  }),
  'owner.shift-cash.control-review': makeTextLesson({
    title: 'Как читать контроль наличной кассы',
    summary:
      'Владелец читает кассу смены как контроль качества учета: что было на старте, какие были расходы, почему появилось расхождение и как это связано с P&L.',
    updatedAt: SHIFT_CASH_UPDATED_AT,
    blocks: [
      {
        screenshotIndex: 1,
        title: 'Что нажать: открыть кассу смены',
        type: 'step',
        text:
          'Открой «Мотивация» и перейди к блоку «Касса» нужной смены. Владелец может проходить обучение за роли, но права владельца при этом сохраняются.',
      },
      {
        screenshotIndices: [2, 3],
        title: 'Что сверить: качество учета наличных',
        type: 'step',
        text:
          'Проверь стартовый остаток, наличную выручку, расходы, ожидаемый остаток и факт. По расходам смотри категорию, описание, фото чека и статус: активный или отмененный.',
        items: [
          'Ожидаемый остаток считается из старта, наличных продаж, активных расходов и корректировок.',
          'Расход из кассы должен иметь связанную финансовую операцию, чтобы P&L не расходился с операционной кассой.',
          'Расхождение без комментария не должно закрывать смену.',
        ],
      },
      {
        screenshotIndices: [3, 4],
        title: 'Как проверить результат',
        type: 'step',
        text:
          'Результат проверки нормальный, если закрытая касса показывает факт, расхождение и комментарий, а кассовые расходы можно найти в финансовом отчете по дате смены, категории расхода и связанной строке истории.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/shift-cash/full-cash-metrics.png',
        alt: 'Кассовый блок активной смены для владельца',
        caption:
          'Кассовый блок показывает метрики смены, стартовый остаток и расходы смены.',
      },
      {
        src: '/onboarding/shift-cash/full-cash-metrics.png',
        alt: 'Кассовый блок активной смены для владельца',
        caption:
          'Кассовый блок показывает метрики смены, стартовый остаток и расходы смены.',
      },
      {
        src: '/onboarding/shift-cash/expense-result-attached.png',
        alt: 'Расход смены с Finance ID и чеком',
        caption:
          'Карточка расхода связывает категорию, Finance ID, сумму и фото чека.',
      },
      {
        src: '/onboarding/shift-cash/close-dialog-variance-comment.png',
        alt: 'Сверка кассы с расхождением и комментарием',
        caption:
          'Сверка кассы показывает ожидаемые суммы, фактический остаток, расхождение, обязательный комментарий и завершение сверки.',
      },
      {
        src: '/onboarding/shift-cash/accountant-linked-row-history.png',
        alt: 'Финансовая история со связанной кассовой операцией',
        caption:
          'Финансовая история показывает дату операции, действие обновления Finance-записи и причину со ссылкой на кассу смены.',
      },
    ],
  }),
  'accountant.shift-cash.finance-review': makeTextLesson({
    title: 'Как сверить кассовые расходы в P&L',
    summary:
      'Бухгалтер не управляет кассой смены как администратор: он проверяет финансовую запись, созданную из кассового расхода.',
    updatedAt: SHIFT_CASH_UPDATED_AT,
    blocks: [
      {
        screenshotIndex: 1,
        title: 'Что нажать: открыть финансы',
        type: 'step',
        text:
          'Открой «Финансы», выбери период, который включает дату смены, и проверь, что при необходимости доступен экспорт отчета.',
      },
      {
        screenshotIndex: 2,
        title: 'Что сверить: категория, сумма, дата и комментарий',
        type: 'step',
        text:
          'Найди строку расхода в P&L и связанную запись в финансовой истории. Сверь, что категория, сумма, дата смены и причина операции совпадают с кассовым расходом.',
        items: [
          'Администратор не получает общий доступ к управлению финансами из-за кассы смены.',
          'Отмененный кассовый расход должен уйти из активных расходов P&L.',
          'Если категория ошибочная, исправление делает роль с правом управления финансами или кассой по процессу клуба.',
        ],
      },
      {
        screenshotIndices: [1, 2],
        title: 'Как проверить результат',
        type: 'step',
        text:
          'Проверка завершена, если период отчета совпадает с датой смены, экспорт доступен, связанный расход виден в P&L, а финансовая история содержит строку с причиной вида «Касса смены ...».',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/shift-cash/accountant-period-export.png',
        alt: 'Финансовый отчет бухгалтера с периодом и экспортом',
        caption:
          'Финансовый отчет показывает выбранный период, кнопку экспорта, структуру расходов и строку расхода в P&L.',
      },
      {
        src: '/onboarding/shift-cash/accountant-period-export.png',
        alt: 'Финансовый отчет бухгалтера с периодом и экспортом',
        caption:
          'Финансовый отчет показывает выбранный период, кнопку экспорта, структуру расходов и строку расхода в P&L.',
      },
      {
        src: '/onboarding/shift-cash/accountant-linked-row-history.png',
        alt: 'Финансовая история со связанной кассовой строкой',
        caption:
          'Финансовая история показывает дату операции, действие связанной Finance-записи и причину со ссылкой на кассу смены.',
      },
    ],
  }),
  'admin.prepayments.dashboard-review': makeTextLesson({
    title: 'Как администратору читать сводку предоплат',
    summary:
      'Сводка предоплат помогает на смене быстро перейти к разрешенным деталям по абонементам и сертификатам.',
    updatedAt: PREPAYMENTS_SCREENSHOT_UPDATED_AT,
    blocks: [
      {
        title: 'Что нажать: открыть сводку предоплат',
        type: 'step',
        text:
          'Открой раздел «Предоплаты» из бокового меню. В роли администратора работай с доступными операционными блоками: абонементы, сертификаты и переходы к разрешенным деталям.',
        items: [
          'Если нужного блока нет в твоем доступе, не обходи роль и передай вопрос менеджеру, владельцу или бухгалтеру.',
          'Финансовые сверки выполняются в ролях, которым доступны бухгалтерские разделы.',
        ],
      },
      {
        title: 'Что сверить: абонементы и сертификаты',
        type: 'step',
        text:
          'В блоке абонементов сверяй клиента, тип, остаток занятий, использовано, срок действия и статус. В блоке сертификатов сверяй код, клиента, тип, остаток денег или услуг, срок действия и статус.',
        items: [
          'Для списания занятия переходи в карточку клиента и проверяй историю абонемента там.',
          'Для сертификата сначала сверяй код и остаток, а затем переходи к разрешенной карточке.',
        ],
      },
      {
        title: 'Как проверить результат',
        type: 'step',
        text:
          'Результат проверки засчитан, если ты нашел нужный абонемент или сертификат, понял его статус и перешел только в разрешенную детальную карточку. Если нужного блока нет или доступ закрыт, не обходи права роли и передай вопрос старшей роли.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/knowledge/prepayments/overview.png',
        alt: 'Раздел предоплат в CRM',
        caption:
          'Общий вид раздела «Предоплаты» с блоками, доступными роли пользователя.',
      },
    ],
  }),
  'admin.subscription.redemption-review': {
    title: 'Как списать занятие по абонементу',
    summary:
      'Урок показывает, как открыть карточку клиента, оформить списание абонемента и проверить остаток с историей.',
    blocks: [
      {
        screenshotIndex: 0,
        title: 'Что нажать: открыть абонемент клиента',
        type: 'step',
        text:
          'Открой раздел «Клиенты», найди клиента по имени или телефону и перейди в его карточку. В карточке найди блок абонементов и выбери активный абонемент, который подходит к фактической тренировке.',
        items: [
          'Не списывай занятие у похожего клиента.',
          'Проверь статус абонемента до открытия списания.',
          'Если активных абонементов несколько, выбери тот, который соответствует формату занятия.',
        ],
      },
      {
        screenshotIndex: 1,
        title: 'Что заполнить: параметры списания',
        type: 'step',
        text:
          'В форме списания укажи услугу или тип занятия, дату, количество списываемых занятий и короткий комментарий, если он нужен для смены или тренера.',
        items: [
          'Количество списаний должно соответствовать фактическому занятию.',
          'Дата должна совпадать с датой услуги.',
          'Комментарий нужен для нестандартной ситуации, например ручного исправления.',
          'После проверки полей нажми «Сохранить» или основную кнопку списания.',
        ],
      },
      {
        screenshotIndex: 2,
        title: 'Как проверить результат: остаток и история',
        type: 'step',
        text:
          'После сохранения проверь, что остаток абонемента уменьшился корректно, а новая строка появилась в истории списаний. Если списание ошибочное, исправляй его отдельной отменой, а не незаметным удалением следа.',
        items: [
          'Остаток = «Всего занятий» - «Использовано».',
          'История должна показывать дату, услугу, сотрудника и комментарий.',
          'Истекший, отмененный или полностью использованный абонемент не должен списываться.',
        ],
      },
    ],
    screenshots: [
      {
        src: '/onboarding/admin/subscription-redemption/subscription-card.png',
        alt: 'Карточка клиента с активным абонементом',
        caption:
          'На скриншоте видны блок «Абонементы», активный абонемент, остаток занятий и кнопка списания.',
        calloutsEmbedded: true,
        callouts: [
          { height: 5.6, label: '1', labelX: 17.8, labelY: 50.7, text: 'Блок активных абонементов клиента.', width: 12.8, x: 18, y: 51 },
          { height: 3.8, label: '2', labelX: 36.8, labelY: 64.8, text: 'Кнопка списания занятия.', width: 7.6, x: 41.4, y: 67.8 },
          { height: 28.4, label: '3', labelX: 17.8, labelY: 59.7, text: 'Карточка конкретного абонемента.', width: 32.8, x: 18, y: 60 },
          { height: 5.2, label: '4', labelX: 39.2, labelY: 58, text: 'Остаток занятий по абонементу.', width: 5.2, x: 44.8, y: 61.8 },
        ],
      },
      {
        src: '/onboarding/admin/subscription-redemption/redemption-form.png',
        alt: 'Форма списания тренировки по абонементу',
        caption:
          'На скриншоте видны дата, тип тренировки, текущий остаток, комментарий и кнопка списания.',
        calloutsEmbedded: true,
        callouts: [
          { height: 7, label: '1', labelX: 2.8, labelY: 22.8, text: 'Дата списываемой услуги.', width: 42.8, x: 3, y: 25.6 },
          { height: 7, label: '2', labelX: 50.8, labelY: 22.8, text: 'Тип тренировки или услуги.', width: 23.8, x: 51, y: 25.6 },
          { height: 14.2, label: '3', labelX: 2.8, labelY: 34.8, text: 'Текущий остаток перед списанием.', width: 94.4, x: 3, y: 38 },
          { height: 20.2, label: '4', labelX: 2.8, labelY: 59.8, text: 'Комментарий к списанию.', width: 94.4, x: 3, y: 63 },
          { height: 7.3, label: '5', labelX: 2.8, labelY: 87.8, text: 'Кнопка подтверждения списания.', width: 94.4, x: 3, y: 89.2 },
        ],
      },
      {
        src: '/onboarding/admin/subscription-redemption/balance-history.png',
        alt: 'Абонемент после списания с обновленным остатком и историей',
        caption:
          'На скриншоте видны уменьшенный остаток, обновленное поле «Использовано» и новая строка в истории списаний.',
        calloutsEmbedded: true,
        callouts: [
          { height: 5.6, label: '1', labelX: 44.8, labelY: 61.7, text: 'Обновленный остаток занятий.', width: 5.8, x: 45, y: 62 },
          { height: 14.4, label: '2', labelX: 18.8, labelY: 73.7, text: 'История списаний абонемента.', width: 33.8, x: 18.4, y: 78.4 },
          { height: 9.8, label: '3', labelX: 18.8, labelY: 81.7, text: 'Новая запись о списанной услуге.', width: 32.2, x: 19, y: 82 },
          { height: 4.8, label: '4', labelX: 46.9, labelY: 83.7, text: 'Кнопка отмены ошибочного списания.', width: 3.8, x: 47.1, y: 84 },
        ],
      },
    ],
  },
  'admin.certificate.redemption-review': makeTextLesson({
    title: 'Как понять списание сертификата',
    summary:
      'Сертификат в CRM имеет код, тип, остаток и историю списаний, поэтому его можно проверить без ручных таблиц.',
    blocks: [
      {
        title: 'Что нажать: открыть сертификаты',
        type: 'step',
        text:
          'Открой раздел «Сертификаты» или перейди к сертификатам из сводки предоплат. Используй поиск по коду, клиенту или статусу. Код является главным ориентиром для проверки.',
        items: [
          'Не списывай услугу, пока не сверил код сертификата.',
          'Если сертификат не найден, проверь статус и правильность кода у клиента.',
        ],
      },
      {
        title: 'Что сверить перед списанием',
        type: 'step',
        text:
          'Сверь тип сертификата, исходный номинал, использованную часть, текущий остаток и срок действия. Денежный сертификат списывается суммой, сервисный — количеством услуг или пакетом.',
        items: [
          'Если остаток нулевой, сертификат нельзя использовать для новой услуги.',
          'Если срок действия истек, передай ситуацию старшей роли вместо ручного обхода.',
        ],
      },
      {
        title: 'Как проверить результат',
        type: 'step',
        text:
          'После списания проверь, что остаток уменьшился, а в истории появилась строка с датой, сотрудником и комментарием. Ошибочное списание исправляй отменой отдельной записи, чтобы история осталась понятной.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/knowledge/certificates/overview.png',
        alt: 'Раздел сертификатов в CRM',
        caption:
          'Общий вид раздела «Сертификаты» для поиска кода, клиента, статуса и остатка.',
      },
    ],
  }),
  'admin.booking.training-plan-link': makeTextLesson({
    title: 'Как тренировочная бронь связана с планом тренировки',
    summary:
      'Тренировочная бронь может стать источником плана: CRM берет тип брони, участников и ответственного тренера, а затем собирает план занятия.',
    blocks: [
      {
        title: 'Что нажать: открыть тренировочную бронь',
        type: 'step',
        text:
          'Открой «Бронирование», выбери нужную дату и открой карточку брони. План создавай только для тренировочных типов: персональная тренировка или групповая тренировка.',
        items: [
          'Обычная игровая бронь не должна создавать тренировочный план.',
          'Если тип брони неверный, сначала исправь бронь или передай вопрос старшей роли.',
        ],
      },
      {
        title: 'Что сверить перед созданием плана',
        type: 'step',
        text:
          'Проверь дату, время, корт, тип занятия, клиента или участников группы и ответственного тренера. Если ответственный сотрудник связан с активным аккаунтом тренера, план назначится этому тренеру.',
        items: [
          'Для групповой тренировки проверь всех участников, а не только основного клиента.',
          'Не создавай план, если ответственный тренер не выбран.',
        ],
      },
      {
        title: 'Как проверить результат',
        type: 'step',
        text:
          'После действия с планом убедись, что у брони появился связанный план или переход к нему. В плане должны совпадать дата, участники, тренер и тип занятия; если данные не совпали, вернись к брони и исправь источник.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/knowledge/bookings/overview.png',
        alt: 'Раздел бронирования в CRM',
        caption:
          'Общий вид раздела «Бронирование», откуда открывается карточка тренировочной брони.',
      },
    ],
  }),
  'manager.manager-control.daily-review': makeTextLesson({
    title: 'Как разобрать ежедневную очередь контроля',
    summary:
      'Контроль менеджера собирает в один экран то, что требует реакции сегодня: проблемные брони, звонки, обзвоны, предоплаты и корпоративные остатки.',
    blocks: [
      {
        title: 'Что сверить: фильтры и итог очереди',
        type: 'step',
        text:
          'Выбери дату броней, период истечения и порог низкого корпоративного баланса. Затем посмотри верхние счетчики: всего в очереди, предоплаты, звонки и брони на выбранную дату.',
        items: [
          'Дата влияет на блок проблемных броней.',
          'Период истечения влияет на абонементы и сертификаты.',
          'Порог баланса влияет на корпоративные компании с низким остатком.',
        ],
      },
      {
        title: 'Что открыть: строки очереди',
        type: 'step',
        text:
          'Разбери блоки по порядку: pending sales без клиента, просроченные задачи обзвона, пропущенные звонки, проблемные брони, истекающие абонементы, сертификаты и низкие корпоративные балансы. В каждой строке используй основную кнопку перехода, чтобы открыть исходный раздел.',
        items: [
          'У проблемной брони смотри бейджи «Конфликт», «Оплата» или «Отмена».',
          'У предоплат смотри, это привязка продажи, истечение срока или низкий остаток.',
          'У звонков и обзвонов смотри дедлайн, ответственного и следующий экран обработки.',
        ],
      },
      {
        title: 'Как проверить результат',
        type: 'step',
        text:
          'После разбора вернись на контроль менеджера и нажми «Обновить». Результат виден, если количество строк в нужном блоке уменьшилось, причина риска исчезла или строка ведет в правильный рабочий раздел для следующего действия.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/knowledge/manager-control/overview.png',
        alt: 'Раздел контроля менеджера с очередью дня',
        caption:
          'Так выглядит раздел «Контроль менеджера»: фильтры, счетчики и очереди задач на день.',
      },
    ],
  }),
  'owner.manager-control.daily-review': makeTextLesson({
    title: 'Как владельцу проверить ежедневную очередь менеджера',
    summary:
      'Контроль менеджера показывает, какие операционные хвосты CRM уже собрала в очередь реакции на сегодня.',
    blocks: [
      {
        title: 'Что сверить: общий риск дня',
        type: 'step',
        text:
          'Открой контроль менеджера и посмотри верхние счетчики. Они показывают, сколько всего задач требует внимания, сколько связано с предоплатами, звонками и бронями выбранной даты.',
      },
      {
        title: 'Что открыть: источник риска',
        type: 'step',
        text:
          'Если в блоке есть строки, открой их через кнопку действия. CRM ведет в исходный раздел: каталог для pending sales, расписание для проблемной брони, телефонию или задачи обзвона для контакта, карточку клиента, сертификат или корпоративную компанию для остатков.',
      },
      {
        title: 'Как проверить результат',
        type: 'step',
        text:
          'Проверь, что для каждой строки понятна причина: конфликт, неоплата, отмена, пропущенный звонок, просроченный обзвон, истечение абонемента или сертификата, низкий корпоративный баланс. Если причина неочевидна, открывай исходный раздел из строки и сверяй данные там.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/knowledge/manager-control/overview.png',
        alt: 'Раздел контроля менеджера с очередью дня',
        caption:
          'Так выглядит раздел «Контроль менеджера»: фильтры, счетчики и очереди задач на день.',
      },
    ],
  }),
  'manager.prepayments.sale-mapping': makeTextLesson({
    title: 'Как работают настройки продаж Эвотора',
    summary:
      'Настройки продаж объясняют CRM, что означает товар из кассы: обычную продажу, абонемент или сертификат.',
    blocks: [
      {
        title: 'Зачем нужны настройки',
        text:
          'Чек Эвотора хранит строку товара и сумму, но сам по себе не знает, должен ли товар создать абонемент, сертификат или просто попасть в финансовую категорию. Настройка продаж добавляет этот смысл поверх обычного финансового сопоставления.',
      },
      {
        title: 'Чем это отличается от категории',
        text:
          'Финансовая категория отвечает, где строка попадет в отчет прибыли. Тип продажи отвечает, нужно ли после продажи создать обязательство перед клиентом: абонемент или сертификат. Эти два решения не заменяют друг друга.',
      },
      {
        title: 'Как читать правило',
        text:
          'Для товара нужно проверить название из кассы, финансовую категорию, тип продажи и, если выбран абонемент, конкретный тип абонемента. Для сертификата важно понимать, какой сертификат будет создан при привязке продажи.',
      },
      {
        title: 'Как не сломать отчет',
        text:
          'Не меняй смысл товара только ради удобного названия. Если товар уже продавался, изменение правила влияет на будущую обработку и может изменить ожидания команды по очереди привязки.',
      },
    ],
  }),
  'manager.prepayments.pending-sales': makeTextLesson({
    title: 'Как работает очередь привязки продаж',
    summary:
      'Очередь привязки появляется, когда CRM видит продажу абонемента или сертификата, но не может надежно определить клиента.',
    blocks: [
      {
        title: 'Когда появляется очередь',
        text:
          'После чека Эвотора CRM смотрит настройки продаж. Если строка относится к абонементу или сертификату и клиента нельзя определить автоматически, создается ожидающая продажа для ручной привязки.',
      },
      {
        title: 'Что сверять перед привязкой',
        text:
          'Проверь товар, сумму, дату чека, тип продажи и клиента. Ошибка привязки создаст активный абонемент или сертификат не тому человеку, поэтому поиск клиента должен быть аккуратным.',
      },
      {
        title: 'Что происходит после привязки',
        text:
          'Для абонемента CRM создает клиентский абонемент с типом, сроком и остатком занятий. Для сертификата CRM создает сертификат с кодом, номиналом или количеством услуг и сроком действия.',
      },
      {
        title: 'Когда игнорировать или отменять',
        text:
          'Игнорирование подходит для ошибочной или неактуальной строки, которую не нужно превращать в обязательство. Отмена нужна, когда продажа больше не должна обрабатываться, но след решения должен остаться в истории.',
      },
    ],
  }),
  'manager.subscriptions.types-review': makeTextLesson({
    title: 'Как устроены типы абонементов',
    summary:
      'Тип абонемента задает правила будущего клиентского абонемента: формат, срок, цену и количество занятий.',
    blocks: [
      {
        title: 'Что хранит тип',
        text:
          'Тип абонемента хранит название, вид тренировки, сегмент времени, количество занятий, срок действия, цену, признак безлимита и бонусные персональные занятия, если они есть.',
      },
      {
        title: 'Как тип превращается в абонемент клиента',
        text:
          'Когда ожидающая продажа с типом абонемента привязана к клиенту, CRM копирует настройки типа в клиентский абонемент. После этого остаток и срок живут уже в карточке клиента.',
      },
      {
        title: 'Как читается остаток',
        text:
          'Остаток = «Всего занятий» - «Использовано». Для безлимитного абонемента остаток не уходит в минус, потому что ограничение работает по сроку и условиям тарифа, а не по количеству списаний.',
      },
      {
        title: 'Что проверять при изменениях',
        text:
          'Перед изменением типа проверь, не используется ли он в текущих продажах. Изменение справочника должно быть понятным для будущих продаж и не должно скрывать смысл уже созданных клиентских абонементов.',
      },
    ],
  }),
  'manager.certificates.review': makeTextLesson({
    title: 'Как CRM ведет сертификаты',
    summary:
      'Сертификат в CRM связан с продажей, клиентом, кодом, сроком, остатком и историей списаний.',
    blocks: [
      {
        title: 'Типы сертификатов',
        text:
          'Денежный сертификат хранит сумму и списывается рублями. Сервисный сертификат хранит услугу или пакет и списывается количеством. Поэтому в списке важно смотреть не только название, но и тип.',
      },
      {
        title: 'Как появляется сертификат',
        text:
          'Сертификат создается после привязки ожидающей продажи из Эвотора к клиенту. CRM может сгенерировать код автоматически или принять введенный вручную код, если он уникален.',
      },
      {
        title: 'Как читается статус',
        text:
          'Активный сертификат можно использовать. Погашенный уже израсходован. Истекший вышел за срок действия. Отмененный не должен использоваться для новой услуги.',
      },
      {
        title: 'Как контролировать списания',
        text:
          'Смотри историю: дата, кто списал, сумма или количество, комментарий и возможная отмена ошибки. История нужна, чтобы остаток сертификата был проверяемым.',
      },
    ],
  }),
  'manager.corporate.review': makeTextLesson({
    title: 'Как устроены корпоративные балансы',
    summary:
      'Корпоративный клиент хранит денежный баланс, который пополняется через финансы и списывается по фактическим услугам.',
    blocks: [
      {
        title: 'Что такое корпоративный клиент',
        text:
          'Корпоративный клиент - это компания с контактными данными, статусом и текущим балансом. В отличие от абонемента, здесь не считаются занятия по пакету, а ведется денежный остаток.',
      },
      {
        title: 'Как работает пополнение',
        text:
          'Пополнение создается как запись корпоративного баланса и должно быть связано с ручным финансовым доходом. Так деньги попадают в финансовый отчет и одновременно увеличивают баланс компании.',
      },
      {
        title: 'Как работает списание',
        text:
          'Списание уменьшает баланс и хранит дату, услугу, сумму, участника или клиента, если он указан, и комментарий. Нельзя списывать больше остатка без отдельного разрешенного сценария.',
      },
      {
        title: 'Как читать детализацию',
        text:
          'Детализация показывает пополнения, списания, отмены и остаток после операций за период. Она нужна, чтобы объяснить корпоративному клиенту, какие услуги были использованы.',
      },
    ],
  }),
  'manager.prepayments.dashboard-review': makeTextLesson({
    title: 'Как читать единый экран предоплат',
    summary:
      'Экран предоплат собирает все обязательства клуба перед клиентами и компаниями в один рабочий обзор.',
    blocks: [
      {
        title: 'Главные блоки',
        text:
          'Смотри очередь продаж, активные абонементы, активные сертификаты и корпоративные балансы. Каждый блок показывает не только количество, но и риски: скоро истекает, низкий остаток или продажа требует привязки.',
      },
      {
        title: 'Фильтры и поиск',
        text:
          'Фильтры по типу, статусу и сроку помогают быстро найти проблему. Поиск по клиенту, коду сертификата или компании нужен, когда сотрудник отвечает на конкретный запрос.',
      },
      {
        title: 'Как читать суммы',
        text:
          'Сумма ожидающих продаж - деньги из чеков, которые еще не стали абонементом или сертификатом. Сумма корпоративных остатков - деньги компаний, доступные для будущих списаний. Эти цифры показывают обязательства, а не новую выручку.',
      },
      {
        title: 'Что делать после просмотра',
        text:
          'После экрана должно быть понятно, где нужна привязка продажи, продление коммуникации, списание услуги или проверка корпоративной детализации.',
      },
    ],
  }),
  'owner.prepayments.dashboard-review': makeTextLesson({
    title: 'Как владельцу читать сводку предоплат',
    summary:
      'Сводка показывает, какие оплаченные услуги еще не полностью отработаны в CRM.',
    blocks: [
      {
        title: 'Что означает сводка',
        text:
          'Предоплаты - это не просто продажи. Это обязательства клуба: абонементы с оставшимися занятиями, сертификаты с остатком, корпоративные деньги и продажи, которые еще ждут привязки к клиенту.',
      },
      {
        title: 'Как читать риски',
        text:
          'Скоро истекающие абонементы и сертификаты требуют внимания команды. Низкий корпоративный остаток помогает заранее увидеть, что компания скоро потребует пополнение. Ожидающая продажа показывает незавершенный операционный хвост.',
      },
      {
        title: 'Как связаны блоки',
        text:
          'Продажа из Эвотора может сначала попасть в очередь, затем после привязки стать абонементом или сертификатом. Корпоративное пополнение идет через ручную финансовую операцию и увеличивает баланс компании.',
      },
      {
        title: 'Где проверять детали',
        text:
          'Из сводки переходи в каталог для правил продаж, в карточку клиента для абонемента, в сертификаты для кода и остатка, в корпоративных клиентов для баланса и детализации.',
      },
    ],
  }),
  'owner.prepayments.sale-mapping': makeTextLesson({
    title: 'Как проверять правила продаж Эвотора',
    summary:
      'Правила продаж определяют, какие строки кассового чека создают абонементы и сертификаты.',
    blocks: [
      {
        title: 'Две разные настройки',
        text:
          'Финансовая категория отвечает за отчет прибыли. Тип продажи отвечает за создание обязательства: абонемента или сертификата. Если настроить только категорию, CRM увидит выручку, но не создаст клиентский остаток.',
      },
      {
        title: 'Что проверять у товара',
        text:
          'Смотри название из кассы, категорию, тип продажи и связанный тип абонемента, если товар продает абонемент. Для сертификата проверь, какой вид сертификата должен создаваться при привязке продажи.',
      },
      {
        title: 'Как понять ошибку',
        text:
          'Если продажа не попала в очередь, проверь тип продажи. Если деньги попали в отчет не туда, проверь финансовую категорию. Если создался неверный абонемент, проверь связанный тип абонемента.',
      },
      {
        title: 'Почему нельзя хардкодить товары',
        text:
          'Названия товаров в кассе могут меняться. Поэтому CRM должна опираться на настраиваемые правила, а не на зашитые в код названия из прайса.',
      },
    ],
  }),
  'owner.subscriptions.lifecycle-review': makeTextLesson({
    title: 'Как работает жизненный цикл абонемента',
    summary:
      'Абонемент начинается с продажи, проходит через активацию на клиента и дальше живет через списания, остаток и статус.',
    blocks: [
      {
        title: 'Продажа и активация',
        text:
          'Товар Эвотора с типом абонемента создает ожидающую продажу, если клиент неизвестен. После привязки к клиенту CRM создает активный абонемент с типом, сроком и количеством занятий.',
      },
      {
        title: 'Остаток и срок',
        text:
          'Остаток = «Всего занятий» - «Использовано». Статус зависит от остатка, срока действия и отмены. Абонемент может быть активным, истекшим, использованным или отмененным.',
      },
      {
        title: 'Списание',
        text:
          'Списание уменьшает остаток и сохраняет историю: дата, услуга, сотрудник и комментарий. Ошибочное списание отменяется отдельной записью, а не незаметным удалением.',
      },
      {
        title: 'Где смотреть в CRM',
        text:
          'Открывай карточку клиента: там видно активные абонементы, историю абонементов, списания и остаток. Единый экран предоплат помогает найти абонементы с рисками по сроку или остатку.',
      },
    ],
  }),
  'owner.certificates.lifecycle-review': makeTextLesson({
    title: 'Как работает жизненный цикл сертификата',
    summary:
      'Сертификат связан с продажей, кодом, клиентом, остатком и историей использования.',
    blocks: [
      {
        title: 'Создание сертификата',
        text:
          'Сертификат создается после привязки ожидающей продажи из Эвотора. У него есть уникальный код, клиент, тип, срок действия и исходный номинал или количество услуг.',
      },
      {
        title: 'Денежный или сервисный',
        text:
          'Денежный сертификат хранит рублевый остаток. Сервисный хранит количество услуг или пакет. Это влияет на форму списания и на то, как сотрудник объясняет остаток клиенту.',
      },
      {
        title: 'Статусы',
        text:
          'Активный сертификат можно списывать. Погашенный израсходован. Истекший вышел за срок действия. Отмененный не должен использоваться.',
      },
      {
        title: 'Контроль истории',
        text:
          'История списаний показывает, кто, когда и на какую сумму или количество использовал сертификат. Отмена ошибочного списания должна оставлять след исправления.',
      },
    ],
  }),
  'owner.corporate.lifecycle-review': makeTextLesson({
    title: 'Как работает корпоративный баланс',
    summary:
      'Корпоративный баланс показывает деньги компании в CRM и движение этих денег по пополнениям и списаниям.',
    blocks: [
      {
        title: 'Пополнение',
        text:
          'Пополнение корпоративного баланса создается или связывается с ручной финансовой операцией. Поэтому сумма отражается и в балансе компании, и в финансовом контуре CRM.',
      },
      {
        title: 'Списание',
        text:
          'Списание уменьшает баланс и хранит дату, услугу, сумму, участника, связанного клиента или бронь, если они указаны. CRM не должна позволять случайно списать больше доступного остатка.',
      },
      {
        title: 'Остаток после операций',
        text:
          'Остаток компании читается как сумма активных пополнений минус активные списания. Отмененные операции не должны уменьшать или увеличивать текущий баланс, но остаются в истории.',
      },
      {
        title: 'Детализация для клиента',
        text:
          'Выгрузка детализации показывает движение за период: дату, услугу, участника, сумму, комментарий и остаток после операции. Это основной способ объяснить корпоративному клиенту использование средств.',
      },
    ],
  }),
  'accountant.prepayments.dashboard-review': makeTextLesson({
    title: 'Как бухгалтеру читать корпоративные остатки в предоплатах',
    summary:
      'Для бухгалтера экран предоплат нужен прежде всего для сверки корпоративных балансов с финансовыми операциями.',
    updatedAt: PREPAYMENTS_SCREENSHOT_UPDATED_AT,
    blocks: [
      {
        title: 'Что нажать: открыть предоплаты',
        type: 'step',
        text:
          'Открой раздел «Предоплаты» и работай с корпоративными остатками. Для роли бухгалтера фокус — компании, текущий баланс, признаки низкого остатка и переход к корпоративной карточке.',
        items: [
          'Не ориентируйся на блоки продаж, абонементов или сертификатов, если они скрыты для роли.',
          'Для бухгалтерской сверки переходи в корпоративную карточку и финансовый контур.',
        ],
      },
      {
        title: 'Что сверить с финансами',
        type: 'step',
        text:
          'Сверь корпоративный баланс со связанными ручными финансовыми операциями. Пополнение должно увеличивать баланс компании и иметь корректную запись дохода в финансах.',
        items: [
          'Баланс отвечает на вопрос, сколько компания еще может использовать.',
          'Финансовая операция отвечает на вопрос, какой доход попал в отчет.',
        ],
      },
      {
        title: 'Как проверить результат',
        type: 'step',
        text:
          'Результат сверки засчитан, если текущий корпоративный остаток объясняется активными пополнениями, списаниями, отменами и экспортом детализации за период. Если баланс не сходится, проверь связанные финансовые записи и отмененные операции.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/knowledge/prepayments/overview.png',
        alt: 'Раздел предоплат для бухгалтера',
        caption:
          'Общий вид раздела «Предоплаты» для перехода к корпоративным остаткам.',
      },
    ],
  }),
  'accountant.corporate.deposit-review': makeTextLesson({
    title: 'Как корпоративное пополнение связано с финансами',
    summary:
      'Корпоративное пополнение должно одновременно увеличить баланс компании и быть отражено в финансовом контуре.',
    blocks: [
      {
        title: 'Что нажать: открыть корпоративную карточку',
        type: 'step',
        text:
          'Открой «Корпоративные клиенты», выбери компанию и перейди к операциям баланса. Пополнение оформляй или проверяй из карточки компании.',
        items: [
          'Проверь, что выбрана правильная компания.',
          'Сумма пополнения должна относиться к корпоративному балансу, а не к обычной продаже клиента.',
        ],
      },
      {
        title: 'Что заполнить или связать',
        type: 'step',
        text:
          'При пополнении проверь сумму, дату, категорию, комментарий и связь с финансовой операцией. Можно создать ручной финансовый доход из пополнения или связать пополнение с уже существующей операцией.',
        items: [
          'Если финансовой связи нет, финансовый отчет может потерять доход.',
          'Если операция учебная, у нее должен быть учебный признак.',
        ],
      },
      {
        title: 'Как проверить результат',
        type: 'step',
        text:
          'После сохранения проверь, что баланс компании увеличился, в истории появилась строка пополнения, а в финансах есть связанный доход. При отмене пополнение должно остаться в истории и перестать влиять на активный остаток.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/knowledge/corporate-clients/overview.png',
        alt: 'Раздел корпоративных клиентов в CRM',
        caption:
          'Общий вид раздела «Корпоративные клиенты», откуда открывается карточка компании и операции баланса.',
      },
    ],
  }),
  'accountant.corporate.export-review': makeTextLesson({
    title: 'Как читать экспорт корпоративной детализации',
    summary:
      'Экспорт корпоративной детализации показывает движение баланса компании за выбранный период.',
    blocks: [
      {
        title: 'Что нажать: открыть детализацию компании',
        type: 'step',
        text:
          'Открой карточку корпоративного клиента и перейди к детализации или экспорту операций. Период выбирай по запросу компании или отчетному месяцу.',
        items: [
          'Слишком широкий период усложняет сверку.',
          'Слишком узкий период может скрыть пополнение, списание или отмену.',
        ],
      },
      {
        title: 'Что сверить в выгрузке',
        type: 'step',
        text:
          'В выгрузке должны быть дата, тип операции, услуга, участник или клиент, сумма, комментарий и остаток после операции. Отмененная операция остается в истории как исправление.',
        items: [
          'Активные строки влияют на остаток.',
          'Отмененные строки объясняют прошлое исправление, но не должны менять текущий баланс.',
        ],
      },
      {
        title: 'Как проверить результат',
        type: 'step',
        text:
          'После экспорта открой файл и проверь, что строки за выбранный период совпадают с карточкой компании, а итоговый остаток объясняется пополнениями, списаниями и отменами.',
      },
      {
        title: 'Что сверять перед отправкой',
        type: 'step',
        text:
          'Перед передачей детализации проверь название компании, период, начальный и конечный остаток, а также подозрительные строки без услуги или комментария.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/knowledge/corporate-clients/overview.png',
        alt: 'Раздел корпоративных клиентов для экспорта детализации',
        caption:
          'Общий вид раздела «Корпоративные клиенты», откуда открывается карточка компании и экспорт детализации.',
      },
    ],
  }),
  'manager.methodology.review-base': makeTextLesson({
    title: 'Как устроена методическая база тренировок',
    summary:
      'Методическая база хранит навыки и упражнения, из которых CRM собирает рекомендации, планы и структурные записи тренировок.',
    blocks: [
      {
        title: 'Навыки',
        text:
          'Навык описывает то, чему учится игрок: техническое действие, тактическое решение, игровую ситуацию, парное взаимодействие или физико-координационный элемент. Навык нужен карте клиента и рекомендациям, поэтому название должно быть однозначным.',
      },
      {
        title: 'Упражнения',
        text:
          'Упражнение связано с главным навыком, может иметь дополнительные навыки, ступень упражнения, формат занятия, диапазон уровня навыка, критерий успеха, упрощение и усложнение. Утвержденные упражнения участвуют в рекомендациях; черновики не должны попадать в автоматический план.',
      },
      {
        title: 'Статусы и права',
        text:
          'Владелец и управляющий могут управлять навыками и утверждать упражнения. Тренер может смотреть методику и создавать свои черновики упражнений, но не утверждает их сам. Это защищает общую базу от случайного разнобоя.',
      },
      {
        title: 'Как читать раздел',
        text:
          'Сначала смотри активные навыки по направлениям, потом упражнения по статусу, ступени, формату и уровню навыка. Если рекомендация не может подобрать упражнение, чаще всего не хватает утвержденного упражнения в нужном навыке, формате или ступени.',
      },
    ],
  }),
  'manager.methodology.analytics-review': makeTextLesson({
    title: 'Как читать аналитику методики',
    summary:
      'Аналитика методики показывает, хватает ли базы упражнений и насколько планы совпадают с фактическими тренировками.',
    blocks: [
      {
        title: 'Покрытие базы',
        text:
          'CRM считает, по каким навыкам есть активные упражнения и где есть пробелы. Если у навыка нет утвержденных упражнений, рекомендация может оставить ручной блок или выбрать менее точный вариант.',
      },
      {
        title: 'Планы и факт',
        text:
          'План тренировки хранится как запланированный до занятия и как завершенный после фиксации фактических результатов. В завершенном плане CRM сравнивает запланированные упражнения с тем, что тренер записал по факту.',
      },
      {
        title: 'Отклонения от рекомендации',
        text:
          'Отклонение означает, что упражнение из плана не совпало с фактической структурной записью. Это не всегда ошибка: тренер мог адаптировать занятие. Но частые отклонения показывают, что база, рекомендации или дисциплина фиксации требуют проверки.',
      },
      {
        title: 'Что именно проверять в CRM',
        text:
          'Смотри период, тренеров, планы, покрытие навыков, повторы и примеры отклонений. Задача раздела - показать, где данные методики не объясняют фактический тренировочный процесс.',
      },
    ],
  }),
  'owner.methodology.review-base': makeTextLesson({
    title: 'Как CRM хранит методическую базу',
    summary:
      'Методическая база в CRM связывает навыки, упражнения, уровни сложности и тренировочные записи в единую систему.',
    blocks: [
      {
        title: 'Что открыть на экране',
        text:
          'В разделе методики владелец видит список навыков и упражнений. Навыки группируются по направлениям, упражнения имеют статус, формат, ступень, критерий успеха и связь с навыками.',
      },
      {
        title: 'Как данные используются дальше',
        text:
          'Активные навыки попадают в карту навыков клиента. Утвержденные упражнения участвуют в персональных и групповых рекомендациях. Структурная запись тренировки использует эти же упражнения, чтобы CRM могла обновить карту навыков.',
      },
      {
        title: 'Какие статусы важны',
        text:
          'Активный навык доступен для работы. Архивный навык сохраняет историю, но не должен расширять новые сценарии. Упражнение в черновике еще не участвует в автоматике, утвержденное участвует, архивное остается в истории.',
      },
      {
        title: 'Как пользоваться разделом в CRM',
        text:
          'Используй фильтры по направлению, статусу, формату, уровню навыка и ступени упражнения. Так можно проверить, почему рекомендация выбирает или не выбирает конкретное упражнение.',
      },
    ],
  }),
  'owner.methodology.analytics-review': makeTextLesson({
    title: 'Как CRM считает аналитику методики',
    summary:
      'Аналитика методики показывает покрытие базы упражнений, выполнение планов и расхождения между планом и фактом.',
    blocks: [
      {
        title: 'Что считается по базе',
        text:
          'CRM показывает, какие навыки покрыты утвержденными упражнениями, где нет упражнений для нужной ступени или формата и какие элементы чаще оказываются ручными блоками.',
      },
      {
        title: 'Что считается по планам',
        text:
          'План считается запланированным, пока занятие не завершено. После завершения он становится завершенным. Для завершенного плана CRM сравнивает упражнения из плана с фактическими структурными результатами в тренировочной записи.',
      },
      {
        title: 'Как читать совпадение плана и факта',
        text:
          'Совпадение = фактически записанные упражнения из занятия совпали с упражнениями запланированного плана. Если часть упражнений отсутствует или добавлены другие, CRM показывает отклонение. Это помогает проверить не человека, а качество данных в методическом контуре.',
      },
      {
        title: 'Как пользоваться разделом в CRM',
        text:
          'Выбери период и смотри сводные показатели, тренеров, примеры планов и причины расхождений. Раздел нужен, чтобы найти место в системе, где методика, планы или фиксация занятий расходятся.',
      },
    ],
  }),
  'trainer.methodology.review-base': makeTextLesson({
    title: 'Как тренеру пользоваться методической базой',
    summary:
      'Методическая база дает тренеру общий список навыков и упражнений, но защищает утверждение упражнений управленческими правами.',
    blocks: [
      {
        title: 'Что нажать: открыть методику',
        type: 'step',
        text:
          'Открой раздел «Методика». В роли тренера используй активные навыки, утвержденные упражнения и свои черновики для подготовки занятия.',
        items: [
          'Не утверждай общую базу сам: это действие старшей роли.',
          'Если нужен новый вариант упражнения, создай черновик с понятным описанием.',
        ],
      },
      {
        title: 'Что сверить в упражнении',
        type: 'step',
        text:
          'Перед использованием упражнения сверяй главный навык, дополнительные навыки, ступень, формат, диапазон уровня, критерий успеха, упрощение и усложнение.',
        items: [
          'Черновик не используй как автоматическую рекомендацию.',
          'Архивное упражнение не добавляй в новый план.',
        ],
      },
      {
        title: 'Как проверить результат',
        type: 'step',
        text:
          'Результат засчитан, если ты нашел подходящее утвержденное упражнение для занятия или создал черновик с критерием успеха и адаптациями для проверки старшей ролью.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/knowledge/methodology/overview.png',
        alt: 'Раздел методики тренировок',
        caption:
          'Общий вид раздела «Методика», где тренер сверяет навыки, упражнения и статусы.',
      },
    ],
  }),
  'trainer.client.skill-map-review': makeTextLesson({
    title: 'Как читать карту навыков игрока',
    summary:
      'Карта навыков показывает текущий уровень каждого активного навыка, последний тренировочный факт и следующую ступень упражнения.',
    blocks: [
      {
        title: 'Что нажать: открыть карточку игрока',
        type: 'step',
        text:
          'Открой тренерский кабинет, найди игрока по имени и перейди в его тренировочную карточку. Используй карту навыков как рабочий ориентир для следующего занятия.',
        items: [
          'Не ищи игрока по телефону: тренерский сценарий работает без телефонов.',
          'Если игрок не найден, попроси администратора проверить клиентскую карточку.',
        ],
      },
      {
        title: 'Что сверить в карте навыков',
        type: 'step',
        text:
          'По каждому навыку сверяй уровень от 0 до 5, дату последней отработки, последнее упражнение, последнюю оценку, флаг повтора и следующую ступень упражнения.',
        items: [
          'Флаг повтора означает, что навык или упражнение нужно повторить.',
          'Следующая ступень помогает подобрать упражнение без ручной догадки.',
        ],
      },
      {
        title: 'Как проверить результат',
        type: 'step',
        text:
          'Результат засчитан, если ты выбрал фокус следующего занятия по карте навыков и не используешь скрытые для тренера персональные CRM-поля.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/trainer/trainer/overview.png',
        alt: 'Тренерский кабинет с карточками игроков',
        caption:
          'Общий вид тренерского кабинета без телефонов и лишних персональных данных.',
      },
    ],
  }),
  'trainer.training-note.structured-record': makeTextLesson({
    title: 'Как структурно зафиксировать тренировку',
    summary:
      'Структурная запись связывает занятие с упражнениями из методической базы и дает CRM данные для обновления карты навыков.',
    blocks: [
      {
        title: 'Что нажать: открыть дневник тренировки',
        type: 'step',
        text:
          'Открой карточку игрока в тренерском кабинете и перейди к созданию или редактированию тренировочной записи. Структурные результаты заполняй внутри дневника занятия.',
        items: [
          'Запись должна относиться к фактической тренировке.',
          'Свободную заметку используй только для короткого тренировочного вывода.',
        ],
      },
      {
        title: 'Что заполнить в структурной записи',
        type: 'step',
        text:
          'Выбери дату, уровень игрока, упражнения из утвержденной базы, оценку выполнения и при необходимости флаг повтора по упражнению или навыку. После проверки нажми «Сохранить».',
        items: [
          'Оценка 1/5 или 2/5 ставит повтор и предлагает вернуться на шаг ниже.',
          'Оценка 3/5 оставляет уровень и требует закрепления.',
          'Две подходящие оценки 4/5 или 5/5 без флага повтора могут повысить уровень навыка.',
        ],
      },
      {
        title: 'Как проверить результат',
        type: 'step',
        text:
          'После сохранения проверь, что запись появилась в дневнике, упражнения отображаются списком, карта навыков обновилась ожидаемо, а текст заметки не содержит лишних персональных данных.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/trainer/trainer/overview.png',
        alt: 'Тренерский кабинет для ведения дневника',
        caption:
          'Общий вид тренерского кабинета, откуда открывается карточка игрока и дневник тренировок.',
      },
    ],
  }),
  'trainer.recommendation.personal-review': makeTextLesson({
    title: 'Как читать персональную рекомендацию',
    summary:
      'Персональная рекомендация выбирает навыки и упражнения по карте конкретного игрока, истории тренировок и цели занятия.',
    blocks: [
      {
        title: 'Что нажать: открыть рекомендацию игрока',
        type: 'step',
        text:
          'Открой карточку игрока в тренерском кабинете и перейди к персональной рекомендации или подготовке плана. Рекомендацию используй как основу, а не как слепую замену тренерского решения.',
        items: [
          'Сначала проверь актуальность карты навыков игрока.',
          'Если структурной истории мало, рекомендация может дать ручной блок.',
        ],
      },
      {
        title: 'Что сверить в рекомендации',
        type: 'step',
        text:
          'Сверь выбранные навыки, причину приоритета, упражнения, формат, ступень и диапазон уровня. Приоритет получают слабые или давно не отработанные навыки, низкая последняя оценка, флаг повтора или совпадение с целью занятия.',
        items: [
          'Недавно успешно закрепленный навык обычно получает меньший приоритет.',
          'Если упражнение повторяется слишком часто, проверь причину выбора.',
        ],
      },
      {
        title: 'Как проверить результат',
        type: 'step',
        text:
          'Проверь, что в рекомендации видны причина выбора, выбранный навык, упражнение и ручные блоки. Если подходящего упражнения нет, подготовь ручную адаптацию или предложи черновик в методическую базу.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/trainer/trainer/overview.png',
        alt: 'Тренерский кабинет для персональной рекомендации',
        caption:
          'Общий вид тренерского кабинета, где открывается игрок и персональная рекомендация.',
      },
    ],
  }),
  'trainer.recommendation.group-review': makeTextLesson({
    title: 'Как читать групповую рекомендацию',
    summary:
      'Групповая рекомендация ищет общий тренировочный фокус по нескольким участникам и оставляет место для дифференциации.',
    blocks: [
      {
        title: 'Что нажать: открыть групповую рекомендацию',
        type: 'step',
        text:
          'Открой подготовку групповой тренировки или групповую рекомендацию. Выбери участников и цель занятия, затем проверь предложенные блоки плана.',
        items: [
          'Состав группы должен соответствовать фактическим участникам.',
          'Если участник выбран ошибочно, рекомендация будет построена по неверной карте навыков.',
        ],
      },
      {
        title: 'Что сверить по группе',
        type: 'step',
        text:
          'Сверь общие слабые места, флаги повтора, историю упражнений и цель занятия. В плане проверь разминку, навык большинства, дифференцированную отработку, игровую связку и мини-игру.',
        items: [
          'Если уровни участников разные, проверь упрощение и усложнение упражнения.',
          'Ручной блок требует решения тренера, а не пропуска.',
        ],
      },
      {
        title: 'Как проверить результат',
        type: 'step',
        text:
          'Результат засчитан, если групповой план можно провести для всех участников: общий фокус понятен, дифференциация описана, а ручные блоки либо заполнены, либо осознанно оставлены для тренерской адаптации.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/trainer/trainer/overview.png',
        alt: 'Тренерский кабинет для групповой рекомендации',
        caption:
          'Общий вид тренерского кабинета, где тренер работает с участниками и подготовкой занятия.',
      },
    ],
  }),
  'trainer.training-plan.lifecycle': makeTextLesson({
    title: 'Как работает запланированный и завершенный план',
    summary:
      'План тренировки сначала хранит подготовленную структуру занятия, а после завершения превращается в фактические тренировочные записи.',
    blocks: [
      {
        title: 'Что нажать: открыть план тренировки',
        type: 'step',
        text:
          'Открой план тренировки из тренерского кабинета, рекомендации или тренировочной брони. Запланированный план содержит дату, тренера, участников, цель и упражнения.',
        items: [
          'Проверь, что план относится к нужному занятию.',
          'Если план пришел из брони, сверяй дату, участников и ответственного тренера.',
        ],
      },
      {
        title: 'Что можно менять до занятия',
        type: 'step',
        text:
          'Пока план запланирован, тренер может заменить упражнения, если занятие требует адаптации. Выбирай утвержденные упражнения и не дублируй одно упражнение в плане без причины.',
        items: [
          'Сохраняй цель занятия понятной.',
          'Если упражнение заменено вручную, проверь, что оно подходит уровню игрока или группы.',
        ],
      },
      {
        title: 'Как проверить результат после завершения',
        type: 'step',
        text:
          'После завершения проверь, что фактические упражнения попали в тренировочные записи участников, план получил завершенное состояние, а карта навыков пересчиталась по структурным результатам.',
      },
    ],
    screenshots: [
      {
        src: '/onboarding/trainer/trainer/overview.png',
        alt: 'Тренерский кабинет для работы с планом тренировки',
        caption:
          'Общий вид тренерского кабинета, откуда тренер открывает планы, дневник и рекомендации.',
      },
    ],
  }),
  'manager.client-base.create': makeCardLesson({
    title: 'Как создать базу клиентов',
    summary:
      'Клиентская база сохраняет сегмент, из которого менеджер запускает повторные касания и обзвоны.',
    overviewTitle: 'Открой список клиентских баз',
    overviewText:
      'На странице баз видно, какие сегменты уже используются, сколько клиентов в каждом сегменте и когда по ним создавались задачи.',
    overviewItems: [
      'Сначала проверь, нет ли уже подходящей базы.',
      'Смотри на фильтр, количество клиентов и дату последней задачи.',
    ],
    detailTitle: 'Настрой сегмент под цель',
    detailText:
      'Новая база должна отвечать на конкретную операционную задачу: вернуть новичков, прозвонить пропавших или собрать клиентов по источнику.',
    detailItems: [
      'Название должно объяснять, кого собрали.',
      'Срок прозвона помогает не потерять задачу.',
      'Фильтр должен быть воспроизводимым для следующего менеджера.',
    ],
    finalTitle: 'Перед сохранением',
    finalText:
      'Проверь, что сегмент не дублирует существующую базу и что команда поймет, зачем по нему работать.',
    screenshot: {
      role: 'manager',
      slug: 'client-bases',
      overviewAlt: 'Список клиентских баз менеджера',
      overviewCaption: 'Проверь существующие сегменты перед созданием новой базы.',
      detailAlt: 'Детали клиентских баз менеджера',
      detailCaption: 'Сверь фильтр, срок прозвона и последний запуск задачи.',
    },
  }),
  'manager.call-task.create': makeCardLesson({
    title: 'Как создать задачу обзвона',
    summary:
      'Задача обзвона превращает клиентскую базу в понятную работу с исполнителем, сроком и контролем результата.',
    overviewTitle: 'Открой задачи обзвона',
    overviewText:
      'В списке задач видно статус, базу, исполнителя и прогресс. Перед созданием новой задачи проверь, что похожий обзвон уже не запущен.',
    overviewItems: [
      'Активные задачи не должны конкурировать за одних и тех же клиентов.',
      'Просроченные задачи лучше разобрать до запуска новой волны.',
    ],
    detailTitle: 'Задай исполнителя и цель',
    detailText:
      'В задаче должны быть понятны база, ответственный, срок и ожидаемый результат: запись, реактивация или уточнение статуса клиента.',
    detailItems: [
      'Исполнитель должен иметь доступ к обзвонам.',
      'Срок нужен для ежедневного контроля.',
      'Комментарий помогает одинаково вести разговор.',
    ],
    finalTitle: 'После запуска',
    finalText:
      'Проверь, что задача появилась в списке и что по ней можно открыть состав клиентов и отчет.',
    screenshot: {
      role: 'manager',
      slug: 'call-tasks',
      overviewAlt: 'Список задач обзвона менеджера',
      overviewCaption: 'Сначала оцени активные и просроченные обзвоны.',
      detailAlt: 'Контекст задачи обзвона',
      detailCaption: 'Задача должна иметь базу, ответственного, срок и цель.',
    },
  }),
  'manager.call-task.read-report': makeCardLesson({
    title: 'Как прочитать отчет по обзвону',
    summary:
      'Отчет по обзвону показывает, дошла ли команда до клиентов и где нужно вмешательство менеджера.',
    overviewTitle: 'Открой список задач',
    overviewText:
      'Начинай с задач в работе: сравни план, просрочку, исполнителя и количество попыток.',
    overviewItems: [
      'Низкая контактность может означать плохое время звонков.',
      'Просрочка требует решения: продлить, перераспределить или закрыть.',
    ],
    detailTitle: 'Разбери результат',
    detailText:
      'Внутри задачи смотри статусы клиентов, последние попытки и итоговые реакции. Это помогает понять, где нужна новая гипотеза.',
    detailItems: [
      'Отдельно смотри клиентов без попыток.',
      'Записи и отказы оценивай вместе с источником базы.',
    ],
    finalTitle: 'Решение менеджера',
    finalText:
      'После отчета нужно принять действие: продолжить обзвон, изменить скрипт, создать новую базу или закрыть задачу.',
    screenshot: {
      role: 'manager',
      slug: 'call-tasks',
      overviewAlt: 'Отчетность задач обзвона',
      overviewCaption: 'Список помогает быстро увидеть просрочки и прогресс.',
      detailAlt: 'Детали задачи обзвона',
      detailCaption: 'В деталях смотри попытки, статусы и итоговую конверсию.',
    },
  }),
  'manager.shift.approve': makeCardLesson({
    title: 'Как проверить смену сотрудника',
    summary:
      'Проверка смен нужна, чтобы payroll и операционная история отражали фактическую работу команды.',
    overviewTitle: 'Открой персонал и смены',
    overviewText:
      'В верхнем блоке видны период payroll, предупреждения, часы, выручка и начисления. Начинай сверку с периода.',
    overviewItems: [
      'Период должен совпадать с датами проверки.',
      'Предупреждения показывают смены, которые требуют внимания.',
    ],
    detailTitle: 'Сверь смены и начисления',
    detailText:
      'Проверь строки смен: сотрудник, дата, часы, выручка и итог. Если данные спорные, разберись до изменения статуса payroll.',
    detailItems: [
      'Черновики нельзя утверждать без проверки.',
      'Ручные корректировки должны иметь понятную причину.',
    ],
    finalTitle: 'Когда можно подтверждать',
    finalText:
      'Смену можно считать проверенной, когда период, часы, выручка и начисления не конфликтуют с фактической работой.',
    screenshot: {
      role: 'manager',
      slug: 'staff',
      overviewAlt: 'Персонал и payroll менеджера',
      overviewCaption: 'Начинай проверку с периода, предупреждений и метрик payroll.',
      detailAlt: 'Список смен и сотрудников',
      detailCaption: 'Сверяй сотрудников, смены, часы и начисления.',
    },
  }),
  'manager.motivation.update': makeCardLesson({
    title: 'Как обновить правило мотивации',
    summary:
      'Правила мотивации влияют на начисления команды, поэтому любое изменение должно быть осознанным и проверяемым.',
    overviewTitle: 'Открой мотивацию',
    overviewText:
      'На странице видно активные правила, условия начисления и связь с продажами или сменами.',
    overviewItems: [
      'Сначала проверь, какое правило уже действует.',
      'Не меняй правило, если не понимаешь, на какие начисления оно влияет.',
    ],
    detailTitle: 'Измени только нужное значение',
    detailText:
      'Правка должна быть минимальной: процент, сумма, категория или период действия. После изменения перепроверь формулировку правила.',
    detailItems: [
      'Старые периоды payroll лучше не трогать без причины.',
      'Команда должна понимать, за что начисляется бонус.',
    ],
    finalTitle: 'После сохранения',
    finalText:
      'Проверь период действия, категорию, роль или сотрудника, условие начисления и статус правила. Результат корректен, если активно только нужное правило и оно не пересекается с соседними правилами по тем же условиям.',
    screenshot: {
      role: 'manager',
      slug: 'motivation',
      overviewAlt: 'Правила мотивации менеджера',
      overviewCaption: 'Начинай с обзора активных правил и условий.',
      detailAlt: 'Детали правил мотивации',
      detailCaption: 'Меняй только конкретное значение и проверяй эффект.',
    },
  }),
  'manager.references.review': makeCardLesson({
    title: 'Как проверить справочники клуба',
    summary:
      'Справочники задают единый язык CRM: источники, статусы, причины и другие значения, которые видит команда.',
    overviewTitle: 'Открой справочники',
    overviewText:
      'Сначала выбери нужный раздел справочника и посмотри, какие значения доступны сотрудникам.',
    overviewItems: [
      'Неактуальные значения создают хаос в отчетах.',
      'Дубли в справочниках портят фильтры и аналитику.',
    ],
    detailTitle: 'Проверь рабочие значения',
    detailText:
      'Сверь названия, активность и порядок значений. Менеджер отвечает за то, чтобы команда выбирала одинаковые причины и источники.',
    detailItems: [
      'Название должно быть коротким и понятным.',
      'Удалять значение стоит только после оценки влияния на историю.',
    ],
    finalTitle: 'Итог проверки',
    finalText:
      'Справочник в порядке, если сотрудник без пояснений понимает, какое значение выбрать в рабочем сценарии.',
    screenshot: {
      role: 'manager',
      slug: 'references',
      overviewAlt: 'Справочники CRM менеджера',
      overviewCaption: 'Выбери раздел и проверь доступные значения.',
      detailAlt: 'Детали справочников CRM',
      detailCaption: 'Сверяй названия, активность и отсутствие дублей.',
    },
  }),
  'manager.visits-analytics.review': makeVisitsAnalyticsManagerLesson({
    title: 'Как разобрать глубокую аналитику посещений',
    summary:
      'Урок показывает четыре вкладки отчета, правила расчета метрик и путь от аналитического сегмента к клиентской базе и задаче обзвона.',
  }),
  'manager.utilization.review': makeCardLesson({
    title: 'Как найти провалы загрузки',
    summary:
      'Утилизация показывает свободную емкость кортов и помогает решить, где нужна акция или обзвон.',
    overviewTitle: 'Открой утилизацию',
    overviewText:
      'Смотри загрузку по дням и кортам. Сначала найди периоды, где свободного времени больше всего.',
    overviewItems: [
      'Провал утром и провал вечером требуют разных действий.',
      'Сравнивай будни, выходные и отдельные корты.',
    ],
    detailTitle: 'Привяжи провал к действию',
    detailText:
      'Для каждого слабого периода выбери реакцию: обзвон базы, промо, перенос тренировки или изменение расписания ресурсов.',
    detailItems: [
      'Не все свободное время одинаково ценно.',
      'Решение должно учитывать спрос и доступность тренеров.',
    ],
    finalTitle: 'Хороший вывод',
    finalText:
      'Отчет полезен, если после него понятно, какой слот, день или корт нужно загрузить первым.',
    screenshot: {
      role: 'manager',
      slug: 'utilization',
      overviewAlt: 'Утилизация кортов менеджера',
      overviewCaption: 'Ищи свободную емкость по дням и кортам.',
      detailAlt: 'Детали утилизации кортов',
      detailCaption: 'Связывай провал загрузки с конкретным действием.',
    },
  }),
  'owner.account.create': makeCardLesson({
    title: 'Как создать пользователя CRM',
    summary:
      'Пользователь CRM получает роль и доступы, поэтому владелец начинает с минимально достаточных прав.',
    overviewTitle: 'Открой пользователей системы',
    overviewText:
      'На странице видны аккаунты, роли, привязка к сотрудникам и статус доступа.',
    overviewItems: [
      'Проверь, нет ли у человека уже активного аккаунта.',
      'Роль должна соответствовать реальной работе сотрудника.',
    ],
    detailTitle: 'Выдай доступ аккуратно',
    detailText:
      'При создании аккаунта выбирай роль, привязку к персоналу и статус. Не выдавай owner или manager без управленческой причины.',
    detailItems: [
      'Admin работает с операционкой, но не управляет всей системой.',
      'Trainer не должен видеть лишние персональные данные.',
      'Viewer нужен только для чтения отчетов.',
    ],
    finalTitle: 'После создания',
    finalText:
      'Проверь, что аккаунт активен, роль верная, а сотрудник сможет войти без лишних прав.',
    screenshot: {
      role: 'owner',
      slug: 'users',
      overviewAlt: 'Пользователи системы владельца',
      overviewCaption: 'Сначала проверь существующие аккаунты и роли.',
      detailAlt: 'Детали пользователей системы',
      detailCaption: 'Выдавай минимальную роль, достаточную для работы.',
    },
  }),
  'owner.audit.review': makeCardLesson({
    title: 'Как проверить журнал действий',
    summary:
      'Журнал действий помогает владельцу понять, кто изменил данные и где появился операционный риск.',
    overviewTitle: 'Открой аудит',
    overviewText:
      'Начинай с фильтров по периоду, пользователю, модулю или действию. Так журнал быстро превращается в расследование.',
    overviewItems: [
      'Сначала формулируй вопрос: кто, что, когда изменил.',
      'Не читай весь журнал подряд без фильтра.',
    ],
    detailTitle: 'Разбери конкретное событие',
    detailText:
      'В событии важны пользователь, тип действия, объект и время. Для чувствительных данных CRM показывает безопасное описание.',
    detailItems: [
      'Сверяй действие с бизнес-контекстом.',
      'При спорной правке переходи к ответственному процессу.',
    ],
    finalTitle: 'Итог проверки',
    finalText:
      'Аудит закрыт, когда понятно, было ли действие ожидаемым и нужно ли менять права, инструкцию или процесс.',
    screenshot: {
      role: 'owner',
      slug: 'audit',
      overviewAlt: 'Журнал действий владельца',
      overviewCaption: 'Фильтруй аудит по вопросу, а не просматривай все подряд.',
      detailAlt: 'Детали журнала действий',
      detailCaption: 'Смотри пользователя, действие, объект и время события.',
    },
  }),
  'owner.onboarding.review-training-data': makeCardLesson({
    title: 'Как проверить учебные данные роли',
    summary:
      'Владелец может смотреть обучение за любую роль и контролировать, что учебные данные отделены от боевой работы.',
    overviewTitle: 'Открой обучение',
    overviewText:
      'На странице обучения владелец видит выбор роли, прогресс и задачи выбранного пути.',
    overviewItems: [
      'Выбор роли не снижает права владельца.',
      'Так можно проверить, что увидит сотрудник конкретной роли.',
    ],
    detailTitle: 'Переключи роль и проверь путь',
    detailText:
      'Выбери роль, открой задания и убедись, что инструкции соответствуют реальному интерфейсу этой роли.',
    detailItems: [
      'Admin должен видеть операционные задачи смены.',
      'Trainer должен видеть безопасный тренерский сценарий.',
      'Viewer должен получать только read-only задачи.',
    ],
    finalTitle: 'Что считать нормой',
    finalText:
      'Учебный путь готов, если владелец может открыть роль, пройти карточки и не увидеть смешения учебных и боевых сценариев.',
    screenshot: {
      role: 'owner',
      slug: 'onboarding',
      overviewAlt: 'Обучение с выбором роли владельца',
      overviewCaption: 'Владелец может переключать роли и проверять путь сотрудника.',
      detailAlt: 'Детали обучения по ролям',
      detailCaption: 'Проверь задачи, прогресс и разделение учебных сценариев.',
    },
  }),
  'owner.finance.review': makeCardLesson({
    title: 'Как прочитать P&L',
    summary:
      'P&L показывает финансовый результат клуба за период: доходы, расходы и итоговую маржу.',
    overviewTitle: 'Открой финансы',
    overviewText:
      'Начинай с периода и верхних метрик: выручка, расходы, прибыль и структура движения денег.',
    overviewItems: [
      'Период должен отвечать на управленческий вопрос.',
      'Сравни итог с загрузкой и посещениями.',
    ],
    detailTitle: 'Проверь структуру',
    detailText:
      'Разбери категории доходов и расходов. Владелец ищет не только сумму, но и причину изменения результата.',
    detailItems: [
      'Смотри крупные статьи отдельно.',
      'Ручные операции должны иметь понятные комментарии.',
    ],
    finalTitle: 'Решение после P&L',
    finalText:
      'После просмотра должно быть ясно, что влияет на прибыль: загрузка, цены, расходы, payroll или структура продаж.',
    screenshot: {
      role: 'owner',
      slug: 'finances',
      overviewAlt: 'Финансы владельца',
      overviewCaption: 'Сначала выбери период и прочитай ключевые финансовые метрики.',
      detailAlt: 'Детали P&L владельца',
      detailCaption: 'Разбирай категории, ручные операции и причину изменения результата.',
    },
  }),
  'owner.utilization.review': makeCardLesson({
    title: 'Как проверить утилизацию кортов',
    summary:
      'Утилизация показывает, где клуб теряет емкость и где можно вырастить выручку без новых ресурсов.',
    overviewTitle: 'Открой утилизацию',
    overviewText:
      'Смотри загрузку по дням, времени и кортам. Владелец ищет стратегические окна роста.',
    overviewItems: [
      'Слабый слот может требовать акции или другого продукта.',
      'Перегруженный слот может требовать пересмотра цены.',
    ],
    detailTitle: 'Сравни емкость и деньги',
    detailText:
      'Утилизация полезна вместе с финансами: свободные часы показывают потенциал, а не только проблему расписания.',
    detailItems: [
      'Отделяй сезонность от системного провала.',
      'Смотри, какие корты и дни повторяют паттерн.',
    ],
    finalTitle: 'Вывод владельца',
    finalText:
      'Хороший вывод формулируется как действие: поднять загрузку, изменить цену, усилить продажи или пересобрать расписание.',
    screenshot: {
      role: 'owner',
      slug: 'utilization',
      overviewAlt: 'Утилизация кортов владельца',
      overviewCaption: 'Ищи стратегические окна роста по дням и кортам.',
      detailAlt: 'Детали утилизации владельца',
      detailCaption: 'Связывай свободную емкость с деньгами и продуктом.',
    },
  }),
  'owner.motivation.review': makeCardLesson({
    title: 'Как проверить мотивацию',
    summary:
      'Мотивация должна поддерживать нужное поведение команды и не создавать неожиданных начислений.',
    overviewTitle: 'Открой правила мотивации',
    overviewText:
      'Сначала посмотри активные правила и то, к каким продажам, сменам или категориям они привязаны.',
    overviewItems: [
      'Правило должно объяснять, за что платится бонус.',
      'Сложные правила повышают риск ошибок payroll.',
    ],
    detailTitle: 'Оцени управленческий смысл',
    detailText:
      'Владелец проверяет не только формулу, но и эффект: стимулирует ли правило нужные действия сотрудников.',
    detailItems: [
      'Сверяй правило с целями месяца.',
      'Проверяй, нет ли пересечений с другими бонусами.',
    ],
    finalTitle: 'Когда правило хорошее',
    finalText:
      'Правило хорошее, если сотрудник понимает мотивацию, бухгалтер может ее проверить, а владелец видит связь с результатом.',
    screenshot: {
      role: 'owner',
      slug: 'motivation',
      overviewAlt: 'Мотивация владельца',
      overviewCaption: 'Сначала проверь активные правила и условия начислений.',
      detailAlt: 'Детали правил мотивации владельца',
      detailCaption: 'Оценивай формулу вместе с управленческим смыслом.',
    },
  }),
  'owner.operations.review-visits': makeVisitsAnalyticsManagerLesson({
    title: 'Как проверить посещения, источники и LTV',
    summary:
      'Урок объясняет четыре вкладки глубокой аналитики посещений и показывает, как owner через role override собирает сегмент в клиентскую базу для дальнейшего обзвона.',
  }),
  'accountant.visits-analytics.review': makeVisitsAnalyticsReadOnlyLesson({
    roleLabel: 'Бухгалтер',
    title: 'Как сверить выручку и LTV посещений',
    summary:
      'Бухгалтер читает аналитику посещений как отчет: применяет фильтры, сверяет выручку, LTV, coverage и экспортирует данные без рабочих действий с базами.',
  }),
  'accountant.finance.review': makeCardLesson({
    title: 'Как проверить P&L за период',
    summary:
      'Бухгалтер проверяет P&L как финансовую сверку: период, категории, ручные операции и итоговую прибыль.',
    overviewTitle: 'Открой финансы',
    overviewText:
      'Выбери нужный период и проверь верхние показатели: доходы, расходы, прибыль и разницу по категориям.',
    overviewItems: [
      'Период должен совпадать с датами сверки.',
      'Необычные суммы ищи через категории и операции.',
    ],
    detailTitle: 'Сверь категории и операции',
    detailText:
      'Разбери финансовые строки: категория, дата, сумма и комментарий должны объяснять происхождение операции.',
    detailItems: [
      'Ручные операции без комментария сложнее проверять.',
      'Ошибочная категория искажает P&L.',
    ],
    finalTitle: 'Когда отчет готов',
    finalText:
      'P&L можно считать проверенным, когда период, суммы, категории и ручные корректировки не вызывают вопросов.',
    screenshot: {
      role: 'accountant',
      slug: 'finances',
      overviewAlt: 'Финансы бухгалтера',
      overviewCaption: 'Начинай сверку с периода и верхних финансовых метрик.',
      detailAlt: 'Детали финансов бухгалтера',
      detailCaption: 'Сверяй категории, операции и комментарии.',
    },
  }),
  'accountant.finance.manual-record': makeCardLesson({
    title: 'Как создать ручную операцию',
    summary:
      'Ручная операция нужна для дохода или расхода, который не пришел из автоматического сценария CRM.',
    overviewTitle: 'Открой финансовый раздел',
    overviewText:
      'Перед добавлением операции убедись, что нужная сумма еще не отражена автоматически в бронях, продажах или payroll.',
    overviewItems: [
      'Дубли ручных операций искажают прибыль.',
      'Дата операции влияет на период отчета.',
    ],
    detailTitle: 'Заполни финансовый смысл',
    detailText:
      'Укажи тип операции, категорию, сумму, дату и комментарий. Комментарий должен объяснять, почему операция внесена вручную. После проверки нажми «Сохранить».',
    detailItems: [
      'Категория определяет место операции в P&L.',
      'Комментарий нужен для будущей сверки.',
    ],
    finalTitle: 'После сохранения',
    finalText:
      'Проверь, что операция попала в правильный период и изменила нужную статью отчета.',
    screenshot: {
      role: 'accountant',
      slug: 'finances',
      overviewAlt: 'Раздел финансов для ручной операции',
      overviewCaption: 'Сначала проверь, что операция не продублирует автоматические данные.',
      detailAlt: 'Детали финансовой операции',
      detailCaption: 'Категория, дата, сумма и комментарий должны быть проверяемыми.',
    },
  }),
  'accountant.finance.export': makeCardLesson({
    title: 'Как сделать экспорт отчета',
    summary:
      'Экспорт нужен для внешней сверки, передачи данных или архива финансового периода.',
    overviewTitle: 'Подготовь период',
    overviewText:
      'Перед экспортом выбери период и проверь, что отчет на экране отражает нужные даты.',
    overviewItems: [
      'Неверный период делает выгрузку бесполезной.',
      'Сначала закрывай очевидные ошибки в категориях.',
    ],
    detailTitle: 'Выгрузи после сверки',
    detailText:
      'Экспортируй отчет только после проверки ключевых метрик, ручных операций и подозрительных сумм.',
    detailItems: [
      'Файл должен соответствовать выбранному периоду.',
      'Повторный экспорт после правок лучше делать заново.',
    ],
    finalTitle: 'Контроль файла',
    finalText:
      'После выгрузки проверь, что файл скачался, а название и период понятны для дальнейшей сверки.',
    screenshot: {
      role: 'accountant',
      slug: 'finances',
      overviewAlt: 'Финансовый отчет перед экспортом',
      overviewCaption: 'Выставь период и проверь отчет до выгрузки.',
      detailAlt: 'Детали финансового экспорта',
      detailCaption: 'Экспортируй только сверенный период.',
    },
  }),
  'accountant.catalog.update-category': makeCardLesson({
    title: 'Как обновить финансовую категорию',
    summary:
      'Финансовые категории управляют тем, как операции попадают в P&L и будущие сверки.',
    overviewTitle: 'Открой справочник товаров',
    overviewText:
      'В каталоге бухгалтер проверяет категории, группы P&L и правила, которые влияют на финансовую отчетность.',
    overviewItems: [
      'Категория должна быть понятна не только бухгалтеру.',
      'Группа P&L определяет место операции в отчете.',
    ],
    detailTitle: 'Сверь параметры категории',
    detailText:
      'Перед правкой проверь название, группу, тип учета и комиссию. Изменение категории влияет на будущие операции. После проверки нажми «Сохранить».',
    detailItems: [
      'Не меняй категорию ради разовой ошибки в операции.',
      'Для спорных случаев лучше завести отдельное правило.',
    ],
    finalTitle: 'После изменения',
    finalText:
      'Проверь, что категория осталась активной там, где нужна, и не нарушила правила сопоставления.',
    screenshot: {
      role: 'accountant',
      slug: 'catalog',
      overviewAlt: 'Справочник товаров бухгалтера',
      overviewCaption: 'Начинай с категорий и групп P&L.',
      detailAlt: 'Детали финансовых категорий',
      detailCaption: 'Сверяй название, группу и влияние на будущие операции.',
    },
  }),
  'accountant.catalog.update-rule': makeCardLesson({
    title: 'Как проверить правило сопоставления',
    summary:
      'Правило сопоставления связывает товар или операцию с финансовой категорией, чтобы отчет собирался автоматически.',
    overviewTitle: 'Открой каталог и правила',
    overviewText:
      'Найди правило, которое отвечает за нужный товар, услугу или тип операции.',
    overviewItems: [
      'Правило должно быть однозначным.',
      'Дубли правил могут отправлять операции в неверные категории.',
    ],
    detailTitle: 'Проверь финансовый результат',
    detailText:
      'Сверь условие, категорию P&L и будущие начисления. Исправляй правило только если понимаешь эффект на отчет.',
    detailItems: [
      'Категория влияет на P&L.',
      'Комиссия или бонус могут влиять на payroll.',
    ],
    finalTitle: 'Контроль после правки',
    finalText:
      'После изменения проверь, что правило стало понятнее и не конфликтует с соседними правилами.',
    screenshot: {
      role: 'accountant',
      slug: 'catalog',
      overviewAlt: 'Правила сопоставления каталога',
      overviewCaption: 'Найди правило для нужного товара или операции.',
      detailAlt: 'Детали правила сопоставления',
      detailCaption: 'Сверяй условие, категорию P&L и влияние на начисления.',
    },
  }),
  'accountant.payroll.review': makeCardLesson({
    title: 'Как проверить начисления сотрудникам',
    summary:
      'Payroll показывает смены, часы, выручку, бонусы и итоговые начисления за период.',
    overviewTitle: 'Открой персонал и смены',
    overviewText:
      'Верхний блок показывает payroll-период, предупреждения и суммарные начисления. Начинай сверку с дат.',
    overviewItems: [
      'Период должен совпадать с расчетным месяцем или неделей.',
      'Предупреждения показывают, где расчет может быть неточным.',
    ],
    detailTitle: 'Сверь строки начислений',
    detailText:
      'Проверь сотрудников, часы, выручку, бонусы и ручные корректировки. Каждая спорная сумма должна иметь объяснение.',
    detailItems: [
      'Черновики требуют дополнительной проверки.',
      'Ручная корректировка без причины должна насторожить.',
    ],
    finalTitle: 'Готовность payroll',
    finalText:
      'Payroll готов к следующему статусу, когда период, смены, бонусы и корректировки проверены и не требуют уточнений.',
    screenshot: {
      role: 'accountant',
      slug: 'staff',
      overviewAlt: 'Payroll бухгалтера',
      overviewCaption: 'Начинай с периода, предупреждений и суммы начислений.',
      detailAlt: 'Детали начислений сотрудникам',
      detailCaption: 'Сверяй сотрудников, часы, бонусы и ручные корректировки.',
    },
  }),
  'trainer.client.open-card': makeCardLesson({
    title: 'Как открыть карточку игрока',
    summary:
      'Тренерский кабинет показывает только нужные для тренировки данные: игрока, уровень, визиты и дневник.',
    overviewTitle: 'Найди игрока безопасно',
    overviewText:
      'Используй поиск по имени и уровень. В тренерском режиме не показываются телефоны и лишние CRM-поля.',
    overviewItems: [
      'Ищи игрока по имени, а не по телефону.',
      'Безопасный режим должен оставаться включенным.',
    ],
    detailTitle: 'Открой карточку тренировки',
    detailText:
      'После выбора игрока справа открывается дневник: последний визит, записи, уровень и форма новой тренировки.',
    detailItems: [
      'Не работай с клиентской базой из тренерского сценария.',
      'Смотри только данные, нужные для занятия.',
    ],
    finalTitle: 'Что проверить',
    finalText:
      'Карточка открыта корректно, если видны тренировочные данные, но нет телефона и лишнего персонального контекста.',
    screenshot: {
      role: 'trainer',
      slug: 'trainer',
      overviewAlt: 'Тренерский кабинет с безопасным поиском',
      overviewCaption: 'Тренер ищет игрока по имени и не видит телефоны.',
      detailAlt: 'Карточка игрока в тренерском кабинете',
      detailCaption: 'В карточке виден дневник тренировок и форма новой записи.',
    },
  }),
  'trainer.training-note.create': makeCardLesson({
    title: 'Как добавить заметку тренировки',
    summary:
      'Заметка тренировки фиксирует дату, уровень, упражнения и короткий вывод для следующего занятия.',
    overviewTitle: 'Выбери игрока',
    overviewText:
      'Найди игрока в тренерском кабинете и убедись, что открыт правильный человек.',
    overviewItems: [
      'Проверяй имя и историю визитов.',
      'Не используй заметку для персональных данных вне тренировки.',
    ],
    detailTitle: 'Заполни тренировочную запись',
    detailText:
      'Укажи дату, уровень, упражнения и заметку. Пиши так, чтобы другой тренер понял, что закрепить дальше. После проверки нажми «Сохранить».',
    detailItems: [
      'Упражнения должны быть конкретными.',
      'Заметка должна описывать прогресс или следующий фокус.',
    ],
    finalTitle: 'После добавления',
    finalText:
      'Проверь, что запись появилась в истории игрока и не содержит лишних персональных данных.',
    screenshot: {
      role: 'trainer',
      slug: 'trainer',
      overviewAlt: 'Выбор игрока для тренировочной заметки',
      overviewCaption: 'Сначала выбери нужного игрока в безопасном кабинете.',
      detailAlt: 'Форма новой тренировочной записи',
      detailCaption: 'Заполни уровень, упражнения и короткий итог тренировки.',
    },
  }),
  'trainer.training-note.update': makeCardLesson({
    title: 'Как уточнить заметку после тренировки',
    summary:
      'Уточнение заметки помогает сохранить точную историю прогресса игрока без лишнего шума.',
    overviewTitle: 'Найди игрока и запись',
    overviewText:
      'Открой игрока, проверь последнюю тренировку и найди запись, которую нужно уточнить.',
    overviewItems: [
      'Не создавай новую запись, если нужно исправить старую.',
      'Сохраняй историю понятной для следующего занятия.',
    ],
    detailTitle: 'Исправь только нужное',
    detailText:
      'Обнови упражнение, уровень или вывод. Не переписывай всю историю, если изменилась одна деталь.',
    detailItems: [
      'Правка должна объяснять тренировочный факт.',
      'Не добавляй администраторские комментарии в дневник тренера.',
    ],
    finalTitle: 'Контроль качества',
    finalText:
      'После правки запись должна быть точнее, но по-прежнему короткой и полезной для тренировки.',
    screenshot: {
      role: 'trainer',
      slug: 'trainer',
      overviewAlt: 'Поиск тренировочной записи',
      overviewCaption: 'Открой игрока и найди запись, которую нужно уточнить.',
      detailAlt: 'Дневник тренировок игрока',
      detailCaption: 'Меняй только нужную тренировочную информацию.',
    },
  }),
  'trainer.training-level.update': makeCardLesson({
    title: 'Как обновить уровень игрока',
    summary:
      'Уровень игрока должен меняться только после наблюдаемого прогресса и понятного обоснования.',
    overviewTitle: 'Открой игрока',
    overviewText:
      'Найди игрока и посмотри текущий уровень, визиты и последние тренировочные записи.',
    overviewItems: [
      'Уровень нельзя менять только по просьбе клиента.',
      'Сначала проверь историю тренировок.',
    ],
    detailTitle: 'Зафиксируй причину изменения',
    detailText:
      'При обновлении уровня оставь понятный вывод: что изменилось в игре и почему новый уровень подходит лучше.',
    detailItems: [
      'Причина должна быть тренировочной, а не административной.',
      'Следующий тренер должен понять решение без уточнений.',
    ],
    finalTitle: 'После обновления',
    finalText:
      'Проверь, что новый уровень виден в карточке и согласуется с последними тренировочными заметками.',
    screenshot: {
      role: 'trainer',
      slug: 'trainer',
      overviewAlt: 'Текущий уровень игрока',
      overviewCaption: 'Сначала проверь историю и текущий уровень.',
      detailAlt: 'Форма тренерской записи с уровнем',
      detailCaption: 'Обновляй уровень только с понятным тренировочным обоснованием.',
    },
  }),
  'viewer.visits-analytics.review': makeVisitsAnalyticsReadOnlyLesson({
    roleLabel: 'Наблюдатель',
    title: 'Как смотреть глубокую аналитику посещений',
    summary:
      'Наблюдатель читает четыре вкладки отчета, применяет фильтры и экспортирует данные без изменения CRM и без рабочих действий с базами.',
  }),
  'viewer.finance.review': makeCardLesson({
    title: 'Как смотреть финансы без изменений',
    summary:
      'Viewer может читать финансовую картину, но не должен создавать или редактировать операции.',
    overviewTitle: 'Открой финансы',
    overviewText:
      'Выбери период и посмотри верхние метрики P&L. В режиме просмотра действия изменения недоступны.',
    overviewItems: [
      'Смотри доходы, расходы и прибыль.',
      'Не пытайся вносить ручные операции.',
    ],
    detailTitle: 'Разбери структуру отчета',
    detailText:
      'Проверь категории и динамику. Viewer фиксирует наблюдения, но не корректирует финансовые данные.',
    detailItems: [
      'Для спорной суммы обращайся к бухгалтеру или владельцу.',
      'Отчет нужно читать в контексте выбранного периода.',
    ],
    finalTitle: 'Граница роли',
    finalText:
      'Задача выполнена, если финансовый отчет понятен, а данные CRM не были изменены.',
    screenshot: {
      role: 'viewer',
      slug: 'finances',
      overviewAlt: 'Финансы наблюдателя',
      overviewCaption: 'Viewer читает P&L без правки операций.',
      detailAlt: 'Детали финансового отчета наблюдателя',
      detailCaption: 'Смотри структуру отчета и передавай вопросы ответственным.',
    },
  }),
  'viewer.utilization.review': makeCardLesson({
    title: 'Как смотреть утилизацию',
    summary:
      'Утилизация в read-only режиме помогает понять загрузку кортов без изменения расписания.',
    overviewTitle: 'Открой утилизацию',
    overviewText:
      'Посмотри период, загрузку и распределение по кортам. Viewer читает отчет, но не управляет ресурсами.',
    overviewItems: [
      'Ищи пики и провалы загрузки.',
      'Не меняй настройки отчета за пределами просмотра периода.',
    ],
    detailTitle: 'Сделай наблюдение',
    detailText:
      'Выдели дни или корты с заметным отклонением. Такой вывод можно передать менеджеру или владельцу.',
    detailItems: [
      'Провал загрузки требует проверки контекста.',
      'Высокая загрузка может означать ограниченную емкость.',
    ],
    finalTitle: 'Итог просмотра',
    finalText:
      'Утилизация прочитана, если понятно, где клуб загружен, где есть свободная емкость и кто должен реагировать.',
    screenshot: {
      role: 'viewer',
      slug: 'utilization',
      overviewAlt: 'Утилизация кортов наблюдателя',
      overviewCaption: 'Viewer смотрит загрузку кортов без управления расписанием.',
      detailAlt: 'Детали утилизации наблюдателя',
      detailCaption: 'Отмечай пики и провалы для передачи ответственным.',
    },
  }),
  'viewer.bookings.review': makeCardLesson({
    title: 'Как смотреть расписание броней',
    summary:
      'Viewer видит расписание, чтобы понимать занятость кортов, но не создает и не меняет брони.',
    overviewTitle: 'Открой расписание',
    overviewText:
      'Выбери дату и посмотри сетку кортов. В расписании видны занятые слоты, статусы и неоплаченные суммы.',
    overviewItems: [
      'Смотри дату перед выводами по загрузке.',
      'Не пытайся переносить или отменять брони.',
    ],
    detailTitle: 'Прочитай занятость',
    detailText:
      'Сравни корты, время и статусы. Viewer должен понять ситуацию, не вмешиваясь в работу администратора.',
    detailItems: [
      'Неоплаченные брони отмечай как вопрос к операционной команде.',
      'Свободные окна сверяй с утилизацией.',
    ],
    finalTitle: 'Граница просмотра',
    finalText:
      'Задание выполнено, если расписание понятно, а данные бронирований не изменялись.',
    screenshot: {
      role: 'viewer',
      slug: 'bookings',
      overviewAlt: 'Расписание броней наблюдателя',
      overviewCaption: 'Viewer смотрит дату, корты и занятые слоты.',
      detailAlt: 'Детали расписания броней наблюдателя',
      detailCaption: 'Читай статусы и оплату без изменения бронирований.',
    },
  }),
};

const CRM_KNOWLEDGE_SECTIONS = [
  {
    slug: 'access-monitor',
    title: 'Монитор входов и смена',
    description: 'Понять, как CRM фиксирует визиты, активную смену и текущий поток гостей.',
    route: '/admin',
    skills: ['Операционка', 'Визиты'],
    badge: 'Логика входов',
    estimatedMinutes: 6,
    summary:
      'Монитор входов связывает ресепшн, визиты и дневную операционную картину клуба.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Монитор входов нужен для текущей смены: кто уже пришел, какие визиты активны, какие ключи или цели визита зафиксированы и где администратору нужно завершить действие. Это рабочий экран смены, а не исторический отчет.',
        items: [
          'Активные визиты показывают гостей, которые сейчас находятся в клубе.',
          'Закрытые визиты уходят в историю и аналитику посещений.',
          'Цель визита помогает потом читать трафик не только по количеству, но и по причине прихода.',
        ],
      },
      {
        title: 'Откуда берутся данные',
        text:
          'Визиты появляются из QR-сканера, ручного создания входа и связанных клиентских действий. CRM хранит время входа, время выхода, клиента, категорию визита, ключ и учебный маркер. Учебные записи не должны попадать в боевую аналитику.',
      },
      {
        title: 'Как читать метрики',
        text:
          'Главный смысл монитора - не итоговый показатель, а контроль состояния смены. Если активных визитов больше фактических гостей, значит входы не закрываются. Если много ручных входов, нужно проверить QR-процесс или дисциплину ресепшна.',
      },
    ],
    managerLens:
      'Менеджер использует монитор входов как диагностику качества смены: смотрит незакрытые визиты, повторяющиеся ручные операции и корректность целей визита. По этим сигналам понятно, кого дообучить и где процесс ломается.',
    ownerLens:
      'В этом разделе владелец в CRM проверяет, насколько аккуратно смена фиксирует входы: активные визиты, ручные входы, категории и незакрытые записи. Экран помогает понять, можно ли доверять отчетам по посещениям.',
  },
  {
    slug: 'bookings',
    title: 'Бронирования и расписание',
    description: 'Разобраться, как CRM считает статусы, оплату, конфликты и занятость кортов.',
    route: '/admin/bookings',
    skills: ['Расписание', 'Доход'],
    badge: 'Логика броней',
    estimatedMinutes: 7,
    summary:
      'Бронирования связывают клиентский спрос, занятость ресурсов, оплату и будущую загрузку.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Расписание показывает сетку кортов, брони, блокировки, статусы, оплату, быстрые действия на карточках и предупреждения в форме брони. Это основной экран, где видно будущую загрузку, операционные риски и свободную емкость.',
        items: [
          'Активные брони участвуют в занятости и выручке.',
          'Отмененные брони остаются в истории, но не должны занимать слот.',
          'Неоплаченные записи показывают кассовый риск смены.',
        ],
      },
      {
        title: 'Как CRM проверяет бронь',
        text:
          'При создании или переносе CRM сверяет дату, время, ресурс, длительность и пересечение с другими активными бронями или блокировками. Форма также предупреждает о неполной оплате, активных абонементах и сертификатах клиента, а для групповой тренировки показывает участников. Цена считается по правилам расписания: длительность разбивается на интервалы, а стоимость часа пропорционально применяется к каждому сегменту.',
      },
      {
        title: 'Как считаются деньги и риски',
        text:
          'Плановая сумма брони сравнивается с фактической оплатой. Неоплаченный остаток считается как максимум между нулем и разницей плановой суммы и оплаченной суммы. В отчетах активные брони отделяются от отмен, неявок и переносов.',
      },
      {
        title: 'Связь с клиентами',
        text:
          'CRM может помечать первую бронь клиента через историю предыдущих броней и визитов. В форме брони ссылка на карточку клиента помогает быстро проверить историю, предоплаты и контекст без отдельного поиска. Поэтому важно не создавать дублей клиентов: дубль ломает понимание, новый это человек или уже знакомый гость.',
      },
    ],
    managerLens:
      'Менеджер читает расписание как операционный пульт: где есть неоплаченные хвосты, конфликты, пустые окна и места для обзвона. Хорошее решение после просмотра расписания всегда привязано к конкретному дню, корту и слоту.',
    ownerLens:
      'В этом разделе владелец в CRM выбирает дату и проверяет занятость кортов, оплату, отмены, переносы и неявки. Расписание показывает, какие записи требуют внимания и где свободная емкость уже видна в системе.',
  },
  {
    slug: 'manager-control',
    title: 'Контроль менеджера',
    description:
      'Понять ежедневную очередь рисков по броням, звонкам, обзвонам, предоплатам и корпоративным остаткам.',
    route: '/admin/manager-control',
    skills: ['Операционный контроль', 'Очередь дня'],
    badge: 'Логика контроля',
    estimatedMinutes: 7,
    summary:
      'Контроль менеджера собирает в одну очередь CRM-сигналы, которые требуют реакции до конца дня.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Раздел показывает рабочую очередь: pending sales без клиента, просроченные задачи обзвона, пропущенные звонки, проблемные брони, истекающие абонементы и сертификаты, корпоративные компании с низким балансом. Это не отчет “для красоты”, а список строк, из которых нужно открыть источник и закрыть хвост.',
      },
      {
        title: 'Как работают фильтры',
        text:
          'Дата броней ограничивает блок проблемных броней. Период истечения показывает, какие абонементы и сертификаты скоро потребуют реакции. Порог низкого баланса определяет, какие корпоративные клиенты попадут в очередь. Кнопка обновления перечитывает данные после действий в исходных разделах.',
      },
      {
        title: 'Что считается проблемной бронью',
        text:
          'В очередь попадают активные брони с неполной оплатой, отмененные брони и пересечения по одному корту и времени. Бейдж показывает тип риска: «Оплата», «Отмена» или «Конфликт». Кнопка строки ведет в расписание на дату брони.',
      },
      {
        title: 'Как связаны предоплаты и финансы',
        text:
          'Сводный счетчик предоплат складывается из pending sales, истекающих абонементов, истекающих сертификатов и низких корпоративных балансов. Эти строки не являются новой выручкой: они показывают обязательства или операционные хвосты, которые надо разобрать в своем разделе.',
      },
    ],
    managerLens:
      'Менеджер открывает этот раздел в начале и в конце смены: сначала выбирает дату, затем разбирает строки очереди и после действий обновляет экран, чтобы увидеть, какие риски остались.',
    ownerLens:
      'Владелец использует раздел как контрольный экран CRM: видно, какие проблемы система уже нашла и в какой исходный раздел нужно перейти, чтобы проверить причину.',
  },
  {
    slug: 'clients',
    title: 'Клиенты и карточка клиента',
    description: 'Понять, что хранится в клиентской базе и почему качество данных влияет на всю CRM.',
    route: '/admin/clients',
    skills: ['Клиенты', 'Данные'],
    badge: 'Логика клиентской базы',
    estimatedMinutes: 6,
    summary:
      'Клиентская карточка собирает идентичность клиента, историю контактов, визитов, броней и тренировок.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Раздел клиентов нужен для поиска людей, создания карточек, проверки дублей, истории визитов, броней, обзвонов, тренировочных заметок и карты навыков. Это не просто список телефонов, а память клуба о взаимоотношениях и тренировочном прогрессе человека.',
      },
      {
        title: 'Как CRM защищает базу от дублей',
        text:
          'Телефон нормализуется до единого формата, чтобы один и тот же клиент не появлялся под разными масками номера. Дополнительно могут проверяться Telegram, VK и внешние идентификаторы. При ошибочном дубле история клиента расползается между карточками, и отчеты теряют смысл.',
      },
      {
        title: 'Какие данные влияют на аналитику',
        text:
          'Источник клиента помогает понимать, откуда приходит спрос. Заметки и история событий сохраняют контекст. Визиты, брони, звонки, тренировочные записи и карта навыков связывают клиента с разными разделами CRM и показывают жизненный цикл человека в клубе.',
      },
      {
        title: 'Ограничения доступа',
        text:
          'Роль тренера видит только безопасный тренировочный контекст и не должна получать телефоны, внешние идентификаторы и управленческие CRM-поля. Это важно для приватности и для того, чтобы тренерский сценарий не превращался в управление клиентской базой.',
      },
    ],
    managerLens:
      'Менеджер отвечает за чистоту клиентской базы: источники, отсутствие дублей, понятные заметки и пригодные сегменты. Без этого обзвоны, повторные продажи и отчеты по источникам становятся шумом.',
    ownerLens:
      'В этом разделе владелец в CRM открывает карточку клиента и проверяет источник, историю визитов, бронирований, звонков, задач и заметок. Карточка нужна, чтобы быстро понять, какие данные уже есть в системе и где возможны дубли.',
  },
  {
    slug: 'trainer',
    title: 'Тренерский кабинет и дневник',
    description:
      'Понять безопасный контур тренера: карту навыков, рекомендации, планы и ограничения персональных данных.',
    route: '/admin/trainer',
    skills: ['Тренеры', 'Методика'],
    badge: 'Логика тренера',
    estimatedMinutes: 8,
    summary:
      'Тренерский кабинет соединяет безопасную карточку игрока, карту навыков, рекомендации, планы и дневник занятия.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Тренер видит игроков, уровень, карту навыков, историю тренировочных заметок, рекомендации, планы тренировок и форму фактической записи занятия. Экран сфокусирован на тренировочном процессе, а не на продажах, оплатах или клиентской базе.',
      },
      {
        title: 'Карта навыков игрока',
        text:
          'Карта навыков строится по активным навыкам методической базы. Для каждого навыка CRM хранит уровень от 0 до 5, дату последней отработки, последнее упражнение, последнюю оценку, флаг повтора и следующую ступень упражнения. Эта карта показывает, что тренировать дальше.',
      },
      {
        title: 'Структурная фиксация тренировки',
        text:
          'В тренировочной записи можно выбрать упражнения из утвержденной методической базы, поставить оценку и отметить, нужно ли повторить упражнение или навык. Такая запись не просто сохраняет текст, а дает CRM данные для пересчета карты навыков.',
      },
      {
        title: 'Как CRM обновляет навыки',
        text:
          'Оценка 1/5 или 2/5 ставит повтор и предлагает шаг ниже. Оценка 3/5 оставляет уровень и требует закрепления. Две подходящие оценки 4/5 или 5/5 без флага повтора могут повысить уровень навыка. Если упражнение не подходит текущей ступени или диапазону уровня, повышение не происходит.',
      },
      {
        title: 'Рекомендации и планы',
        text:
          'Персональная рекомендация выбирает блоки по карте одного игрока, истории тренировок и цели занятия. Групповая рекомендация ищет общий фокус по нескольким участникам. Из рекомендации можно создать запланированный план, а после занятия перевести его в завершенный через фактические результаты.',
      },
      {
        title: 'Почему доступ ограничен',
        text:
          'Тренер не должен видеть лишние персональные данные и не управляет клиентской базой. Поэтому телефоны, внешние идентификаторы, CRM-заметка и часть истории клиента скрываются. Это снижает риск утечек и удерживает роль в ее рабочем сценарии.',
      },
    ],
    managerLens:
      'В этом разделе менеджер проверяет, ведутся ли структурные записи, обновляется ли карта навыков и есть ли у тренеров запланированные планы с понятным завершенным фактом. Экран помогает увидеть качество тренировочного процесса без раскрытия лишних персональных данных.',
    ownerLens:
      'В этом разделе владелец в CRM проверяет безопасный тренировочный контур: игрок, уровень, карта навыков, рекомендации, планы и дневник. Раздел показывает, как CRM превращает занятие в структурные данные без открытия лишних персональных данных.',
  },
  {
    slug: 'methodology',
    title: 'Методическая база навыков и упражнений',
    description:
      'Понять, как навыки и упражнения становятся основой карт навыков, рекомендаций и планов тренировок.',
    route: '/admin/methodology',
    skills: ['Методика', 'Упражнения'],
    badge: 'Логика методики',
    estimatedMinutes: 8,
    summary:
      'Методическая база описывает, чему учит клуб и какие упражнения CRM может использовать в рекомендациях.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Раздел методики показывает навыки и упражнения. Навык описывает тренировочную цель, упражнение описывает способ отработки. Вместе они формируют справочник, из которого CRM строит карту навыков, рекомендации и планы.',
      },
      {
        title: 'Направления навыков',
        text:
          'Навык относится к направлению: техника, тактика, игровые ситуации, парное взаимодействие, физика и координация. Направление помогает фильтровать базу и видеть, где методика покрыта сильнее или слабее.',
      },
      {
        title: 'Поля упражнения',
        text:
          'У упражнения есть главный навык, дополнительные навыки, ступень упражнения, формат занятия, диапазон уровня навыка, критерий успеха, упрощение и усложнение. Эти поля нужны не для красоты карточки, а для автоматического подбора упражнения под игрока или группу.',
      },
      {
        title: 'Статусы',
        text:
          'Навык может быть активным или архивным. Упражнение может быть черновиком, утвержденным или архивным. В рекомендации и автоматические планы попадают только утвержденные упражнения с подходящими полями.',
      },
      {
        title: 'Права ролей',
        text:
          'Владелец и управляющий могут управлять навыками и утверждать упражнения. Тренер может смотреть базу и создавать свои черновики, но не утверждает общую методику сам. Это сохраняет единый стандарт упражнений.',
      },
    ],
    managerLens:
      'В этом разделе менеджер проверяет, хватает ли активных навыков и утвержденных упражнений для тренировочного процесса. Если рекомендация оставляет ручной блок, в CRM нужно проверить покрытие навыка, формат, ступень и диапазон уровня.',
    ownerLens:
      'В этом разделе владелец в CRM открывает навыки и упражнения, смотрит статусы, направления, ступени, форматы и критерии успеха. Экран нужен, чтобы понять, из какой базы CRM собирает рекомендации и планы тренировок.',
  },
  {
    slug: 'methodology-analytics',
    title: 'Аналитика методики и старшего тренера',
    description:
      'Понять, как CRM считает покрытие методики, выполнение планов и отклонения между планом и фактом.',
    route: '/admin/methodology-analytics',
    skills: ['Методика', 'Аналитика'],
    badge: 'Логика аналитики',
    estimatedMinutes: 9,
    summary:
      'Аналитика методики показывает, где база упражнений, рекомендации, планы и фактические записи расходятся.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Раздел аналитики показывает состояние методической базы, тренировочные планы, фактические упражнения и примеры отклонений. Это экран для проверки качества данных тренерского контура.',
      },
      {
        title: 'Покрытие методической базы',
        text:
          'CRM смотрит, есть ли утвержденные упражнения по активным навыкам, форматам и ступеням. Если покрытие слабое, рекомендации чаще оставляют ручные блоки или выбирают менее точные варианты.',
      },
      {
        title: 'План и факт',
        text:
          'Planned-план содержит подготовленные упражнения до занятия. Completed-план появляется после завершения и связывается с фактическими тренировочными записями участников. Так CRM понимает, что было запланировано и что реально сделали.',
      },
      {
        title: 'Как считается совпадение',
        text:
          'Совпадение считается по упражнениям: CRM сравнивает упражнения из запланированного плана с упражнениями, которые попали в фактическую структурную запись. Если часть упражнений пропала или появились другие, фиксируется отклонение.',
      },
      {
        title: 'Какие данные исключаются',
        text:
          'Учебные записи с учебным признаком не должны попадать в боевую аналитику методики. Это важно для проверки обучения: тренировочные планы и карты навыков можно создавать в учебном режиме без загрязнения отчетов.',
      },
    ],
    managerLens:
      'В этом разделе менеджер выбирает период и проверяет покрытие навыков, запланированные и завершенные планы, отклонения и тренеров. Экран помогает найти место в CRM, где методика, план или фактическая запись требуют уточнения.',
    ownerLens:
      'В этом разделе владелец в CRM читает показатели методики: какие навыки покрыты упражнениями, какие планы завершены, где факт расходится с запланированным планом и какие учебные данные исключены из боевой картины.',
  },
  {
    slug: 'client-bases',
    title: 'Клиентские базы и сегменты',
    description: 'Разобраться, как сегменты превращают клиентскую базу в повторяемую работу.',
    route: '/admin/client-bases',
    skills: ['Сегменты', 'Рост'],
    badge: 'Логика сегментов',
    estimatedMinutes: 6,
    summary:
      'Клиентская база сохраняет фильтр, чтобы команда могла регулярно работать с одним и тем же сегментом.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Раздел баз показывает сохраненные сегменты: название, фильтры, количество клиентов, срок прозвона и историю запуска задач. Это способ превратить аналитику клиентов в повторяемую операционную работу.',
      },
      {
        title: 'Как формируется состав базы',
        text:
          'Состав зависит от фильтров: источник, визиты, категории, давность посещения, статус и другие параметры. Фиксированная база сохраняет снимок состава клиентов, динамическая пересчитывается по текущим данным.',
      },
      {
        title: 'Как не сломать сегментацию',
        text:
          'Название базы должно объяснять гипотезу: кого возвращаем и почему. Если фильтр слишком широкий, задача обзвона будет дорогой и мутной. Если слишком узкий, команда может не набрать достаточно контактов для вывода.',
      },
    ],
    managerLens:
      'Менеджер отвечает за то, чтобы каждая база имела цель: вернуть новичков, поднять пропавших, проверить источник или дозагрузить слабый слот. База без действия быстро превращается в архивный список.',
    ownerLens:
      'В этом разделе владелец в CRM открывает сохраненные базы, смотрит фильтры, размер сегмента, срок прозвона и связанные задачи. Так видно, из каких данных собрана база и какие задачи уже запущены по этому сегменту.',
  },
  {
    slug: 'call-tasks',
    title: 'Задачи обзвона и воронка',
    description: 'Понять, как CRM считает прогресс обзвонов, попытки, статусы и результативность.',
    route: '/admin/call-tasks',
    skills: ['Обзвоны', 'Воронка'],
    badge: 'Логика обзвона',
    estimatedMinutes: 7,
    summary:
      'Задачи обзвона связывают сегмент клиентов, исполнителя, дедлайн, попытки контакта и итоговую конверсию.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'В задачах обзвона видно базу, ответственного, статус, дедлайн, количество клиентов, прогресс, попытки и результат. Это не список звонков, а управляемая воронка работы с клиентами.',
      },
      {
        title: 'Как считается прогресс',
        text:
          'Прогресс строится по клиентам внутри задачи: у кого есть попытки, какой последний статус, есть ли просроченный следующий контакт и какой итог зафиксирован. Массовые обновления должны менять сводку, но не подменять фактическое время контакта.',
      },
      {
        title: 'Как читать отчет',
        text:
          'В отчете важны контактность, записи, отказы, «Не дозвонились», просрочки и количество попыток. Низкая контактность может означать плохое время звонков, слабую базу или дисциплину исполнителя. Высокие отказы указывают на проблему предложения или сегмента.',
      },
    ],
    managerLens:
      'Менеджер должен после отчета принимать действие: продолжить обзвон, сменить скрипт, перераспределить задачу, закрыть сегмент или создать новую гипотезу. Просто посмотреть проценты недостаточно.',
    ownerLens:
      'В этом разделе владелец в CRM открывает задачу обзвона, отчет и список клиентов, чтобы проверить прогресс, просрочки, попытки, итоги и ответственного. Карточка показывает, где именно в системе смотреть качество обработки базы.',
  },
  {
    slug: 'telephony',
    title: 'Телефония, звонки и записи',
    description: 'Разобраться, как звонки попадают в CRM, связываются с клиентами и превращаются в задачи.',
    route: '/admin/telephony',
    skills: ['Телефония', 'Контроль контакта'],
    badge: 'Логика звонков',
    estimatedMinutes: 8,
    summary:
      'Телефония показывает, насколько клуб обрабатывает входящие и исходящие звонки и где теряются клиенты.',
    cards: [
      {
        title: 'Что попадает в телефонию',
        text:
          'CRM принимает события телефонии из интеграции, нормализует их в записи звонков и хранит направление, статус, телефон, длительность, оператора, время, ссылку на запись и связь с клиентом, если ее удалось определить.',
      },
      {
        title: 'Как понимать статусы',
        text:
          'Направление показывает, звонок был входящим или исходящим. Статус звонка отвечает, что произошло с самим звонком: пропущен, завершен или неизвестен. Статус обработки отвечает, что команда сделала в CRM: новый, в работе, обработан или скрыт как шум.',
      },
      {
        title: 'Какие метрики считать',
        text:
          'В отчете важны простые величины: «Всего звонков», «Пропущенные», «Активные», «Обработанные», «Скрытые», «Без клиента», «С записью» и средняя длительность. Доля обработанных = «Обработанные» / «Всего звонков» * 100%. Доля звонков без клиента = «Без клиента» / «Всего звонков» * 100%.',
      },
      {
        title: 'Как звонки связаны с CRM',
        text:
          'Пропущенные входящие могут превращаться в задачи на следующий контакт. Звонок можно связать с существующим клиентом или использовать для создания нового. Записи разговоров сопоставляются по телефону, времени и длительности, поэтому качество номера критично.',
      },
      {
        title: 'Ошибки интерпретации',
        text:
          'Большое число звонков не равно хорошей работе. Смотри, сколько звонков обработано, сколько клиентов неизвестны, есть ли записи разговоров и как звонки приводят к бронированиям или понятным следующим действиям.',
      },
    ],
    managerLens:
      'Менеджер использует телефонию как контроль дисциплины контакта: пропущенные, необработанные, звонки без клиента, просроченные следующие действия и качество результата после разговора.',
    ownerLens:
      'В этом разделе владелец в CRM проверяет сводку звонков, пропущенные входящие, звонки без клиента и наличие записей разговоров. Экран показывает, какие звонки уже обработаны в системе, а какие еще требуют разбора.',
  },
  {
    slug: 'visits-analytics',
    title: 'Аналитика посещений',
    description:
      'Понять, как CRM считает визиты, повторяемость, качество источников, когорты, жизненный цикл, выручку и LTV.',
    route: '/admin/visits-analytics',
    skills: ['Посещения', 'Источники', 'LTV'],
    badge: 'Логика посещений',
    estimatedMinutes: 12,
    summary:
      'Аналитика посещений состоит из четырех вкладок: обзор, качество источников, когорты и жизненный цикл, выручка и LTV.',
    cards: [
      {
        title: 'Карта экрана для первого входа',
        text:
          'Открой раздел «Аналитика посещений» и начни с вкладок сверху: «Обзор», «Качество источников», «Когорты и жизненный цикл», «Выручка и LTV». Все даты и сравнения читаются в timezone Europe/Moscow.',
      },
      {
        title: 'Вкладка «Обзор»: базовые метрики',
        text:
          'CRM считает визиты по каноническому клиенту: если карточки объединялись, визит относится к корневой карточке. Дата берется из scannedAt, а если ее нет - из createdAt. Учебные визиты, учебные клиенты и дубли визитов исключаются. New visits - первые визиты клиентов, returning visits - визиты тех, кто уже был раньше, repeat visits - повторные визиты в периоде. Repeat rate 30 считается только по зрелым окнам, где у клиента было достаточно времени вернуться.',
      },
      {
        title: 'Вкладка «Качество источников»',
        text:
          'Источник хранится устойчивым ключом: id:<id> для справочника, legacy:<значение> для старых строк, unspecified для пустого источника. Eligible 30/60/90 показывает, сколько клиентов уже можно честно оценивать в окне возврата. «Недостаточно времени» означает незрелое окно, «Мало данных» - слишком маленькую выборку. Один визит показывает слабый возврат, 3+ визита - устойчивую повторяемость. Среднее и медиана второго визита показывают скорость возврата.',
      },
      {
        title: 'Вкладка «Когорты и жизненный цикл»',
        text:
          'Когорта M0+ строится от месяца первого визита: M0 - первый календарный месяц, M1, M2 и дальше - следующие месяцы. CRM сравнивает только зрелые календарные месяцы. Жизненный цикл показывает статусы active, risk, sleeping и lost. Рост active - благоприятный. Снижение risk, sleeping или lost - благоприятное. Рост risk, sleeping или lost - неблагоприятный и показывается красным. Нулевое изменение нейтрально.',
      },
      {
        title: 'Вкладка «Выручка и LTV»',
        text:
          'Выручка атрибутируется к клиенту и источнику по доступным платежным данным. PAYBACK - возвратный чек: его сумма учитывается со знаком минус, уменьшает net-выручку и, при надежной связи с клиентом, соответствующий LTV клиента или источника. Непривязанный PAYBACK остается в coverage как риск неполной атрибуции. LTV 30/60/90/lifetime - накопленная ценность клиента в разных окнах. Source LTV показывает ценность источника, cohort LTV - ценность клиентов месяца первого визита. Coverage предупреждает, какая часть данных покрыта платежами и атрибуцией; при низком coverage вывод по LTV неполный.',
      },
      {
        title: 'Права и рабочий сценарий',
        text:
          'Owner и manager могут выбрать source, cohort или lifecycle filter, создать клиентскую базу из сегмента, проверить provenance/count и передать базу в существующую задачу обзвона. Accountant и viewer работают только на чтение: применяют фильтры, сверяют метрики и экспортируют отчет без создания баз и задач обзвона.',
      },
    ],
    managerLens:
      'Менеджер использует аналитику посещений как путь от метрики к действию в CRM: фильтр источника, когорты или статуса, затем клиентская база и задача обзвона.',
    ownerLens:
      'Владелец через этот раздел проверяет, как фактический поток превращается в возврат, LTV и рабочие сегменты для команды, не расширяя права других ролей.',
  },
  {
    slug: 'finances',
    title: 'Финансы, прибыль и маржа',
    description: 'Разобраться, как CRM собирает доходы, расходы, начисления, прибыль и маржу.',
    route: '/admin/finances',
    skills: ['Финансы', 'Прибыль'],
    badge: 'Логика прибыли',
    estimatedMinutes: 8,
    summary:
      'Финансовый отчет связывает чеки, ручные операции, категории, себестоимость, начисления и итоговую прибыль.',
    cards: [
      {
        title: 'Из чего складывается выручка',
        text:
          'Выручка складывается из продаж по кассе и ручных или внешних доходов. Кассовая часть приходит из строк чеков Evotor и сопоставляется с категориями через товарные правила. Ручные операции хранятся в финансовых записях CRM.',
      },
      {
        title: 'Как считается прибыль',
        text:
          'Обозначения: «Выручка» - все доходы за период; «Себестоимость и комиссии» - прямые удержания по продажам; «Операционные расходы» - расходы и автоматические начисления. Валовая прибыль = «Выручка» - «Себестоимость и комиссии». Чистая прибыль = «Валовая прибыль» - «Операционные расходы». Маржа = «Чистая прибыль» / «Выручка» * 100%, если выручка больше нуля.',
      },
      {
        title: 'Касса, безнал и сверка',
        text:
          'Деньги разделяются на наличные и безналичные по оплатам в чеке. Эквайринговая комиссия может считаться от безналичной части. Сверка показывает расхождение между суммой чека и суммой товарных строк, чтобы находить ошибки сопоставления или импорта.',
      },
      {
        title: 'Что исключается из отчета',
        text:
          'Учебные записи не должны попадать в боевой финансовый отчет. Поэтому учебные данные исключаются из финансовых агрегатов, иначе обучение сотрудников будет искажать картину в CRM.',
      },
      {
        title: 'Как предоплаты связаны с финансами',
        text:
          'Продажа абонемента или сертификата попадает в финансовый контур через чек и категорию, а остаток услуги живет в предоплатах. Корпоративное пополнение попадает через ручную финансовую операцию и одновременно увеличивает баланс компании.',
      },
    ],
    managerLens:
      'Менеджер читает финансы для операционных решений: какие категории дают вклад, где растут расходы, какие смены или процессы требуют внимания. Важно смотреть не только выручку, но и чистую прибыль, маржу и расхождения сверки.',
    ownerLens:
      'В этом разделе владелец в CRM выбирает период и проверяет выручку, валовую прибыль, операционные расходы, чистую прибыль, маржу, наличные, безналичные и сверку. Экран показывает, из каких записей система собрала итоговые цифры.',
  },
  {
    slug: 'prepayments',
    title: 'Предоплаты и списания',
    description:
      'Понять единый экран обязательств клуба: абонементы, сертификаты, очередь продаж и корпоративные остатки.',
    route: '/admin/prepayments',
    skills: ['Предоплаты', 'Контроль'],
    badge: 'Логика предоплат',
    estimatedMinutes: 8,
    updatedAt: PREPAYMENTS_SCREENSHOT_UPDATED_AT,
    summary:
      'Предоплаты показывают оплаченные или пополненные остатки, которые еще нужно отработать услугами.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Раздел собирает очередь продаж, активные абонементы, активные сертификаты и корпоративные балансы. Это экран для быстрого поиска обязательств клуба и перехода к деталям.',
      },
      {
        title: 'Почему это не просто выручка',
        text:
          'Деньги могли уже попасть в чек или финансовую операцию, но услуга еще не оказана полностью. Поэтому сводка предоплат отвечает не на вопрос новой выручки, а на вопрос оставшегося обязательства перед клиентом или компанией.',
      },
      {
        title: 'Как читать основные показатели',
        text:
          '«Ожидающие продажи» - строки чеков, которые нужно привязать. «Активные абонементы» - клиентские пакеты с остатком занятий. «Активные сертификаты» - сертификаты с доступной суммой или услугами. «Корпоративные остатки» - деньги компаний, доступные для списаний.',
      },
      {
        title: 'Как работают фильтры',
        text:
          'Фильтр по типу отделяет очередь, абонементы, сертификаты и корпоративные балансы. Фильтр по статусу показывает активные, истекающие, использованные, погашенные или проблемные строки. Поиск помогает найти клиента, код сертификата или компанию.',
      },
    ],
    managerLens:
      'Менеджер использует этот раздел как ежедневный контроль хвостов: что надо привязать, какие абонементы скоро истекают, какие сертификаты или корпоративные балансы требуют внимания.',
    ownerLens:
      'В этом разделе владелец в CRM смотрит оплаченные, но еще не полностью отработанные обязательства: абонементы, сертификаты, корпоративные остатки и ожидающие привязки продажи.',
  },
  {
    slug: 'certificates',
    title: 'Сертификаты',
    description:
      'Разобраться, как CRM хранит сертификаты, коды, остатки, сроки и историю списаний.',
    route: '/admin/certificates',
    skills: ['Сертификаты', 'Списания'],
    badge: 'Логика сертификатов',
    estimatedMinutes: 7,
    summary:
      'Сертификат связывает продажу, клиента, код, срок действия и остаток денег или услуг.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Раздел показывает сертификаты по коду, клиенту, типу, статусу, сроку и остатку. Из списка можно открыть сертификат и посмотреть историю списаний.',
      },
      {
        title: 'Денежный и сервисный сертификат',
        text:
          'Денежный сертификат хранит сумму: исходную, использованную и оставшуюся. Сервисный сертификат хранит количество услуг или пакет: всего, использовано и осталось.',
      },
      {
        title: 'Как появляется сертификат',
        text:
          'Сертификат создается после продажи через Эвотор и привязки ожидающей продажи к клиенту. Код может быть создан автоматически или введен вручную, но он должен быть уникальным.',
      },
      {
        title: 'Как читается статус',
        text:
          'Активный сертификат можно использовать. Погашенный израсходован. Истекший вышел за срок действия. Отмененный нельзя списывать, но его история остается для проверки.',
      },
    ],
    managerLens:
      'Менеджер проверяет сертификаты по коду, остаткам и срокам, чтобы команда не списывала истекшие или уже погашенные сертификаты и могла объяснить клиенту историю использования.',
    ownerLens:
      'В этом разделе владелец в CRM видит сертификаты как отдельный контур обязательств: кто владелец сертификата, какой остаток доступен, когда истекает срок и какие списания уже были.',
  },
  {
    slug: 'corporate-clients',
    title: 'Корпоративные клиенты и балансы',
    description:
      'Понять, как CRM ведет деньги компаний, пополнения, списания и детализацию за период.',
    route: '/admin/corporate-clients',
    skills: ['Корпоративные клиенты', 'Баланс'],
    badge: 'Логика корпоративных балансов',
    estimatedMinutes: 8,
    summary:
      'Корпоративный контур хранит компании, денежные остатки, пополнения, списания и выгрузку детализации.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Раздел показывает компании, контактные данные, статус, текущий баланс и историю операций. В карточке компании видно пополнения, списания, отмены и остаток после операций.',
      },
      {
        title: 'Как работает пополнение',
        text:
          'Пополнение увеличивает баланс компании и должно быть связано с ручной финансовой операцией. Так CRM одновременно хранит обязательство перед компанией и отражает деньги в финансовом контуре.',
      },
      {
        title: 'Как работает списание',
        text:
          'Списание уменьшает баланс. В строке списания хранятся дата, услуга, сумма, участник или клиент, если он указан, связь с бронью или визитом при наличии и комментарий.',
      },
      {
        title: 'Как читать экспорт',
        text:
          'Экспорт детализации за период должен отвечать компании, на что ушли средства: дата, услуга, участник, сумма, комментарий и остаток после операции.',
      },
    ],
    managerLens:
      'Менеджер смотрит корпоративный контур как операционную историю компании: хватит ли остатка, какие услуги списаны и какие строки требуют комментария перед отправкой детализации.',
    ownerLens:
      'В этом разделе владелец в CRM проверяет, какие компании имеют остатки, какие пополнения пришли, какие услуги списаны и как это связано с финансовыми операциями.',
  },
  {
    slug: 'staff',
    title: 'Персонал, смены и начисления',
    description: 'Понять, как CRM связывает смены, часы, продажи, бонусы, корректировки и начисления.',
    route: '/admin/staff',
    skills: ['Команда', 'Начисления'],
    badge: 'Логика начислений',
    estimatedMinutes: 7,
    summary:
      'Персонал и начисления показывают, как работа сотрудников превращается в расчет выплат.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Раздел персонала показывает сотрудников, смены, часы, статусы, продажи, предупреждения, начисления и расчетный период. Это место, где операционная работа связывается с оплатой труда.',
      },
      {
        title: 'Как считаются начисления',
        text:
          'База начислений зависит от часов, ставки и правил переработки. Бонусы подтягиваются из связанных правил мотивации и категорий продаж. Итого к выплате = «База» + «Расчетный бонус» + «Ручная корректировка».',
      },
      {
        title: 'Зачем нужны статусы и блокировки',
        text:
          'Черновики требуют проверки, спорные смены должны иметь объяснение, а закрытые расчетные периоды защищают историю от случайных правок. Ручная корректировка без причины должна считаться риском.',
      },
    ],
    managerLens:
      'Менеджер отвечает за точность смен: кто работал, сколько часов, какие продажи или бонусы должны попасть в расчет. Ошибка в смене быстро становится ошибкой доверия внутри команды.',
    ownerLens:
      'В этом разделе владелец в CRM выбирает расчетный период и проверяет смены, часы, ставки, бонусы, ручные корректировки, предупреждения и итог к выплате. Раздел показывает, из каких строк система собрала начисления.',
  },
  {
    slug: 'users',
    title: 'Пользователи и права',
    description: 'Разобраться, как роли ограничивают доступ и почему владелец управляет полным контуром.',
    route: '/admin/users',
    skills: ['Доступы', 'Безопасность'],
    badge: 'Логика ролей',
    estimatedMinutes: 6,
    summary:
      'Пользователи и роли определяют, кто может читать, создавать, менять и видеть чувствительные данные CRM.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Раздел пользователей показывает аккаунты, роли, статус доступа и привязку к сотруднику. Это административная точка входа в безопасность CRM.',
      },
      {
        title: 'Как устроены роли',
        text:
          'Владелец управляет всей системой. Управляющий управляет операционкой. Администратор работает со сменами, клиентами и бронированиями. Бухгалтер видит финансы и начисления. Наблюдатель только читает. Тренер работает в безопасном тренировочном контуре.',
      },
      {
        title: 'Как выдавать доступ',
        text:
          'Роль должна соответствовать реальной работе человека. Не стоит выдавать управляющего или владельца ради удобства на один день. Если доступ временный, его нужно потом отключить или понизить.',
      },
    ],
    managerLens:
      'Менеджер может использовать роли для операционного контроля, но должен уважать принцип минимально достаточных прав. Лишний доступ обычно создает не скорость, а риск.',
    ownerLens:
      'В этом разделе владелец в CRM проверяет аккаунты, роли, статус доступа и привязку к сотруднику. Экран нужен, чтобы быстро увидеть, кто может входить в систему и какие разделы ему доступны.',
  },
  {
    slug: 'audit',
    title: 'Журнал действий и расследования',
    description: 'Понять, как журнал действий помогает восстановить, кто и что изменил в CRM.',
    route: '/admin/audit',
    skills: ['Аудит', 'Контроль'],
    badge: 'Логика аудита',
    estimatedMinutes: 6,
    summary:
      'Журнал действий сохраняет следы важных изменений и помогает разбирать спорные ситуации.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Журнал действий показывает действие, пользователя, сущность, время и безопасное описание изменения. Это не лента для ежедневного чтения, а инструмент проверки гипотезы: кто, когда и что сделал.',
      },
      {
        title: 'Какие данные маскируются',
        text:
          'Чувствительные поля вроде телефонов и внешних ID не должны раскрываться в описании изменения. Журнал должен помогать расследовать действие, но не становиться вторым источником утечки персональных данных.',
      },
      {
        title: 'Как читать расследование',
        text:
          'Начинай с периода, пользователя и типа сущности. Потом сверяй действие с бизнес-контекстом: бронь, клиент, задача, финансы, справочник или аккаунт. Важно отличать ошибку процесса от единичной ручной правки.',
      },
    ],
    managerLens:
      'Менеджер использует аудит для разбора операционных инцидентов: неверная отмена, спорная правка клиента, изменение справочника или ошибка в расписании.',
    ownerLens:
      'В этом разделе владелец в CRM задает период, пользователя и тип сущности, чтобы найти след конкретного действия. Журнал показывает, кто, когда и какую запись изменил, без раскрытия лишних чувствительных данных.',
  },
  {
    slug: 'motivation',
    title: 'Мотивация и бонусы',
    description: 'Разобраться, как правила мотивации связаны с продажами, категориями и начислениями.',
    route: '/admin/motivation',
    skills: ['Мотивация', 'Бонусы'],
    badge: 'Логика стимулов',
    estimatedMinutes: 7,
    summary:
      'Мотивация описывает, за какие действия и категории сотрудники получают бонусы.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Раздел мотивации показывает базовые правила, бонусные правила, условия начисления, категории, проценты, пороги и периоды действия. Это настройка стимулов команды.',
      },
      {
        title: 'Как правило влияет на расчеты',
        text:
          'Бонус может зависеть от категории, количества, выручки или процента. Когда продажи сопоставлены с финансовыми категориями, расчет начислений может рассчитать бонус по активным правилам и периоду.',
      },
      {
        title: 'Как не создать конфликт',
        text:
          'Перед изменением правила нужно понимать, на какие категории, сотрудников и периоды оно влияет. Старые расчетные периоды лучше не менять без понятной причины, иначе история начислений станет спорной.',
      },
    ],
    managerLens:
      'Менеджер смотрит на мотивацию как на инструмент поведения: правило должно быть понятным сотруднику и проверяемым в цифрах. Неясный бонус демотивирует сильнее, чем отсутствие бонуса.',
    ownerLens:
      'В этом разделе владелец в CRM проверяет базовые ставки, правила переработки, бонусные правила, категории, пороги и периоды действия. Экран показывает, какие правила сейчас участвуют в расчете начислений.',
  },
  {
    slug: 'utilization',
    title: 'Утилизация кортов',
    description: 'Понять, как загрузка показывает свободную емкость и будущие возможности роста.',
    route: '/admin/utilization',
    skills: ['Утилизация', 'Емкость'],
    badge: 'Логика загрузки',
    estimatedMinutes: 6,
    summary:
      'Утилизация показывает, сколько емкости кортов занято и где остаются окна для роста.',
    cards: [
      {
        title: 'Что показывает отчет',
        text:
          'Отчет показывает загрузку по датам и кортам: сколько сессий доступно, сколько забронировано, где есть пики и провалы. Это карта емкости клуба.',
      },
      {
        title: 'Откуда берутся данные',
        text:
          'Расчет опирается на записи утилизации по дате и корту. «Занятые сессии» показывают уже занятую емкость, а «Доступные сессии» - всю доступную емкость за период.',
      },
      {
        title: 'Как читать процент',
        text:
          'Загрузка = «Занятая емкость» / «Доступная емкость» * 100%. Высокая загрузка означает, что свободных окон мало. Низкая загрузка показывает, где в расписании есть свободная емкость, которую можно сверить с бронированиями и звонками.',
      },
    ],
    managerLens:
      'Менеджер должен превращать провал загрузки в действие: кому звонить, какой слот продвигать, какой корт или день проверить. Утилизация полезна только вместе с конкретным планом.',
    ownerLens:
      'В этом разделе владелец в CRM выбирает период и смотрит загрузку по дням, кортам и процентам. Экран помогает увидеть, какая часть доступной емкости уже занята по данным системы.',
  },
  {
    slug: 'catalog',
    title: 'Справочник товаров и финансовые правила',
    description: 'Разобраться, как товары из чеков попадают в категории, финансы и начисления.',
    route: '/admin/catalog',
    skills: ['Каталог', 'Финансы'],
    badge: 'Логика каталога',
    estimatedMinutes: 6,
    summary:
      'Каталог и правила сопоставления переводят сырой товарный чек в управленческую финансовую структуру.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Раздел каталога показывает финансовые категории и правила, по которым строки чеков попадают в отчеты. Без этих правил товарные названия из кассы остаются сырьем, а не понятными данными CRM.',
      },
      {
        title: 'Как работает сопоставление',
        text:
          'Правила смотрят на название товара или другие признаки позиции и назначают категорию. Категория определяет группу отчета, себестоимость, комиссию или связь с бонусом, если такие правила включены.',
      },
      {
        title: 'Как товар становится абонементом или сертификатом',
        text:
          'Для предоплат у товара есть еще один смысл: обычная продажа, абонемент или сертификат. Финансовая категория отвечает за отчет прибыли, а тип продажи отвечает за создание клиентского обязательства после чека.',
      },
      {
        title: 'Почему это влияет на отчеты',
        text:
          'Если товар попал не в ту категорию, исказятся разбивка выручки, себестоимость, валовая прибыль, бонусы сотрудников и финансовые итоги. Правка правила влияет на будущие расчеты и может требовать пересверки периода.',
      },
    ],
    managerLens:
      'Менеджер должен понимать каталог, чтобы видеть, почему категория в отчете выглядит странно, и вовремя передать вопрос бухгалтеру или владельцу.',
    ownerLens:
      'В этом разделе владелец в CRM проверяет категории и правила сопоставления товаров. Раздел показывает, почему конкретная строка чека попадает в нужную финансовую категорию и как это влияет на отчет.',
  },
  {
    slug: 'references',
    title: 'Справочники CRM и качество данных',
    description: 'Понять, почему источники, причины, статусы и категории должны быть единым языком команды.',
    route: '/admin/references',
    skills: ['Справочники', 'Качество данных'],
    badge: 'Логика справочников',
    estimatedMinutes: 5,
    summary:
      'Справочники задают значения, которыми сотрудники описывают клиентов, визиты и операционные события.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Справочники содержат значения, которые команда выбирает в формах: источники, категории визита, причины и другие рабочие списки. Это словарь CRM.',
      },
      {
        title: 'Как справочники влияют на аналитику',
        text:
          'Если в справочнике есть дубли или неясные названия, сотрудники выбирают разные значения для одного смысла. Потом фильтры, сегменты и отчеты показывают раздробленную картину.',
      },
      {
        title: 'Как безопасно менять значения',
        text:
          'Архивирование лучше удаления, если значение уже использовалось в истории. Переименование не должно скрывать старую проблему данных. Новое значение должно быть коротким и одинаково понятным всей команде.',
      },
    ],
    managerLens:
      'Менеджер отвечает за практичность справочников: сотрудник на смене должен без пояснений понимать, какое значение выбрать.',
    ownerLens:
      'В этом разделе владелец в CRM проверяет активные и архивные значения справочников: источники, категории визита, причины и другие списки. Так видно, какие варианты сотрудники выбирают в формах и отчетах.',
  },
  {
    slug: 'onboarding',
    title: 'Обучение, роли и учебные данные',
    description: 'Разобраться, как обучение хранит прогресс, учебные данные и переключение роли обучения для владельца.',
    route: '/admin/onboarding',
    skills: ['Обучение', 'Sandbox'],
    badge: 'Логика обучения',
    estimatedMinutes: 6,
    summary:
      'Onboarding помогает обучать сотрудников по ролям, не смешивая учебные действия с боевой операционкой.',
    cards: [
      {
        title: 'Что показывает раздел',
        text:
          'Раздел обучения показывает миссии, задания, прогресс, навыки, учебные данные и выбор роли прохождения. Для владельца доступно переключение роли обучения: можно смотреть обучение любой роли, оставаясь владельцем.',
      },
      {
        title: 'Как хранится прогресс',
        text:
          'Прогресс хранится отдельно по аккаунту, выбранной роли обучения и конкретному заданию. Поэтому один и тот же владелец может отдельно проходить путь владельца, администратора, управляющего, тренера и другие пути без смешивания статусов.',
      },
      {
        title: 'Как работает режим обучения',
        text:
          'Режим обучения помечает созданные учебные записи как тренировочные и сохраняет, для какой роли и аккаунта они были созданы. Такие записи исключаются из боевых отчетов и могут быть очищены через инструменты обучения.',
      },
    ],
    managerLens:
      'Менеджер использует обучение для стандарта команды: какие сценарии должны знать администраторы, где люди застревают и какие учебные данные нужно чистить после практики.',
    ownerLens:
      'В этом разделе владелец в CRM выбирает роль прохождения, открывает миссии, проверяет прогресс и смотрит учебные данные. Переключение роли обучения позволяет пройти путь любой роли, оставаясь в аккаунте владельца.',
  },
];

const CRM_KNOWLEDGE_SECTION_BY_SLUG = new Map(
  CRM_KNOWLEDGE_SECTIONS.map((section) => [section.slug, section]),
);

const CRM_KNOWLEDGE_DEEP_CARDS = {
  'access-monitor': [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Начинай чтение экрана сверху вниз. Сначала смотри состояние смены и фильтры, затем активные визиты, затем действия администратора. Если на экране есть активный визит, он должен отвечать на три вопроса: кто в клубе, зачем пришел и нужно ли закрыть вход.',
      items: [
        'Верх экрана - текущий контекст смены и быстрые действия.',
        'Основная зона - активные и недавние визиты.',
        'Формы и кнопки - ручное создание входа, закрытие визита и исправление контекста.',
      ],
    },
    {
      title: 'Жизненный цикл визита',
      text:
        'Визит начинается с QR-скана или ручного создания. Дальше CRM хранит клиента, время входа, категорию визита, номер ключа и учебный маркер. В конце визит закрывается временем выхода. Пока выход не закрыт, визит считается активным и влияет на картину смены.',
    },
    {
      title: 'Как понять качество смены',
      text:
        'Хорошая смена видна по отсутствию зависших активных визитов, понятным категориям и небольшому количеству ручных исправлений. Если ручных входов много, надо проверить QR-процесс, дисциплину ресепшна или понятность инструкций администратора.',
    },
    {
      title: 'Типовые ошибки и что они ломают',
      text:
        'Незакрытый визит завышает активную картину смены. Неверная категория портит аналитику посещений. Дубль клиента разрывает историю. Учебный визит без учебного маркера попадет в боевой отчет и создаст шум в трафике.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если в конце дня видно много активных визитов, которых фактически нет в клубе, проблема не в отчете, а в процессе закрытия смены. Решение: проверить администраторов, коротко дообучить закрытию визитов и через неделю сравнить число зависших входов.',
    },
  ],
  bookings: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Сначала выбери дату и посмотри сетку кортов. Затем смотри список броней дня, статусы, оплату и быстрые действия на карточках. Важный порядок чтения: дата, корт, время, клиент, статус, сумма, оплата, предупреждения, участники группы и комментарий. Только после этого можно делать вывод о загрузке или риске.',
      items: [
        'Сетка отвечает на вопрос, где есть свободное время.',
        'Список броней отвечает на вопрос, что именно запланировано.',
        'Статус и оплата отвечают на вопрос, где нужен контроль смены.',
      ],
    },
    {
      title: 'Жизненный цикл брони',
      text:
        'Бронь создается с клиентом, датой, кортом, временем, длительностью, источником и ценой. Потом она может быть оплачена, перенесена, отменена или отмечена как неявка. Активная бронь занимает слот; отмененная остается в истории, но не должна занимать емкость.',
    },
    {
      title: 'Как CRM считает занятость и оплату',
      text:
        'Занятость строится по активным броням и длительности в минутах. Обозначения: «Занятые минуты» - минуты активных броней; «Доступные минуты» - вся емкость кортов за период; «Плановая сумма» - цена брони; «Оплачено» - фактическая оплата. Занятые часы = «Занятые минуты» / 60. Процент занятости = «Занятые минуты» / «Доступные минуты» * 100%. Долг = «Плановая сумма» - «Оплачено», но не меньше нуля.',
    },
    {
      title: 'Цена, правила и конфликты',
      text:
        'Цена зависит от расписания и правил: длительность разбивается по временным сегментам, а стоимость часа применяется пропорционально. При создании и переносе CRM проверяет пересечение с активными бронями и блокировками, чтобы один слот не был продан дважды. Предупреждение оплаты показывает остаток к оплате, а предупреждение предоплаты напоминает проверить абонемент или сертификат клиента.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Частичная оплата не равна полной оплате. Быстрые действия на карточке удобны только после точной проверки клиента и времени. Перенос без причины усложняет разбор спора. Отмена должна освобождать слот, но сохранять историю. Дубль клиента может сделать повторного гостя новым и исказить аналитику первого визита.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если день выглядит загруженным, но много неоплаченных броней, это не такая же здоровая загрузка, как оплаченные слоты. Решение менеджера: проверить ближайшие неоплаченные записи, подтвердить клиентов и разобрать причины долгов по смене.',
    },
  ],
  'manager-control': [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Сначала смотри фильтры сверху: дата броней, период истечения и порог низкого баланса. Затем читай счетчики и только потом переходи к карточкам очереди. Каждая строка должна отвечать на два вопроса: почему она попала в контроль и куда CRM предлагает перейти.',
      items: [
        'Счетчик «Всего в очереди» показывает суммарный объем хвостов.',
        'Блок «Проблемные брони» зависит от выбранной даты.',
        'Блоки предоплат показывают обязательства и остатки, а не новую выручку.',
      ],
    },
    {
      title: 'Как формируется очередь',
      text:
        'Очередь собирается из разных доменов CRM: расписание, задачи обзвона, телефония, pending sales, абонементы, сертификаты и корпоративные балансы. Строка появляется не потому, что кто-то вручную создал задачу, а потому что CRM нашла состояние, требующее проверки.',
    },
    {
      title: 'Что означают строки броней',
      text:
        'Проблемная бронь может быть неоплаченной, отмененной или конфликтующей по времени и корту. Для оплаты проверяй сумму и оплаченный остаток. Для конфликта открывай расписание на дату и сверяй пересечение. Для отмены смотри причину и необходимость повторной коммуникации.',
    },
    {
      title: 'Как читать предоплаты в очереди',
      text:
        'Pending sale означает продажу без клиента. Истекающий абонемент или сертификат означает риск неотработанного остатка. Низкий корпоративный баланс означает, что компания скоро не сможет списывать услуги без пополнения. Эти строки нужно разбирать в исходных разделах, а не править из очереди напрямую.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Не считай пустую очередь гарантией идеальной смены: проверь выбранную дату и фильтры. Не закрывай проблему в голове без перехода в исходный раздел. Не смешивай pending sale, активный абонемент, сертификат и корпоративный баланс: это разные сущности с разными действиями.',
    },
  ],
  clients: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'В списке клиентов сначала используй поиск и фильтры, потом открывай карточку. В карточке смотри базовые данные, источник, заметки, историю визитов, брони, звонки, задачи обзвона и тренировки. Это единая история отношений клуба с человеком.',
    },
    {
      title: 'Главные сущности клиента',
      text:
        'Клиент связан с визитами, бронями, звонками, задачами обзвона, тренировочными заметками, картой навыков и внешними идентификаторами. Телефон нормализуется, чтобы один человек не жил в базе как несколько разных клиентов из-за разного формата номера.',
    },
    {
      title: 'Жизненный цикл клиента',
      text:
        'Клиент может появиться из обращения, звонка, визита, брони или импорта. Потом карточка обогащается источником, заметками и историей действий. Если клиент архивируется, история сохраняется. Если найден дубль, истории нужно объединять, а не вести параллельно.',
    },
    {
      title: 'Как читать качество базы',
      text:
        'Качественная база не обязательно самая большая. Важнее доля клиентов с телефоном, понятным источником, отсутствием дублей, живой историей и корректной тренировочной картой для тех, кто занимается. Если много пустых источников, менеджер теряет понимание, какой канал реально привел клиентов.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Нельзя создавать нового клиента, если человек уже есть в базе. Нельзя писать в заметку лишние персональные данные. Нельзя давать тренеру доступ к полному CRM-контексту, если для тренировки достаточно уровня, дневника и имени.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если обзвон дает слабый результат, сначала проверь не скрипт, а качество клиентской базы: есть ли телефоны, источники, сегмент, история визитов и отсутствие дублей. Плохая база делает любую коммуникацию дорогой и случайной.',
    },
  ],
  trainer: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Тренерский кабинет читается через игрока. Сначала найди игрока, затем смотри уровень, карту навыков, ближайшие планы, рекомендации и дневник. Это не клиентская CRM, а безопасный тренировочный контур.',
    },
    {
      title: 'Запись и обновление навыков',
      text:
        'Тренер фиксирует дату, уровень, упражнения из методической базы, оценку и короткий вывод. CRM обновляет карту навыков только по структурным результатам: низкая оценка ставит повтор, оценка 3/5 закрепляет текущий уровень, а две подходящие оценки 4/5 или 5/5 без повтора могут повысить уровень навыка.',
    },
    {
      title: 'Рекомендация и план',
      text:
        'Рекомендация объясняет, какие навыки требуют внимания и какие упражнения подходят. Из нее можно создать запланированный план. После занятия план завершается фактом, и CRM создает или обновляет тренировочные записи участников.',
    },
    {
      title: 'Что скрыто и почему',
      text:
        'Тренер не должен видеть телефон, внешние идентификаторы, CRM-заметку и лишнюю историю клиента. Это не ограничение ради неудобства, а защита персональных данных и разделение ролей: тренер работает с прогрессом игрока, а не с продажами.',
    },
    {
      title: 'Как читать качество тренерского процесса',
      text:
        'Хороший дневник содержит конкретные упражнения, оценки, флаги повтора и короткий вывод. Плохой дневник выглядит как набор общих фраз. Если записи не обновляют карту навыков и не помогают следующему занятию, процесс обучения игрока не управляется.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если у постоянных игроков нет структурных результатов, карта навыков не обновляется и рекомендации остаются слабыми. В CRM нужно смотреть не только наличие заметки, но и упражнения, оценки, план занятия и связь с картой навыков.',
    },
  ],
  methodology: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Сначала открой список навыков и проверь направления. Потом перейди к упражнениям: статус, главный навык, дополнительные навыки, формат, ступень и диапазон уровня. Такой порядок помогает понять, из чего CRM собирает тренировочные рекомендации.',
    },
    {
      title: 'Жизненный цикл навыка',
      text:
        'Навык создается как активный элемент методики. Когда он активен, CRM добавляет его в карты навыков клиентов. Если навык архивировать, он сохраняется в истории, но не должен расширять новые рекомендации и планы.',
    },
    {
      title: 'Жизненный цикл упражнения',
      text:
        'Упражнение может быть черновиком, утвержденным или архивным. Черновик позволяет тренеру предложить вариант. Утвержденное упражнение участвует в рекомендациях и планах. Архивное остается в истории, но не должно попадать в новый автоматический подбор.',
    },
    {
      title: 'Как упражнение попадает в рекомендацию',
      text:
        'CRM сопоставляет упражнение с нужным навыком, форматом занятия, ступенью и уровнем навыка игрока. Если упражнение не утверждено или не подходит по диапазону, оно не должно быть автоматически выбрано.',
    },
    {
      title: 'Типовые ошибки методической базы',
      text:
        'Навык без упражнений создает пробел в рекомендациях. Упражнение без критерия успеха сложно оценивать. Слишком широкий диапазон уровня делает упражнение непредсказуемым. Дубли навыков дробят карту клиента.',
    },
    {
      title: 'Как читать качество раздела',
      text:
        'Методическая база качественная, если по активным навыкам есть утвержденные упражнения разных форматов и ступеней, а карточки упражнений объясняют критерий успеха, упрощение и усложнение.',
    },
  ],
  'methodology-analytics': [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Начинай с периода и верхних показателей. Затем смотри покрытие навыков, планы, тренеров и примеры отклонений. Раздел нужен для поиска места, где методика, рекомендация или факт занятия расходятся.',
    },
    {
      title: 'Как считается покрытие навыков',
      text:
        'Покрытие навыка есть, если по активному навыку существуют утвержденные упражнения, подходящие для рабочих форматов и ступеней. Если покрытия нет, CRM не сможет уверенно собрать автоматический блок рекомендации.',
    },
    {
      title: 'Как считается выполнение плана',
      text:
        'План считается завершенным, когда после занятия CRM создала или обновила фактические тренировочные записи участников. До этого план остается запланированным и не должен считаться фактом тренировки.',
    },
    {
      title: 'Как считается совпадение плана и факта',
      text:
        'Совпадение = «Количество упражнений из плана, которые есть в фактической записи» / «Количество упражнений в плане» * 100%. Если фактическая запись содержит другие упражнения, CRM показывает отклонение.',
    },
    {
      title: 'Как читать отклонения',
      text:
        'Отклонение не всегда ошибка тренера. Оно может означать адаптацию занятия, нехватку упражнений в базе, неверно выбранный план или неполную фиксацию факта. Разбирать нужно пример плана, участника и фактическую запись.',
    },
    {
      title: 'Учебные данные',
      text:
        'Учебные планы, карты навыков и тренировочные записи должны иметь учебный признак и исключаться из боевой аналитики. Иначе тестовое обучение тренеров будет выглядеть как реальный методический процесс.',
    },
  ],
  'client-bases': [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Сначала смотри список баз: название, фильтр, количество клиентов, срок прозвона и последний запуск задачи. Затем открывай детали фильтра. База должна отвечать на вопрос, кого именно мы хотим вернуть или проверить.',
    },
    {
      title: 'Фиксированная и динамическая база',
      text:
        'Фиксированная база хранит состав клиентов на момент создания. Динамическая база пересчитывается по фильтрам и может менять состав со временем. Фиксированная удобна для разовой кампании, динамическая - для регулярной операционной работы.',
    },
    {
      title: 'Как база превращается в задачу',
      text:
        'База сама по себе не работа. Работа начинается, когда из нее создают задачу обзвона с ответственным, сроком и понятным ожидаемым результатом. Срок прозвона помогает не растянуть контакт до состояния, где сегмент уже устарел.',
    },
    {
      title: 'Как читать качество сегмента',
      text:
        'Хороший сегмент достаточно конкретный, чтобы по нему можно было говорить с клиентом осмысленно. Например, “новички без второго визита за 14 дней” лучше, чем “все клиенты”. Чем понятнее причина попадания в базу, тем лучше разговор.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Слишком широкая база перегружает команду. Слишком узкая база не дает статистики. Дублирующиеся базы создают конкурирующие задачи. Архивные клиенты не должны попадать в новые обзвоны без явной причины.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если задача обзвона провалилась, сравни состав базы и цель. Возможно, проблема не в исполнителе, а в сегменте: клиенты слишком старые, источник не тот или фильтр собрал людей без реального повода для контакта.',
    },
  ],
  'call-tasks': [
    {
      title: 'Карта экрана для первого входа',
      text:
        'В списке задач смотри статус, базу, ответственного, срок, прогресс и просрочку. Внутри задачи смотри клиентов, последнюю попытку, следующий контакт, статус и итог разговора. Это рабочая воронка, а не архив звонков.',
    },
    {
      title: 'Жизненный цикл задачи обзвона',
      text:
        'Задача создается из базы или из карточки клиента, получает ответственного и дедлайн. Клиенты внутри задачи проходят понятные статусы: «Новый», «Не дозвонились», «Перезвонить», «Сомневается», «Записался», «Отказ». Попытки фиксируют историю контакта и следующий шаг.',
    },
    {
      title: 'Как считаются метрики',
      text:
        'Обозначения: «Всего» - все клиенты в задаче; «Новые» - клиенты без результата; «Контактировано» = «Всего» - «Новые»; «Записались» - клиенты с итогом записи; «Отказались» - клиенты с итогом отказа. Контактность = «Контактировано» / «Всего» * 100%. Завершенность = («Записались» + «Отказались») / «Всего» * 100%. Конверсия в запись = «Записались» / «Контактировано» * 100%. Просрочка = «Просроченные контакты» / «Всего» * 100%.',
    },
    {
      title: 'Как читать результат',
      text:
        'Много новых клиентов означает, что задача не начата. Много статусов «Не дозвонились» может означать плохое время звонков. Много отказов может означать слабое предложение или неподходящий сегмент. Много «Перезвонить» требует контроля следующего действия.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Нельзя закрывать задачу только потому, что были попытки. Нельзя массово проставлять итог без реального контакта. Нельзя считать каждую запись чистой заслугой обзвона, если сегмент уже был горячим и клиент сам планировал записаться.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если контактность высокая, а конверсия в запись низкая, люди берут трубку, но не записываются. Это сигнал проверить карточки клиентов, статусы и комментарии попыток. Если контактность низкая, сначала смотри время звонков и дисциплину дозвона в CRM.',
    },
  ],
  telephony: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Читай телефонию в таком порядке: сводные счетчики, список звонков, фильтр по статусу, связь с клиентом, результат обработки, запись разговора. Не начинай с отдельных звонков, пока не понял общую картину потерь.',
    },
    {
      title: 'Жизненный цикл звонка',
      text:
        'Звонок приходит из телефонии как внешнее событие, нормализуется в TelephonyCall, получает направление, статус, номер, длительность, оператора и запись. Потом сотрудник связывает его с клиентом, ставит результат, следующий шаг или игнорирует шум.',
    },
    {
      title: 'Статус звонка и статус обработки',
      text:
        'Статус звонка отвечает, что произошло с самим звонком: пропущен, завершен или неизвестен. Статус обработки отвечает, что команда сделала с записью в CRM: новый, в работе, обработан, скрыт как шум или завершился ошибкой. Эти статусы нельзя смешивать.',
    },
    {
      title: 'Как считаются метрики',
      text:
        'Сначала проверь базовые величины: «Всего звонков», «Обработанные», «Записались», «С записью разговора» и «Без клиента». Потом смотри долю обработанных, конверсию в запись, покрытие записями и долю звонков без клиента. Эти показатели читаются вместе: один высокий счетчик без обработки и результата не означает качественную работу.',
    },
    {
      title: 'Записи разговоров и сопоставление',
      text:
        'Запись может прийти отдельно от события звонка. CRM ищет вероятный звонок по телефону, времени, направлению и длительности в окне около времени записи. Если номер грязный или время сильно отличается, запись может не сопоставиться автоматически.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Пропущенный входящий без следующего действия - потерянный контакт. Звонок без клиента не всегда означает нового клиента: иногда это грязный номер или дубль. Скрывать как шум нужно только лишние звонки, а не неудобные обращения. Ошибка обработки требует проверки интеграции.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если пропущенных звонков становится больше, доля обработанных низкая, а звонков без клиента много, в CRM видно три проблемы: не ответили, не обработали и не связали звонок с карточкой. Дальше смотри список звонков, ответственного и результат обработки.',
    },
  ],
  'visits-analytics': [
    {
      title: 'Что может исказить отчет',
      text:
        'Неверные визиты, дубли клиентов, пустые источники, неполная атрибуция платежей и учебные данные могут искажать вывод. Отчет специально исключает training и duplicate visits, но качество источника, платежей и объединения клиентских карточек все равно важно проверять.',
    },
    {
      title: 'Как читать сравнение периодов',
      text:
        'Предыдущий период всегда равен текущему по длине. Если выбран 14-дневный период, сравнение идет с предыдущими 14 днями. Это защищает от сравнения недели с месяцем, но не отменяет сезонность, праздники и изменения расписания.',
    },
    {
      title: 'Как передать сегмент в работу',
      text:
        'Для owner/manager рабочее действие начинается с фильтра: source, cohort или lifecycle. После preview проверь count и provenance, создай клиентскую базу и уже из базы запускай существующую задачу обзвона. Accountant/viewer этот шаг не выполняют.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если источник дает много первых визитов, но мало eligible-клиентов возвращаются в 30/60/90 дней, это не обязательно плохой источник: сначала проверь зрелость окна, «Мало данных» и coverage. Если окно зрелое и выборка нормальная, owner/manager могут собрать базу клиентов этого источника и передать ее в обзвон.',
    },
  ],
  finances: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Начинай с периода и верхних метрик: выручка, валовая прибыль, операционные расходы, чистая прибыль, маржа, наличные и безналичные. Потом переходи к дереву категорий и деталям. Если верхняя цифра кажется странной, сначала ищи источник в детализации, а не правь руками.',
    },
    {
      title: 'Как данные попадают в финансовый отчет',
      text:
        'Данные приходят из ручных финансовых записей, чеков Evotor, строк чеков, правил каталога, категорий, смен и мотивации. Чек дает кассовую выручку, ручные операции дают внешние доходы или расходы, смены добавляют автоматические начисления администраторов в операционные расходы.',
    },
    {
      title: 'Как считаются ключевые суммы',
      text:
        'Верхние суммы проверяй в таком порядке: выручка, прямые удержания, валовая прибыль, операционные расходы, чистая прибыль и маржа. Если итог изменился, открывай детализацию категории и смотри, какая строка дала изменение: чек, ручная операция, комиссия, расход или начисление.',
    },
    {
      title: 'Чеки, возвраты и эквайринг',
      text:
        'Продажи и возвраты имеют разный знак: возврат уменьшает сумму. Наличные и безналичные берутся из платежей чека. Эквайринг считается от безналичной части. Если в чеке нет строк, разница может попасть в “Неразобранное”.',
    },
    {
      title: 'Сверка и неразобранные суммы',
      text:
        'Сверка сравнивает сумму чека и сумму товарных строк. Разница показывает, где чек не сошелся со строками. Это сигнал проверить импорт, правила сопоставления, возвраты или товары, которые не попали в категории.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Ручная операция с неверной категорией попадет не в тот раздел финансового отчета. Неверное правило каталога исказит кассовую выручку и бонусы. Учебные данные исключаются из отчета, иначе обучение сотрудников будет менять прибыль.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если выручка растет, а чистая прибыль падает, в CRM нужно открыть детализацию и проверить себестоимость, комиссии, операционные расходы и начисления. Так видно, какая строка отчета изменила итог.',
    },
  ],
  prepayments: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Сначала смотри верхние показатели: ожидающие продажи, активные абонементы, сертификаты, истечения и корпоративные остатки. Потом переходи к блокам ниже и фильтрам по типу, статусу и сроку.',
    },
    {
      title: 'Жизненный цикл предоплаты',
      text:
        'Продажа из кассы может попасть в очередь, затем после привязки стать абонементом или сертификатом. Корпоративное пополнение приходит через финансовую операцию и становится балансом компании. Сводка показывает текущий этап каждой такой истории.',
    },
    {
      title: 'Как читать обязательства',
      text:
        'Абонемент показывает остаток занятий. Сертификат показывает остаток денег или услуг. Корпоративный клиент показывает денежный баланс. Ожидающая продажа показывает будущий абонемент или сертификат, который еще не привязан к клиенту.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Не считай ожидающую продажу активным абонементом, пока она не привязана. Не путай сумму продажи и текущий остаток. Не используй сводку как замену финансовому отчету: она показывает обязательства, а не все доходы и расходы.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если много ожидающих продаж, проблема не в клиенте, а в операционном процессе привязки. В CRM нужно открыть очередь, разобрать строки по сумме и клиенту и закрыть хвосты до конца смены.',
    },
  ],
  certificates: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Начинай с поиска по коду или клиенту, затем смотри тип сертификата, статус, срок действия и остаток. После открытия карточки проверь историю списаний и отмен.',
    },
    {
      title: 'Жизненный цикл сертификата',
      text:
        'Сертификат создается из продажи, получает уникальный код, привязывается к клиенту и становится активным. Дальше он может частично списываться, полностью погашаться, истекать по сроку или отменяться.',
    },
    {
      title: 'Как считать остаток',
      text:
        'Для денежного сертификата остаток = «Номинал» - «Использовано». Для сервисного сертификата остаток = «Всего услуг» - «Использовано». Срок действия отдельно ограничивает возможность списания.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Код сертификата должен быть уникальным. Нельзя списывать истекший, отмененный или полностью погашенный сертификат. Ошибочное списание нужно отменять через историю, а не исправлять остаток вручную.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если клиент говорит, что сертификат еще действителен, а CRM показывает нулевой остаток, открой историю списаний: там видно, кто и когда использовал сумму или услуги.',
    },
  ],
  'corporate-clients': [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Сначала выбери компанию и смотри текущий баланс. Затем открой детализацию операций за период: пополнения, списания, отмены, комментарии и остаток после каждой строки.',
    },
    {
      title: 'Жизненный цикл корпоративных денег',
      text:
        'Компания получает баланс через пополнение. Пополнение связано с финансовой операцией, чтобы деньги были видны в отчете. Затем услуги списываются с баланса, а детализация объясняет движение денег компании.',
    },
    {
      title: 'Как считать баланс',
      text:
        'Баланс = «Активные пополнения» - «Активные списания». Отмененные операции остаются в истории, но не должны менять текущий остаток. Пополнение и списание должны иметь понятный комментарий.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Нельзя пополнять баланс без финансового следа. Нельзя списывать больше текущего остатка без отдельного согласованного сценария. Нельзя отправлять детализацию без проверки периода и компании.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если компания просит объяснить остаток, открой период и выгрузи детализацию. В CRM должно быть видно, какие услуги списались, кто был участником и какой остаток остался после каждой операции.',
    },
  ],
  staff: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Сначала смотри расчетный период, затем предупреждения, затем строки смен и сотрудников. В каждой строке важны дата, сотрудник, часы, выручка, база, бонус, ручная корректировка, итог и комментарий.',
    },
    {
      title: 'Жизненный цикл смены и начислений',
      text:
        'Смена создается с датой, сотрудником, часами, временем начала/конца и статусом. Расчет начислений собирает смены за период, считает базу, бонусы, корректировки и итог. Период можно переводить по статусам и закрывать от случайных изменений.',
    },
    {
      title: 'Как считается начисление',
      text:
        'Обозначения: «Обычные часы» - часы до порога переработки; «Часы переработки» - часы сверх порога; «Базовая ставка» и «Ставка переработки» задаются в правилах. База = «Обычные часы» * «Базовая ставка» + «Часы переработки» * «Ставка переработки». Итого к выплате = «База» + «Расчетный бонус» + «Ручная корректировка».',
    },
    {
      title: 'Как CRM привязывает продажи к смене',
      text:
        'Если у смены есть startedAt и endedAt, продажи можно точнее связать со временем. Если в один день несколько смен без точного времени, CRM предупреждает, что бонусы считаются по дневной выручке, а не по точной зоне ответственности.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Смена без часов не дает начисления. Ручная корректировка без комментария выглядит как риск. Закрытый расчетный период нельзя менять без понятного основания. Несколько смен без времени делают бонусы менее точными.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если у сотрудника резко вырос бонус, не начинай с подозрения. Проверь продажи смены, категории, активные бонусные правила и ручные корректировки. Часто причина в измененном правиле мотивации или сопоставлении каталога.',
    },
  ],
  users: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'В разделе пользователей смотри email, роль, статус, привязку к сотруднику и дату создания. Перед созданием нового аккаунта проверь, нет ли уже существующего доступа для этого человека.',
    },
    {
      title: 'Матрица ролей простыми словами',
      text:
        'Владелец управляет всем. Управляющий управляет операционкой и командой. Администратор ведет смену, клиентов и брони. Бухгалтер работает с финансами и начислениями. Наблюдатель только читает. Тренер работает в безопасном тренировочном контуре.',
    },
    {
      title: 'Жизненный цикл доступа',
      text:
        'Доступ создается, используется, меняется при смене должности и отключается при уходе человека. Роль должна следовать работе сотрудника, а не удобству. Временный доступ должен иметь дату или понятный повод для пересмотра.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Выдать роль управляющего ради одной операции проще, но опаснее. Роль владельца должна быть редкой. Неактивные сотрудники не должны сохранять активный аккаунт. Тренер не должен получать доступ к полной клиентской базе.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если сотрудник сделал спорную правку, сначала проверь роль. Возможно, проблема не в человеке, а в слишком широком доступе. Решение: сузить роль и добавить обучение по конкретному сценарию.',
    },
  ],
  audit: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Начинай с фильтра периода, пользователя и типа сущности. Потом смотри действие, время, кто изменил, какую сущность и какое безопасное описание изменения сохранилось. Журнал действий нужен для ответа на конкретный вопрос, а не для бесконечного чтения.',
    },
    {
      title: 'Что считается событием аудита',
      text:
        'В аудит попадают значимые изменения: клиенты, брони, задачи, справочники, каталог, финансы, аккаунты, начисления и другие действия в CRM. Событие должно помогать восстановить контекст: кто, что, когда и где изменил.',
    },
    {
      title: 'Почему изменение не показывает все подряд',
      text:
        'Чувствительные поля маскируются, чтобы аудит не стал копией персональных данных. Лог должен помогать расследовать действие, но не раскрывать телефоны и внешние ID тем, кому они не нужны.',
    },
    {
      title: 'Как проводить расследование',
      text:
        'Сначала сформулируй вопрос: какая бронь пропала, кто изменил клиента, почему сумма стала другой. Потом сужай период и сущность. После нахождения события проверь связанный раздел CRM, потому что аудит показывает след, а не всегда полную бизнес-причину.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если бронь отменена без понятной причины, аудит покажет пользователя и время. Дальше менеджер сверяет комментарий, оплату и звонки. Решение может быть обучением администратора, изменением прав или правкой процесса отмены.',
    },
  ],
  motivation: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Сначала смотри базовые ставки и правила переработки, потом бонусные правила, категории, пороги, проценты и активность. Правило мотивации надо читать вместе с начислениями и каталогом, иначе непонятно, где оно сработает.',
    },
    {
      title: 'Как считается база',
      text:
        'Базовая оплата смены зависит от часов. До порога переработки часы умножаются на базовую ставку, сверх порога - на ставку переработки. Если ставка переработки не задана, используется базовая ставка.',
    },
    {
      title: 'Как считается бонус',
      text:
        'Обозначения: «Выручка по правилу» - продажи в категориях, к которым привязано правило; «Количество» - число подходящих позиций; «Процент бонуса» - процент из правила. Если условие порога выполнено, бонус = «Выручка по правилу» * «Процент бонуса» / 100. Несколько правил могут дать несколько бонусов по одной продаже.',
    },
    {
      title: 'Связь с каталогом и продажами',
      text:
        'Мотивация зависит от того, как строки чеков попали в категории каталога. Если товар сопоставлен неверно, сотрудник может получить неправильный бонус или не получить заслуженный. Поэтому мотивация и каталог всегда проверяются вместе.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Не меняй правило задним числом без понимания расчетных периодов. Не создавай два похожих правила для одной категории без причины. Не используй бонус, который сотрудник не может проверить и объяснить.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если бонусы выросли, а чистая прибыль не выросла, в CRM нужно проверить категории, выручку по правилу, процент бонуса и связанные начисления. Так видно, какое правило изменило сумму выплаты.',
    },
  ],
  utilization: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'Сначала выбери период, затем смотри загрузку по дням и кортам. Сравни занятую емкость, доступную емкость и процент. После этого ищи повторяющиеся провалы: конкретный день недели, время или корт.',
    },
    {
      title: 'Две модели загрузки',
      text:
        'В CRM есть ручные записи утилизации с занятыми и доступными сессиями, а в аналитике бронирований есть расчет по занятым и доступным минутам. В обоих случаях смысл один: занятая емкость делится на доступную емкость.',
    },
    {
      title: 'Как читать процент',
      text:
        'Высокий процент может означать дефицит емкости, но не гарантирует прибыльность. Низкий процент показывает свободное место, но не всегда проблему: возможно, это непиковое время, где нужен другой продукт, цена или тренер.',
    },
    {
      title: 'Что сравнивать вместе',
      text:
        'Утилизацию надо читать вместе с финансами, бронированиями, посещениями и телефонией. Свободный слот без спроса и свободный слот при большом количестве пропущенных звонков означают разные ситуации в данных CRM.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если вторник утром стабильно пустой, не надо сразу снижать цену на все. Сначала проверь спрос по звонкам, историю броней, тренеров и сегменты клиентов. Потом запускай точечное предложение именно на этот слот.',
    },
  ],
  catalog: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'В каталоге сначала смотри категории, затем правила сопоставления. Категория говорит, куда попадет сумма в финансовом отчете. Правило говорит, как CRM узнает категорию по строке чека или товарному названию.',
    },
    {
      title: 'Жизненный цикл строки чека',
      text:
        'Evotor присылает чек и позиции. CRM берет название позиции, ищет подходящее правило, назначает категорию и относит сумму в группу финансового отчета. Если правило не найдено, сумма может попасть в неразобранные категории.',
    },
    {
      title: 'Что настраивается в категории',
      text:
        'Категория может задавать группу отчета, родителя, комиссию, связь с мотивацией и управленческий смысл. Поэтому категория влияет не только на красивую группировку, но и на прибыль, себестоимость, комиссии и начисления.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Слишком широкое правило может поймать чужой товар. Слишком узкое правило оставит продажи неразобранными. Переименование категории меняет язык отчетов. Удаление категории с историей опаснее архивирования.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если в финансовом отчете появилась большая сумма в “Неразобранное”, проблема не в финансах, а в каталоге или импорте чеков. В CRM нужно найти позиции, создать точные правила и пересверить период.',
    },
  ],
  references: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'В справочниках сначала выбирай тип справочника, потом смотри активные и архивные значения. Новые формы должны использовать активные значения, а старые записи должны продолжать отображать исторический смысл.',
    },
    {
      title: 'Что такое справочник в CRM',
      text:
        'Справочник - это контролируемый словарь. Источники, категории визита, причины и статусы нужны, чтобы сотрудники не писали одно и то же разными словами и не ломали будущую аналитику.',
    },
    {
      title: 'Как справочник влияет на процессы',
      text:
        'Источник клиента влияет на аналитику маркетинга. Категория визита влияет на отчет посещений. Причины и статусы помогают фильтровать операционные проблемы. Неверное значение в справочнике размножает ошибку по всей CRM.',
    },
    {
      title: 'Типовые ошибки и исключения',
      text:
        'Не создавай “Инстаграм”, “Instagram” и “инста” как три источника. Не удаляй значение, если оно уже есть в истории. Не переименовывай значение так, чтобы старые записи начали означать другое.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если отчет по источникам показывает много “Не указан”, проблема не в рекламе, а в дисциплине заполнения и справочнике. Решение: сократить список источников, сделать названия понятными и обучить администраторов.',
    },
  ],
  onboarding: [
    {
      title: 'Карта экрана для первого входа',
      text:
        'На странице обучения смотри выбранную роль, миссии, задания, прогресс, навыки и учебные данные. Владелец может переключить роль прохождения, но его реальные права owner при этом не уменьшаются.',
    },
    {
      title: 'Как устроен прогресс',
      text:
        'Прогресс хранится отдельно по аккаунту, роли прохождения и заданию. Поэтому один аккаунт владельца может пройти путь владельца, потом путь администратора, потом путь тренера, не смешивая статусы разных ролей.',
    },
    {
      title: 'Что такое режим обучения',
      text:
        'Режим обучения передает в CRM признак учебного действия и выбранную роль обучения. Сервисы помечают учебные записи, чтобы отчеты не приняли обучение за реальную операционку.',
    },
    {
      title: 'Как читать учебные данные',
      text:
        'Учебные клиенты, визиты, брони, финансы, базы, задачи, попытки и тренировочные заметки должны быть отделены от боевой истории. Владелец может смотреть сводку и чистить учебные данные по роли.',
    },
    {
      title: 'Пример управленческого чтения',
      text:
        'Если новая фича вышла, но обучение не обновлено, сотрудники начнут учиться друг у друга и закрепят разные привычки. Поэтому регламент релиза требует обновлять задачи, скриншоты и базу знаний вместе с фичей.',
    },
  ],
};

const CRM_KNOWLEDGE_SELF_CHECKS = {
  'access-monitor': [
    'Можешь объяснить разницу между активным и закрытым визитом.',
    'Понимаешь, как категория визита потом влияет на аналитику посещений.',
    'Знаешь, почему зависшие визиты и ручные входы являются сигналом проблемы процесса.',
  ],
  bookings: [
    'Можешь объяснить, какие брони занимают емкость, а какие остаются только в истории.',
    'Понимаешь формулу долга: «Плановая сумма» - «Оплачено», но не меньше нуля.',
    'Знаешь, как перенос, отмена, неявка и частичная оплата меняют вывод в CRM.',
  ],
  'manager-control': [
    'Можешь объяснить, почему строка попала в ежедневную очередь контроля.',
    'Понимаешь, как фильтры даты, срока истечения и низкого баланса меняют состав очереди.',
    'Знаешь, в какой исходный раздел открыть pending sale, проблемную бронь, звонок, абонемент, сертификат или корпоративный баланс.',
  ],
  clients: [
    'Можешь объяснить, почему телефонная нормализация и дубли влияют на всю CRM.',
    'Понимаешь, какие разделы пишут историю в карточку клиента.',
    'Знаешь, какие данные тренер не должен видеть и почему.',
  ],
  trainer: [
    'Можешь объяснить, чем тренерский кабинет отличается от клиентской CRM.',
    'Понимаешь, как структурная запись обновляет карту навыков.',
    'Знаешь, чем запланированный план отличается от завершенного факта занятия.',
  ],
  methodology: [
    'Можешь объяснить связь навыка, упражнения, формата и ступени.',
    'Понимаешь, почему в рекомендации попадают только утвержденные упражнения.',
    'Знаешь, какие права у владельца, управляющего и тренера в методической базе.',
  ],
  'methodology-analytics': [
    'Можешь объяснить формулу совпадения плана и факта по упражнениям.',
    'Понимаешь разницу между запланированным и завершенным планом.',
    'Знаешь, почему учебные планы и карты навыков не должны попадать в боевую аналитику.',
  ],
  'client-bases': [
    'Можешь объяснить разницу между фиксированной и динамической базой.',
    'Понимаешь, почему база без задачи обзвона еще не является работой.',
    'Знаешь, как оценить, не слишком ли широкий или узкий сегмент.',
  ],
  'call-tasks': [
    'Можешь объяснить статусы «Новый», «Не дозвонились», «Перезвонить», «Сомневается», «Записался» и «Отказ».',
    'Понимаешь контактность, завершенность, конверсию в запись и просрочку.',
    'Знаешь, какой управленческий вывод делать при низкой контактности или низкой конверсии.',
  ],
  telephony: [
    'Можешь разделить статус звонка и статус обработки без путаницы.',
    'Понимаешь долю обработанных, конверсию в запись, покрытие записями и долю звонков без клиента.',
    'Знаешь, почему пропущенные, звонки без клиента и ошибки обработки показывают разные проблемы.',
  ],
  'visits-analytics': [
    'Можешь объяснить, почему визит относится к каноническому клиенту и почему scannedAt важнее createdAt.',
    'Понимаешь, как читать new, returning, repeat visits и mature repeat rate 30.',
    'Знаешь, что означают stable source key, eligible 30/60/90, «Недостаточно времени» и «Мало данных».',
    'Можешь объяснить M0+ когорты, зрелые календарные месяцы и polarity статусов: рост active благоприятен, рост risk/sleeping/lost неблагоприятен.',
    'Понимаешь, что PAYBACK - возвратный чек: он уменьшает net-выручку и связанный LTV, а непривязанный возврат остается риском coverage.',
  ],
  finances: [
    'Можешь объяснить выручку, валовую прибыль, операционные расходы, чистую прибыль и маржу.',
    'Понимаешь, как чек Evotor проходит через правила каталога в финансовый отчет.',
    'Знаешь, почему разница сверки важнее, чем просто красивая верхняя цифра.',
  ],
  prepayments: [
    'Можешь объяснить, почему предоплата является обязательством, а не просто новой выручкой.',
    'Понимаешь разницу между ожидающей продажей, активным абонементом, сертификатом и корпоративным балансом.',
    'Знаешь, где искать риск: привязка продажи, срок действия, низкий остаток или детализация компании.',
  ],
  certificates: [
    'Можешь объяснить разницу между денежным и сервисным сертификатом.',
    'Понимаешь, как код, срок, статус и остаток определяют возможность списания.',
    'Знаешь, почему ошибочное списание нужно отменять через историю.',
  ],
  'corporate-clients': [
    'Можешь объяснить формулу баланса: «Активные пополнения» - «Активные списания».',
    'Понимаешь, почему пополнение должно быть связано с финансовой операцией.',
    'Знаешь, какие поля нужны в детализации для корпоративного клиента.',
  ],
  staff: [
    'Можешь объяснить формулу: «Итого к выплате» = «База» + «Расчетный бонус» + «Ручная корректировка».',
    'Понимаешь, как часы, продажи смены и правила мотивации попадают в начисления.',
    'Знаешь, почему закрытый расчетный период защищает историю от случайных правок.',
  ],
  users: [
    'Можешь объяснить границы владельца, управляющего, администратора, бухгалтера, наблюдателя и тренера.',
    'Понимаешь принцип минимально достаточных прав.',
    'Знаешь, как связать спорное действие пользователя с ролью и аудитом.',
  ],
  audit: [
    'Можешь сформулировать вопрос расследования до открытия журнала.',
    'Понимаешь, почему чувствительные поля маскируются.',
    'Знаешь, как перейти от найденного события к проверке бизнес-контекста.',
  ],
  motivation: [
    'Можешь объяснить базовую ставку, переработку, порог и процент бонуса.',
    'Понимаешь связь мотивации с категориями каталога.',
    'Знаешь, почему правило мотивации надо проверять вместе с начислениями и финансовым отчетом.',
  ],
  utilization: [
    'Можешь объяснить, что сравнивается в формуле «Занятая емкость» / «Доступная емкость».',
    'Понимаешь, почему высокая загрузка не всегда означает высокую прибыль.',
    'Знаешь, как связать провал загрузки с обзвоном, ценой, тренерами или маркетингом.',
  ],
  catalog: [
    'Можешь объяснить, как строка чека становится категорией финансового отчета.',
    'Понимаешь, чем опасны слишком широкие и слишком узкие правила сопоставления.',
    'Знаешь, почему каталог влияет на финансы и бонусы одновременно.',
  ],
  references: [
    'Можешь объяснить, почему справочник является словарем CRM.',
    'Понимаешь, чем опасны дубли значений вроде Instagram, Инстаграм и инста.',
    'Знаешь, когда архивирование безопаснее удаления.',
  ],
  onboarding: [
    'Можешь объяснить переключение роли обучения владельца и отдельный прогресс по ролям.',
    'Понимаешь, как режим обучения помечает учебные данные.',
    'Знаешь, почему обучение надо обновлять вместе с релизом фичи.',
  ],
};

const KNOWLEDGE_MISSION_GROUPS = [
  {
    slug: 'operations',
    managerTitle: 'База знаний: ежедневная операционка',
    ownerTitle: 'База знаний: контроль операционки',
    managerDescription:
      'Понять, как устроены смены, расписание и клиенты.',
    ownerDescription:
      'Разобраться, как ежедневные процессы превращаются в данные для управления клубом.',
    sections: ['access-monitor', 'bookings', 'manager-control', 'clients'],
  },
  {
    slug: 'training-methodology',
    managerTitle: 'База знаний: тренировки и методика',
    ownerTitle: 'База знаний: качество тренировок',
    managerDescription:
      'Понять тренерский кабинет, методическую базу и аналитику старшего тренера.',
    ownerDescription:
      'Проверить, как CRM связывает тренировки, навыки, рекомендации, планы и аналитику методики.',
    sections: ['trainer', 'methodology', 'methodology-analytics'],
  },
  {
    slug: 'growth',
    managerTitle: 'База знаний: рост и коммуникации',
    ownerTitle: 'База знаний: спрос и возврат клиентов',
    managerDescription:
      'Понять сегменты, обзвоны, телефонию и аналитику посещений как единую воронку.',
    ownerDescription:
      'Проверить, где CRM показывает спрос, потерянные контакты и возможности повторных продаж.',
    sections: ['client-bases', 'call-tasks', 'telephony', 'visits-analytics'],
  },
  {
    slug: 'economics',
    managerTitle: 'База знаний: экономика смен',
    ownerTitle: 'База знаний: экономика клуба',
    managerDescription:
      'Разобраться в финансах, начислениях, мотивации и утилизации как операционных разделах CRM.',
    ownerDescription:
      'Проверить, как финансовый отчет, начисления, мотивация и загрузка кортов связаны в CRM.',
    sections: [
      'finances',
      'prepayments',
      'certificates',
      'corporate-clients',
      'staff',
      'motivation',
      'utilization',
    ],
  },
  {
    slug: 'governance',
    managerTitle: 'База знаний: правила и контроль',
    ownerTitle: 'База знаний: управление системой',
    managerDescription:
      'Понять роли, аудит, справочники, каталог и обучение как основу порядка в CRM.',
    ownerDescription:
      'Проверить, как права, аудит, справочники, каталог и обучение защищают качество управления.',
    sections: ['users', 'audit', 'catalog', 'references', 'onboarding'],
  },
];

const KNOWLEDGE_ROLE_CONFIGS = {
  manager: {
    finalTitle: 'Как пользоваться разделом в CRM',
    rewardXp: 25,
  },
  owner: {
    finalTitle: 'Как пользоваться разделом в CRM',
    rewardXp: 30,
  },
};

function makeKnowledgeLesson(role, section) {
  const roleConfig = KNOWLEDGE_ROLE_CONFIGS[role];
  const lensText = role === 'owner' ? section.ownerLens : section.managerLens;
  const selfCheckItems = CRM_KNOWLEDGE_SELF_CHECKS[section.slug] || [];
  const screenshots =
    section.screenshotRequired === false
      ? []
      : [
          {
            src: `/onboarding/knowledge/${section.slug}/overview.png`,
            alt: `Экран CRM: ${section.title}`,
            caption: `Так выглядит раздел «${section.title}». Открой его перед прохождением урока.`,
          },
        ];
  const cards = [
    ...section.cards,
    ...(CRM_KNOWLEDGE_DEEP_CARDS[section.slug] || []),
  ];

  return {
    title: `${section.title}: как это работает`,
    summary: section.summary,
    ...(section.updatedAt ? { updatedAt: section.updatedAt } : {}),
    screenshots,
    blocks: [
      ...cards.map((card) => ({
        title: card.title,
        type: 'paragraph',
        text: card.text,
        ...(screenshots.length > 0 && card.title === 'Карта экрана для первого входа'
          ? { screenshotIndex: 0 }
          : {}),
        ...(card.items?.length > 0 ? { items: card.items } : {}),
      })),
      ...(selfCheckItems.length > 0
        ? [
            {
              title: 'Самопроверка понимания',
              type: 'paragraph',
              text:
                'Перед завершением раздела проверь, что можешь объяснить эти вещи без подсказки.',
              items: selfCheckItems,
            },
          ]
        : []),
      {
        title: roleConfig.finalTitle,
        type: 'paragraph',
        text: lensText,
      },
    ],
  };
}

function makeKnowledgeTask(role, section) {
  const roleConfig = KNOWLEDGE_ROLE_CONFIGS[role];
  const key = `${role}.knowledge.${section.slug}`;

  return {
    key,
    title: section.title,
    description: section.description,
    route: section.route,
    kind: 'review',
    skills: section.skills,
    badge: section.badge,
    estimatedMinutes: section.estimatedMinutes,
    rewardXp: roleConfig.rewardXp,
    checkpoint: {
      event: 'report.viewed',
      conditions: { knowledgeTask: key },
    },
    lesson: makeKnowledgeLesson(role, section),
    trainingMode: { recommended: false },
  };
}

function buildKnowledgeMissions(role) {
  return KNOWLEDGE_MISSION_GROUPS.map((group) => ({
    key: `${role}.knowledge-${group.slug}`,
    title: role === 'owner' ? group.ownerTitle : group.managerTitle,
    description:
      role === 'owner' ? group.ownerDescription : group.managerDescription,
    tasks: group.sections.map((sectionSlug) => {
      const section = CRM_KNOWLEDGE_SECTION_BY_SLUG.get(sectionSlug);
      if (!section) {
        throw new Error(`Unknown onboarding knowledge section: ${sectionSlug}`);
      }
      return makeKnowledgeTask(role, section);
    }),
  }));
}

function appendRoleKnowledgeMissions() {
  for (const role of Object.keys(KNOWLEDGE_ROLE_CONFIGS)) {
    const pathConfig = onboardingCatalog[role];
    if (!pathConfig) continue;

    const existingMissionKeys = new Set(
      (pathConfig.missions || []).map((mission) => mission.key),
    );

    for (const mission of buildKnowledgeMissions(role)) {
      if (!existingMissionKeys.has(mission.key)) {
        pathConfig.missions.push(mission);
      }
    }
  }
}

function applyRoleInstructionLessons() {
  for (const pathConfig of Object.values(onboardingCatalog)) {
    for (const mission of pathConfig.missions || []) {
      for (const task of mission.tasks || []) {
        if (!task.lesson && roleInstructionLessons[task.key]) {
          task.lesson = roleInstructionLessons[task.key];
        }
        convertLessonToSectionFirstFormat(task);
        stampLessonUpdatedAt(task);
      }
    }
  }
}

appendRoleKnowledgeMissions();
applyRoleInstructionLessons();

function getOnboardingRoleOptions() {
  return ACCOUNT_ROLE_VALUES.map((role) => ({
    value: role,
    label: ACCOUNT_ROLES[role].label,
    description: ACCOUNT_ROLES[role].description,
  }));
}

function getOnboardingPath(role) {
  return onboardingCatalog[role] || null;
}

function listOnboardingPaths() {
  return ACCOUNT_ROLE_VALUES.map((role) => onboardingCatalog[role]).filter(Boolean);
}

function findOnboardingTask(role, taskKey) {
  const path = getOnboardingPath(role);
  if (!path) return null;

  for (const mission of path.missions) {
    const task = mission.tasks.find((item) => item.key === taskKey);
    if (task) {
      return {
        mission,
        path,
        task,
      };
    }
  }

  return null;
}

function validateOnboardingCatalog() {
  const errors = [];
  const roleSet = new Set(ACCOUNT_ROLE_VALUES);
  const routeSet = new Set(ONBOARDING_ROUTES);
  const eventSet = new Set(ONBOARDING_CHECKPOINT_EVENTS);
  const clientEventSet = new Set(ONBOARDING_CLIENT_CHECKPOINT_EVENTS);
  const seenTaskKeys = new Set();

  for (const eventKey of clientEventSet) {
    if (!eventSet.has(eventKey)) {
      errors.push(`Client checkpoint event ${eventKey} is not allowed`);
    }
  }

  for (const role of ACCOUNT_ROLE_VALUES) {
    const path = onboardingCatalog[role];
    if (!path) {
      errors.push(`Missing onboarding path for role ${role}`);
      continue;
    }

    if (!roleSet.has(path.role)) {
      errors.push(`Unknown path role ${path.role}`);
    }

    if (!path.levelLabel) {
      errors.push(`Path ${role} has no level label`);
    }

    if (!path.completionBadge) {
      errors.push(`Path ${role} has no completion badge`);
    }

    const seenMissionKeys = new Set();
    for (const mission of path.missions || []) {
      if (seenMissionKeys.has(mission.key)) {
        errors.push(`Duplicate mission key ${mission.key}`);
      }
      seenMissionKeys.add(mission.key);

      if (!Array.isArray(mission.tasks) || mission.tasks.length === 0) {
        errors.push(`Mission ${mission.key} has no tasks`);
      }

      for (const task of mission.tasks || []) {
        if (seenTaskKeys.has(task.key)) {
          errors.push(`Duplicate task key ${task.key}`);
        }
        seenTaskKeys.add(task.key);

        if (!routeSet.has(task.route)) {
          errors.push(`Task ${task.key} points to unknown route ${task.route}`);
        }

        if (!task.checkpoint?.event || !eventSet.has(task.checkpoint.event)) {
          errors.push(`Task ${task.key} uses unknown checkpoint event ${task.checkpoint?.event}`);
        }

        if (
          !Array.isArray(task.skills) ||
          task.skills.length === 0 ||
          task.skills.some((skill) => typeof skill !== 'string' || skill.trim().length === 0)
        ) {
          errors.push(`Task ${task.key} has no skills`);
        }

        if (typeof task.badge !== 'string' || task.badge.trim().length === 0) {
          errors.push(`Task ${task.key} has no badge`);
        }
      }
    }
  }

  return errors;
}

module.exports = {
  ONBOARDING_CONTENT_UPDATED_AT,
  ONBOARDING_CLIENT_CHECKPOINT_EVENTS,
  ONBOARDING_CHECKPOINT_EVENTS,
  ONBOARDING_ROUTES,
  findOnboardingTask,
  getOnboardingPath,
  getOnboardingRoleOptions,
  listOnboardingPaths,
  onboardingCatalog,
  validateOnboardingCatalog,
};
