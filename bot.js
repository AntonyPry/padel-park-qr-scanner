process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();
const db = require('./models');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const QRCode = require('qrcode');
const { Op } = require('sequelize');
const startScanner = require('./scanner');
const { SocksProxyAgent } = require('socks-proxy-agent');

// --- ИМПОРТЫ TELEGRAM ---
const {
  Bot: TgBot,
  session: tgSession,
  InlineKeyboard: TgInlineKeyboard,
  Keyboard: TgKeyboard,
  InputFile: TgInputFile,
} = require('grammy');
const {
  conversations: tgConversations,
  createConversation: tgCreateConversation,
} = require('@grammyjs/conversations');
const { run: runTg } = require('@grammyjs/runner');

// --- ИМПОРТЫ VK ---
const { VK, Keyboard: VkKeyboard } = require('vk-io');
const { SessionManager: VkSessionManager } = require('@vk-io/session');
const {
  SceneManager: VkSceneManager,
  StepScene: VkStepScene,
} = require('@vk-io/scenes');

// ==========================================
// 1. ВЕБ-СЕРВЕР И АДМИНКА (Общая часть)
// ==========================================
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/api/search', async (req, res) => {
  /* Твой код поиска без изменений */
  const query = req.query.q;
  if (!query || query.length < 2) return res.json([]);
  try {
    const users = await db.User.findAll({
      where: { name: { [Op.like]: `%${query}%` } },
      limit: 5,
    });
    res.json(users);
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/manual-visit', async (req, res) => {
  /* Твой код ручного визита без изменений */
  const { userId } = req.body;
  if (!userId) return res.status(400).send('No ID');
  try {
    const user = await db.User.findByPk(userId);
    if (!user) return res.status(404).send('User not found');
    const lastVisit = await db.Visit.findOne({
      where: { userId: user.id },
      order: [['createdAt', 'DESC']],
    });
    let visitId;
    let isNewVisit = true;
    if (lastVisit && (new Date() - lastVisit.createdAt) / 60000 < 5) {
      visitId = lastVisit.id;
      isNewVisit = false;
    }
    if (isNewVisit) {
      const newVisit = await db.Visit.create({ userId: user.id });
      visitId = newVisit.id;
    }
    io.emit('scan_result', {
      success: true,
      user: user,
      visitId: visitId,
      isRepeated: !isNewVisit,
    });
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).send('Error');
  }
});

app.post('/api/key', async (req, res) => {
  /* Твой код ключа без изменений */
  const { visitId, keyNumber } = req.body;
  try {
    await db.Visit.update({ keyNumber }, { where: { id: visitId } });
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).send('Error');
  }
});

// АДАПТИРОВАННЫЙ СКАНЕР ДЛЯ TG И VK
app.post('/api/scan', async (req, res) => {
  const { qr } = req.body;
  console.log('📡 Сканер:', qr);
  if (!qr) return res.status(400).send('No QR');

  try {
    let user;
    // Проверяем, откуда пришел QR: если есть префикс vk_ - ищем в vkId
    if (qr.startsWith('vk_')) {
      const vkId = qr.replace('vk_', '');
      user = await db.User.findOne({ where: { vkId: vkId } });
    } else {
      // Иначе считаем, что это Telegram ID
      user = await db.User.findOne({ where: { telegramId: qr } });
    }

    if (user) {
      const lastVisit = await db.Visit.findOne({
        where: { userId: user.id },
        order: [['createdAt', 'DESC']],
      });
      let visitId;
      let isNewVisit = true;
      if (lastVisit && (new Date() - lastVisit.createdAt) / 60000 < 5) {
        console.log('⏱️ Повторный скан. Новая запись не создана.');
        visitId = lastVisit.id;
        isNewVisit = false;
      }
      if (isNewVisit) {
        const newVisit = await db.Visit.create({ userId: user.id });
        visitId = newVisit.id;
      }
      io.emit('scan_result', {
        success: true,
        user: user,
        visitId: visitId,
        isRepeated: !isNewVisit,
      });
      res.json({ status: 'ok', found: true });
    } else {
      io.emit('scan_result', { success: false, id: qr });
      res.json({ status: 'ok', found: false });
    }
  } catch (e) {
    console.error(e);
    res.status(500).send('Server Error');
  }
});

