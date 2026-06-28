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
  type CrmChangedEvent,
} from '@/lib/realtime-invalidation';
import { useAuth } from '@/lib/useAuth';

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { account } = useAuth();
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const invalidationTimerRef = useRef<number | null>(null);
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
    if (!account || !getAuthToken()) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      window.queueMicrotask(() => setStatus('idle'));
      return;
    }

    const socket = io(API_URL, {
      autoConnect: false,
      auth: { token: getAuthToken() },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;
    window.queueMicrotask(() => setStatus('connecting'));

    socket.on('connect', () => {
      setStatus('connected');
      void queryClient.refetchQueries({ type: 'active' });
      emitRealtimeBrowserEvent('crm:reconnected', { at: new Date().toISOString() });
    });

    socket.on('disconnect', () => {
      setStatus('disconnected');
    });

    socket.on('connect_error', () => {
      setStatus('error');
    });

    socket.on(CRM_CHANGED_EVENT, (event: CrmChangedEvent) => {
      queueInvalidations(event);
      emitRealtimeBrowserEvent(CRM_CHANGED_EVENT, event);
    });

    socket.on('scan_result', (event) => {
      emitRealtimeBrowserEvent('scan_result', event);
    });

    socket.connect();

    return () => {
      if (invalidationTimerRef.current) {
        window.clearTimeout(invalidationTimerRef.current);
        invalidationTimerRef.current = null;
      }
      socket.removeAllListeners();
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [account, queryClient, queueInvalidations]);

  const value = useMemo(() => ({ status }), [status]);

  return (
    <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
  );
}
