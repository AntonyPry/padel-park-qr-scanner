import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireRoles } from './RequireRoles';
import { AuthContext } from '@/lib/auth-context';
import {
  canAccessPathForAuthority,
  type ClientRoute,
} from '@/lib/permissions';
import type { AccountRole } from '@/lib/roles';

afterEach(cleanup);

function LocationProbe() {
  return <div>redirect:{useLocation().pathname}</div>;
}

function MountRequestProbe({
  onRequest,
  path,
}: {
  onRequest?: () => void;
  path: ClientRoute;
}) {
  useEffect(() => {
    onRequest?.();
  }, [onRequest]);

  return <div>protected:{path}</div>;
}

function renderProtected(
  path: ClientRoute,
  {
    accountRole,
    effectiveRole,
    membershipRole,
    onRequest,
    tenantContextEnabled = true,
  }: {
    accountRole: AccountRole;
    effectiveRole: AccountRole;
    membershipRole: AccountRole;
    onRequest?: () => void;
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
                <MountRequestProbe onRequest={onRequest} path={path} />
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

  it('allows bookings only when its club and organization requirements pass', () => {
    renderProtected('/admin/bookings', {
      accountRole: 'trainer',
      effectiveRole: 'manager',
      membershipRole: 'trainer',
    });

    expect(screen.getByText('protected:/admin/bookings')).toBeInTheDocument();
  });

  it.each([
    ['/admin/motivation', 'trainer', 'manager'],
    ['/admin/catalog', 'manager', 'trainer'],
    ['/admin/shift-reports', 'trainer', 'manager'],
    ['/admin/shift-reports', 'manager', 'trainer'],
    ['/admin/finances', 'trainer', 'manager'],
    ['/admin/finances', 'manager', 'trainer'],
  ] as const)(
    'does not mount composite page %s for membership %s and club %s',
    async (path, membershipRole, effectiveRole) => {
      renderProtected(path, {
        accountRole: membershipRole,
        effectiveRole,
        membershipRole,
      });

      expect(
        await screen.findByText(/^redirect:/),
      ).toBeInTheDocument();
      expect(screen.queryByText(`protected:${path}`)).not.toBeInTheDocument();
    },
  );

  it('blocks page mount requests for every denied non-owner override combination', async () => {
    const roles: AccountRole[] = [
      'manager',
      'admin',
      'accountant',
      'trainer',
      'viewer',
    ];
    const paths: ClientRoute[] = [
      '/admin/motivation',
      '/admin/catalog',
      '/admin/shift-reports',
      '/admin/finances',
    ];

    for (const path of paths) {
      for (const membershipRole of roles) {
        for (const effectiveRole of roles) {
          const request = vi.fn();
          const authority = {
            accountRole: membershipRole,
            tenantContext: {
              clubId: 12,
              effectiveRole,
              membershipId: 21,
              membershipRole,
              organizationId: 11,
            },
            tenantContextEnabled: true,
          };
          const allowed = canAccessPathForAuthority(authority, path);

          renderProtected(path, {
            accountRole: membershipRole,
            effectiveRole,
            membershipRole,
            onRequest: request,
          });

          if (allowed) {
            await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
          } else {
            await screen.findByText(/^redirect:/);
            expect(request).not.toHaveBeenCalled();
          }
          expect(screen.queryByText(/403/)).not.toBeInTheDocument();
          cleanup();
        }
      }
    }
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
