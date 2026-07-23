import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@/lib/theme';
import InstallationRecoveryAccountPage from './InstallationRecoveryAccountPage';

function json(value: unknown) { return Promise.resolve(new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' }, status: 200 })); }
function LocationProbe() { return <output data-testid="location">{useLocation().pathname}</output>; }

describe('InstallationRecoveryAccountPage', () => {
  beforeEach(() => {
    window.sessionStorage.setItem('setly_installation_operator_token', 'operator-token');
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn().mockReturnValue({ addEventListener: vi.fn(), matches: false, removeEventListener: vi.fn() }) });
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/recovery/accounts/7')) return json({ id: 7, email: 'admin@example.test', role: 'admin', displayName: 'Admin', phone: null });
      if (url.includes('/recovery/requests')) return json({ requests: [] });
      return json({});
    }));
  });
  afterEach(() => { cleanup(); window.sessionStorage.clear(); vi.restoreAllMocks(); });

  it('renders account detail and returns to the list with SPA navigation', async () => {
    render(<ThemeProvider><MemoryRouter initialEntries={['/installation/organizations/1/clubs/2/recovery/accounts/7']}><Routes><Route path="*" element={<><InstallationRecoveryAccountPage /><LocationProbe /></>} /></Routes></MemoryRouter></ThemeProvider>);
    await screen.findByRole('heading', { name: 'Admin' });
    screen.getByRole('button', { name: 'К списку аккаунтов' }).click();
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/installation/organizations/1/clubs/2/recovery'));
  });
});
