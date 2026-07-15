import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from '@/config';
import { getAuthToken } from '@/lib/api';
import {
  CRM_CHANGED_EVENT,
  RealtimeContext,
  emitRealtimeBrowserEvent,
  type RealtimeStatus,
} from '@/lib/realtime';
import {
  getRealtimeQueryKeys,
  isRealtimeEventForActiveTenant,
  type CrmChangedEvent,
} from '@/lib/realtime-invalidation';
import { useAuth } from '@/lib/useAuth';

const REALTIME_DISABLED = import.meta.env.VITE_DISABLE_REALTIME === 'true';

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const {
    account,
    tenantCacheRealtimeEnabled,
    tenantContext,
    tenantReady,
  } = useAuth();
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const connectTimerRef = useRef<number | null>(null);
  const invalidationTimerRef = useRef<number | null>(null);
  const reconnectRefreshTimerRef = useRef<number | null>(null);
  const pendingKeysRef = useRef<Map<string, readonly unknown[]>>(new Map());
  const [status, setStatus] = useState<RealtimeStatus>('idle');

  const flushInvalidations = useCallback(() => {
    const keys = Array.from(pendingKeysRef.current.values());
    pendingKeysRef.current.clear();
    invalidationTimerRef.current = null;

    keys.forEach((queryKey) => {
      void queryClient.invalidateQueries({ queryKey });
    });
  }, [queryClient]);

  const queueInvalidations = useCallback(
    (event: CrmChangedEvent) => {
      getRealtimeQueryKeys(event).forEach((queryKey) => {
        pendingKeysRef.current.set(JSON.stringify(queryKey), queryKey);
      });

      if (invalidationTimerRef.current) {
        window.clearTimeout(invalidationTimerRef.current);
      }
      invalidationTimerRef.current = window.setTimeout(flushInvalidations, 250);
    },
    [flushInvalidations],
  );

  useEffect(() => {
    const pendingKeys = pendingKeysRef.current;
    if (REALTIME_DISABLED || !account || !getAuthToken() || !tenantReady) {
      if (connectTimerRef.current) {
        window.clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
      socketRef.current?.disconnect();
      socketRef.current = null;
      window.queueMicrotask(() => setStatus('idle'));
      return;
    }

    const socket = io(API_URL, {
      autoConnect: false,
      auth: {
        token: getAuthToken(),
        ...(tenantCacheRealtimeEnabled && tenantContext
          ? {
              clubId: tenantContext.clubId,
              organizationId: tenantContext.organizationId,
            }
          : {}),
      },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      transports: ['websocket'],
    });

    socketRef.current = socket;
    window.queueMicrotask(() => setStatus('connecting'));
    let hasConnected = false;

    socket.on('connect', () => {
      setStatus('connected');
      if (hasConnected && reconnectRefreshTimerRef.current === null) {
        reconnectRefreshTimerRef.current = window.setTimeout(() => {
          reconnectRefreshTimerRef.current = null;
          void queryClient.refetchQueries({ type: 'active' });
          emitRealtimeBrowserEvent('crm:reconnected', {
            at: new Date().toISOString(),
          });
        }, 250);
      }
      hasConnected = true;
    });

    socket.on('disconnect', () => {
      setStatus('disconnected');
    });

    socket.on('connect_error', () => {
      setStatus('error');
    });

    socket.on(CRM_CHANGED_EVENT, (event: CrmChangedEvent) => {
      if (!isRealtimeEventForActiveTenant(event)) return;
      queueInvalidations(event);
      emitRealtimeBrowserEvent(CRM_CHANGED_EVENT, event);
    });

    socket.on('scan_result', (event) => {
      if (tenantCacheRealtimeEnabled) {
        if (!isRealtimeEventForActiveTenant(event)) return;
        emitRealtimeBrowserEvent('scan_result', event.data);
        return;
      }
      emitRealtimeBrowserEvent('scan_result', event);
    });

    connectTimerRef.current = window.setTimeout(() => {
      connectTimerRef.current = null;
      if (socketRef.current === socket) {
        socket.connect();
      }
    }, 150);

    return () => {
      if (connectTimerRef.current) {
        window.clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
      if (invalidationTimerRef.current) {
        window.clearTimeout(invalidationTimerRef.current);
        invalidationTimerRef.current = null;
      }
      if (reconnectRefreshTimerRef.current) {
        window.clearTimeout(reconnectRefreshTimerRef.current);
        reconnectRefreshTimerRef.current = null;
      }
      pendingKeys.clear();
      socket.removeAllListeners();
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [
    account,
    queryClient,
    queueInvalidations,
    tenantCacheRealtimeEnabled,
    tenantContext,
    tenantReady,
  ]);

  const value = useMemo(() => ({ status }), [status]);

  return (
    <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
  );
}
