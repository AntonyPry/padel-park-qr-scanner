require('dotenv').config();

const http = require('http');
const db = require('./models');
const createApp = require('./src/app');
const { createSocketServer } = require('./src/sockets');
const { publishLegacyRealtimeChange } = require('./src/realtime');
const { createTelegramBot } = require('./src/bots/telegram');
const { createVkBot } = require('./src/bots/vk');
const callTasksService = require('./src/services/call-tasks.service');
const telephonyService = require('./src/services/telephony.service');
const {
  assertTenantFoundationInitialized,
  assertTenantFoundationOperational,
} = require('./src/services/tenant-foundation.service');
const {
  TENANT_FOUNDATION_STATES,
} = require('./src/tenant-foundation/constants');
const {
  BACKGROUND_COMPONENT_POLICIES,
} = require('./src/files-workers/background-run-context');
const {
  isTenantFilesWorkersEnabled,
  isTenantProviderIntegrationsEnabled,
} = require('./src/tenant-context/capabilities');
const {
  listActiveConnections,
} = require('./src/provider-integrations/connection-service');
const {
  assertLegacyDownstreamReady,
} = require('./src/provider-integrations/runtime');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || process.env.SERVER_HOST || null;

const app = createApp({ onTenantInitialized: startBackgroundComponents });
const server = http.createServer(app);
const io = createSocketServer(server);

app.set('io', io);

