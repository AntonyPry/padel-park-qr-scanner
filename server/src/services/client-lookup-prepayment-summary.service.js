'use strict';

const { Op } = require('sequelize');
const db = require('../../models');
const { ACCESS_MATRIX } = require('../constants/access-matrix');
const { TENANT_SCOPES } = require('../tenant-context/route-scope-declarations');
const certificatesService = require('./certificates.service');
const {
  bindClientMoneyActor,
  resolveClientMoneyAccessContext,
} = require('./client-money-access-context.service');
const subscriptionsService = require('./subscriptions.service');
const { safeTenantDenial } = require('./tenant-context.service');

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value, now = new Date()) {
  const date = toDate(value);
  if (!date) return null;
  return Math.ceil((date.getTime() - now.getTime()) / 86400000);
}

function formatShortDate(value) {
  const date = toDate(value);
  if (!date) return 'без даты';
  return date.toLocaleDateString('ru-RU');
}

function buildSubscriptionWarning(subscription, now = new Date()) {
  if (!subscription) return null;
  if (subscription.status === 'expired') {
    return {
      id: `subscription-${subscription.id}-expired`,
      level: 'danger',
      text: `${subscription.typeName} истек ${formatShortDate(subscription.expiresAt)}`,
      type: 'expired',
    };
  }
  if (subscription.status === 'used') {
    return {
      id: `subscription-${subscription.id}-used`,
      level: 'danger',
      text: `${subscription.typeName} закончился`,
      type: 'used',
    };
  }
  if (subscription.status === 'canceled') {
    return {
      id: `subscription-${subscription.id}-canceled`,
      level: 'muted',
      text: `${subscription.typeName} отменен`,
      type: 'canceled',
    };
  }

  const daysLeft = daysUntil(subscription.expiresAt, now);
  if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14) {
    return {
      id: `subscription-${subscription.id}-expiring`,
      level: 'warning',
      text: `${subscription.typeName} истекает через ${daysLeft} дн.`,
      type: 'expiring_soon',
    };
  }

  if (
    subscription.remainingSessions !== null &&
    subscription.remainingSessions !== undefined &&
    Number(subscription.remainingSessions) <= 1
  ) {
    return {
      id: `subscription-${subscription.id}-low`,
      level: 'warning',
      text: `${subscription.typeName}: осталось ${subscription.remainingSessions} занятий`,
      type: 'low_remaining',
    };
  }

  return null;
}

function buildCertificateWarning(certificate, now = new Date()) {
  if (!certificate) return null;
  if (certificate.status === 'expired') {
    return {
      id: `certificate-${certificate.id}-expired`,
      level: 'danger',
      text: `Сертификат ${certificate.code} истек ${formatShortDate(certificate.expiresAt)}`,
      type: 'expired',
    };
  }
  if (certificate.status === 'redeemed') {
    return {
      id: `certificate-${certificate.id}-redeemed`,
      level: 'muted',
      text: `Сертификат ${certificate.code} погашен`,
      type: 'redeemed',
    };
  }
  if (certificate.status === 'canceled') {
    return {
      id: `certificate-${certificate.id}-canceled`,
      level: 'muted',
      text: `Сертификат ${certificate.code} отменен`,
      type: 'canceled',
    };
  }

  const daysLeft = daysUntil(certificate.expiresAt, now);
  if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 14) {
    return {
      id: `certificate-${certificate.id}-expiring`,
      level: 'warning',
      text: `Сертификат ${certificate.code} истекает через ${daysLeft} дн.`,
      type: 'expiring_soon',
    };
  }

  return null;
}

