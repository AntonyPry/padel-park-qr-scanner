const QRCode = require('qrcode');
const { SocksProxyAgent } = require('socks-proxy-agent');
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
const db = require('../../../models');
const {
  CONSENT_TEXT,
  getPhoneValidationError,
  getSourceRows,
  isValidWord,
} = require('../shared/registration');
const clientsService = require('../../services/clients.service');
const {
  assertLegacyDownstreamReady,
} = require('../../provider-integrations/runtime');

function createProxyAgent(proxyUrl) {
  if (!proxyUrl) return undefined;

  return new SocksProxyAgent(proxyUrl, {
    rejectUnauthorized: false,
    tls: { rejectUnauthorized: false },
  });
}

async function createSourceKeyboard(includeBack = false) {
  const rows = (await getSourceRows(db)).map((row) => [...row]);
  if (includeBack) rows[rows.length - 1].push('⬅️ Назад');
  return TgKeyboard.from(rows).resized().oneTime();
}

function createTelegramBot({
  connection = null,
  token = process.env.BOT_TOKEN,
  proxyUrl = process.env.TG_PROXY_CREDS,
} = {}) {
  if (!token) return null;

  const logError = (label, error) => {
    if (connection) console.error(label, 'PROVIDER_HANDLER_FAILED');
    else console.error(label, error);
  };

  const agent = createProxyAgent(proxyUrl);
  const bot = new TgBot(token, {
    client: {
      buildFetchConfig: (init) => ({
        ...init,
        ...(agent ? { agent } : {}),
      }),
    },
  });

  if (connection) {
    bot.use(async (_ctx, next) => {
      await assertLegacyDownstreamReady(connection);
      return next();
    });
  }

  bot.use(tgSession({ initial: () => ({ consents: [false, false, false] }) }));
  bot.use(tgConversations());

  const mainMenu = new TgKeyboard()
    .text('🔄 Сгенерировать QR заново')
    .row()
    .text('✏️ Изменить данные')
    .resized();

  function getConsentKeyboard(consents) {
    const keyboard = new TgInlineKeyboard();
    keyboard
      .text(
        consents[0]
          ? '✅ С правилами ознакомлен'
          : '❌ С правилами ознакомлен',
        'toggle_consent_0',
      )
      .row();
    keyboard
      .text(
        consents[1] ? '✅ Согласен с политикой' : '❌ Согласен с политикой',
        'toggle_consent_1',
      )
      .row();
    keyboard
      .text(
        consents[2] ? '✅ Даю согласие' : '❌ Даю согласие',
        'toggle_consent_2',
      )
      .row();

    if (consents.every(Boolean)) keyboard.text('➡️ ДАЛЕЕ', 'consent_next');
    else keyboard.text('🔒 Отметьте все пункты выше', 'consent_locked');

    return keyboard;
  }

  async function sendQrCode(ctx, telegramId) {
    try {
      const qrBuffer = await QRCode.toBuffer(telegramId, {
        scale: 10,
        margin: 1,
      });
      await ctx.replyWithPhoto(new TgInputFile(qrBuffer), {
        reply_markup: mainMenu,
      });
    } catch (error) {
      logError('Ошибка QR Tg:', error);
      await ctx.reply('Ошибка генерации QR.');
    }
  }

  async function registerConversation(conversation, ctx) {
    let surname;
    let firstname;
    let phone;
    let source;
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
        const keyboard = new TgKeyboard().text('⬅️ Назад').resized().oneTime();
        await ctx.reply('📝 Шаг 2 из 4. Введите вашу **Фамилию**:', {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
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
        const keyboard = new TgKeyboard().text('⬅️ Назад').resized().oneTime();
        await ctx.reply(
          `👤 ${firstname} ${surname}\n\nШаг 3 из 4. Введите ваш **номер телефона**.\nПример: +79991234567`,
          { parse_mode: 'Markdown', reply_markup: keyboard },
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
        await ctx.reply('📊 Шаг 4 из 4. Откуда вы о нас узнали?', {
          reply_markup: await createSourceKeyboard(true),
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

    try {
      await conversation.external(() =>
        clientsService.registerClientFromMessenger({
          externalId: telegramId,
          messenger: 'telegram',
          name: fullName,
          phone,
          source,
        }),
      );
    } catch (error) {
      logError('Ошибка регистрации Tg:', error);
      await ctx.reply(
        error.statusCode === 409
          ? `❌ ${error.message}`
          : '❌ Произошла ошибка при сохранении.',
        { reply_markup: { remove_keyboard: true } },
      );
      return;
    }

    await ctx.reply('✅ Регистрация завершена!', {
      reply_markup: { remove_keyboard: true },
    });
    await ctx.reply('Ваш пропуск:');
    return sendQrCode(ctx, telegramId);
  }

  bot.use(tgCreateConversation(registerConversation, 'register'));

  bot.command('start', async (ctx) => {
    const telegramId = String(ctx.from.id);
    const user = await db.User.findOne({ where: { telegramId } });

    if (user) {
      return ctx.reply(`С возвращением, ${user.name}!`, {
        reply_markup: mainMenu,
      });
    }

    ctx.session.consents = [false, false, false];
    await ctx.reply(CONSENT_TEXT, {
      link_preview_options: { is_disabled: true },
      reply_markup: getConsentKeyboard(ctx.session.consents),
    });
  });

  bot.callbackQuery(/toggle_consent_(\d)/, async (ctx) => {
    const idx = parseInt(ctx.match[1]);
    ctx.session.consents[idx] = !ctx.session.consents[idx];

    try {
      await ctx.editMessageReplyMarkup({
        reply_markup: getConsentKeyboard(ctx.session.consents),
      });
    } catch (error) {}

    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('consent_locked', async (ctx) => {
    await ctx.answerCallbackQuery({
      text: 'Отметьте все пункты галочками!',
      show_alert: true,
    });
  });

  bot.callbackQuery('consent_next', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('✅ Согласия получены. Начинаем регистрацию...');
    await ctx.conversation.enter('register');
  });

  bot.hears('🔄 Сгенерировать QR заново', async (ctx) =>
    sendQrCode(ctx, String(ctx.from.id)),
  );
  bot.hears('✏️ Изменить данные', async (ctx) =>
    ctx.conversation.enter('register'),
  );

  return {
    bot,
    start: () => runTg(bot),
  };
}

module.exports = {
  createTelegramBot,
};
