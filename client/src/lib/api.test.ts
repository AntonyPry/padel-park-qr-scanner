import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyOnboardingProgressResponse,
  apiFetch,
  apiRequest,
  ApiRequestError,
  clearAuthToken,
  setAuthToken,
  setStoredTrainingMode,
} from './api';
import {
  activateOnboardingQuest,
  clearStoredActiveOnboardingQuest,
  getStoredActiveOnboardingQuest,
  ONBOARDING_COMPLETED_TASKS_HEADER,
  ONBOARDING_PROGRESSED_TASKS_HEADER,
} from './onboarding-quest';
import {
  selectTenantContext,
  setTenantContextCapability,
} from './tenant-context';

afterEach(() => {
  clearAuthToken();
  document.cookie = 'setly_csrf=; Max-Age=0';
  clearStoredActiveOnboardingQuest();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('adds auth token and parses successful json response', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    setAuthToken('test-token');

    await expect(apiRequest<{ ok: boolean }>('/api/example')).resolves.toEqual({
      ok: true,
    });

    const [, init] = fetchMock.mock.calls[0] || [];
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-token');
    expect(init?.credentials).toBe('include');
    expect(localStorage.getItem('padel_park_auth_token')).toBeNull();
  });

  it('sends the browser CSRF double-submit header for unsafe requests', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    document.cookie = 'setly_csrf=csrf-test-token';

    await apiFetch('/api/example', { method: 'POST', body: '{}' });

    const [, init] = fetchMock.mock.calls[0] || [];
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-test-token');
    expect(init?.credentials).toBe('include');
  });

  it('throws typed error with server message when request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'Некорректные данные' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 409,
        }),
      ),
    );

    await expect(apiRequest('/api/example')).rejects.toMatchObject({
      message: 'Некорректные данные',
      name: 'ApiRequestError',
      status: 409,
    } satisfies Partial<ApiRequestError>);
  });

  it('adds training mode headers when enabled locally', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    setStoredTrainingMode({ isEnabled: true, role: 'admin' });

    await apiRequest('/api/example');

    const [, init] = fetchMock.mock.calls[0] || [];
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Training-Mode')).toBe('true');
    expect(headers.get('X-Training-Role')).toBe('admin');
  });

  it('adds exact quest context only on its CRM route and clears on confirmed progress', async () => {
    window.history.replaceState(null, '', '/admin/clients');
    setTenantContextCapability(true);
    selectTenantContext({
      memberships: [{
        clubs: [{
          effectiveRole: 'admin',
          id: 12,
          name: 'First club',
          slug: 'first-club',
          timezone: 'Europe/Moscow',
        }],
        id: 21,
        organization: { id: 11, name: 'First org', slug: 'first-org' },
        role: 'admin',
      }],
      recommendedContext: {
        clubId: 12,
        effectiveRole: 'admin',
        membershipId: 21,
        organizationId: 11,
      },
    });
    activateOnboardingQuest(
      {
        key: 'admin.client.create',
        route: '/admin/clients',
        title: 'Создать клиента из обращения',
      },
      'admin',
    );
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return new Response(JSON.stringify({ ok: true }), {
          headers: {
            'Content-Type': 'application/json',
            [ONBOARDING_PROGRESSED_TASKS_HEADER]: 'admin.client.create',
          },
          status: 201,
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/clients', { method: 'POST', body: '{}' });

    const [, init] = fetchMock.mock.calls[0] || [];
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Onboarding-Quest-Task-Key')).toBe(
      'admin.client.create',
    );
    expect(headers.get('X-Onboarding-Quest-Role')).toBe('admin');
    expect(headers.get('X-Organization-Id')).toBe('11');
    expect(headers.has('X-Club-Id')).toBe(false);
    expect(getStoredActiveOnboardingQuest()).toBeNull();
  });

  it('keeps failed or unrelated quests and does not send stale context off-route', async () => {
    window.history.replaceState(null, '', '/admin/bookings');
    activateOnboardingQuest(
      {
        key: 'admin.client.create',
        route: '/admin/clients',
        title: 'Создать клиента из обращения',
      },
      'admin',
    );
    const response = new Response(JSON.stringify({ error: 'Ошибка' }), {
      headers: {
        [ONBOARDING_COMPLETED_TASKS_HEADER]: 'admin.client.create',
      },
      status: 422,
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return response;
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/clients');
    applyOnboardingProgressResponse(response);

    const [, init] = fetchMock.mock.calls[0] || [];
    const headers = new Headers(init?.headers);
    expect(headers.has('X-Onboarding-Quest-Task-Key')).toBe(false);
    expect(getStoredActiveOnboardingQuest()).not.toBeNull();
  });

  it('does not send quest headers for a late ordinary create after abandonment', async () => {
    window.history.replaceState(null, '', '/admin/clients');
    activateOnboardingQuest(
      {
        key: 'admin.client.create',
        route: '/admin/clients',
        title: 'Создать клиента из обращения',
      },
      'admin',
    );
    clearStoredActiveOnboardingQuest();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
          status: 201,
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/clients', { method: 'POST', body: '{}' });

    const [, init] = fetchMock.mock.calls[0] || [];
    const headers = new Headers(init?.headers);
    expect(headers.has('X-Onboarding-Quest-Task-Key')).toBe(false);
    expect(headers.has('X-Onboarding-Quest-Role')).toBe(false);
    expect(getStoredActiveOnboardingQuest()).toBeNull();
  });
});
