require('dotenv').config();

const http = require('http');
const db = require('./models');
const createApp = require('./src/app');
const { createSocketServer } = require('./src/sockets');
const { createTelegramBot } = require('./src/bots/telegram');
const { createVkBot } = require('./src/bots/vk');
const callTasksService = require('./src/services/call-tasks.service');
const telephonyService = require('./src/services/telephony.service');

const PORT = process.env.PORT || 3000;

const app = createApp();
const server = http.createServer(app);
const io = createSocketServer(server);

app.set('io', io);

async function startDatabase() {
  await db.sequelize.authenticate();
  console.log('✅ БД подключена.');
}

function startHttpServer() {
  server.listen(PORT);
  console.log('Сервер запущен на порту', PORT);
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

  try {
    startHttpServer();
    startRecurringCallTasksRunner();
    startTelephonySubscriptionRunner();
  } catch (error) {
    console.error('❌ Ошибка старта сервера:', error);
  }
}

startApp();
