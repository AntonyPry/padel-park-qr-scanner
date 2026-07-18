const db = require('../../models');
const {
  bindClientMoneyActor,
  clubTenantWhere,
  resolveClientMoneyAccessContextForModel,
} = require('./client-money-access-context.service');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const certificatesService = require('./certificates.service');
const corporateClientsService = require('./corporate-clients.service');
const pendingSaleService = require('./pending-sale.service');
const subscriptionsService = require('./subscriptions.service');

const DEFAULT_EXPIRING_DAYS = 14;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_LOW_BALANCE_THRESHOLD = 5000;
const DEFAULT_CERTIFICATE_LOW_BALANCE_THRESHOLD = 1000;
const LOW_SESSIONS_THRESHOLD = 1;

const DASHBOARD_TYPES = [
  'all',
  'pending_sales',
  'subscriptions',
  'certificates',
  'corporate_balances',
];
const DASHBOARD_STATUSES = [
  'all',
  'pending',
  'linked',
  'ignored',
  'active',
  'expiring_soon',
  'low_balance',
  'expired',
  'used',
  'redeemed',
  'canceled',
  'archived',
];
const EXPIRY_FILTERS = ['all', 'expiring_soon', 'expired', 'valid'];

function hasRole(account, roles = []) {
  return Boolean(account?.role && roles.includes(account.role));
}