// ==========================================
// 2. ОБЩИЕ ФУНКЦИИ И ТЕКСТЫ
// ==========================================
function isValidWord(text) {
  return text && /^[а-яА-Яa-zA-ZёЁ\-]+$/.test(text.trim());
}
function getPhoneValidationError(text) {
  if (!text) return 'Пустой ввод.';
  if (!/^[0-9\+\-\s\(\)]+$/.test(text)) return '❌ Используйте только цифры.';
  const digitsOnly = text.replace(/\D/g, '');
  if (digitsOnly.length < 10) return '❌ Слишком короткий номер.';
  if (digitsOnly.length > 15) return '❌ Слишком длинный номер.';
  return null;
}

const CONSENT_TEXT = `Просим вас ознакомиться с правилами клуба и дать согласие ☺️\n
• Публичная оферта и правила клуба\nhttps://padelpark.pro/rules\n
• Политика конфиденциальности\nhttps://padelpark.pro/privacy\n
• Согласие на получение рекламных рассылок\nhttps://padelpark.pro/adv\n
Нажмите на пункты ниже, чтобы отметить их галочками.`;

// ==========================================
// 3. БОТ ВКОНТАКТЕ (VK-IO)
// ==========================================
const vk = new VK({ token: process.env.VK_TOKEN });
const vkSessionManager = new VkSessionManager();
const vkSceneManager = new VkSceneManager();

vk.updates.on('message_new', vkSessionManager.middleware);
vk.updates.on('message_new', vkSceneManager.middleware);
vk.updates.on('message_new', vkSceneManager.middlewareIntercept);

// Главное меню ВК
const vkMainMenu = VkKeyboard.builder()
  .textButton({
    label: '🔄 Сгенерировать QR заново',
    payload: { command: 'get_qr' },
    color: VkKeyboard.PRIMARY_COLOR,
  })
  .row()
  .textButton({
    label: '✏️ Изменить данные',
    payload: { command: 'edit_profile' },
    color: VkKeyboard.SECONDARY_COLOR,
  });

// Клавиатура галочек для ВК
function getVkConsentKeyboard(consents) {
  const kb = VkKeyboard.builder()
    .textButton({
      label: consents[0]
        ? '✅ С правилами ознакомлен'
        : '❌ С правилами ознакомлен',
      payload: { consent: 0 },
    })
    .row()
    .textButton({
      label: consents[1]
        ? '✅ Согласен с политикой'
        : '❌ Согласен с политикой',
      payload: { consent: 1 },
    })
    .row()
    .textButton({
      label: consents[2] ? '✅ Даю согласие' : '❌ Даю согласие',
      payload: { consent: 2 },
    })
    .row();
  if (consents.every((c) => c === true)) {
    kb.textButton({
      label: '➡️ ДАЛЕЕ',
      payload: { command: 'start_register' },
      color: VkKeyboard.POSITIVE_COLOR,
    });
  }
  return kb.inline();
}

