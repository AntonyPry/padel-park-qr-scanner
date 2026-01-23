require('dotenv').config();
const { Bot, session, InlineKeyboard, Keyboard, InputFile } = require('grammy');
const {
  conversations,
  createConversation,
} = require('@grammyjs/conversations');
const QRCode = require('qrcode');
const { run } = require('@grammyjs/runner');
const db = require('./models');

const bot = new Bot(process.env.BOT_TOKEN);

// Храним состояние галочек в сессии
bot.use(
  session({
    initial: () => ({
      consents: [false, false, false],
    }),
  }),
);

bot.use(conversations());

// --- ГЛАВНОЕ МЕНЮ (НИЖНЕЕ) ---
const mainMenu = new Keyboard()
  .text('🔄 Сгенерировать QR заново')
  .row()
  .text('✏️ Изменить данные')
  .resized();

// --- ВАЛИДАЦИЯ ---
function isValidWord(text) {
  if (!text) return false;
  const regex = /^[а-яА-Яa-zA-ZёЁ\-]+$/;
  return regex.test(text.trim());
}

// Валидация телефона (возвращает текст ошибки или null если всё ок)
function getPhoneValidationError(text) {
  if (!text) return 'Пустой ввод.';

  // Проверка на недопустимые символы (буквы и спецсимволы, кроме допустимых)
  // Разрешаем: цифры, +, пробел, дефис, скобки
  const validCharsRegex = /^[0-9\+\-\s\(\)]+$/;
  if (!validCharsRegex.test(text)) {
    return '❌ В номере обнаружены недопустимые символы (буквы). Используйте только цифры.';
  }

  // Считаем количество чистых цифр
  const digitsOnly = text.replace(/\D/g, ''); // Удаляем всё, кроме цифр

  if (digitsOnly.length < 10) {
    return '❌ Слишком короткий номер. Введите номер полностью (минимум 10 цифр).';
  }

  if (digitsOnly.length > 15) {
    return '❌ Слишком длинный номер. Проверьте правильность ввода.';
  }

  return null; // Ошибок нет
}

// --- ДИАЛОГ РЕГИСТРАЦИИ ---
async function registerConversation(conversation, ctx) {
  let surname, firstname, phone, source;
  let step = 0;

  while (step < 4) {
    // --- ШАГ 0: ФАМИЛИЯ ---
    if (step === 0) {
      await ctx.reply('📝 Шаг 1 из 4. Введите вашу **Фамилию**:', {
        parse_mode: 'Markdown',
        reply_markup: { remove_keyboard: true },
      });
      const response = await conversation.waitFor(':text');
      const text = response.message.text.trim();

      if (!isValidWord(text)) {
        await ctx.reply('❌ Фамилия должна состоять только из букв.');
        continue;
      }
      surname = text;
      step++;
    }

    // --- ШАГ 1: ИМЯ ---
    else if (step === 1) {
      const kb = new Keyboard().text('⬅️ Назад').resized().oneTime();
      await ctx.reply('📝 Шаг 2 из 4. Введите ваше **Имя**:', {
        parse_mode: 'Markdown',
        reply_markup: kb,
      });

      const response = await conversation.waitFor(':text');
      const text = response.message.text.trim();

      if (text === '⬅️ Назад') {
        step--;
        continue;
      }
      if (!isValidWord(text)) {
        await ctx.reply('❌ Имя должно состоять только из букв.');
        continue;
      }

      firstname = text;
      step++;
    }

    // --- ШАГ 2: ТЕЛЕФОН (РУЧНОЙ ВВОД) ---
    else if (step === 2) {
      // Кнопка только "Назад", запроса контакта больше нет
      const kb = new Keyboard().text('⬅️ Назад').resized().oneTime();

      await ctx.reply(
        `👤 ${surname} ${firstname}\n\n` +
          `Шаг 3 из 4. Введите ваш **номер телефона**.\n` +
          `Пример: +79991234567`,
        { parse_mode: 'Markdown', reply_markup: kb },
      );

      // Ждем ТЕКСТ (так как ввода контакта больше нет)
      const response = await conversation.waitFor(':text');
      const text = response.message.text.trim();

      if (text === '⬅️ Назад') {
        step--;
        continue;
      }

      // Валидация
      const error = getPhoneValidationError(text);
      if (error) {
        // Сообщаем конкретную ошибку и остаемся на этом шаге
        await ctx.reply(error);
        continue;
      }

      phone = text; // Сохраняем как есть (или можно сохранить digitsOnly)
      step++;
    }

    // --- ШАГ 3: ОТКУДА УЗНАЛИ ---
    else if (step === 3) {
      const sources = [
        ['Вк', 'Тг', 'Радио'],
        ['Хоккей', 'Сайт', 'Инст'],
        ['Рекомендация друзей', 'Увидел в тц'],
        ['Другое', '⬅️ Назад'],
      ];
      const kb = Keyboard.from(sources).resized().oneTime();

      await ctx.reply('📊 Шаг 4 из 4. Откуда вы о нас узнали?', {
        reply_markup: kb,
      });

      const response = await conversation.waitFor(':text');
      const text = response.message.text.trim();

      if (text === '⬅️ Назад') {
        step--;
        continue;
      }

      source = text;
      step++;
    }
  }

  // --- СОХРАНЕНИЕ ---
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

  return sendQrCode(ctx, telegramId);
}

