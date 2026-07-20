'use strict';

const INTEGRATION_CONNECTION_STATUSES = Object.freeze([
  'active',
  'disabled',
  'revoked',
]);

const INTEGRATION_PROVIDERS = Object.freeze([
  'beeline',
  'evotor',
  'telegram',
  'vk',
]);

const INTEGRATION_PURPOSES = Object.freeze([
  'telephony',
  'point_of_sale',
  'client_registration',
]);

const PROVIDER_PURPOSE = Object.freeze({
  beeline: 'telephony',
  evotor: 'point_of_sale',
  telegram: 'client_registration',
  vk: 'client_registration',
});

const PROVIDER_REQUIRED_SECRETS = Object.freeze({
  // Callback authentication is mode-specific: callbackToken or webhookSecret.
  beeline: Object.freeze(['apiToken']),
  evotor: Object.freeze(['webhookSecret']),
  telegram: Object.freeze(['botToken']),
  vk: Object.freeze(['botToken']),
});

module.exports = {
  INTEGRATION_CONNECTION_STATUSES,
  INTEGRATION_PROVIDERS,
  INTEGRATION_PURPOSES,
  PROVIDER_PURPOSE,
  PROVIDER_REQUIRED_SECRETS,
};
