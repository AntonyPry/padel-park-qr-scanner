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
              conditions: {
                name: 'Иван Иванович Тестов',
                note: '[training] создано в задании администратора',
                phoneNormalized: '9000000999',
                source: 'Онбординг',
              },
            },
            lesson: {
              title: 'Как создать клиента из первого обращения',
              summary:
                'Администратор заводит клиента в базе сразу с телефоном, источником и короткой заметкой, чтобы команда понимала контекст обращения.',
              blocks: [
                {
                  screenshotIndex: 0,
                  title: 'Открой клиентскую базу',
                  type: 'step',
                  text: 'Клиента создают на странице клиентской базы, когда человек впервые обратился в клуб: позвонил, написал или подошел на ресепшн. Начинай с кнопки создания клиента в правой части экрана.',
                },
                {
                  screenshotIndex: 1,
                  title: 'Заполни только важный минимум',
                  type: 'step',
                  text: 'В первой карточке достаточно зафиксировать данные, по которым команда сможет узнать человека и понять контекст обращения.',
                  items: [
                    'Имя помогает быстро найти клиента в базе.',
                    'Телефон нужен для связи и проверки дублей.',
                    'Источник показывает, откуда пришло обращение.',
                    'Заметка сохраняет контекст для следующего сотрудника.',
                  ],
                },
                {
                  title: 'Что важно проверить перед сохранением',
                  type: 'paragraph',
                  text: 'Перед сохранением убедись, что телефон введен полностью, источник выбран из справочника, а заметка коротко объясняет повод обращения. Так следующий сотрудник быстро поймет контекст клиента.',
                },
              ],
              screenshots: [
                {
                  src: '/onboarding/admin/client-create/client-list.png',
                  alt: 'Список клиентов с кнопкой создания клиента',
                  caption: 'Начинай с кнопки «Клиент» на странице клиентской базы.',
                },
                {
                  src: '/onboarding/admin/client-create/client-form.png',
                  alt: 'Форма создания клиента с учебными полями',
                  caption: 'Заполни имя, телефон, источник и заметку, затем сохрани карточку.',
                },
              ],
            },
            practice: {
              autoTrainingMode: true,
              route: '/admin/clients',
              targetSelectors: [
                'admin.client.create.open',
                'admin.client.create.name',
                'admin.client.create.phone',
                'admin.client.create.source',
                'admin.client.create.note',
                'admin.client.create.save',
              ],
              testData: {
                name: 'Иван Иванович Тестов',
                note: '[training] создано в задании администратора',
                phone: '+79000000999',
                source: 'Онбординг',
              },
              steps: [
                {
                  key: 'open-form',
                  title: 'Открой форму',
                  description: 'Нажми кнопку «Клиент» на странице клиентской базы.',
                  target: 'admin.client.create.open',
                },
                {
                  key: 'fill-name',
                  title: 'Введи имя',
                  description: 'Укажи «Иван Иванович Тестов».',
                  target: 'admin.client.create.name',
                },
                {
                  key: 'fill-phone',
                  title: 'Введи телефон',
                  description: 'Укажи «+79000000999».',
                  target: 'admin.client.create.phone',
                },
                {
                  key: 'select-source',
                  title: 'Выбери источник',
                  description: 'Поставь источник «Онбординг».',
                  target: 'admin.client.create.source',
                },
                {
                  key: 'fill-note',
                  title: 'Добавь заметку',
                  description: 'Вставь учебную заметку из инструкции.',
                  target: 'admin.client.create.note',
                },
                {
                  checkpointEvent: 'client.created',
                  key: 'save-client',
                  title: 'Сохрани клиента',
                  description: 'Сохрани карточку. CRM проверит данные и закроет практику.',
                  target: 'admin.client.create.save',
                },
              ],
            },
            quiz: {
              passingScorePercent: 100,
              questions: [
                {
                  key: 'client-required-fields',
                  prompt: 'Какие данные обязательно внести в этом задании?',
                  type: 'single_choice',
                  correctOptionId: 'name-phone-source-note',
                  hint: 'Задание проверяет не просто создание клиента, а полный контекст первого обращения.',
                  explanation:
                    'Имя, телефон, источник и заметка нужны, чтобы клиентская база оставалась полезной для смены и менеджера.',
                  options: [
                    {
                      id: 'name-phone-source-note',
                      text: 'Имя, телефон, источник и заметку',
                    },
                    {
                      id: 'name-only',
                      text: 'Только имя клиента',
                    },
                    {
                      id: 'phone-only',
                      text: 'Только телефон, остальное можно оставить пустым',
                    },
                  ],
                },
                {
                  key: 'client-training-mode',
                  prompt: 'Почему практику надо проходить в режиме тренировки?',
                  type: 'single_choice',
                  correctOptionId: 'training-isolated',
                  hint: 'Учебные записи должны быть безопасны для отчетов и боевой базы.',
                  explanation:
                    'Training mode помечает созданного клиента как учебного, чтобы его можно было удалить и не учитывать в боевых отчетах.',
                  options: [
                    {
                      id: 'training-isolated',
                      text: 'Учебный клиент не смешается с боевыми данными и отчетами',
                    },
                    {
                      id: 'training-faster',
                      text: 'Так форма сохраняется без обязательных полей',
                    },
                    {
                      id: 'training-hides-errors',
                      text: 'Так CRM игнорирует ошибки заполнения',
                    },
                  ],
                },
              ],
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
                'Телефонная бронь должна сразу попадать в расписание с клиентом, временем, кортом, источником и понятным статусом.',
              blocks: [
                {
                  screenshotIndex: 0,
                  title: 'Открой расписание броней',
                  type: 'step',
                  text: 'На странице бронирования выбери нужный день и свободный слот. Перед созданием проверь, что корт и время совпадают с запросом клиента.',
                },
                {
                  screenshotIndex: 1,
                  title: 'Заполни форму брони',
                  type: 'step',
                  text: 'В форме укажи клиента, источник phone, дату, время, корт и статус. Если клиент просит комментарий, добавь его сразу.',
                  items: [
                    'Источник phone помогает отделить телефонные брони от заявок с ресепшна.',
                    'Статус должен отражать реальную договоренность с клиентом.',
                    'Цена и оплата проверяются до сохранения, если они уже известны.',
                  ],
                },
                {
                  title: 'Финальная сверка',
                  type: 'paragraph',
                  text: 'После сохранения проверь, что бронь появилась в сетке расписания и не конфликтует с соседними слотами.',
                },
              ],
              screenshots: [
                {
                  src: '/onboarding/admin/booking-create-phone/schedule.png',
                  alt: 'Расписание бронирования',
                  caption: 'Выбери день, корт и свободное время в расписании.',
                },
                {
                  src: '/onboarding/admin/booking-create-phone/booking-form.png',
                  alt: 'Форма создания брони',
                  caption: 'Заполни ключевые поля брони и сохрани запись.',
                },
              ],
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
                  text: 'Открой день бронирования и найди бронь клиента по времени, корту и имени. Не отмечай оплату у похожей соседней записи.',
                },
                {
                  screenshotIndex: 1,
                  title: 'Проверь сумму и способ оплаты',
                  type: 'step',
                  text: 'Перед подтверждением оплаты сверь сумму, способ оплаты и статус. Если клиент оплатил частично, не ставь полную оплату.',
                  items: [
                    'Способ оплаты должен совпадать с фактическим платежом.',
                    'Сумма не должна превышать стоимость брони.',
                    'После оплаты у записи должен быть понятный paid-статус.',
                  ],
                },
                {
                  title: 'После оплаты',
                  type: 'paragraph',
                  text: 'Проверь, что бронь больше не висит как неоплаченная, а итог дня по оплатам стал корректнее.',
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
                  text: 'Перед переносом открой сетку расписания и проверь, что новое время действительно свободно для нужного корта.',
                },
                {
                  screenshotIndex: 1,
                  title: 'Перенеси только нужную запись',
                  type: 'step',
                  text: 'Переноси конкретную бронь клиента, не меняя соседние записи. После переноса проверь дату, время, корт и длительность.',
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
                  text: 'Найди бронь в расписании или списке дня и сверь клиента, время и корт. Отмена похожей записи создаст кассовый и операционный шум.',
                },
                {
                  screenshotIndex: 1,
                  title: 'Укажи причину отмены',
                  type: 'step',
                  text: 'При отмене запиши короткую причину: клиент перенес планы, ошибка записи, дубль или другое объяснение.',
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
            lesson: {
              title: 'Как проверить расписание на смену',
              summary:
                'Перед и во время смены администратор должен видеть ближайшие брони, спорные статусы и возможные накладки.',
              blocks: [
                {
                  screenshotIndex: 0,
                  title: 'Посмотри день целиком',
                  type: 'step',
                  text: 'Открой страницу бронирования и оцени загруженность дня: где плотные места, где есть свободные окна, какие корты требуют внимания.',
                },
                {
                  screenshotIndex: 1,
                  title: 'Проверь ближайшие брони',
                  type: 'step',
                  text: 'В списке броней дня сверь ближайшие записи, статусы, оплату и комментарии. Так проще предупредить проблему до прихода клиента.',
                  items: [
                    'Особое внимание уделяй неоплаченным и перенесенным броням.',
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

const roleInstructionLessons = {
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
      'Проверь, что правило осталось активным только там, где нужно, и не конфликтует с соседними правилами.',
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
  'manager.visits-analytics.review': makeCardLesson({
    title: 'Как читать аналитику посещений',
    summary:
      'Аналитика посещений показывает пульс смен: сколько гостей пришло, какие цели визитов работают и где есть отклонения.',
    overviewTitle: 'Открой отчет по посещениям',
    overviewText:
      'Начинай с периода и ключевых метрик. Сравни посещения, динамику и распределение по целям.',
    overviewItems: [
      'Период должен совпадать с управленческим вопросом.',
      'Резкие провалы лучше проверять по сменам и бронированиям.',
    ],
    detailTitle: 'Найди смены с отклонениями',
    detailText:
      'Смотри детализацию: какие дни, цели визитов или сотрудники дают отличие от ожиданий.',
    detailItems: [
      'Отдельно отмечай дни с низким входящим потоком.',
      'Сверяй посещения с расписанием и акциями.',
    ],
    finalTitle: 'Что делать с выводом',
    finalText:
      'После отчета должно появиться действие: обзвон, акция, проверка смены или корректировка расписания.',
    screenshot: {
      role: 'manager',
      slug: 'visits-analytics',
      overviewAlt: 'Аналитика посещений менеджера',
      overviewCaption: 'Сначала выставь период и прочитай основные метрики.',
      detailAlt: 'Детализация посещений',
      detailCaption: 'Ищи дни и цели визитов с отклонениями.',
    },
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
  'owner.operations.review-visits': makeCardLesson({
    title: 'Как проверить динамику посещений',
    summary:
      'Динамика посещений помогает владельцу увидеть спрос, качество операционной работы и эффект активностей клуба.',
    overviewTitle: 'Открой аналитику посещений',
    overviewText:
      'Выбери период и посмотри основные метрики: количество визитов, цели и изменение потока.',
    overviewItems: [
      'Сравни период с предыдущими неделями или месяцами.',
      'Проверь, не объясняется ли провал расписанием или праздниками.',
    ],
    detailTitle: 'Сопоставь с операционными данными',
    detailText:
      'Посещения стоит читать вместе с бронями, загрузкой и финансами, чтобы отличить проблему продаж от проблемы расписания.',
    detailItems: [
      'Рост визитов без роста денег требует проверки среднего чека.',
      'Падение визитов при высокой загрузке может быть нормальным для пиковых часов.',
    ],
    finalTitle: 'Управленческий итог',
    finalText:
      'После отчета у владельца должен быть один из выводов: все по плану, нужен разбор смены, нужна акция или нужен пересмотр расписания.',
    screenshot: {
      role: 'owner',
      slug: 'visits-analytics',
      overviewAlt: 'Аналитика посещений владельца',
      overviewCaption: 'Сначала выбери период и оцени динамику посещений.',
      detailAlt: 'Детализация посещений владельца',
      detailCaption: 'Сопоставляй посещения с бронями, загрузкой и финансами.',
    },
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
      'Укажи тип операции, категорию, сумму, дату и комментарий. Комментарий должен объяснять, почему операция внесена вручную.',
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
      'Перед правкой проверь название, группу, тип учета и комиссию. Изменение категории влияет на будущие операции.',
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
      'Укажи дату, уровень, упражнения и заметку. Пиши так, чтобы другой тренер понял, что закрепить дальше.',
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
  'viewer.visits-analytics.review': makeCardLesson({
    title: 'Как смотреть аналитику входов',
    summary:
      'Наблюдатель читает отчет без изменения данных: период, динамика и основные выводы по посещениям.',
    overviewTitle: 'Открой аналитику посещений',
    overviewText:
      'Выбери период и посмотри ключевые показатели. Viewer работает только с чтением отчета.',
    overviewItems: [
      'Не ищи кнопки изменения данных в режиме просмотра.',
      'Фиксируй выводы вне CRM, если нужны комментарии для команды.',
    ],
    detailTitle: 'Прочитай детализацию',
    detailText:
      'Смотри дни, цели визитов и отклонения. Задача наблюдателя — понять картину, не вмешиваясь в операционку.',
    detailItems: [
      'Сравнивай периоды одинаковой длины.',
      'Отмечай только проверяемые выводы.',
    ],
    finalTitle: 'Итог просмотра',
    finalText:
      'Отчет просмотрен корректно, если понятны период, динамика и главный вывод без изменения данных CRM.',
    screenshot: {
      role: 'viewer',
      slug: 'visits-analytics',
      overviewAlt: 'Аналитика посещений наблюдателя',
      overviewCaption: 'Viewer читает отчет по выбранному периоду без редактирования.',
      detailAlt: 'Детализация посещений наблюдателя',
      detailCaption: 'Смотри динамику и отклонения, не меняя данные.',
    },
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

function applyRoleInstructionLessons() {
  for (const pathConfig of Object.values(onboardingCatalog)) {
    for (const mission of pathConfig.missions || []) {
      for (const task of mission.tasks || []) {
        if (!task.lesson && roleInstructionLessons[task.key]) {
          task.lesson = roleInstructionLessons[task.key];
        }
      }
    }
  }
}

function applyInstructionScreenshotFallbacks() {
  for (const pathConfig of Object.values(onboardingCatalog)) {
    for (const mission of pathConfig.missions || []) {
      for (const task of mission.tasks || []) {
        const lesson = task.lesson;
        const blocks = Array.isArray(lesson?.blocks) ? lesson.blocks : [];
        const screenshots = Array.isArray(lesson?.screenshots)
          ? lesson.screenshots
          : [];

        if (blocks.length === 0 || screenshots.length === 0) continue;

        blocks.forEach((block, blockIndex) => {
          if (!block || Number.isInteger(block.screenshotIndex)) return;

          block.screenshotIndex = Math.min(blockIndex, screenshots.length - 1);
        });
      }
    }
  }
}

applyRoleInstructionLessons();
applyInstructionScreenshotFallbacks();

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
