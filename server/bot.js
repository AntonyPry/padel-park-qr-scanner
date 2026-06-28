require('dotenv').config();

const http = require('http');
const db = require('./models');
const createApp = require('./src/app');
const { createSocketServer } = require('./src/sockets');
const { publishRealtimeChange } = require('./src/realtime');
const { createTelegramBot } = require('./src/bots/telegram');
const { createVkBot } = require('./src/bots/vk');
const callTasksService = require('./src/services/call-tasks.service');
const telephonyService = require('./src/services/telephony.service');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || process.env.SERVER_HOST || null;

const app = createApp();
const server = http.createServer(app);
const io = createSocketServer(server);

app.set('io', io);

async function startDatabase() {
  await db.sequelize.authenticate();
  console.log('✅ БД подключена.');
}

function startHttpServer() {
  if (HOST) {
    server.listen(PORT, HOST);
    console.log(`Сервер запущен на ${HOST}:${PORT}`);
    return;
  }

  server.listen(PORT);
  console.log('Сервер запущен на порту', PORT);
}

function isFeatureEnabled(envName, defaultValue = true) {
  const value = process.env[envName];
  if (value == null || value === '') return defaultValue;

  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function startRecurringCallTasksRunner() {
  const intervalMs = Number(process.env.CALL_TASKS_RUNNER_INTERVAL_MS || 60000);

  const run = async () => {
    try {
      const result = await callTasksService.runDueRecurringTasks(new Date());
      if (result.processed > 0) {
        console.log(
          `📞 Автозадачи обзвона: обработано баз ${result.processed}.`,
        );
        publishRealtimeChange(io, {
          domain: 'call_tasks',
          entity: 'call_task',
          action: 'synced',
          source: 'system',
          hints: {
            queryGroups: ['callTasks', 'clientBases', 'clients', 'managerControl'],
            routes: [
              '/admin/call-tasks',
              '/admin/client-bases',
              '/admin/clients',
              '/admin/manager-control',
            ],
          },
        });
      }
    } catch (error) {
      console.error('❌ Ошибка автозадач обзвона:', error);
    }
  };

  setInterval(run, intervalMs);
  void run();
}

function startTelephonySubscriptionRunner() {
  const rawIntervalMs = Number(process.env.BEELINE_SUBSCRIPTION_RUNNER_INTERVAL_MS);
  const intervalMs =
    Number.isFinite(rawIntervalMs) && rawIntervalMs >= 60 * 1000
      ? rawIntervalMs
      : 5 * 60 * 1000;

  const run = async () => {
    try {
      const result = await telephonyService.maintainEventSubscription();
      if (['created', 'renewed'].includes(result.action)) {
        console.log(`☎️ XSI-подписка Билайна: ${result.action}.`);
        publishRealtimeChange(io, {
          domain: 'telephony',
          entity: 'telephony_subscription',
          action: 'synced',
          source: 'system',
          hints: {
            queryGroups: ['telephony'],
            routes: ['/admin/telephony'],
          },
        });
      }
      if (result.action === 'failed') {
        console.error('❌ Ошибка автопродления XSI-подписки:', result.error);
      }
    } catch (error) {
      console.error('❌ Ошибка runner XSI-подписки:', error);
    }
  };

  setInterval(run, intervalMs);
  setTimeout(run, 15000);
}

async function startTelegramBot() {
  const telegramBot = createTelegramBot();
  if (!telegramBot) {
    console.log('✈️ Telegram Бот не запущен: BOT_TOKEN не задан.');
    return;
  }

  telegramBot.start();
  console.log('✈️ Telegram Бот запущен.');
}

async function startVkBot() {
  const vkBot = createVkBot();
  if (!vkBot) {
    console.log('🟦 ВКонтакте Бот не запущен: VK_TOKEN не задан.');
    return;
  }

  await vkBot.start();
  console.log('🟦 ВКонтакте Бот запущен.');
}

async function startApp() {
  try {
    await startDatabase();
  } catch (error) {
    console.error('❌ Ошибка старта БД:', error);
  }

  if (isFeatureEnabled('BOTS_ENABLED')) {
    try {
      await startTelegramBot();
    } catch (error) {
      console.error('❌ Ошибка старта Tg:', error);
    }

    try {
      await startVkBot();
    } catch (error) {
      console.error('❌ Ошибка старта VK:', error);
    }
  } else {
    console.log('🤖 Боты отключены через BOTS_ENABLED=false.');
  }

  try {
    startHttpServer();
    if (isFeatureEnabled('BACKGROUND_RUNNERS_ENABLED')) {
      startRecurringCallTasksRunner();
      startTelephonySubscriptionRunner();
    } else {
      console.log('⏱️ Фоновые runner-ы отключены через BACKGROUND_RUNNERS_ENABLED=false.');
    }
  } catch (error) {
    console.error('❌ Ошибка старта сервера:', error);
  }
}

startApp();
