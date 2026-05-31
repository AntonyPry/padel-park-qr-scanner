import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  apiRequest,
  ApiRequestError,
  clearAuthToken,
  setAuthToken,
  setStoredTrainingMode,
} from './api';

afterEach(() => {
  clearAuthToken();
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
});
