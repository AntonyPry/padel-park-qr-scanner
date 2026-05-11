require('dotenv').config();

const http = require('http');
const db = require('./models');
const createApp = require('./src/app');
const { createSocketServer } = require('./src/sockets');
const { createTelegramBot } = require('./src/bots/telegram');
const { createVkBot } = require('./src/bots/vk');

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
  } catch (error) {
    console.error('❌ Ошибка старта сервера:', error);
  }
}

startApp();
