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

afterEach(() => {
  clearAuthToken();
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
});
