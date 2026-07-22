'use strict';

const { URL, URLSearchParams } = require('node:url');
const { credentialFingerprint } = require('./fingerprints');

const PROVIDER_LABELS = Object.freeze({
  beeline: 'Билайн',
  evotor: 'Эвотор',
  telegram: 'Telegram',
  vk: 'VK',
});

function validationError(message, code = 'INTEGRATION_VALIDATION_FAILED') {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

function previewMode() {
  return process.env.INSTALLATION_PROVIDER_VALIDATION_MODE === 'preview';
}

function previewIdentity(provider, secret) {
  const suffix = credentialFingerprint(provider, secret).slice(0, 8);
  if (provider === 'telegram') {
    return { identityKey: `telegram-preview-${suffix}`, safeIdentity: `@setly_${suffix}` };
  }
  if (provider === 'vk') {
    return { identityKey: `vk-preview-${suffix}`, safeIdentity: `Сообщество Setly ${suffix}` };
  }
  if (provider === 'beeline') {
    return { identityKey: `beeline-preview-${suffix}`, safeIdentity: `Виртуальная АТС ${suffix}` };
  }
  return { identityKey: null, safeIdentity: null };
}

async function fetchJson(url, options, failureMessage) {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(Number(options.timeoutMs || 15000)),
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) throw validationError(failureMessage);
    return body;
  } catch (error) {
    if (error?.code === 'INTEGRATION_VALIDATION_FAILED') throw error;
    throw validationError(failureMessage);
  }
}

async function validateTelegram({ secrets }) {
  if (previewMode()) return previewIdentity('telegram', secrets.botToken);
  const body = await fetchJson(
    `https://api.telegram.org/bot${encodeURIComponent(secrets.botToken)}/getMe`,
    { method: 'GET' },
    'Telegram не подтвердил токен бота',
  );
  if (!body?.ok || !body?.result?.id) {
    throw validationError('Telegram не подтвердил токен бота');
  }
  const username = String(body.result.username || '').trim();
  return {
    identityKey: String(body.result.id),
    safeIdentity: username ? `@${username}` : `Бот ${body.result.id}`,
  };
}

async function validateVk({ secrets }) {
  if (previewMode()) return previewIdentity('vk', secrets.botToken);
  const parameters = new URLSearchParams({
    access_token: secrets.botToken,
    v: '5.199',
  });
  const body = await fetchJson(
    'https://api.vk.com/method/groups.getById',
    {
      body: parameters,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    },
    'VK не подтвердил токен сообщества',
  );
  const group = Array.isArray(body?.response?.groups)
    ? body.response.groups[0]
    : Array.isArray(body?.response)
      ? body.response[0]
      : null;
  if (!group?.id) throw validationError('VK не подтвердил токен сообщества');
  return {
    identityKey: String(group.id),
    safeIdentity: String(group.name || `Сообщество ${group.id}`),
  };
}

async function validateBeeline({ config, secrets }) {
  if (previewMode()) return previewIdentity('beeline', secrets.apiToken);
  const statisticsUrl = new URL(
    `${String(config.apiBaseUrl).replace(/\/+$/u, '')}/${String(config.statisticsPath).replace(/^\/+/, '')}`,
  );
  statisticsUrl.searchParams.set('dateFrom', new Date(Date.now() - 60000).toISOString());
  statisticsUrl.searchParams.set('dateTo', new Date().toISOString());
  statisticsUrl.searchParams.set('page', '0');
  statisticsUrl.searchParams.set('pageSize', '10');
  await fetchJson(
    statisticsUrl,
    {
      headers: { 'X-MPBX-API-AUTH-TOKEN': secrets.apiToken },
      method: 'GET',
      timeoutMs: config.apiTimeoutMs,
    },
    'Билайн не подтвердил адрес API или токен',
  );
  return { identityKey: null, safeIdentity: 'Виртуальная АТС Билайн' };
}

async function validateEvotor() {
  return { identityKey: null, safeIdentity: null, validationStatus: 'pending_event' };
}

async function validateProviderCandidate(provider, candidate) {
  const validators = {
    beeline: validateBeeline,
    evotor: validateEvotor,
    telegram: validateTelegram,
    vk: validateVk,
  };
  const validator = validators[provider];
  if (!validator) throw validationError('Неизвестный провайдер', 'INTEGRATION_PROVIDER_INVALID');
  const validated = await validator(candidate);
  return Object.freeze({
    ...validated,
    validatedAt: new Date(),
    validationStatus: validated.validationStatus || 'verified',
  });
}

module.exports = {
  PROVIDER_LABELS,
  validateProviderCandidate,
  validationError,
};
