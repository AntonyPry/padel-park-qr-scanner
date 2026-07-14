import { afterEach, describe, expect, it, vi } from 'vitest';
import { postScannerDiagnosticEvent } from './scanner-telemetry';

const payload = {
  eventType: 'serial_read_failed',
  severity: 'error' as const,
  source: 'web_serial' as const,
  clientEventId: 'scanner-event-1',
  metadata: {
    hadSuccessfulRead: false,
    reconnectAttempt: 0,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scanner telemetry', () => {
  it('posts a diagnostic event and returns the journal result', async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return new Response(JSON.stringify({ status: 'ok', eventId: 42 }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200,
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(postScannerDiagnosticEvent(payload)).resolves.toEqual({
      status: 'ok',
      eventId: 42,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/api\/scanner-events$/);
  });

  it('rejects an HTTP error so the caller can log lost telemetry', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'Журнал временно недоступен' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 503,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(postScannerDiagnosticEvent(payload)).rejects.toMatchObject({
      message: 'Журнал временно недоступен',
      name: 'ApiRequestError',
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
