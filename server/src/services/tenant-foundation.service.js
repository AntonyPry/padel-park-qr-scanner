'use strict';

const crypto = require('crypto');
const db = require('../../models');
const {
  DEFAULT_CLUB_SLUG,
  DEFAULT_ORGANIZATION_SLUG,
  TENANT_FOUNDATION_STATES,
} = require('../tenant-foundation/constants');

class TenantFoundationStateError extends Error {
  constructor(message, classification, code = 'TENANT_FOUNDATION_INVALID') {
    super(message);
    this.name = 'TenantFoundationStateError';
    this.statusCode = 503;
    this.code = code;
    this.classification = classification;
    this.details = classification?.diagnostics || undefined;
  }
}

function stableChecksum(snapshot) {
  const value = JSON.stringify({
    accesses: snapshot.accesses.map((row) => [
      row.organizationId,
      row.membershipId,
      row.clubId,
      row.roleOverride,
      row.status,
    ]),
    accounts: snapshot.accounts.map((row) => [row.id, row.role, row.status]),
    clubs: snapshot.clubs.map((row) => [
      row.id,
      row.organizationId,
      row.slug,
      row.status,
    ]),
    memberships: snapshot.memberships.map((row) => [
      row.id,
      row.organizationId,
      row.accountId,
      row.role,
      row.status,
    ]),
    organizations: snapshot.organizations.map((row) => [
      row.id,
      row.slug,
      row.status,
    ]),
  });

  return crypto.createHash('sha256').update(value).digest('hex');
}

async function selectRows(sequelize, sql, { transaction, lock = false } = {}) {
  const [rows] = await sequelize.query(`${sql}${lock ? ' FOR UPDATE' : ''}`, {
    transaction,
  });
  return rows;
}

async function loadTenantFoundationSnapshot({
  sequelize = db.sequelize,
  transaction,
  lock = false,
} = {}) {
  const queryOptions = { lock: lock && Boolean(transaction), transaction };
  const organizations = await selectRows(
    sequelize,
    'SELECT id, slug, name, status FROM Organizations ORDER BY id',
    queryOptions,
  );
  const clubs = await selectRows(
    sequelize,
    'SELECT id, organizationId, slug, name, timezone, status FROM Clubs ORDER BY id',
    queryOptions,
  );
  const accounts = await selectRows(
    sequelize,
    'SELECT id, role, status FROM Accounts ORDER BY id',
    queryOptions,
  );
  const memberships = await selectRows(
    sequelize,
    'SELECT id, organizationId, accountId, role, status FROM Memberships ORDER BY id',
    queryOptions,
  );
  const accesses = await selectRows(
    sequelize,
    'SELECT organizationId, membershipId, clubId, roleOverride, status FROM MembershipClubAccesses ORDER BY membershipId, clubId',
    queryOptions,
  );

  return { accesses, accounts, clubs, memberships, organizations };
}