bot.use(createConversation(registerConversation, 'register'));

// --- ЭКРАН СОГЛАСИЯ ---

const CONSENT_TEXT = `🔒 **Политика конфиденциальности**

Перед началом использования бота, пожалуйста, примите следующие условия:

1. Согласие на обработку Персональных Данных.
2. Согласие на получение рекламных рассылок.
3. Ознакомлен с Правилами посещения клуба.

_Нажмите на пункты ниже, чтобы отметить их галочками._`;

function getConsentKeyboard(consents) {
  const keyboard = new InlineKeyboard();

  keyboard
    .text(
      consents[0]
        ? '✅ Согласен на обработку ПД'
        : '❌ Согласен на обработку ПД',
      'toggle_consent_0',
    )
    .row();
  keyboard
    .text(
      consents[1] ? '✅ Согласен на рассылку' : '❌ Согласен на рассылку',
      'toggle_consent_1',
    )
    .row();
  keyboard
    .text(
      consents[2] ? '✅ Ознакомлен с правилами' : '❌ Ознакомлен с правилами',
      'toggle_consent_2',
    )
    .row();

  const allChecked = consents.every((c) => c === true);

  if (allChecked) {
    keyboard.text('➡️ ДАЛЕЕ', 'consent_next');
  } else {
    keyboard.text('🔒 Выберите все пункты выше', 'consent_locked');
  }

  return keyboard;
}

bot.callbackQuery(/toggle_consent_(\d)/, async (ctx) => {
  const index = parseInt(ctx.match[1]);
  ctx.session.consents[index] = !ctx.session.consents[index];
  try {
    await ctx.editMessageReplyMarkup({
      reply_markup: getConsentKeyboard(ctx.session.consents),
    });
  } catch (e) {}
  await ctx.answerCallbackQuery();
});

bot.callbackQuery('consent_locked', async (ctx) => {
  await ctx.answerCallbackQuery({
    text: 'Пожалуйста, отметьте все пункты галочками!',
    show_alert: true,
  });
});

bot.callbackQuery('consent_next', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText('✅ Согласия получены. Начинаем регистрацию...');
  await ctx.conversation.enter('register');
});

// --- КОМАНДЫ И МЕНЮ ---

bot.command('start', async (ctx) => {
  const telegramId = String(ctx.from.id);
  const user = await db.User.findOne({ where: { telegramId } });

  if (user) {
    await ctx.reply(`С возвращением, ${user.name}!`, {
      reply_markup: mainMenu,
    });
    return;
  }

  ctx.session.consents = [false, false, false];
  await ctx.reply(CONSENT_TEXT, {
    parse_mode: 'Markdown',
    reply_markup: getConsentKeyboard(ctx.session.consents),
  });
});

bot.hears('🔄 Сгенерировать QR заново', async (ctx) => {
  await sendQrCode(ctx, String(ctx.from.id));
});

bot.hears('✏️ Изменить данные', async (ctx) => {
  await ctx.conversation.enter('register');
});

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

async function sendQrCode(ctx, qrData) {
  try {
    const qrBuffer = await QRCode.toBuffer(qrData, {
      scale: 10,
      margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' },
    });

    await ctx.replyWithPhoto(new InputFile(qrBuffer), {
      reply_markup: mainMenu,
    });
  } catch (error) {
    console.error(error);
    await ctx.reply('Ошибка генерации QR.');
  }
}

async function startApp() {
  try {
    await db.sequelize.authenticate();
    console.log('✅ БД подключена.');
    run(bot);
  } catch (error) {
    console.error('❌ Ошибка:', error);
  }
}

startApp();
