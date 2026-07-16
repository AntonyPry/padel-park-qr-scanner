import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireRoles } from '@/components/RequireRoles';
import { ROUTE_ACCESS } from '@/lib/permissions';

const mocks = vi.hoisted(() => ({ role: 'admin' }));

vi.mock('@/lib/useAuth', () => ({
  useAuth: () => ({ account: { id: 1, role: mocks.role } }),
}));

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

afterEach(() => cleanup());

describe('Shift settings route guard', () => {
  it('redirects an admin away from direct Shift settings access', () => {
    mocks.role = 'admin';
    render(
      <MemoryRouter initialEntries={['/admin/shift-settings']}>
        <Routes>
          <Route
            path="/admin/shift-settings"
            element={
              <RequireRoles roles={ROUTE_ACCESS['/admin/shift-settings']}>
                <div>settings</div>
              </RequireRoles>
            }
          />
          <Route path="/admin" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('location')).toHaveTextContent('/admin');
    expect(screen.queryByText('settings')).not.toBeInTheDocument();
  });

  it('allows an owner to open Shift settings directly', () => {
    mocks.role = 'owner';
    render(
      <MemoryRouter initialEntries={['/admin/shift-settings']}>
        <Routes>
          <Route
            path="/admin/shift-settings"
            element={
              <RequireRoles roles={ROUTE_ACCESS['/admin/shift-settings']}>
                <div>settings</div>
              </RequireRoles>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('settings')).toBeInTheDocument();
  });
});