// Сцена регистрации ВК
const vkRegisterScene = new VkStepScene('register', [
  async (ctx) => {
    if (ctx.scene.step.firstTime) {
      await ctx.send('📝 Шаг 1 из 4. Введите ваше Имя:');
      return;
    }
    if (!isValidWord(ctx.text)) {
      await ctx.send('❌ Имя должно состоять только из букв.');
      return;
    }
    ctx.scene.state.firstname = ctx.text.trim();
    await ctx.scene.step.next();
  },
  async (ctx) => {
    if (ctx.scene.step.firstTime) {
      await ctx.send('📝 Шаг 2 из 4. Введите вашу Фамилию:');
      return;
    }
    if (!isValidWord(ctx.text)) {
      await ctx.send('❌ Фамилия должна состоять только из букв.');
      return;
    }
    ctx.scene.state.surname = ctx.text.trim();
    await ctx.scene.step.next();
  },
  async (ctx) => {
    if (ctx.scene.step.firstTime) {
      await ctx.send(
        `👤 ${ctx.scene.state.firstname} ${ctx.scene.state.surname}\n\nШаг 3 из 4. Введите ваш номер телефона.\nПример: +79991234567`,
      );
      return;
    }
    const error = getPhoneValidationError(ctx.text);
    if (error) {
      await ctx.send(error);
      return;
    }
    ctx.scene.state.phone = ctx.text.trim();
    await ctx.scene.step.next();
  },
  async (ctx) => {
    if (ctx.scene.step.firstTime) {
      const kb = VkKeyboard.builder()
        .textButton({ label: 'Вк' })
        .textButton({ label: 'Тг' })
        .textButton({ label: 'Радио' })
        .row()
        .textButton({ label: 'Хоккей' })
        .textButton({ label: 'Сайт' })
        .textButton({ label: 'Инст' })
        .row()
        .textButton({ label: 'Рекомендация друзей' })
        .textButton({ label: 'Увидел в тц' })
        .row()
        .textButton({ label: 'Другое' })
        .oneTime();
      await ctx.send('📊 Шаг 4 из 4. Откуда вы о нас узнали?', {
        keyboard: kb,
      });
      return;
    }
    ctx.scene.state.source = ctx.text.trim();

    // Сохранение в БД
    const vkId = String(ctx.peerId);
    const fullName = `${ctx.scene.state.surname} ${ctx.scene.state.firstname}`;

    try {
      await db.User.upsert({
        vkId: vkId,
        name: fullName,
        phone: ctx.scene.state.phone,
        source: ctx.scene.state.source,
      });
      await ctx.send('✅ Регистрация завершена!');
      await sendVkQrCode(ctx, vkId);
    } catch (e) {
      console.error('Ошибка БД ВК:', e);
      await ctx.send('❌ Произошла ошибка при сохранении.');
    }

    await ctx.scene.leave();
  },
]);
vkSceneManager.addScenes([vkRegisterScene]);

// Обработчик сообщений ВК (Защита от случайных сообщений - админ может чатиться)
vk.updates.on('message_new', async (ctx, next) => {
  // Если клиент уже в процессе регистрации - пропускаем его к сцене
  if (ctx.scene.current) return next();

  // Если это просто текст без кнопок/команд (живое общение) - ИГНОРИРУЕМ
  if (
    !ctx.messagePayload &&
    !['Начать', 'начать', '/start'].includes(ctx.text)
  ) {
    return;
  }

  const payload = ctx.messagePayload || {};
  const vkId = String(ctx.peerId);

  // Команда старта
  if (['Начать', 'начать', '/start'].includes(ctx.text)) {
    const user = await db.User.findOne({ where: { vkId } });
    if (user) {
      return ctx.send(`С возвращением, ${user.name}!`, {
        keyboard: vkMainMenu,
      });
    }
    ctx.session.consents = [false, false, false];
    return ctx.send(CONSENT_TEXT, {
      keyboard: getVkConsentKeyboard(ctx.session.consents),
      dont_parse_links: true,
    });
  }

  // Обработка галочек согласия
  if (payload.consent !== undefined) {
    ctx.session.consents[payload.consent] =
      !ctx.session.consents[payload.consent];
    return ctx.send('Обновил выбор:', {
      keyboard: getVkConsentKeyboard(ctx.session.consents),
    });
  }

  // Кнопка Далее
  if (payload.command === 'start_register') {
    await ctx.send('✅ Согласия получены. Начинаем...');
    return ctx.scene.enter('register');
  }

  // Главное меню
  if (payload.command === 'get_qr' || ctx.text === '🔄 Сгенерировать QR заново')
    return sendVkQrCode(ctx, vkId);
  if (payload.command === 'edit_profile' || ctx.text === '✏️ Изменить данные')
    return ctx.scene.enter('register');

  await next();
});

