import { describe, expect, it } from 'vitest';
import {
  ROUTE_ACCESS,
  ROUTE_AUTHORIZATION,
  canAccessPath,
  canAccessPathForAuthority,
  canManageBookingResources,
  canManageBookings,
  canManageClientBases,
  canManageCallTasks,
  canManageClients,
  canManageCorporateDeposits,
  canManageFinance,
  canManageMethodology,
  canManagePrepaymentSales,
  canManagePrepaymentSettings,
  canManageShiftReportTemplates,
  canManageStaff,
  canManageSubscriptionTypes,
  canManageSystemUsers,
  canManageTelephony,
  canViewManagerControlDashboard,
  canRedeemCertificates,
  canRedeemClientSubscriptions,
  canViewCertificates,
  canViewClientSubscriptions,
  canViewCorporateClients,
  canViewMethodologyAnalytics,
  canViewPrepaymentsDashboard,
  canWorkTelephony,
  canViewTrainingNotes,
  getDefaultPath,
} from './permissions';
import { selectAuthorizationRole, type RoleAuthority } from './authorization';

describe('permissions', () => {
  it('declares one audited authorization contract for every protected client route', () => {
    expect(Object.keys(ROUTE_AUTHORIZATION).sort()).toEqual(
      Object.keys(ROUTE_ACCESS).sort(),
    );
    expect(ROUTE_AUTHORIZATION['/admin/onboarding']).toMatchObject({
      strategy: 'partial',
      requirements: [{ scope: 'membership' }],
    });
    expect(ROUTE_AUTHORIZATION['/admin/staff']).toMatchObject({
      strategy: 'partial',
      requirements: [{ scope: 'organization' }],
    });
    expect(ROUTE_AUTHORIZATION['/admin/users']).toMatchObject({
      strategy: 'single',
      requirements: [{ scope: 'organization' }],
    });
    expect(
      ROUTE_AUTHORIZATION['/admin/bookings'].requirements.map(({ scope }) => scope),
    ).toEqual(['club', 'organization']);
    expect(
      ROUTE_AUTHORIZATION['/admin/finances'].requirements.map(({ scope }) => scope),
    ).toEqual(['club', 'organization']);
    expect(ROUTE_AUTHORIZATION['/admin/shift-cash']).toMatchObject({
      strategy: 'single',
      requirements: [{ scope: 'club' }],
    });
  });

  it('requires both organization and club authority for inseparable mixed pages', () => {
    const authority = (
      membershipRole: 'manager' | 'trainer',
      effectiveRole: 'manager' | 'trainer',
    ): RoleAuthority => ({
      accountRole: membershipRole,
      tenantContext: {
        clubId: 12,
        effectiveRole,
        membershipId: 21,
        membershipRole,
        organizationId: 11,
      },
      tenantContextEnabled: true,
    });

    const trainerManager = authority('trainer', 'manager');
    expect(canAccessPathForAuthority(trainerManager, '/admin/motivation')).toBe(
      false,
    );
    expect(canAccessPathForAuthority(trainerManager, '/admin/shift-reports')).toBe(
      true,
    );
    expect(canAccessPathForAuthority(trainerManager, '/admin/finances')).toBe(
      false,
    );

    const managerTrainer = authority('manager', 'trainer');
    expect(canAccessPathForAuthority(managerTrainer, '/admin/catalog')).toBe(false);
    expect(canAccessPathForAuthority(managerTrainer, '/admin/shift-reports')).toBe(
      false,
    );
    expect(canAccessPathForAuthority(managerTrainer, '/admin/finances')).toBe(
      false,
    );
  });

  it('separates organization management from club manager actions', () => {
    const authority = (
      accountRole: 'trainer' | 'manager',
      membershipRole: 'trainer' | 'manager',
      effectiveRole: 'trainer' | 'manager',
    ): RoleAuthority => ({
      accountRole,
      tenantContext: {
        clubId: 12,
        effectiveRole,
        membershipId: 21,
        membershipRole,
        organizationId: 11,
      },
      tenantContextEnabled: true,
    });
    const trainerManager = authority('trainer', 'trainer', 'manager');
    const trainerOrganizationRole = selectAuthorizationRole(
      trainerManager,
      'organization',
    );
    const managerClubRole = selectAuthorizationRole(trainerManager, 'club');
    expect(canManageStaff(trainerOrganizationRole)).toBe(false);
    expect(canManageSystemUsers(trainerOrganizationRole)).toBe(false);
    expect(canManageBookingResources(managerClubRole)).toBe(true);
    expect(canAccessPathForAuthority(trainerManager, '/admin/staff')).toBe(false);
    expect(canAccessPathForAuthority(trainerManager, '/admin/bookings')).toBe(true);

    const managerTrainer = authority('manager', 'manager', 'trainer');
    const managerOrganizationRole = selectAuthorizationRole(
      managerTrainer,
      'organization',
    );
    const trainerClubRole = selectAuthorizationRole(managerTrainer, 'club');
    expect(canManageStaff(managerOrganizationRole)).toBe(true);
    expect(canManageSystemUsers(managerOrganizationRole)).toBe(true);
    expect(canManageBookingResources(trainerClubRole)).toBe(false);
    expect(canAccessPathForAuthority(managerTrainer, '/admin/users')).toBe(true);
    expect(canAccessPathForAuthority(managerTrainer, '/admin/bookings')).toBe(false);
  });

  it('routes accountants and trainers to their safe default sections', () => {
    expect(getDefaultPath('accountant')).toBe('/admin/finances');
    expect(getDefaultPath('trainer')).toBe('/admin/trainer');
    expect(getDefaultPath('viewer')).toBe('/admin/visits-analytics');
  });

  it('keeps trainer away from common CRM management sections', () => {
    expect(canAccessPath('trainer', '/admin/trainer')).toBe(true);
    expect(canAccessPath('trainer', '/admin/methodology')).toBe(true);
    expect(canAccessPath('trainer', '/admin/methodology-analytics')).toBe(false);
    expect(canAccessPath('trainer', '/admin/onboarding')).toBe(true);
    expect(canAccessPath('trainer', '/admin/clients')).toBe(false);
    expect(canManageClients('trainer')).toBe(false);
    expect(canManageMethodology('trainer')).toBe(false);
    expect(canViewMethodologyAnalytics('trainer')).toBe(false);
    expect(canViewTrainingNotes('trainer')).toBe(true);
  });

  it('allows owners and managers to manage methodology approvals', () => {
    expect(canManageMethodology('owner')).toBe(true);
    expect(canManageMethodology('manager')).toBe(true);
    expect(canManageMethodology('admin')).toBe(false);
    expect(canViewMethodologyAnalytics('owner')).toBe(true);
    expect(canViewMethodologyAnalytics('manager')).toBe(true);
  });

  it('separates finance management from finance visibility', () => {
    expect(canAccessPath('manager', '/admin/finances')).toBe(true);
    expect(canManageFinance('manager')).toBe(false);
    expect(canManageFinance('accountant')).toBe(true);
  });

  it('keeps manager control dashboard limited to owner and manager', () => {
    expect(canAccessPath('owner', '/admin/manager-control')).toBe(true);
    expect(canAccessPath('manager', '/admin/manager-control')).toBe(true);
    expect(canViewManagerControlDashboard('manager')).toBe(true);
    expect(canAccessPath('accountant', '/admin/manager-control')).toBe(false);
    expect(canAccessPath('viewer', '/admin/manager-control')).toBe(false);
    expect(canAccessPath('trainer', '/admin/manager-control')).toBe(false);
    expect(canAccessPath('admin', '/admin/manager-control')).toBe(false);
  });

  it('keeps prepayment sale settings separate from catalog management', () => {
    expect(canAccessPath('manager', '/admin/catalog')).toBe(true);
    expect(canAccessPath('manager', '/admin/prepayments')).toBe(true);
    expect(canAccessPath('admin', '/admin/prepayments')).toBe(true);
    expect(canAccessPath('accountant', '/admin/prepayments')).toBe(true);
    expect(canViewPrepaymentsDashboard('owner')).toBe(true);
    expect(canViewPrepaymentsDashboard('trainer')).toBe(false);
    expect(canManagePrepaymentSettings('manager')).toBe(true);
    expect(canManagePrepaymentSales('manager')).toBe(true);
    expect(canManagePrepaymentSettings('accountant')).toBe(false);
  });

  it('keeps subscription balances away from trainers', () => {
    expect(canManageSubscriptionTypes('owner')).toBe(true);
    expect(canManageSubscriptionTypes('manager')).toBe(true);
    expect(canManageSubscriptionTypes('accountant')).toBe(false);
    expect(canViewClientSubscriptions('admin')).toBe(true);
    expect(canRedeemClientSubscriptions('admin')).toBe(true);
    expect(canRedeemClientSubscriptions('viewer')).toBe(false);
    expect(canViewClientSubscriptions('accountant')).toBe(false);
    expect(canRedeemClientSubscriptions('accountant')).toBe(false);
    expect(canViewClientSubscriptions('trainer')).toBe(false);
    expect(canRedeemClientSubscriptions('trainer')).toBe(false);
    expect(canAccessPath('accountant', '/admin/clients')).toBe(false);
  });

  it('keeps certificate balances available to admins without leaking to trainers', () => {
    expect(canAccessPath('admin', '/admin/certificates')).toBe(true);
    expect(canViewCertificates('viewer')).toBe(true);
    expect(canRedeemCertificates('admin')).toBe(true);
    expect(canRedeemCertificates('viewer')).toBe(false);
    expect(canViewCertificates('accountant')).toBe(false);
    expect(canRedeemCertificates('accountant')).toBe(false);
    expect(canViewCertificates('trainer')).toBe(false);
    expect(canRedeemCertificates('trainer')).toBe(false);
  });

  it('keeps corporate balances on finance visibility and deposits on finance management', () => {
    expect(canAccessPath('owner', '/admin/corporate-clients')).toBe(true);
    expect(canAccessPath('manager', '/admin/corporate-clients')).toBe(true);
    expect(canAccessPath('accountant', '/admin/corporate-clients')).toBe(true);
    expect(canAccessPath('viewer', '/admin/corporate-clients')).toBe(true);
    expect(canAccessPath('admin', '/admin/corporate-clients')).toBe(false);
    expect(canViewCorporateClients('manager')).toBe(true);
    expect(canViewCorporateClients('trainer')).toBe(false);
    expect(canManageCorporateDeposits('owner')).toBe(true);
    expect(canManageCorporateDeposits('accountant')).toBe(true);
    expect(canManageCorporateDeposits('manager')).toBe(false);
    expect(canManageCorporateDeposits('admin')).toBe(false);
  });

  it('allows admins to operate bookings by phone', () => {
    expect(canAccessPath('admin', '/admin/bookings')).toBe(true);
    expect(canManageBookings('admin')).toBe(true);
    expect(canManageBookingResources('admin')).toBe(false);
    expect(canManageBookingResources('manager')).toBe(true);
    expect(canManageBookings('viewer')).toBe(false);
  });

  it('allows admins to process calls but keeps telephony setup for managers', () => {
    expect(canAccessPath('admin', '/admin/telephony')).toBe(true);
    expect(canWorkTelephony('admin')).toBe(true);
    expect(canManageTelephony('admin')).toBe(false);
    expect(canManageTelephony('manager')).toBe(true);
    expect(canWorkTelephony('viewer')).toBe(false);
  });

  it('allows owners and managers to manage shift report templates', () => {
    expect(canAccessPath('owner', '/admin/shift/reports')).toBe(true);
    expect(canAccessPath('manager', '/admin/shift/reports')).toBe(true);
    expect(canAccessPath('admin', '/admin/shift/reports')).toBe(true);
    expect(canAccessPath('admin', '/admin/shift/cash')).toBe(true);
    expect(canAccessPath('accountant', '/admin/shift/cash')).toBe(false);
    expect(canAccessPath('owner', '/admin/shift-settings')).toBe(true);
    expect(canAccessPath('manager', '/admin/shift-settings')).toBe(true);
    expect(canAccessPath('admin', '/admin/shift-settings')).toBe(false);
    expect(canManageShiftReportTemplates('owner')).toBe(true);
    expect(canManageShiftReportTemplates('manager')).toBe(true);
    expect(canManageShiftReportTemplates('admin')).toBe(false);
  });

  it('shows visits analytics actions only to client-base managers', () => {
    expect(canAccessPath('owner', '/admin/visits-analytics')).toBe(true);
    expect(canAccessPath('manager', '/admin/visits-analytics')).toBe(true);
    expect(canManageClientBases('owner')).toBe(true);
    expect(canManageClientBases('manager')).toBe(true);
    expect(canManageCallTasks('owner')).toBe(true);
    expect(canManageCallTasks('manager')).toBe(true);
    for (const role of ['accountant', 'viewer', 'admin', 'trainer'] as const) {
      expect(canManageClientBases(role)).toBe(false);
      expect(canManageCallTasks(role)).toBe(false);
    }
  });
});
