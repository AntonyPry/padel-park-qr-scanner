import { describe, expect, it } from 'vitest';
import {
  canAccessPath,
  canManageBookings,
  canManageClients,
  canManageFinance,
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
    expect(canAccessPath('trainer', '/admin/clients')).toBe(false);
    expect(canManageClients('trainer')).toBe(false);
    expect(canViewTrainingNotes('trainer')).toBe(true);
  });

  it('separates finance management from finance visibility', () => {
    expect(canAccessPath('manager', '/admin/finances')).toBe(true);
    expect(canManageFinance('manager')).toBe(false);
    expect(canManageFinance('accountant')).toBe(true);
  });

  it('allows admins to operate bookings by phone', () => {
    expect(canAccessPath('admin', '/admin/bookings')).toBe(true);
    expect(canManageBookings('admin')).toBe(true);
    expect(canManageBookings('viewer')).toBe(false);
  });
});
