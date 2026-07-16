import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { toast } from '@/components/ui/toast';
import {
  ShiftWorkspaceContext,
  type ShiftSession,
  type ShiftWorkspaceContextValue,
} from '@/components/shift-workspace-state';
import { apiFetch, getApiErrorMessage } from '@/lib/api';
import { useRealtimeRefresh } from '@/lib/realtime';

async function readResponseError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string; message?: string };
    return data.error || data.message || fallback;
  } catch {
    return fallback;
  }
}

export function ShiftWorkspaceProvider({ children }: { children: ReactNode }) {
  const [activeShift, setActiveShift] = useState<ShiftSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [starting, setStarting] = useState(false);
  const [statusError, setStatusError] = useState('');

  const refreshActiveShift = useCallback(async () => {
    try {
      const response = await apiFetch('/api/shifts/active');
      if (!response.ok) {
        setStatusError(
          await readResponseError(response, 'Не удалось проверить активную смену'),
        );
        return;
      }

      const data = (await response.json()) as { shift: ShiftSession | null };
      setActiveShift(data.shift);
      setStatusError('');
    } catch (error) {
      setStatusError(
        getApiErrorMessage(error, 'Не удалось проверить активную смену'),
      );
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshActiveShift();
  }, [refreshActiveShift]);

  useRealtimeRefresh(['shifts'], () => {
    void refreshActiveShift();
  });

  useEffect(() => {
    if (activeShift?.status !== 'active') return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [activeShift?.id, activeShift?.status]);

  const startShift = useCallback(async () => {
    setStarting(true);
    try {
      const response = await apiFetch('/api/shifts/start', { method: 'POST' });
      if (!response.ok) {
        toast.error(await readResponseError(response, 'Не удалось начать смену'));
        return;
      }

      const data = (await response.json()) as { shift: ShiftSession };
      setActiveShift(data.shift);
      setStatusError('');
      toast.success('Смена начата');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось начать смену'));
    } finally {
      setStarting(false);
    }
  }, []);

  const value = useMemo<ShiftWorkspaceContextValue>(
    () => ({
      activeShift,
      loaded,
      now,
      refreshActiveShift,
      setActiveShift,
      startShift,
      starting,
      statusError,
    }),
    [
      activeShift,
      loaded,
      now,
      refreshActiveShift,
      startShift,
      starting,
      statusError,
    ],
  );

  return (
    <ShiftWorkspaceContext.Provider value={value}>
      {children}
    </ShiftWorkspaceContext.Provider>
  );
}
