import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from '@/components/AuthGate';
import { apiFetch, clearAuthToken, setAuthToken } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';
import { useAuth } from '@/lib/useAuth';
import { getActiveTenantContext } from '@/lib/tenant-context';

const account = {
  email: 'manager@padelpark.demo',
  id: 7,
  role: 'manager' as const,
  status: 'active' as const,
};

const discovery = {
  memberships: [
    {
      clubs: [
        {
          effectiveRole: 'manager',
          id: 12,
          name: 'Padel Park',
          slug: 'padel-park',
          timezone: 'Europe/Moscow',
        },
      ],
      id: 21,
      organization: { id: 11, name: 'Padel Park', slug: 'padel-park' },
      role: 'manager',
    },
  ],
  recommendedContext: {
    clubId: 12,
    effectiveRole: 'manager',
    membershipId: 21,
    organizationId: 11,
  },
};

function DomainProbe() {
  const { account: currentAccount, tenantContext, tenantReady } = useAuth();
  useEffect(() => {
    if (tenantReady) void apiFetch('/api/bookings/schedule');
  }, [tenantReady]);
  return (
    <div>
      ready:{String(tenantReady)} role:{currentAccount?.role} club:{tenantContext?.clubId}
    </div>
  );
}

function SessionProbe() {
  const { account: currentAccount, logout, tenantContext } = useAuth();
  return (
    <div>
      <span>
        session:{currentAccount?.email} club:{tenantContext?.clubId}
      </span>
      <button type="button" onClick={logout}>logout-probe</button>
      <button type="button" onClick={() => void apiFetch('/api/bookings/schedule')}>
        unauthorized-probe
      </button>
    </div>
  );
}

