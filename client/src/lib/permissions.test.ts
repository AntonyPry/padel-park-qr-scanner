import { describe, expect, it } from 'vitest';
import {
  canAccessPath,
  canManageBookingResources,
  canManageBookings,
  canManageClients,
  canManageCorporateDeposits,
  canManageFinance,
  canManageMethodology,
  canManagePrepaymentSales,
  canManagePrepaymentSettings,
  canManageShiftReportTemplates,
  canManageSubscriptionTypes,
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

describe('permissions', () => {
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
    expect(canAccessPath('owner', '/admin/shift-reports')).toBe(true);
    expect(canAccessPath('manager', '/admin/shift-reports')).toBe(true);
    expect(canAccessPath('admin', '/admin/shift-reports')).toBe(false);
    expect(canManageShiftReportTemplates('owner')).toBe(true);
    expect(canManageShiftReportTemplates('manager')).toBe(true);
    expect(canManageShiftReportTemplates('admin')).toBe(false);
  });
});
