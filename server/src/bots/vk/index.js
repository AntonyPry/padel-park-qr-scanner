const QRCode = require('qrcode');
const { VK, Keyboard: VkKeyboard } = require('vk-io');
const { SessionManager: VkSessionManager } = require('@vk-io/session');
const {
  SceneManager: VkSceneManager,
  StepScene: VkStepScene,
} = require('@vk-io/scenes');
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
const { markConnectionActivity } = require('../../provider-integrations/activity');

async function buildSourceKeyboard(tenant = null) {
  const keyboard = VkKeyboard.builder();
  const rows = await getSourceRows(db, tenant);

  rows.forEach((row, rowIndex) => {
    row.forEach((label) => keyboard.textButton({ label }));
    if (rowIndex < rows.length - 1) keyboard.row();
  });

  return keyboard.oneTime();
}

function createVkConsentKeyboard(consents) {
  const keyboard = VkKeyboard.builder()
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

  if (consents.every(Boolean)) {
    keyboard.textButton({
      label: '➡️ ДАЛЕЕ',
      payload: { command: 'start_register' },
      color: VkKeyboard.POSITIVE_COLOR,
    });
  }

  return keyboard.inline();
}

function createVkBot({ connection = null, token = process.env.VK_TOKEN } = {}) {
  if (!token) return null;

  const logError = (label, error) => {
    if (connection) console.error(label, 'PROVIDER_HANDLER_FAILED');
    else console.error(label, error);
  };

  const vk = new VK({ token });
  const sessionManager = new VkSessionManager();
  const sceneManager = new VkSceneManager();

  if (connection) {
    vk.updates.use(async (_ctx, next) => {
      await assertLegacyDownstreamReady(connection);
      const result = await next();
      await markConnectionActivity(connection);
      return result;
    });
  }

  const mainMenu = VkKeyboard.builder()
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

  async function sendQrCode(ctx, vkId) {
    try {
      const qrBuffer = await QRCode.toBuffer(`vk_${vkId}`, {
        scale: 10,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' },
      });
      const attachment = await vk.upload.messagePhoto({
        source: { value: qrBuffer, filename: 'qr.png' },
        peer_id: ctx.peerId,
      });
      await ctx.send({
        message: 'Ваш пропуск:',
        attachment,
        keyboard: mainMenu,
      });
    } catch (error) {
      logError('Ошибка QR ВК:', error);
      await ctx.send('Ошибка генерации QR.');
    }
  }

  const registerScene = new VkStepScene('register', [
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
        await ctx.send('📊 Шаг 4 из 4. Откуда вы о нас узнали?', {
          keyboard: await buildSourceKeyboard(connection),
        });
        return;
      }

      ctx.scene.state.source = ctx.text.trim();

      const vkId = String(ctx.peerId);
      const fullName = `${ctx.scene.state.surname} ${ctx.scene.state.firstname}`;

      try {
        await clientsService.registerClientFromMessenger({
          externalId: vkId,
          messenger: 'vk',
          name: fullName,
          phone: ctx.scene.state.phone,
          source: ctx.scene.state.source,
          tenant: connection,
        });
        await ctx.send('✅ Регистрация завершена!');
        await sendQrCode(ctx, vkId);
      } catch (error) {
        logError('Ошибка БД ВК:', error);
        await ctx.send(
          error.statusCode === 409
            ? `❌ ${error.message}`
            : '❌ Произошла ошибка при сохранении.',
        );
      }

      await ctx.scene.leave();
    },
  ]);

  sceneManager.addScenes([registerScene]);

  vk.updates.on('message_new', sessionManager.middleware);
  vk.updates.on('message_new', sceneManager.middleware);
  vk.updates.on('message_new', sceneManager.middlewareIntercept);

  vk.updates.on('message_new', async (ctx, next) => {
    if (ctx.scene.current) return next();

    if (
      !ctx.messagePayload &&
      !['Начать', 'начать', '/start'].includes(ctx.text)
    ) {
      return;
    }

    const payload = ctx.messagePayload || {};
    const vkId = String(ctx.peerId);

    if (['Начать', 'начать', '/start'].includes(ctx.text)) {
      const user = await clientsService.findCanonicalByQr(
        `vk_${vkId}`,
        connection,
      );
      if (user) {
        return ctx.send(`С возвращением, ${user.name}!`, {
          keyboard: mainMenu,
        });
      }

      ctx.session.consents = [false, false, false];
      return ctx.send(CONSENT_TEXT, {
        keyboard: createVkConsentKeyboard(ctx.session.consents),
        dont_parse_links: true,
      });
    }

    if (payload.consent !== undefined) {
      ctx.session.consents[payload.consent] =
        !ctx.session.consents[payload.consent];
      return ctx.send('Обновил выбор:', {
        keyboard: createVkConsentKeyboard(ctx.session.consents),
      });
    }

    if (payload.command === 'start_register') {
      await ctx.send('✅ Согласия получены. Начинаем...');
      return ctx.scene.enter('register');
    }

    if (
      payload.command === 'get_qr' ||
      ctx.text === '🔄 Сгенерировать QR заново'
    ) {
      return sendQrCode(ctx, vkId);
    }

    if (
      payload.command === 'edit_profile' ||
      ctx.text === '✏️ Изменить данные'
    ) {
      return ctx.scene.enter('register');
    }

    await next();
  });

  return {
    bot: vk,
    start: () => vk.updates.start(),
    stop: () => vk.updates.stop(),
  };
}

module.exports = {
  createVkBot,
};
