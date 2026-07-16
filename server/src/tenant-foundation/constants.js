'use strict';

const DEFAULT_ORGANIZATION_SLUG = 'padel-park';
const DEFAULT_CLUB_SLUG = 'padel-park';
const DEFAULT_TENANT_NAME = 'Padel Park';
const DEFAULT_CLUB_TIMEZONE = 'Europe/Moscow';

const TENANT_STATUS_VALUES = ['active', 'inactive', 'archived'];
const MEMBERSHIP_ROLE_VALUES = [
  'owner',
  'manager',
  'admin',
  'accountant',
  'viewer',
  'trainer',
];
const CLUB_ROLE_OVERRIDE_VALUES = MEMBERSHIP_ROLE_VALUES.filter(
  (role) => role !== 'owner',
);

const TENANT_FOUNDATION_STATES = {
  BOOTSTRAP_PENDING: 'bootstrap-pending',
  INITIALIZED: 'initialized',
  INVALID: 'invalid',
};

const TENANT_FOUNDATION_TABLES = [
  'Organizations',
  'Clubs',
  'Memberships',
  'MembershipClubAccesses',
];

const FEATURE_2_MIGRATION_NAME =
  '20260714120000-create-tenant-foundation.js';

// Future tenant waves must add their exact migration filenames here before
// they are merged. Rollback also independently rejects external FKs and
// tenant columns outside the foundation tables.
const BLOCKING_LATER_TENANT_MIGRATIONS = Object.freeze([
  '20260715120000-add-tenant-context-plumbing.js',
  '20260716120000-add-tenant-isolation-infrastructure.js',
  '20260716140000-add-tenant-staff-access-identity.js',
  '20260717120000-add-tenant-crm-users-wave.js',
  '20260718120000-add-tenant-bookings-training-wave.js',
  '20260719120000-add-tenant-finance-prepayments-wave.js',
  '20260720120000-add-tenant-ops-audit-onboarding-wave.js',
  '20260721120000-enforce-tenant-isolation.js',
]);

module.exports = {
  BLOCKING_LATER_TENANT_MIGRATIONS,
  CLUB_ROLE_OVERRIDE_VALUES,
  DEFAULT_CLUB_SLUG,
  DEFAULT_CLUB_TIMEZONE,
  DEFAULT_ORGANIZATION_SLUG,
  DEFAULT_TENANT_NAME,
  FEATURE_2_MIGRATION_NAME,
  MEMBERSHIP_ROLE_VALUES,
  TENANT_FOUNDATION_STATES,
  TENANT_FOUNDATION_TABLES,
  TENANT_STATUS_VALUES,
};