function toNumber(value) {
  const numberValue = Number(value || 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function normalizeInteger(value, fallback, max = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) return fallback;
  return max ? Math.min(numberValue, max) : numberValue;
}

function normalizeMoney(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return fallback;
  return Number(numberValue.toFixed(2));
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || fallback).trim();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeFilters(query = {}) {
  return {
    expiringDays: normalizeInteger(
      query.expiringDays,
      DEFAULT_EXPIRING_DAYS,
      365,
    ),
    expiry: normalizeEnum(query.expiry, EXPIRY_FILTERS, 'all'),
    limit: normalizeInteger(query.limit, DEFAULT_LIMIT, MAX_LIMIT),
    lowBalanceThreshold: normalizeMoney(
      query.lowBalanceThreshold,
      DEFAULT_LOW_BALANCE_THRESHOLD,
    ),
    q: String(query.q || query.query || '').trim().toLowerCase(),
    status: normalizeEnum(query.status, DASHBOARD_STATUSES, 'all'),
    type: normalizeEnum(query.type, DASHBOARD_TYPES, 'all'),
  };
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + Number(days || 0));
  return result;
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isInRange(dateValue, from, to) {
  const date = toDate(dateValue);
  if (!date) return false;
  return date.getTime() >= from.getTime() && date.getTime() <= to.getTime();
}

function isExpired(dateValue, now) {
  const date = toDate(dateValue);
  return Boolean(date && date.getTime() < now.getTime());
}

function textMatches(parts, q) {
  if (!q) return true;
  return parts
    .filter((part) => part !== undefined && part !== null)
    .join(' ')
    .toLowerCase()
    .includes(q);
}

function getPermissions(account) {
  return {
    certificates: hasRole(account, ACCESS_MATRIX.certificatesView),
    corporateBalances: hasRole(account, ACCESS_MATRIX.corporateClientsView),
    pendingSales: hasRole(account, ACCESS_MATRIX.prepaymentSalesView),
    subscriptions: hasRole(account, ACCESS_MATRIX.clientSubscriptionsView),
  };
}

function getSubscriptionFlags(subscription, now, expiringUntil) {
  const isActive = subscription.status === 'active';
  const lowRemaining =
    isActive &&
    subscription.remainingSessions !== null &&
    subscription.remainingSessions !== undefined &&
    Number(subscription.remainingSessions) <= LOW_SESSIONS_THRESHOLD;
  return {
    expiringSoon: isActive && isInRange(subscription.expiresAt, now, expiringUntil),
    lowRemaining,
    problem: lowRemaining || (isActive && isInRange(subscription.expiresAt, now, expiringUntil)),
  };
}

function getCertificateFlags(certificate, filters, now, expiringUntil) {
  const isActive = certificate.status === 'active';
  const moneyLowBalance =
    certificate.certificateType === 'money' &&
    certificate.amountRemaining !== null &&
    certificate.amountRemaining !== undefined &&
    Number(certificate.amountRemaining) <= DEFAULT_CERTIFICATE_LOW_BALANCE_THRESHOLD;
  const serviceLowBalance =
    certificate.certificateType === 'service' &&
    certificate.unitsRemaining !== null &&
    certificate.unitsRemaining !== undefined &&
    Number(certificate.unitsRemaining) <= LOW_SESSIONS_THRESHOLD;
  return {
    expiringSoon: isActive && isInRange(certificate.expiresAt, now, expiringUntil),
    lowBalance: isActive && (moneyLowBalance || serviceLowBalance),
    problem:
      isActive &&
      (moneyLowBalance ||
        serviceLowBalance ||
        isInRange(certificate.expiresAt, now, expiringUntil)),
  };
}

function getCorporateFlags(client, filters) {
  const balance = toNumber(client.balance);
  const isActive = client.status === 'active';
  return {
    lowBalance:
      isActive &&
      balance >= 0 &&
      balance <= filters.lowBalanceThreshold,
    problem:
      isActive &&
      balance >= 0 &&
      balance <= filters.lowBalanceThreshold,
  };
}

function enrichPendingSale(sale) {
  return {
    ...sale,
    actionHref: '/admin/catalog?tab=pending',
    flags: {
      needsAttention: sale.status === 'pending',
      problem: sale.status === 'pending',
    },
  };
}

function enrichSubscription(subscription, filters, now, expiringUntil) {
  return {
    ...subscription,
    actionHref: `/admin/clients?clientId=${subscription.clientId}`,
    flags: getSubscriptionFlags(subscription, now, expiringUntil),
  };
}

function enrichCertificate(certificate, filters, now, expiringUntil) {
  return {
    ...certificate,
    actionHref: `/admin/certificates?certificateId=${certificate.id}`,
    flags: getCertificateFlags(certificate, filters, now, expiringUntil),
  };
}

function enrichCorporateClient(client, filters) {
  return {
    ...client,
    actionHref: `/admin/corporate-clients?companyId=${client.id}`,
    flags: getCorporateFlags(client, filters),
  };
}

function matchesSearch(type, item, q) {
  if (type === 'pending_sales') {
    return textMatches(
      [
        item.itemName,
        item.saleIntent,
        item.evotorId,
        item.category,
        item.client?.name,
        item.client?.phone,
      ],
      q,
    );
  }
  if (type === 'subscriptions') {
    return textMatches(
      [
        item.typeName,
        item.trainingKind,
        item.timeSegment,
        item.client?.name,
        item.client?.phone,
      ],
      q,
    );
  }
  if (type === 'certificates') {
    return textMatches(
      [
        item.code,
        item.title,
        item.serviceName,
        item.certificateType,
        item.client?.name,
        item.client?.phone,
      ],
      q,
    );
  }
  if (type === 'corporate_balances') {
    return textMatches(
      [
        item.name,
        item.contactName,
        item.contactPhone,
        item.contactEmail,
        item.comment,
      ],
      q,
    );
  }
  return true;
}

function matchesStatus(type, item, status) {
  if (status === 'all') return true;
  if (status === 'expiring_soon') return Boolean(item.flags?.expiringSoon);
  if (status === 'low_balance') {
    return Boolean(item.flags?.lowBalance || item.flags?.lowRemaining);
  }
  if (type === 'pending_sales') {
    return ['pending', 'linked', 'ignored', 'canceled'].includes(status)
      ? item.status === status
      : false;
  }
  if (type === 'subscriptions') {
    return ['active', 'expired', 'used', 'canceled'].includes(status)
      ? item.status === status
      : false;
  }
  if (type === 'certificates') {
    return ['active', 'expired', 'redeemed', 'canceled'].includes(status)
      ? item.status === status
      : false;
  }
  if (type === 'corporate_balances') {
    return ['active', 'archived'].includes(status) ? item.status === status : false;
  }
  return false;
}

function matchesExpiry(type, item, expiry, now) {
  if (expiry === 'all') return true;
  if (!['subscriptions', 'certificates'].includes(type)) return false;
  if (expiry === 'expiring_soon') return Boolean(item.flags?.expiringSoon);
  if (expiry === 'expired') return item.status === 'expired' || isExpired(item.expiresAt, now);
  if (expiry === 'valid') {
    const expiresAt = toDate(item.expiresAt);
    return item.status === 'active' && (!expiresAt || expiresAt.getTime() >= now.getTime());
  }
  return true;
}

function sectionMatchesType(type, filterType) {
  return filterType === 'all' || filterType === type;
}

function buildSection(type, available, items, filters, now) {
  if (!available) {
    return {
      available: false,
      hiddenReason: 'role',
      items: [],
      total: 0,
    };
  }
  if (!sectionMatchesType(type, filters.type)) {
    return {
      available: true,
      items: [],
      total: 0,
    };
  }

  const filtered = items.filter(
    (item) =>
      matchesSearch(type, item, filters.q) &&
      matchesStatus(type, item, filters.status) &&
      matchesExpiry(type, item, filters.expiry, now),
  );

  return {
    available: true,
    items: filtered.slice(0, filters.limit),
    total: filtered.length,
  };
}

function sum(items, getter) {
  return Number(
    items.reduce((total, item) => total + toNumber(getter(item)), 0).toFixed(2),
  );
}

function buildSummary({ certificates, corporateClients, pendingSales, subscriptions }) {
  const pending = pendingSales.filter((item) => item.status === 'pending');
  const activeSubscriptions = subscriptions.filter((item) => item.status === 'active');
  const activeCertificates = certificates.filter((item) => item.status === 'active');
  const activeCorporateClients = corporateClients.filter(
    (item) => item.status === 'active',
  );

  return {
    activeCertificates: {
      amountRemaining: sum(activeCertificates, (item) => item.amountRemaining),
      count: activeCertificates.length,
      lowBalance: activeCertificates.filter((item) => item.flags?.lowBalance).length,
      serviceUnitsRemaining: activeCertificates.reduce(
        (total, item) => total + Number(item.unitsRemaining || 0),
        0,
      ),
    },
    activeSubscriptions: {
      count: activeSubscriptions.length,
      expiringSoon: activeSubscriptions.filter((item) => item.flags?.expiringSoon)
        .length,
      lowRemaining: activeSubscriptions.filter((item) => item.flags?.lowRemaining)
        .length,
      saleAmount: sum(activeSubscriptions, (item) => item.saleAmount),
    },
    corporateBalances: {
      count: activeCorporateClients.length,
      lowBalance: activeCorporateClients.filter((item) => item.flags?.lowBalance)
        .length,
      totalBalance: sum(activeCorporateClients, (item) => item.balance),
    },
    expiringSoon: {
      certificates: activeCertificates.filter((item) => item.flags?.expiringSoon)
        .length,
      subscriptions: activeSubscriptions.filter((item) => item.flags?.expiringSoon)
        .length,
      total:
        activeCertificates.filter((item) => item.flags?.expiringSoon).length +
        activeSubscriptions.filter((item) => item.flags?.expiringSoon).length,
    },
    pendingSales: {
      amount: sum(pending, (item) => item.amount),
      count: pending.length,
    },
  };
}

function getSubscriptionInclude() {
  return [
    {
      model: db.User,
      as: 'client',
      attributes: ['id', 'name', 'phone', 'status'],
    },
    {
      model: db.SubscriptionType,
      as: 'subscriptionType',
    },
  ];
}

function getCertificateInclude() {
  return [
    {
      model: db.User,
      as: 'client',
      attributes: ['id', 'name', 'phone', 'status'],
    },
  ];
}

async function listSubscriptions(context = null) {
  const rows = await db.ClientSubscription.findAll({
    include: getSubscriptionInclude(),
    order: [
      ['status', 'ASC'],
      ['expiresAt', 'ASC'],
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    where: clubTenantWhere(context),
  });
  return rows.map((row) => subscriptionsService.serializeSubscription(row));
}

async function listCertificates(context = null) {
  const rows = await db.Certificate.findAll({
    include: getCertificateInclude(),
    order: [
      ['status', 'ASC'],
      ['expiresAt', 'ASC'],
      ['createdAt', 'DESC'],
      ['id', 'DESC'],
    ],
    where: clubTenantWhere(context),
  });
  return rows.map((row) => certificatesService.serializeCertificate(row));
}

async function getDashboard(query = {}, account = null, tenant = null) {
  const context = await resolveClientMoneyAccessContextForModel(
    tenant,
    db.ClientSubscription,
  );
  const authorityActor = bindClientMoneyActor(account, context);
  const filters = normalizeFilters(query);
  const permissions = getPermissions(authorityActor);
  const now = new Date();
  const expiringUntil = addDays(now, filters.expiringDays);

  const [pendingSalesRaw, subscriptionsRaw, certificatesRaw, corporateRaw] =
    await Promise.all([
      permissions.pendingSales
        ? pendingSaleService.listPendingSales({ status: 'all' }, context)
        : Promise.resolve([]),
      permissions.subscriptions ? listSubscriptions(context) : Promise.resolve([]),
      permissions.certificates ? listCertificates(context) : Promise.resolve([]),
      permissions.corporateBalances
        ? corporateClientsService.listCorporateClients(
            { status: 'all' },
            authorityActor,
            context,
          )
        : Promise.resolve([]),
    ]);

  const pendingSales = pendingSalesRaw.map(enrichPendingSale);
  const subscriptions = subscriptionsRaw.map((item) =>
    enrichSubscription(item, filters, now, expiringUntil),
  );
  const certificates = certificatesRaw.map((item) =>
    enrichCertificate(item, filters, now, expiringUntil),
  );
  const corporateClients = corporateRaw.map((item) =>
    enrichCorporateClient(item, filters),
  );

  return {
    filters,
    generatedAt: now.toISOString(),
    permissions,
    sections: {
      certificates: buildSection(
        'certificates',
        permissions.certificates,
        certificates,
        filters,
        now,
      ),
      corporateBalances: buildSection(
        'corporate_balances',
        permissions.corporateBalances,
        corporateClients,
        filters,
        now,
      ),
      pendingSales: buildSection(
        'pending_sales',
        permissions.pendingSales,
        pendingSales,
        filters,
        now,
      ),
      subscriptions: buildSection(
        'subscriptions',
        permissions.subscriptions,
        subscriptions,
        filters,
        now,
      ),
    },
    summary: buildSummary({
      certificates,
      corporateClients,
      pendingSales,
      subscriptions,
    }),
  };
}

module.exports = {
  DASHBOARD_STATUSES,
  DASHBOARD_TYPES,
  EXPIRY_FILTERS,
  getDashboard,
  __testing: {
    buildSection,
    buildSummary,
    getPermissions,
    matchesExpiry,
    matchesStatus,
    normalizeFilters,
  },
};