function classifySnapshot(snapshot) {
  const reasons = [];
  const counts = {
    accesses: snapshot.accesses.length,
    accounts: snapshot.accounts.length,
    clubs: snapshot.clubs.length,
    memberships: snapshot.memberships.length,
    organizations: snapshot.organizations.length,
  };

  const organization = snapshot.organizations[0] || null;
  const club = snapshot.clubs[0] || null;

  if (counts.organizations !== 1) {
    reasons.push('exactly one Organization is required');
  } else {
    if (organization.slug !== DEFAULT_ORGANIZATION_SLUG) {
      reasons.push('default Organization slug is missing or incompatible');
    }
    if (organization.status !== 'active') {
      reasons.push('default Organization must be active');
    }
  }

  if (counts.clubs !== 1) {
    reasons.push('exactly one Club is required');
  } else {
    if (club.slug !== DEFAULT_CLUB_SLUG) {
      reasons.push('default Club slug is missing or incompatible');
    }
    if (club.status !== 'active') {
      reasons.push('default Club must be active');
    }
    if (!organization || Number(club.organizationId) !== Number(organization.id)) {
      reasons.push('default Club must belong to default Organization');
    }
  }

  const allIdentityEmpty =
    counts.accounts === 0 && counts.memberships === 0 && counts.accesses === 0;
  const partiallyEmpty =
    (counts.accounts === 0 &&
      (counts.memberships !== 0 || counts.accesses !== 0)) ||
    (counts.accounts > 0 && counts.memberships === 0) ||
    (counts.memberships === 0 && counts.accesses > 0);

  if (partiallyEmpty) {
    reasons.push('Account/Membership/access triple is partially empty');
  }

  if (allIdentityEmpty && reasons.length === 0) {
    return {
      state: TENANT_FOUNDATION_STATES.BOOTSTRAP_PENDING,
      bootstrapPending: true,
      counts,
      checksum: stableChecksum(snapshot),
      defaultClubId: Number(club.id),
      defaultOrganizationId: Number(organization.id),
      diagnostics: { counts, reasons: [] },
    };
  }

  const accountsById = new Map(
    snapshot.accounts.map((row) => [Number(row.id), row]),
  );
  const membershipsById = new Map(
    snapshot.memberships.map((row) => [Number(row.id), row]),
  );
  const membershipsByAccount = new Map();

  for (const membership of snapshot.memberships) {
    const accountId = Number(membership.accountId);
    const list = membershipsByAccount.get(accountId) || [];
    list.push(membership);
    membershipsByAccount.set(accountId, list);

    if (!organization || Number(membership.organizationId) !== Number(organization.id)) {
      reasons.push(`Membership ${membership.id} is outside the default Organization`);
    }
    if (!accountsById.has(accountId)) {
      reasons.push(`Membership ${membership.id} has no Account`);
    }
  }

  for (const account of snapshot.accounts) {
    const memberships = membershipsByAccount.get(Number(account.id)) || [];
    if (memberships.length !== 1) {
      reasons.push(`Account ${account.id} must have exactly one default Membership`);
      continue;
    }
    const membership = memberships[0];
    if (membership.role !== account.role || membership.status !== account.status) {
      reasons.push(`Account ${account.id} role/status parity mismatch`);
    }
  }

  const accessByMembership = new Map();
  for (const access of snapshot.accesses) {
    const membershipId = Number(access.membershipId);
    const list = accessByMembership.get(membershipId) || [];
    list.push(access);
    accessByMembership.set(membershipId, list);

    const membership = membershipsById.get(membershipId);
    if (!membership) {
      reasons.push(`Access for Membership ${membershipId} is orphaned`);
      continue;
    }
    if (
      !organization ||
      Number(access.organizationId) !== Number(organization.id) ||
      Number(access.organizationId) !== Number(membership.organizationId)
    ) {
      reasons.push(`Access for Membership ${membershipId} has Organization mismatch`);
    }
    if (!club || Number(access.clubId) !== Number(club.id)) {
      reasons.push(`Access for Membership ${membershipId} is outside the default Club`);
    }
  }

  let activeOwners = 0;
  let expectedAccesses = 0;
  for (const membership of snapshot.memberships) {
    const accesses = accessByMembership.get(Number(membership.id)) || [];
    if (membership.role === 'owner') {
      if (membership.status === 'active') activeOwners += 1;
      if (accesses.length !== 0) {
        reasons.push(`Owner Membership ${membership.id} must not have Club access rows`);
      }
      continue;
    }

    expectedAccesses += 1;
    if (accesses.length !== 1) {
      reasons.push(`Non-owner Membership ${membership.id} must have exactly one Club access`);
      continue;
    }
    const access = accesses[0];
    if (access.status !== membership.status) {
      reasons.push(`Membership ${membership.id} access status parity mismatch`);
    }
    if (access.roleOverride !== null && access.roleOverride !== undefined) {
      reasons.push(`Membership ${membership.id} parity access must not override role`);
    }
  }

  if (counts.memberships !== counts.accounts) {
    reasons.push('Membership count must equal Account count');
  }
  if (counts.accesses !== expectedAccesses) {
    reasons.push('Access count does not match non-owner Membership count');
  }
  if (counts.accounts > 0 && activeOwners < 1) {
    reasons.push('at least one active owner Membership is required');
  }

  const diagnostics = {
    activeOwners,
    counts,
    expectedAccesses,
    reasons: Array.from(new Set(reasons)),
  };

  if (diagnostics.reasons.length > 0 || counts.accounts === 0) {
    return {
      state: TENANT_FOUNDATION_STATES.INVALID,
      bootstrapPending: false,
      counts,
      checksum: stableChecksum(snapshot),
      defaultClubId: club ? Number(club.id) : null,
      defaultOrganizationId: organization ? Number(organization.id) : null,
      diagnostics,
    };
  }

  return {
    state: TENANT_FOUNDATION_STATES.INITIALIZED,
    bootstrapPending: false,
    counts,
    checksum: stableChecksum(snapshot),
    defaultClubId: Number(club.id),
    defaultOrganizationId: Number(organization.id),
    diagnostics,
  };
}

async function classifyTenantFoundation(options = {}) {
  try {
    const snapshot = await loadTenantFoundationSnapshot(options);
    return classifySnapshot(snapshot);
  } catch (error) {
    if (
      ['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.original?.code) ||
      ['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.parent?.code) ||
      ['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error?.code)
    ) {
      return {
        state: TENANT_FOUNDATION_STATES.INVALID,
        bootstrapPending: false,
        counts: null,
        checksum: null,
        defaultClubId: null,
        defaultOrganizationId: null,
        diagnostics: {
          counts: null,
          reasons: ['tenant foundation schema is missing or incompatible'],
        },
      };
    }
    throw error;
  }
}

function stateError(classification, code = 'TENANT_FOUNDATION_INVALID') {
  const reasons = classification?.diagnostics?.reasons || [];
  const suffix = reasons.length > 0 ? `: ${reasons.join('; ')}` : '';
  return new TenantFoundationStateError(
    `Tenant foundation state is ${classification?.state || 'unknown'}${suffix}`,
    classification,
    code,
  );
}

async function assertTenantFoundationOperational(options = {}) {
  const classification = await classifyTenantFoundation(options);
  if (classification.state === TENANT_FOUNDATION_STATES.INVALID) {
    throw stateError(classification);
  }
  return classification;
}

async function assertTenantFoundationInitialized(options = {}) {
  const classification = await classifyTenantFoundation(options);
  if (classification.state !== TENANT_FOUNDATION_STATES.INITIALIZED) {
    throw stateError(
      classification,
      classification.state === TENANT_FOUNDATION_STATES.BOOTSTRAP_PENDING
        ? 'BOOTSTRAP_REQUIRED'
        : 'TENANT_FOUNDATION_INVALID',
    );
  }
  return classification;
}

module.exports = {
  TenantFoundationStateError,
  assertTenantFoundationInitialized,
  assertTenantFoundationOperational,
  classifySnapshot,
  classifyTenantFoundation,
  loadTenantFoundationSnapshot,
  stateError,
};
