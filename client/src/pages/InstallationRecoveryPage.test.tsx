import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@/lib/theme';
import InstallationRecoveryPage from './InstallationRecoveryPage';

function json(value: unknown) {
  return Promise.resolve(new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' }, status: 200 }));
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

describe('InstallationRecoveryPage navigation', () => {
  beforeEach(() => {
    window.sessionStorage.setItem('setly_installation_operator_token', 'operator-token');
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockReturnValue({ addEventListener: vi.fn(), matches: false, removeEventListener: vi.fn() }) });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/recovery/accounts')) return json({ accounts: [{ id: 7, email: 'admin@example.test', role: 'admin', displayName: 'Admin', staffId: null }] });
      if (url.endsWith('/recovery/requests')) return json({ requests: [] });
      return json({});
    }));
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('uses SPA navigation back to the organization without document reload', async () => {
    render(<ThemeProvider><MemoryRouter initialEntries={['/installation/organizations/1/clubs/2/recovery']}><Routes><Route path="*" element={<><InstallationRecoveryPage /><LocationProbe /></>} /></Routes></MemoryRouter></ThemeProvider>);
    await screen.findByRole('heading', { name: 'Восстановление доступа' });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/installation/organizations/1/clubs/2/recovery'));
    screen.getByRole('button', { name: 'К организации' }).click();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/installation/organizations/1'));
  });

  it('navigates an account card to the dedicated detail route', async () => {
    render(<ThemeProvider><MemoryRouter initialEntries={['/installation/organizations/1/clubs/2/recovery']}><Routes><Route path="*" element={<><InstallationRecoveryPage /><LocationProbe /></>} /></Routes></MemoryRouter></ThemeProvider>);
    await screen.findByRole('button', { name: /Admin/ });
    screen.getByRole('button', { name: /Admin/ }).click();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/installation/organizations/1/clubs/2/recovery/accounts/7'));
  });
});