async function startDatabase() {
  await db.sequelize.authenticate();
  console.log('✅ БД подключена.');
  return assertTenantFoundationOperational();
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
  if (startRecurringCallTasksRunner.started) return;
  startRecurringCallTasksRunner.started = true;
  const intervalMs = Number(process.env.CALL_TASKS_RUNNER_INTERVAL_MS || 60000);

  const run = async () => {
    try {
      const result = await callTasksService.runDueRecurringTasks(new Date());
      if (result.processed > 0) {
        console.log(
          `📞 Автозадачи обзвона: обработано баз ${result.processed}.`,
        );
        await publishLegacyRealtimeChange(io, {
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
  if (startTelephonySubscriptionRunner.started) return;
  startTelephonySubscriptionRunner.started = true;
  const rawIntervalMs = Number(process.env.BEELINE_SUBSCRIPTION_RUNNER_INTERVAL_MS);
  const intervalMs =
    Number.isFinite(rawIntervalMs) && rawIntervalMs >= 60 * 1000
      ? rawIntervalMs
      : 5 * 60 * 1000;

  const run = async () => {
    try {
      const aggregate = isTenantProviderIntegrationsEnabled()
        ? await telephonyService.maintainAllEventSubscriptions()
        : { results: [await telephonyService.maintainEventSubscription()] };
      const changed = aggregate.results.filter((result) =>
        ['created', 'renewed'].includes(result.action),
      );
      if (changed.length > 0) {
        console.log(`☎️ XSI-подписки Билайна обновлены: ${changed.length}.`);
        await publishLegacyRealtimeChange(io, {
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
      const failed = aggregate.results.filter((result) => result.action === 'failed');
      if (failed.length > 0) {
        console.error(`❌ Ошибка автопродления XSI-подписок: ${failed.length}.`);
      }
    } catch (error) {
      console.error('❌ Ошибка runner XSI-подписки:', error);
    }
  };

  setInterval(run, intervalMs);
  setTimeout(run, 15000);
}

async function startTelegramBot() {
  if (startTelegramBot.started) return;
  if (isTenantProviderIntegrationsEnabled()) {
    const connections = await listActiveConnections({ provider: 'telegram' });
    const instances = [];
    if (connections.length > 1) {
      console.error('TELEGRAM_CONNECTION_START_FAILED', 'multiple-connections-until-client-wave');
      startTelegramBot.instances = instances;
      startTelegramBot.started = true;
      return;
    }
    for (const connection of connections) {
      try {
        await assertLegacyDownstreamReady(connection);
        const telegramBot = createTelegramBot({
          connection,
          proxyUrl: connection.secrets.proxyUrl,
          token: connection.secrets.botToken,
        });
        if (!telegramBot) throw new Error('connection token missing');
        telegramBot.start();
        instances.push(telegramBot);
      } catch {
        console.error('TELEGRAM_CONNECTION_START_FAILED', connection.publicId);
      }
    }
    startTelegramBot.instances = instances;
    startTelegramBot.started = true;
    console.log(`✈️ Telegram connections запущено: ${instances.length}.`);
    return;
  }
  const telegramBot = createTelegramBot();
  if (!telegramBot) {
    console.log('✈️ Telegram Бот не запущен: BOT_TOKEN не задан.');
    return;
  }

  telegramBot.start();
  startTelegramBot.started = true;
  console.log('✈️ Telegram Бот запущен.');
}

async function startVkBot() {
  if (startVkBot.started) return;
  if (isTenantProviderIntegrationsEnabled()) {
    const connections = await listActiveConnections({ provider: 'vk' });
    const instances = [];
    if (connections.length > 1) {
      console.error('VK_CONNECTION_START_FAILED', 'multiple-connections-until-client-wave');
      startVkBot.instances = instances;
      startVkBot.started = true;
      return;
    }
    for (const connection of connections) {
      try {
        await assertLegacyDownstreamReady(connection);
        const vkBot = createVkBot({
          connection,
          token: connection.secrets.botToken,
        });
        if (!vkBot) throw new Error('connection token missing');
        await vkBot.start();
        instances.push(vkBot);
      } catch {
        console.error('VK_CONNECTION_START_FAILED', connection.publicId);
      }
    }
    startVkBot.instances = instances;
    startVkBot.started = true;
    console.log(`🟦 VK connections запущено: ${instances.length}.`);
    return;
  }
  const vkBot = createVkBot();
  if (!vkBot) {
    console.log('🟦 ВКонтакте Бот не запущен: VK_TOKEN не задан.');
    return;
  }

  await vkBot.start();
  startVkBot.started = true;
  console.log('🟦 ВКонтакте Бот запущен.');
}

async function startBackgroundComponents() {
  await assertTenantFoundationInitialized();
  if (isTenantFilesWorkersEnabled() && !isTenantProviderIntegrationsEnabled()) {
    const deferred = Object.entries(BACKGROUND_COMPONENT_POLICIES)
      .filter(([, policy]) => policy.classification === 'deferred')
      .map(([component, policy]) => ({
        component,
        deferredTo: policy.deferredTo,
        scope: 'global-scan-blocked',
      }));
    console.warn('TENANT_BACKGROUND_COMPONENTS_DEFERRED', JSON.stringify(deferred));
    return;
  }
  if (isTenantFilesWorkersEnabled()) {
    const deferred = Object.entries(BACKGROUND_COMPONENT_POLICIES)
      .filter(([, policy]) => policy.classification === 'deferred')
      .map(([component, policy]) => ({
        component,
        deferredTo: policy.deferredTo,
        scope: 'global-scan-blocked',
      }));
    console.warn('TENANT_BACKGROUND_COMPONENTS_DEFERRED', JSON.stringify(deferred));
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

  if (isFeatureEnabled('BACKGROUND_RUNNERS_ENABLED')) {
    if (!isTenantFilesWorkersEnabled()) startRecurringCallTasksRunner();
    startTelephonySubscriptionRunner();
  } else {
    console.log('⏱️ Фоновые runner-ы отключены через BACKGROUND_RUNNERS_ENABLED=false.');
  }
}

async function startApp() {
  let foundationState = null;
  try {
    foundationState = await startDatabase();
  } catch (error) {
    console.error('❌ Tenant foundation не прошел startup assertion:', error);
  }

  try {
    startHttpServer();
  } catch (error) {
    console.error('❌ Ошибка старта сервера:', error);
    return;
  }

  if (foundationState?.state === TENANT_FOUNDATION_STATES.INITIALIZED) {
    try {
      await startBackgroundComponents();
    } catch (error) {
      console.error('❌ Ошибка старта фоновых компонентов:', error);
    }
  } else if (
    foundationState?.state === TENANT_FOUNDATION_STATES.BOOTSTRAP_PENDING
  ) {
    console.log('🧱 Setly ожидает первичную настройку; bots/runners отключены.');
  } else {
    console.error('🛑 Business components заблокированы fail-closed.');
  }
}

startApp();
