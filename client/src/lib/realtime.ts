import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from 'react';
import type { CrmChangedEvent } from '@/lib/realtime-invalidation';

export const REALTIME_BROWSER_EVENT_PREFIX = 'realtime:';
export const CRM_CHANGED_EVENT = 'crm:changed';

export type RealtimeStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface RealtimeContextValue {
  status: RealtimeStatus;
}

export const RealtimeContext = createContext<RealtimeContextValue>({
  status: 'idle',
});

export function emitRealtimeBrowserEvent<T>(eventName: string, detail: T) {
  window.dispatchEvent(
    new CustomEvent(`${REALTIME_BROWSER_EVENT_PREFIX}${eventName}`, { detail }),
  );
}

export function useRealtimeStatus() {
  return useContext(RealtimeContext).status;
}

export function useRealtimeEvent<T>(
  eventName: string,
  handler: (event: T) => void,
) {
  useEffect(() => {
    const listener = (event: Event) => {
      handler((event as CustomEvent<T>).detail);
    };

    window.addEventListener(
      `${REALTIME_BROWSER_EVENT_PREFIX}${eventName}`,
      listener,
    );

    return () => {
      window.removeEventListener(
        `${REALTIME_BROWSER_EVENT_PREFIX}${eventName}`,
        listener,
      );
    };
  }, [eventName, handler]);
}

export function useRealtimeRefresh(
  targets: string[],
  refresh: (event: CrmChangedEvent) => void,
) {
  const targetKey = targets.join('\u0000');
  const targetSet = useMemo(
    () => new Set(targetKey ? targetKey.split('\u0000') : []),
    [targetKey],
  );

  const handleChanged = useCallback(
    (event: CrmChangedEvent) => {
      const hintedGroups = event.hints?.queryGroups || [];
      if (
        targetSet.has(event.domain) ||
        hintedGroups.some((group) => targetSet.has(group))
      ) {
        refresh(event);
      }
    },
    [refresh, targetSet],
  );

  useRealtimeEvent<CrmChangedEvent>(CRM_CHANGED_EVENT, handleChanged);
}