async function sendVkQrCode(ctx, vkId) {
  try {
    const qrBuffer = await QRCode.toBuffer(`vk_${vkId}`, {
      scale: 10,
      margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    // В ВК картинку нужно сначала загрузить на сервер
    const attachment = await vk.upload.messagePhoto({
      source: { value: qrBuffer, filename: 'qr.png' },
      peer_id: ctx.peerId,
    });
    await ctx.send({
      message: 'Ваш пропуск:',
      attachment,
      keyboard: vkMainMenu,
    });
  } catch (e) {
    console.error('Ошибка QR ВК:', e);
    ctx.send('Ошибка генерации QR.');
  }
}

// ==========================================
// 4. БОТ TELEGRAM (GRAMMY)
// ==========================================

// Передаем настройки игнорирования сертификатов (для разных версий библиотеки)
const agent = new SocksProxyAgent(process.env.TG_PROXY_CREDS, {
  rejectUnauthorized: false, // Для старых версий socks-proxy-agent
  tls: { rejectUnauthorized: false }, // Для новых версий (v8+)
});

const tgBot = new TgBot(process.env.BOT_TOKEN, {
  client: {
    buildFetchConfig: (init) => ({
      ...init,
      agent: agent,
    }),
  },
});
tgBot.use(tgSession({ initial: () => ({ consents: [false, false, false] }) }));
tgBot.use(tgConversations());

const tgMainMenu = new TgKeyboard()
  .text('🔄 Сгенерировать QR заново')
  .row()
  .text('✏️ Изменить данные')
  .resized();

function getTgConsentKeyboard(consents) {
  const kb = new TgInlineKeyboard();
  kb.text(
    consents[0] ? '✅ С правилами ознакомлен' : '❌ С правилами ознакомлен',
    'toggle_consent_0',
  ).row();
  kb.text(
    consents[1] ? '✅ Согласен с политикой' : '❌ Согласен с политикой',
    'toggle_consent_1',
  ).row();
  kb.text(
    consents[2] ? '✅ Даю согласие' : '❌ Даю согласие',
    'toggle_consent_2',
  ).row();
  if (consents.every((c) => c === true)) kb.text('➡️ ДАЛЕЕ', 'consent_next');
  else kb.text('🔒 Отметьте все пункты выше', 'consent_locked');
  return kb;
}

async function tgRegisterConversation(conversation, ctx) {
  let surname, firstname, phone, source;
  let step = 0;
  while (step < 4) {
    if (step === 0) {
      await ctx.reply('📝 Шаг 1 из 4. Введите ваше **Имя**:', {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true },
      });
      const msg = await conversation.waitFor(':text');
      if (!isValidWord(msg.message.text)) {
        await ctx.reply('❌ Имя должно состоять только из букв.');
        continue;
      }
      firstname = msg.message.text.trim();
      step++;
    } else if (step === 1) {
      const kb = new TgKeyboard().text('⬅️ Назад').resized().oneTime();
      await ctx.reply('📝 Шаг 2 из 4. Введите вашу **Фамилию**:', {
        parse_mode: 'Markdown',
        reply_markup: kb,
      });
      const msg = await conversation.waitFor(':text');
      if (msg.message.text === '⬅️ Назад') {
        step--;
        continue;
      }
      if (!isValidWord(msg.message.text)) {
        await ctx.reply('❌ Фамилия должна состоять только из букв.');
        continue;
      }
      surname = msg.message.text.trim();
      step++;
    } else if (step === 2) {
      const kb = new TgKeyboard().text('⬅️ Назад').resized().oneTime();
      await ctx.reply(
        `👤 ${firstname} ${surname}\n\nШаг 3 из 4. Введите ваш **номер телефона**.\nПример: +79991234567`,
        { parse_mode: 'Markdown', reply_markup: kb },
      );
      const msg = await conversation.waitFor(':text');
      if (msg.message.text === '⬅️ Назад') {
        step--;
        continue;
      }
      const error = getPhoneValidationError(msg.message.text);
      if (error) {
        await ctx.reply(error);
        continue;
      }
      phone = msg.message.text.trim();
      step++;
    } else if (step === 3) {
      const sources = [
        ['Вк', 'Тг', 'Радио'],
        ['Хоккей', 'Сайт', 'Инст'],
        ['Рекомендация друзей', 'Увидел в тц'],
        ['Другое', '⬅️ Назад'],
      ];
      const kb = TgKeyboard.from(sources).resized().oneTime();
      await ctx.reply('📊 Шаг 4 из 4. Откуда вы о нас узнали?', {
        reply_markup: kb,
      });
      const msg = await conversation.waitFor(':text');
      if (msg.message.text === '⬅️ Назад') {
        step--;
        continue;
      }
      source = msg.message.text.trim();
      step++;
    }
  }
  const telegramId = String(ctx.from.id);
  const fullName = `${surname} ${firstname}`;
  await conversation.external(async () => {
    await db.User.upsert({
      telegramId: telegramId,
      name: fullName,
      phone: phone,
      source: source,
    });
  });
  await ctx.reply(`✅ Регистрация завершена!`, {
    reply_markup: { remove_keyboard: true },
  });
  await ctx.reply('Ваш пропуск:');
  return sendTgQrCode(ctx, telegramId);
}
tgBot.use(tgCreateConversation(tgRegisterConversation, 'register'));

tgBot.command('start', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const user = await db.User.findOne({ where: { telegramId } });
  if (user)
    return ctx.reply(`С возвращением, ${user.name}!`, {
      reply_markup: tgMainMenu,
    });
  ctx.session.consents = [false, false, false];
  await ctx.reply(CONSENT_TEXT, {
    link_preview_options: { is_disabled: true },
    reply_markup: getTgConsentKeyboard(ctx.session.consents),
  });
});