function buildClientPrepaymentSummary({
  certificates = [],
  subscriptions = [],
} = {}) {
  const now = new Date();
  const activeSubscriptions = subscriptions.filter(
    (subscription) => subscription.status === 'active',
  );
  const activeCertificates = certificates.filter(
    (certificate) => certificate.status === 'active',
  );
  const subscriptionWarnings = subscriptions
    .map((subscription) => buildSubscriptionWarning(subscription, now))
    .filter(Boolean);
  const certificateWarnings = certificates
    .map((certificate) => buildCertificateWarning(certificate, now))
    .filter(Boolean);

  return {
    activeCertificatesCount: activeCertificates.length,
    activeSubscriptionsCount: activeSubscriptions.length,
    certificateWarnings,
    hasActiveCertificate: activeCertificates.length > 0,
    hasActiveSubscription: activeSubscriptions.length > 0,
    subscriptionWarnings,
  };
}

async function listAuthorizedClubIds(context) {
  if (
    context.authority !== 'request' ||
    context.scope !== TENANT_SCOPES.ORGANIZATION ||
    !context.membershipId ||
    !context.organizationId
  ) {
    throw safeTenantDenial();
  }

  if (context.membershipRole === 'owner') {
    const clubs = await db.Club.findAll({
      attributes: ['id'],
      raw: true,
      where: {
        organizationId: context.organizationId,
        status: 'active',
      },
    });
    return clubs.map((club) => Number(club.id));
  }

  const accesses = await db.MembershipClubAccess.findAll({
    attributes: ['clubId', 'roleOverride'],
    include: [{
      as: 'Club',
      attributes: [],
      model: db.Club,
      required: true,
      where: {
        organizationId: context.organizationId,
        status: 'active',
      },
    }],
    raw: true,
    where: {
      membershipId: context.membershipId,
      organizationId: context.organizationId,
      status: 'active',
    },
  });
  return accesses
    .filter((access) => access.roleOverride !== 'owner')
    .map((access) => Number(access.clubId));
}

async function getOrganizationLookupPrepaymentSummary({
  account,
  clientId,
  tenant,
}) {
  const context = await resolveClientMoneyAccessContext(tenant);
  const actor = bindClientMoneyActor(account, context);
  const clubIds = Array.from(new Set(await listAuthorizedClubIds(context)))
    .filter((clubId) => Number.isSafeInteger(clubId) && clubId > 0);
  if (clubIds.length === 0) return buildClientPrepaymentSummary();

  const where = {
    clientId: Number(clientId),
    clubId: { [Op.in]: clubIds },
    organizationId: context.organizationId,
  };
  const canViewSubscriptions = ACCESS_MATRIX.clientSubscriptionsView.includes(
    actor.role,
  );
  const canViewCertificates = ACCESS_MATRIX.certificatesView.includes(actor.role);
  const [subscriptionRows, certificateRows] = await Promise.all([
    canViewSubscriptions
      ? db.ClientSubscription.findAll({
          attributes: [
            'id',
            'typeName',
            'sessionsTotal',
            'sessionsUsed',
            'isUnlimited',
            'expiresAt',
            'status',
          ],
          raw: true,
          where,
        })
      : [],
    canViewCertificates
      ? db.Certificate.findAll({
          attributes: [
            'id',
            'code',
            'certificateType',
            'amountTotal',
            'amountUsed',
            'unitsTotal',
            'unitsUsed',
            'expiresAt',
            'status',
          ],
          raw: true,
          where,
        })
      : [],
  ]);

  const subscriptions = subscriptionRows.map((subscription) => ({
    expiresAt: subscription.expiresAt,
    id: subscription.id,
    remainingSessions: subscriptionsService.calculateRemaining(subscription),
    status: subscriptionsService.calculateStatus(subscription),
    typeName: subscription.typeName,
  }));
  const certificates = certificateRows.map((certificate) => ({
    code: certificate.code,
    expiresAt: certificate.expiresAt,
    id: certificate.id,
    status: certificatesService.calculateStatus(certificate),
  }));

  return buildClientPrepaymentSummary({ certificates, subscriptions });
}

module.exports = {
  buildClientPrepaymentSummary,
  getOrganizationLookupPrepaymentSummary,
};
