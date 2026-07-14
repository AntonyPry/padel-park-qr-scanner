import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireRoles } from './RequireRoles';
import { AuthContext } from '@/lib/auth-context';
import type { ClientRoute } from '@/lib/permissions';
import type { AccountRole } from '@/lib/roles';

afterEach(cleanup);

function LocationProbe() {
  return <div>redirect:{useLocation().pathname}</div>;
}

function renderProtected(
  path: ClientRoute,
  {
    accountRole,
    effectiveRole,
    membershipRole,
    tenantContextEnabled = true,
  }: {
    accountRole: AccountRole;
    effectiveRole: AccountRole;
    membershipRole: AccountRole;
    tenantContextEnabled?: boolean;
  },
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthContext.Provider
        value={{
          account: {
            email: `${accountRole}@padelpark.demo`,
            id: 1,
            role: accountRole,
            status: 'active',
          },
          bootstrap: vi.fn(),
          loading: false,
          login: vi.fn(),
          logout: vi.fn(),
          setupRequired: false,
          tenantContext: tenantContextEnabled
            ? {
                clubId: 12,
                effectiveRole,
                membershipId: 21,
                membershipRole,
                organizationId: 11,
              }
            : null,
          tenantContextEnabled,
          tenantReady: true,
        }}
      >
        <Routes>
          <Route
            path={path}
            element={
              <RequireRoles path={path}>
                <div>protected:{path}</div>
              </RequireRoles>
            }
          />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('RequireRoles scope authority', () => {
  it('denies organization staff to membership trainer despite club manager access', async () => {
    renderProtected('/admin/staff', {
      accountRole: 'trainer',
      effectiveRole: 'manager',
      membershipRole: 'trainer',
    });

    expect(await screen.findByText('redirect:/admin')).toBeInTheDocument();
    expect(screen.queryByText('protected:/admin/staff')).not.toBeInTheDocument();
  });

  it('allows organization staff to membership manager despite club trainer access', () => {
    renderProtected('/admin/staff', {
      accountRole: 'manager',
      effectiveRole: 'trainer',
      membershipRole: 'manager',
    });

    expect(screen.getByText('protected:/admin/staff')).toBeInTheDocument();
  });

  it('uses the club role for club routes', () => {
    renderProtected('/admin/bookings', {
      accountRole: 'trainer',
      effectiveRole: 'manager',
      membershipRole: 'trainer',
    });

    expect(screen.getByText('protected:/admin/bookings')).toBeInTheDocument();
  });

  it('uses legacy Account.role for every route when the flag is off', () => {
    renderProtected('/admin/users', {
      accountRole: 'manager',
      effectiveRole: 'trainer',
      membershipRole: 'trainer',
      tenantContextEnabled: false,
    });

    expect(screen.getByText('protected:/admin/users')).toBeInTheDocument();
  });
});