tgBot.callbackQuery(/toggle_consent_(\d)/, async (ctx) => {
  const idx = parseInt(ctx.match[1]);
  ctx.session.consents[idx] = !ctx.session.consents[idx];
  try {
    await ctx.editMessageReplyMarkup({
      reply_markup: getTgConsentKeyboard(ctx.session.consents),
    });
  } catch (e) {}
  await ctx.answerCallbackQuery();
});
tgBot.callbackQuery('consent_locked', async (ctx) => {
  await ctx.answerCallbackQuery({
    text: 'Отметьте все пункты галочками!',
    show_alert: true,
  });
});
tgBot.callbackQuery('consent_next', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('✅ Согласия получены. Начинаем регистрацию...');
  await ctx.conversation.enter('register');
});

tgBot.hears(
  '🔄 Сгенерировать QR заново',
  async (ctx) => await sendTgQrCode(ctx, String(ctx.from.id)),
);
tgBot.hears(
  '✏️ Изменить данные',
  async (ctx) => await ctx.conversation.enter('register'),
);

async function sendTgQrCode(ctx, tgId) {
  try {
    const qrBuffer = await QRCode.toBuffer(tgId, { scale: 10, margin: 1 });
    await ctx.replyWithPhoto(new TgInputFile(qrBuffer), {
      reply_markup: tgMainMenu,
    });
  } catch (error) {
    console.error(error);
    ctx.reply('Ошибка генерации QR.');
  }
}

// ==========================================
// 5. ЗАПУСК ВСЕЙ СИСТЕМЫ
// ==========================================
async function startApp() {
  try {
    await db.sequelize.authenticate();
    console.log('✅ БД подключена.');

    // Запуск Telegram
    runTg(tgBot);
    console.log('✈️ Telegram Бот запущен.');

    // Запуск VK (Polling)
    await vk.updates.start();
    console.log('🟦 ВКонтакте Бот запущен.');

    // Запуск Веб-сервера и Сканера
    server.listen(3000, () => {
      console.log('🌐 Админ-панель: http://localhost:3000/admin.html');
      startScanner();
    });
  } catch (error) {
    console.error('❌ Ошибка старта:', error);
  }
}

startApp();