function installSessionFetch(options: { discoveryStatus?: number; onDiscovery?: () => void } = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/auth/status')) {
      return Response.json({ capabilities: { tenantContext: true }, setupRequired: false });
    }
    if (url.endsWith('/api/auth/me')) return Response.json({ account });
    if (url.endsWith('/api/auth/me/memberships')) {
      options.onDiscovery?.();
      if (options.discoveryStatus && options.discoveryStatus !== 200) {
        return Response.json(
          { error: 'Tenant context unavailable', status: options.discoveryStatus },
          { status: options.discoveryStatus },
        );
      }
      return Response.json(discovery);
    }
    if (url.endsWith('/api/bookings/schedule')) {
      return Response.json({ error: 'Unauthorized', status: 401 }, { status: 401 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

afterEach(() => {
  cleanup();
  clearAuthToken();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AuthProvider tenant bootstrap', () => {
  it('runs session -> discovery -> context ready before the first domain request', async () => {
    setAuthToken('test-token');
    let releaseDiscovery!: () => void;
    const discoveryGate = new Promise<void>((resolve) => {
      releaseDiscovery = resolve;
    });
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ init, url });
        if (url.endsWith('/api/auth/status')) {
          return Response.json({
            capabilities: { tenantContext: true },
            setupRequired: false,
          });
        }
        if (url.endsWith('/api/auth/me')) {
          return Response.json({ account });
        }
        if (url.endsWith('/api/auth/me/memberships')) {
          await discoveryGate;
          return Response.json(discovery);
        }
        if (url.endsWith('/api/bookings/schedule')) {
          return Response.json({ courts: [] });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(
      <AuthProvider>
        <AuthGate>
          <DomainProbe />
        </AuthGate>
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(calls.some((call) => call.url.endsWith('/api/auth/me/memberships'))).toBe(true);
    });
    expect(calls.some((call) => call.url.endsWith('/api/bookings/schedule'))).toBe(false);
    expect(screen.getByText('Загрузка...')).toBeInTheDocument();

    releaseDiscovery();
    expect(await screen.findByText('ready:true role:manager club:12')).toBeInTheDocument();
    await waitFor(() => {
      expect(calls.some((call) => call.url.endsWith('/api/bookings/schedule'))).toBe(true);
    });

    const discoveryCall = calls.find((call) => call.url.endsWith('/api/auth/me/memberships'));
    const domainCall = calls.find((call) => call.url.endsWith('/api/bookings/schedule'));
    const discoveryHeaders = new Headers(discoveryCall?.init?.headers);
    const domainHeaders = new Headers(domainCall?.init?.headers);
    expect(discoveryHeaders.has('X-Organization-Id')).toBe(false);
    expect(discoveryHeaders.has('X-Club-Id')).toBe(false);
    expect(domainHeaders.get('X-Organization-Id')).toBe('11');
    expect(domainHeaders.get('X-Club-Id')).toBe('12');
  });

  it('keeps the exact legacy transport when the server capability is off', async () => {
    setAuthToken('test-token');
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ init, url });
        if (url.endsWith('/api/auth/status')) {
          return Response.json({
            capabilities: { tenantContext: false },
            setupRequired: false,
          });
        }
        if (url.endsWith('/api/auth/me')) return Response.json({ account });
        if (url.endsWith('/api/bookings/schedule')) return Response.json({ courts: [] });
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(
      <AuthProvider>
        <AuthGate>
          <DomainProbe />
        </AuthGate>
      </AuthProvider>,
    );

    expect(await screen.findByText('ready:true role:manager club:')).toBeInTheDocument();
    await waitFor(() => {
      expect(calls.some((call) => call.url.endsWith('/api/bookings/schedule'))).toBe(true);
    });
    expect(calls.some((call) => call.url.endsWith('/api/auth/me/memberships'))).toBe(false);
    const domainCall = calls.find((call) => call.url.endsWith('/api/bookings/schedule'));
    const headers = new Headers(domainCall?.init?.headers);
    expect(headers.has('X-Organization-Id')).toBe(false);
    expect(headers.has('X-Club-Id')).toBe(false);
  });

  it('clears the active context on explicit logout', async () => {
    setAuthToken('test-token');
    vi.stubGlobal('fetch', installSessionFetch());

    render(
      <AuthProvider>
        <AuthGate>
          <SessionProbe />
        </AuthGate>
      </AuthProvider>,
    );

    expect(
      await screen.findByText('session:manager@padelpark.demo club:12'),
    ).toBeInTheDocument();
    expect(getActiveTenantContext()?.clubId).toBe(12);
    fireEvent.click(screen.getByRole('button', { name: 'logout-probe' }));

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(getActiveTenantContext()).toBeNull();
  });

  it('clears the active context after a tenant request returns 401', async () => {
    setAuthToken('test-token');
    vi.stubGlobal('fetch', installSessionFetch());

    render(
      <AuthProvider>
        <AuthGate>
          <SessionProbe />
        </AuthGate>
      </AuthProvider>,
    );

    expect(
      await screen.findByText('session:manager@padelpark.demo club:12'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'unauthorized-probe' }));

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(getActiveTenantContext()).toBeNull();
  });

  it('does not retry or redirect-loop when discovery safely denies context', async () => {
    setAuthToken('test-token');
    let discoveryCalls = 0;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      installSessionFetch({
        discoveryStatus: 404,
        onDiscovery: () => {
          discoveryCalls += 1;
        },
      }),
    );

    render(
      <AuthProvider>
        <AuthGate>
          <SessionProbe />
        </AuthGate>
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
    await waitFor(() => expect(discoveryCalls).toBe(1));
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(getActiveTenantContext()).toBeNull();
  });

  it('keeps an already ready session visible across a parent background rerender', async () => {
    setAuthToken('test-token');
    let discoveryCalls = 0;
    vi.stubGlobal(
      'fetch',
      installSessionFetch({
        onDiscovery: () => {
          discoveryCalls += 1;
        },
      }),
    );

    const view = render(
      <AuthProvider>
        <AuthGate>
          <SessionProbe />
        </AuthGate>
      </AuthProvider>,
    );
    const session = await screen.findByText('session:manager@padelpark.demo club:12');

    view.rerender(
      <AuthProvider>
        <AuthGate>
          <SessionProbe />
        </AuthGate>
      </AuthProvider>,
    );

    expect(session).toBeVisible();
    expect(screen.queryByText('Загрузка...')).not.toBeInTheDocument();
    expect(discoveryCalls).toBe(1);
  });
});
