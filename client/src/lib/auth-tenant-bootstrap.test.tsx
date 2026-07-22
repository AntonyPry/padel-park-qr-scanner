import { useEffect, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from '@/components/AuthGate';
import { apiFetch, clearAuthToken, setAuthToken } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';
import { useAuth, useAuthorizationRole } from '@/lib/useAuth';
import { queryClient } from '@/lib/query-client';
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
  const membershipRole = useAuthorizationRole('membership');
  const clubRole = useAuthorizationRole('club');
  useEffect(() => {
    if (tenantReady) void apiFetch('/api/bookings/schedule');
  }, [tenantReady]);
  return (
    <div>
      ready:{String(tenantReady)} role:{currentAccount?.role} membership:{membershipRole}{' '}
      clubRole:{clubRole} club:{tenantContext?.clubId}
    </div>
  );
}

function SessionProbe() {
  const {
    account: currentAccount,
    logout,
    switchTenantContext,
    tenantContext,
  } = useAuth();
  return (
    <div>
      <span>
        session:{currentAccount?.email} club:{tenantContext?.clubId}
      </span>
      <button type="button" onClick={logout}>logout-probe</button>
      <button type="button" onClick={() => void apiFetch('/api/bookings/schedule')}>
        unauthorized-probe
      </button>
      <button type="button" onClick={() => void switchTenantContext(11, 13)}>
        switch-probe
      </button>
    </div>
  );
}

function DraftProbe() {
  const { switchTenantContext, tenantContext } = useAuth();
  const [draft, setDraft] = useState('');

  return (
    <div>
      <span>
        draft-club:{tenantContext?.clubId} effective:{tenantContext?.effectiveRole}
      </span>
      <label htmlFor="tenant-draft">Черновик клиента</label>
      <input
        id="tenant-draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="button" onClick={() => void switchTenantContext(11, 13)}>
        switch-draft-probe
      </button>
    </div>
  );
}

function installSessionFetch(options: { discoveryStatus?: number; onDiscovery?: () => void } = {}) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/auth/status')) {
      return Response.json({ capabilities: { tenantContext: true }, setupRequired: false });
    }
    if (url.endsWith('/api/auth/me')) return Response.json({ account });
    if (url.endsWith('/api/auth/logout')) return Response.json({ success: true });
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

async function seedCompletedTenantMutation(label: string) {
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationFn: async (variables: { organizationId: number; payload: string }) => ({
      organizationId: variables.organizationId,
      result: `${label}-result`,
    }),
    mutationKey: ['bookings', 'save', label],
  });
  await mutation.execute({
    organizationId: 1001,
    payload: `${label}-sensitive-draft`,
  });
  expect(mutation.state).toMatchObject({
    data: { organizationId: 1001, result: `${label}-result` },
    status: 'success',
    variables: {
      organizationId: 1001,
      payload: `${label}-sensitive-draft`,
    },
  });
  return mutation;
}

