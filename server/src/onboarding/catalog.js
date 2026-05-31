const { ACCOUNT_ROLES, ACCOUNT_ROLE_VALUES } = require('../constants/account-roles');

const ONBOARDING_ROUTES = [
  '/admin',
  '/admin/audit',
  '/admin/bookings',
  '/admin/call-tasks',
  '/admin/catalog',
  '/admin/client-bases',
  '/admin/clients',
  '/admin/finances',
  '/admin/motivation',
  '/admin/onboarding',
  '/admin/references',
  '/admin/staff',
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
  'catalog.category_updated',
  'catalog.rule_updated',
  'client.created',
  'client.viewed',
  'client_base.created',
  'finance.record_created',
  'finance.report_viewed',
  'motivation.rule_updated',
  'payroll.reviewed',
  'reference.viewed',
  'report.exported',
  'report.viewed',
  'shift.approved',
  'training_level.updated',
  'training_note.created',
  'training_note.updated',
  'utilization.viewed',
];

const ONBOARDING_CLIENT_CHECKPOINT_EVENTS = [
  'audit.viewed',
  'booking.schedule_viewed',
  'call_task.report_viewed',
  'finance.report_viewed',
  'reference.viewed',
  'report.viewed',
  'utilization.viewed',
];

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
            checkpoint: { event: 'client.created' },
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
            trainingMode: { recommended: true },
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
            trainingMode: { recommended: true },
          },
        ],
      },
      {
        key: 'admin.shift-review',
        title: 'Контроль расписания',
        description: 'Передать смену без сюрпризов: проверить расписание, статусы и ближайшие риски.',
        tasks: [
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
            checkpoint: { event: 'booking.schedule_viewed' },
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
        key: 'manager.operations-review',
        title: 'Операционный контроль',
        description: 'Сверить справочники, отчеты и загрузку, чтобы увидеть проблему до конца дня.',
        tasks: [
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
            title: 'Прочитать отчет по посещениям',
            description: 'Сравнить посещения за период и найти смены, где нужна реакция менеджера.',
            route: '/admin/visits-analytics',
            kind: 'review',
            skills: ['Отчеты', 'Посещения'],
            badge: 'Пульс смен прочитан',
            estimatedMinutes: 4,
            rewardXp: 30,
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
            description: 'Открыть обучение, выбрать роль и убедиться, что sandbox-записи отделены от боевых.',
            route: '/admin/onboarding',
            kind: 'review',
            skills: ['Обучение', 'Безопасность данных'],
            badge: 'Sandbox проверен',
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
        key: 'owner.club-health',
        title: 'Здоровье клуба',
        description: 'Смотреть деньги, загрузку кортов и мотивацию команды.',
        tasks: [
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
            title: 'Проверить динамику посещений',
            description: 'Открыть аналитику входов и сравнить посещаемость с ожиданиями по периоду.',
            route: '/admin/visits-analytics',
            kind: 'review',
            skills: ['Отчеты', 'Посещения'],
            badge: 'Трафик прочитан',
            estimatedMinutes: 4,
            rewardXp: 30,
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
            checkpoint: { event: 'training_note.created' },
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
            title: 'Посмотреть аналитику входов',
            description: 'Выбрать период и прочитать динамику посещений.',
            route: '/admin/visits-analytics',
            kind: 'review',
            skills: ['Отчеты', 'Посещения'],
            badge: 'Динамика прочитана',
            estimatedMinutes: 4,
            rewardXp: 25,
            checkpoint: { event: 'report.viewed' },
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
