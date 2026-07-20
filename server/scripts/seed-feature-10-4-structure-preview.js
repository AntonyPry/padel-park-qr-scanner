'use strict';

const crypto = require('node:crypto');
const db = require('../models');
const authService = require('../src/services/auth.service');
const installationProvisioning = require('../src/services/installation-provisioning.service');
const {
  createConnection,
  generatePublicId,
} = require('../src/provider-integrations/connection-service');
const {
  classifyTenantFoundation,
} = require('../src/services/tenant-foundation.service');
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
} = require('../src/tenant-foundation/constants');

const PREVIEW_DATABASE = 'setly_feature_10_4_structure_preview';
const SECOND_ORGANIZATION_NAME =
  'Северо-Западная академия падела и семейного спорта с очень длинным названием';

function assertSafeTarget() {
  if (process.env.NODE_ENV === 'production' || process.env.DB_NAME !== PREVIEW_DATABASE) {
    throw new Error(`Preview seed is restricted to ${PREVIEW_DATABASE}`);
  }
}

function previewSecret(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
}

function previewDate(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function providerConfig(provider) {
  if (provider !== 'beeline') return {};
  return {
    apiBaseUrl: 'https://cloudpbx.beeline.ru/apis/portal',
    apiTimeoutMs: 10000,
    callbackBaseUrl: 'https://api.setly.tech/api/integrations/beeline/events',
    recordsPath: '/records',
    statisticsPath: '/statistics',
    subscriptionAutoRenewEnabled: true,
    subscriptionExpiresSeconds: 86400,
    subscriptionPath: '/subscription',
    subscriptionPattern: 'CALL.*',
    subscriptionRenewBeforeSeconds: 3600,
    subscriptionType: 'CALL_EVENTS',
    webhookAuthMode: 'capability_uri',
  };
}

function providerSecrets(provider, { withProxy = false } = {}) {
  if (provider === 'beeline') {
    return {
      apiToken: previewSecret('beeline'),
      callbackToken: crypto.randomBytes(32).toString('hex'),
    };
  }
  if (provider === 'evotor') return { webhookSecret: previewSecret('evotor') };
  if (provider === 'telegram') {
    return {
      botToken: previewSecret('telegram'),
      ...(withProxy ? { proxyUrl: `socks5://${previewSecret('preview-proxy')}@127.0.0.1:1080` } : {}),
    };
  }
  return { botToken: previewSecret('vk') };
}

async function addConnection(club, provider, {
  activityHoursAgo = null,
  identity,
  status = 'active',
  validationHoursAgo = null,
  validationStatus = 'not_tested',
  withProxy = false,
} = {}) {
  const publicId = generatePublicId();
  const metadata = {
    ...(activityHoursAgo === null ? {} : { lastActivityAt: previewDate(activityHoursAgo) }),
    ...(identity ? { safeIdentity: identity } : {}),
    ...(provider === 'evotor'
      ? { safeCallbackUrl: `https://api.setly.tech/api/webhooks/evotor/${publicId}` }
      : {}),
    ...(validationHoursAgo === null ? {} : { lastValidatedAt: previewDate(validationHoursAgo) }),
    validationStatus,
  };
  await createConnection({
    clubId: club.id,
    config: providerConfig(provider),
    metadata,
    organizationId: club.organizationId,
    provider,
    publicId,
    secrets: providerSecrets(provider, { withProxy }),
    status,
  });
}

async function seed() {
  assertSafeTarget();
  await db.sequelize.authenticate();

  const existingSecond = await db.Organization.findOne({
    where: { name: SECOND_ORGANIZATION_NAME },
  });
  if (existingSecond) {
    const [clubs, connections, organizations] = await Promise.all([
      db.Club.count(),
      db.IntegrationConnection.unscoped().count(),
      db.Organization.count(),
    ]);
    console.log(JSON.stringify({ clubs, connections, organizations, reused: true }));
    return;
  }

  const accounts = await db.Account.count();
  if (accounts !== 0) {
    throw new Error('Preview database is not empty; refusing a partial fixture mutation');
  }

  // A fresh migration is bootstrapped through the accepted legacy singleton
  // transition, then the preview immediately returns to full tenant enforcement.
  process.env.TENANT_ENFORCEMENT_ENABLED = 'false';
  await authService.bootstrapOwner({
    email: 'owner.moscow@preview.setly.local',
    name: 'Анна Владелец',
    password: previewSecret('crm-owner'),
    phone: '+79990000001',
  });
  process.env.TENANT_ENFORCEMENT_ENABLED = 'true';

  const defaultOrganization = await db.Organization.findOne({
    where: { slug: DEFAULT_ORGANIZATION_SLUG },
  });
  const defaultClub = await db.Club.findOne({
    where: {
      organizationId: defaultOrganization.id,
      slug: DEFAULT_CLUB_SLUG,
    },
  });
  await defaultOrganization.update({
    name: 'Setly Padel Москва — сеть клубов для взрослых и детей',
  });
  await defaultClub.update({
    name: 'Хамовники · Центральный клуб с расширенной программой тренировок',
    timezone: 'Europe/Moscow',
  });
  const [samaraClub, archivedClub] = await Promise.all([
    db.Club.create({
      name: 'Самара · Набережная и детская академия',
      organizationId: defaultOrganization.id,
      slug: 'samara-naberezhnaya',
      status: 'active',
      timezone: 'Europe/Samara',
    }),
    db.Club.create({
      name: 'Екатеринбург · Исторический клуб на реконструкции',
      organizationId: defaultOrganization.id,
      slug: 'yekaterinburg-archive',
      status: 'archived',
      timezone: 'Asia/Yekaterinburg',
    }),
  ]);

  const provisioned = await installationProvisioning.provisionOrganization(
    {
      clubs: [
        { name: 'Санкт-Петербург · Васильевский остров', timezone: 'Europe/Moscow' },
        { name: 'Калининград · Побережье и семейные турниры', timezone: 'Europe/Kaliningrad' },
      ],
      idempotencyKey: crypto.randomUUID(),
      organization: { name: SECOND_ORGANIZATION_NAME },
      owner: {
        email: 'owner.northwest@preview.setly.local',
        name: 'Максим Владелец',
        phone: '+79990000002',
      },
    },
    { username: 'structure-preview' },
  );
  const secondOrganization = await db.Organization.findByPk(provisioned.organization.id);
  const secondClubs = await db.Club.findAll({
    order: [['id', 'ASC']],
    where: { organizationId: secondOrganization.id },
  });

  await addConnection(defaultClub, 'beeline', {
    activityHoursAgo: 1,
    identity: 'ВАТС Хамовники · основная линия',
    validationHoursAgo: 2,
    validationStatus: 'verified',
  });
  await addConnection(defaultClub, 'evotor', {
    identity: 'Webhook чеков · Хамовники',
    validationHoursAgo: 3,
    validationStatus: 'pending_event',
  });
  await addConnection(defaultClub, 'telegram', {
    activityHoursAgo: 16,
    identity: '@setly_khamovniki_preview_bot',
    status: 'disabled',
    validationHoursAgo: 18,
    validationStatus: 'failed',
    withProxy: true,
  });
  await addConnection(samaraClub, 'telegram', {
    activityHoursAgo: 4,
    identity: '@setly_samara_preview_bot',
    validationHoursAgo: 5,
    validationStatus: 'verified',
  });
  await addConnection(samaraClub, 'vk', {
    identity: 'VK · Setly Самара',
    validationStatus: 'not_tested',
  });
  await addConnection(archivedClub, 'beeline', {
    identity: 'ВАТС Екатеринбург · архивная линия',
    status: 'disabled',
    validationStatus: 'not_tested',
  });
  await addConnection(archivedClub, 'evotor', {
    activityHoursAgo: 240,
    identity: 'Webhook чеков · Екатеринбург',
    validationHoursAgo: 240,
    validationStatus: 'pending_event',
  });
  await addConnection(secondClubs[0], 'beeline', {
    activityHoursAgo: 7,
    identity: 'ВАТС Васильевский остров',
    validationHoursAgo: 8,
    validationStatus: 'verified',
  });
  await addConnection(secondClubs[0], 'evotor', {
    identity: 'Webhook чеков · Васильевский остров',
    validationHoursAgo: 9,
    validationStatus: 'pending_event',
  });
  await addConnection(secondClubs[0], 'telegram', {
    activityHoursAgo: 6,
    identity: '@setly_vasileostrovsky_preview_bot',
    validationHoursAgo: 9,
    validationStatus: 'verified',
  });
  await addConnection(secondClubs[0], 'vk', {
    activityHoursAgo: 11,
    identity: 'VK · Setly Васильевский остров',
    validationHoursAgo: 12,
    validationStatus: 'verified',
  });
  await addConnection(secondClubs[1], 'evotor', {
    identity: 'Webhook чеков · Калининград',
    status: 'disabled',
    validationStatus: 'not_tested',
  });
  await addConnection(secondClubs[1], 'vk', {
    identity: 'VK · Setly Калининград',
    status: 'revoked',
    validationHoursAgo: 26,
    validationStatus: 'failed',
  });

  await secondOrganization.update({ status: 'archived' });
  const classification = await classifyTenantFoundation();
  if (classification.state !== 'initialized') {
    throw new Error(`Preview tenant foundation is ${classification.state}`);
  }

  const [clubs, connections, organizations] = await Promise.all([
    db.Club.count(),
    db.IntegrationConnection.unscoped().count(),
    db.Organization.count(),
  ]);
  console.log(JSON.stringify({ clubs, connections, organizations, reused: false }));
}

seed()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.sequelize.close();
  });
