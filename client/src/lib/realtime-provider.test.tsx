import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/lib/auth-context';

const socketHarness = vi.hoisted(() => {
  class FakeSocket {
    auth: Record<string, unknown>;
    disconnectCalls = 0;
    handlers = new Map<string, Array<(value?: unknown) => void>>();
    constructor(auth: Record<string, unknown>) {
      this.auth = auth;
    }
    on(event: string, handler: (value?: unknown) => void) {
      const handlers = this.handlers.get(event) || [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
      return this;
    }
    connect() {
      return this;
    }
    disconnect() {
      this.disconnectCalls += 1;
      return this;
    }
    removeAllListeners() {
      this.handlers.clear();
      return this;
    }
    trigger(event: string, value?: unknown) {
      for (const handler of this.handlers.get(event) || []) handler(value);
    }
  }
  const sockets: FakeSocket[] = [];
  return { FakeSocket, sockets };
});

vi.mock('socket.io-client', () => ({
  io: vi.fn((_url: string, options: { auth: Record<string, unknown> }) => {
    const socket = new socketHarness.FakeSocket(options.auth);
    socketHarness.sockets.push(socket);
    return socket;
  }),
}));

import { setAuthToken } from '@/lib/api';
import { RealtimeProvider } from '@/lib/realtime-provider';

function authValue(clubId = 12, account = true): AuthContextValue {
  return {
    account: account
      ? { email: 'manager@test', id: 7, role: 'manager', status: 'active' }
      : null,
    bootstrap: vi.fn(),
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    setupRequired: false,
    tenantCacheRealtimeEnabled: true,
    tenantContext: account
      ? {
          clubId,
          effectiveRole: 'manager',
          membershipId: 21,
          membershipRole: 'manager',
          organizationId: 11,
        }
      : null,
    tenantContextEnabled: true,
    tenantDiscovery: null,
    tenantError: null,
    tenantReady: true,
    tenantSwitching: false,
    switchTenantContext: vi.fn(),
  };
}

function Harness({ value, client }: { value: AuthContextValue; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={value}>
        <RealtimeProvider><div>ready</div></RealtimeProvider>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  socketHarness.sockets.length = 0;
  setAuthToken('socket-test-token');
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('RealtimeProvider tenant lifecycle', () => {
  it('coalesces repeated reconnects into one background refresh without initial flicker', async () => {
    const client = new QueryClient();
    const refetch = vi.spyOn(client, 'refetchQueries').mockResolvedValue(undefined);
    render(<Harness value={authValue()} client={client} />);
    const socket = socketHarness.sockets[0];

    act(() => socket.trigger('connect'));
    expect(refetch).not.toHaveBeenCalled();
    act(() => {
      socket.trigger('disconnect');
      socket.trigger('connect');
      socket.trigger('connect');
      socket.trigger('connect');
      vi.advanceTimersByTime(250);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('disconnects the old socket and authenticates a new context with server-validated preferences', () => {
    const client = new QueryClient();
    const view = render(<Harness value={authValue(12)} client={client} />);
    const oldSocket = socketHarness.sockets[0];

    view.rerender(<Harness value={authValue(13)} client={client} />);

    expect(oldSocket.disconnectCalls).toBeGreaterThan(0);
    expect(socketHarness.sockets).toHaveLength(2);
    expect(socketHarness.sockets[1].auth).toMatchObject({
      clubId: 13,
      organizationId: 11,
      token: 'socket-test-token',
    });
  });

  it('logout during reconnect clears timers and never starts a refetch loop', () => {
    const client = new QueryClient();
    const refetch = vi.spyOn(client, 'refetchQueries').mockResolvedValue(undefined);
    const view = render(<Harness value={authValue()} client={client} />);
    const socket = socketHarness.sockets[0];
    act(() => {
      socket.trigger('connect');
      socket.trigger('disconnect');
      socket.trigger('connect');
    });

    view.rerender(<Harness value={authValue(12, false)} client={client} />);
    act(() => vi.runAllTimers());

    expect(socket.disconnectCalls).toBeGreaterThan(0);
    expect(refetch).not.toHaveBeenCalled();
  });
});