afterEach(() => {
  cleanup();
  clearAuthToken();
  queryClient.clear();
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
    expect(
      await screen.findByText(
        'ready:true role:manager membership:manager clubRole:manager club:12',
      ),
    ).toBeInTheDocument();
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

    expect(
      await screen.findByText(
        'ready:true role:manager membership:manager clubRole:manager club:',
      ),
    ).toBeInTheDocument();
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
    const fetchMock = installSessionFetch();
    vi.stubGlobal('fetch', fetchMock);

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
    await seedCompletedTenantMutation('logout');
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'logout-probe' }));

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(getActiveTenantContext()).toBeNull();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).endsWith('/api/auth/logout')),
      ).toBe(true);
    });
    const logoutCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/api/auth/logout'));
    expect(logoutCall?.[1]?.method).toBe('POST');
    expect(new Headers(logoutCall?.[1]?.headers).get('Authorization')).toBe(
      'Bearer test-token',
    );
  });

  it('aborts an in-flight tenant request on explicit logout', async () => {
    setAuthToken('test-token');
    let tenantRequestAborted = false;
    let markTenantRequestStarted!: () => void;
    const tenantRequestStarted = new Promise<void>((resolve) => {
      markTenantRequestStarted = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/auth/status')) {
          return Response.json({ capabilities: { tenantContext: true }, setupRequired: false });
        }
        if (url.endsWith('/api/auth/me')) return Response.json({ account });
        if (url.endsWith('/api/auth/logout')) return Response.json({ success: true });
        if (url.endsWith('/api/auth/me/memberships')) return Response.json(discovery);
        if (url.endsWith('/api/bookings/schedule')) {
          return new Promise<Response>((_resolve, reject) => {
            markTenantRequestStarted();
            init?.signal?.addEventListener('abort', () => {
              tenantRequestAborted = true;
              reject(new DOMException('Tenant request aborted', 'AbortError'));
            });
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

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
    const pendingTenantRequest = apiFetch('/api/bookings/schedule').catch((error) => error);
    await tenantRequestStarted;
    fireEvent.click(screen.getByRole('button', { name: 'logout-probe' }));

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(tenantRequestAborted).toBe(true);
    expect(await pendingTenantRequest).toMatchObject({ name: 'AbortError' });
  });

  it('re-discovers authority before switching to one exact club', async () => {
    setAuthToken('test-token');
    let discoveryCalls = 0;
    let tenantRequestAborted = false;
    let markTenantRequestStarted!: () => void;
    const tenantRequestStarted = new Promise<void>((resolve) => {
      markTenantRequestStarted = resolve;
    });
    const multiClubDiscovery = {
      ...discovery,
      memberships: [
        {
          ...discovery.memberships[0],
          clubs: [
            discovery.memberships[0].clubs[0],
            {
              effectiveRole: 'trainer',
              id: 13,
              name: 'Second club',
              slug: 'second-club',
              timezone: 'Europe/Moscow',
            },
          ],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/auth/status')) {
          return Response.json({
            capabilities: { tenantCacheRealtime: true, tenantContext: true },
            setupRequired: false,
          });
        }
        if (url.endsWith('/api/auth/me')) return Response.json({ account });
        if (url.endsWith('/api/auth/me/memberships')) {
          discoveryCalls += 1;
          return Response.json(multiClubDiscovery);
        }
        if (url.endsWith('/api/bookings/schedule')) {
          return new Promise<Response>((_resolve, reject) => {
            markTenantRequestStarted();
            init?.signal?.addEventListener('abort', () => {
              tenantRequestAborted = true;
              reject(new DOMException('Tenant request aborted', 'AbortError'));
            });
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

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
    const pendingTenantRequest = apiFetch('/api/bookings/schedule').catch((error) => error);
    await tenantRequestStarted;
    fireEvent.click(screen.getByRole('button', { name: 'switch-probe' }));

    expect(
      await screen.findByText('session:manager@padelpark.demo club:13'),
    ).toBeInTheDocument();
    expect(tenantRequestAborted).toBe(true);
    expect(await pendingTenantRequest).toMatchObject({ name: 'AbortError' });
    expect(discoveryCalls).toBe(2);
    expect(getActiveTenantContext()).toMatchObject({
      clubId: 13,
      effectiveRole: 'trainer',
      membershipId: 21,
      membershipRole: 'manager',
      organizationId: 11,
    });
  });

  it('unmounts tenant drafts and applies a fresh downgraded role before remount', async () => {
    setAuthToken('test-token');
    let discoveryCalls = 0;
    let releaseSwitchDiscovery!: () => void;
    const switchDiscoveryGate = new Promise<void>((resolve) => {
      releaseSwitchDiscovery = resolve;
    });
    const targetClub = {
      effectiveRole: 'manager' as const,
      id: 13,
      name: 'Second club',
      slug: 'second-club',
      timezone: 'Europe/Moscow',
    };
    const initialDiscovery = {
      ...discovery,
      memberships: [
        {
          ...discovery.memberships[0],
          clubs: [discovery.memberships[0].clubs[0], targetClub],
        },
      ],
    };
    const downgradedDiscovery = {
      ...initialDiscovery,
      memberships: [
        {
          ...initialDiscovery.memberships[0],
          clubs: [
            discovery.memberships[0].clubs[0],
            { ...targetClub, effectiveRole: 'viewer' as const },
          ],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/auth/status')) {
          return Response.json({
            capabilities: { tenantCacheRealtime: true, tenantContext: true },
            setupRequired: false,
          });
        }
        if (url.endsWith('/api/auth/me')) return Response.json({ account });
        if (url.endsWith('/api/auth/me/memberships')) {
          discoveryCalls += 1;
          if (discoveryCalls === 1) return Response.json(initialDiscovery);
          await switchDiscoveryGate;
          return Response.json(downgradedDiscovery);
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    render(
      <AuthProvider>
        <AuthGate>
          <DraftProbe />
        </AuthGate>
      </AuthProvider>,
    );

    expect(
      await screen.findByText('draft-club:12 effective:manager'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Черновик клиента'), {
      target: { value: 'Не должен перейти в другой клуб' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'switch-draft-probe' }));

    expect(await screen.findByText('Переключаем клуб...')).toBeInTheDocument();
    expect(screen.queryByLabelText('Черновик клиента')).not.toBeInTheDocument();
    expect(screen.queryByText(/Не должен перейти/)).not.toBeInTheDocument();

    releaseSwitchDiscovery();
    expect(
      await screen.findByText('draft-club:13 effective:viewer'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Черновик клиента')).toHaveValue('');
    expect(discoveryCalls).toBe(2);
    expect(getActiveTenantContext()).toMatchObject({
      clubId: 13,
      effectiveRole: 'viewer',
      organizationId: 11,
    });
  });

  it('fails closed when fresh discovery revokes the requested club', async () => {
    setAuthToken('test-token');
    let discoveryCalls = 0;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const targetClub = {
      effectiveRole: 'trainer' as const,
      id: 13,
      name: 'Revoked club',
      slug: 'revoked-club',
      timezone: 'Europe/Moscow',
    };
    const initialDiscovery = {
      ...discovery,
      memberships: [
        {
          ...discovery.memberships[0],
          clubs: [discovery.memberships[0].clubs[0], targetClub],
        },
      ],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/auth/status')) {
          return Response.json({
            capabilities: { tenantCacheRealtime: true, tenantContext: true },
            setupRequired: false,
          });
        }
        if (url.endsWith('/api/auth/me')) return Response.json({ account });
        if (url.endsWith('/api/auth/me/memberships')) {
          discoveryCalls += 1;
          return Response.json(discoveryCalls === 1 ? initialDiscovery : discovery);
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );

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
    await seedCompletedTenantMutation('revoked-switch');
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'switch-probe' }));

    expect(
      await screen.findByRole('heading', { name: 'Контекст клуба недоступен' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Выбранный клуб больше недоступен/)).toBeInTheDocument();
    expect(screen.queryByText('session:manager@padelpark.demo club:12')).not.toBeInTheDocument();
    expect(getActiveTenantContext()).toBeNull();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(discoveryCalls).toBe(2);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('keeps Account.role as identity while exposing separate membership and club roles', async () => {
    setAuthToken('test-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/auth/status')) {
          return Response.json({ capabilities: { tenantContext: true }, setupRequired: false });
        }
        if (url.endsWith('/api/auth/me')) {
          return Response.json({ account: { ...account, role: 'trainer' } });
        }
        if (url.endsWith('/api/auth/me/memberships')) {
          return Response.json({
            ...discovery,
            memberships: [
              {
                ...discovery.memberships[0],
                clubs: [
                  { ...discovery.memberships[0].clubs[0], effectiveRole: 'manager' },
                ],
                role: 'trainer',
              },
            ],
          });
        }
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

    expect(
      await screen.findByText(
        'ready:true role:trainer membership:trainer clubRole:manager club:12',
      ),
    ).toBeInTheDocument();
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
    await seedCompletedTenantMutation('expired');
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'unauthorized-probe' }));

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(getActiveTenantContext()).toBeNull();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it('clears completed mutation state after a non-OK auth refresh', async () => {
    setAuthToken('test-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/auth/status')) {
          return Response.json({ capabilities: { tenantContext: true }, setupRequired: false });
        }
        if (url.endsWith('/api/auth/me')) {
          return Response.json({ error: 'Session revoked' }, { status: 403 });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    await seedCompletedTenantMutation('auth-refresh-failure');
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);

    render(
      <AuthProvider>
        <AuthGate>
          <SessionProbe />
        </AuthGate>
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeInTheDocument();
    expect(getActiveTenantContext()).toBeNull();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
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
    await seedCompletedTenantMutation('initialization-failure');
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);

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
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
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
