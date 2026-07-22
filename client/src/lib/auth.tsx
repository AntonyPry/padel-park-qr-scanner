import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  apiFetch,
  clearAuthToken,
  revokeCurrentAuthSession,
  setAuthToken,
} from '@/lib/api';
import {
  AuthContext,
  type Account,
  type BootstrapData,
  type Credentials,
} from '@/lib/auth-context';
import {
  clearActiveTenantContext,
  cancelTenantSensitiveRequests,
  activateTenantContext,
  findDiscoveredTenantContext,
  getActiveTenantContext,
  isTenantCacheRealtimeCapabilityEnabled,
  selectTenantContext,
  setTenantCacheRealtimeCapability,
  setTenantContextCapability,
  type ActiveTenantContext,
  type TenantDiscoveryResponse,
} from '@/lib/tenant-context';
import {
  beginTenantContextTransition,
  clearTenantClientState,
  queryClient,
  transitionTenantQueryCache,
} from '@/lib/query-client';

interface ServerCapabilities {
  tenantCacheRealtime?: boolean;
  tenantContext?: boolean;
}

async function readError(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [tenantContext, setTenantContext] = useState<ActiveTenantContext | null>(null);
  const [tenantDiscovery, setTenantDiscovery] = useState<TenantDiscoveryResponse | null>(null);
  const [tenantCacheRealtimeEnabled, setTenantCacheRealtimeEnabled] = useState(false);
  const [tenantContextEnabled, setTenantContextEnabled] = useState(false);
  const [tenantError, setTenantError] = useState<string | null>(null);
  const [tenantReady, setTenantReady] = useState(true);
  const [tenantSwitching, setTenantSwitching] = useState(false);
  const tenantSwitchLockRef = useRef(false);

  const initializeTenantContext = useCallback(
    async (identityAccount: Account, capabilities: ServerCapabilities = {}) => {
      const contextEnabled = Boolean(capabilities.tenantContext);
      const cacheRealtimeEnabled = Boolean(capabilities.tenantCacheRealtime);
      const previousContext = getActiveTenantContext();
      const previousCacheRealtimeEnabled = isTenantCacheRealtimeCapabilityEnabled();
      setTenantContextCapability(contextEnabled);
      setTenantCacheRealtimeCapability(cacheRealtimeEnabled);
      setTenantContextEnabled(contextEnabled);
      setTenantCacheRealtimeEnabled(cacheRealtimeEnabled);
      if (!contextEnabled) {
        if (previousCacheRealtimeEnabled !== cacheRealtimeEnabled) {
          await clearTenantClientState(queryClient);
        } else {
          await transitionTenantQueryCache(queryClient, previousContext, null);
        }
        clearActiveTenantContext();
        setTenantContext(null);
        setTenantDiscovery(null);
        setTenantError(null);
        setTenantReady(true);
        return identityAccount;
      }

      setTenantReady(false);
      const response = await apiFetch('/api/auth/me/memberships');
      if (!response.ok) {
        throw new Error(await readError(response, 'Не удалось загрузить доступный клуб'));
      }
      const discovery = (await response.json()) as TenantDiscoveryResponse;
      const selected = selectTenantContext(discovery);
      if (previousCacheRealtimeEnabled !== cacheRealtimeEnabled) {
        await clearTenantClientState(queryClient);
      } else {
        await transitionTenantQueryCache(queryClient, previousContext, selected);
      }
      setTenantContext(selected);
      setTenantDiscovery(discovery);
      setTenantError(null);
      setTenantReady(true);
      return identityAccount;
    },
    [],
  );

  const switchTenantContext = useCallback(async (organizationId: number, clubId: number) => {
    if (!tenantContextEnabled || tenantSwitchLockRef.current) return;
    if (
      tenantContext?.organizationId === organizationId &&
      tenantContext.clubId === clubId
    ) {
      return;
    }

    tenantSwitchLockRef.current = true;
    setTenantSwitching(true);
    setTenantReady(false);
    setTenantError(null);
    cancelTenantSensitiveRequests();
    clearActiveTenantContext();
    setTenantContext(null);

    try {
      await beginTenantContextTransition(queryClient);
      const response = await apiFetch('/api/auth/me/memberships');
      if (!response.ok) {
        throw new Error(await readError(response, 'Не удалось перепроверить доступные клубы'));
      }
      const discovery = (await response.json()) as TenantDiscoveryResponse;
      const selected = findDiscoveredTenantContext(discovery, { organizationId, clubId });
      if (!selected) {
        throw new Error('Выбранный клуб больше недоступен. Обновите страницу или войдите снова.');
      }

      activateTenantContext(selected);
      setTenantDiscovery(discovery);
      setTenantContext(selected);
      setTenantReady(true);
    } catch (error) {
      console.error('Tenant context switch failed:', error);
      clearActiveTenantContext();
      await clearTenantClientState(queryClient);
      setTenantDiscovery(null);
      setTenantContext(null);
      setTenantError(
        error instanceof Error ? error.message : 'Не удалось переключить клуб',
      );
      setTenantReady(false);
      // The previous authority is intentionally not restored: a failed fresh
      // discovery must fail closed instead of reviving stale access.
    } finally {
      tenantSwitchLockRef.current = false;
      setTenantSwitching(false);
    }
  }, [tenantContext, tenantContextEnabled]);

  const logout = useCallback(() => {
    void revokeCurrentAuthSession();
    clearAuthToken();
    void clearTenantClientState(queryClient);
    clearActiveTenantContext();
    setTenantContextCapability(false);
    setAccount(null);
    setTenantContext(null);
    setTenantDiscovery(null);
    setTenantCacheRealtimeEnabled(false);
    setTenantContextEnabled(false);
    setTenantError(null);
    setTenantReady(true);
    setTenantSwitching(false);
    tenantSwitchLockRef.current = false;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const statusRes = await apiFetch('/api/auth/status');
      const status = (await statusRes.json()) as {
        capabilities?: ServerCapabilities;
        setupRequired: boolean;
      };
      const contextEnabled = Boolean(status.capabilities?.tenantContext);
      const cacheRealtimeEnabled = Boolean(status.capabilities?.tenantCacheRealtime);
      if (cacheRealtimeEnabled && !contextEnabled) {
        throw new Error('Tenant cache/realtime capability requires tenant context');
      }
      setSetupRequired(Boolean(status.setupRequired));

      if (status.setupRequired) {
        setTenantContextCapability(contextEnabled);
        setTenantCacheRealtimeCapability(cacheRealtimeEnabled);
        setTenantContextEnabled(contextEnabled);
        setTenantCacheRealtimeEnabled(cacheRealtimeEnabled);
        clearAuthToken();
        await clearTenantClientState(queryClient);
        setAccount(null);
        setTenantDiscovery(null);
        setTenantError(null);
        setTenantReady(true);
        return;
      }

      const meRes = await apiFetch('/api/auth/me');
      if (!meRes.ok) {
        clearAuthToken();
        await clearTenantClientState(queryClient);
        setAccount(null);
        return;
      }

      const data = (await meRes.json()) as { account: Account };
      setAccount(await initializeTenantContext(data.account, status.capabilities));
    } catch (error) {
      console.error('Auth refresh failed:', error);
      cancelTenantSensitiveRequests();
      clearActiveTenantContext();
      await clearTenantClientState(queryClient);
      setTenantContextCapability(false);
      setAccount(null);
      setTenantContext(null);
      setTenantDiscovery(null);
      setTenantCacheRealtimeEnabled(false);
      setTenantContextEnabled(false);
      setTenantError(error instanceof Error ? error.message : 'Ошибка tenant context');
      setTenantReady(false);
    } finally {
      setLoading(false);
    }
  }, [initializeTenantContext]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleExpired = () => {
      cancelTenantSensitiveRequests();
      clearActiveTenantContext();
      void clearTenantClientState(queryClient);
      setTenantContextCapability(false);
      setAccount(null);
      setTenantContext(null);
      setTenantDiscovery(null);
      setTenantCacheRealtimeEnabled(false);
      setTenantContextEnabled(false);
      setTenantError(null);
      setTenantReady(true);
    };
    window.addEventListener('auth:expired', handleExpired);

    return () => window.removeEventListener('auth:expired', handleExpired);
  }, []);

  const login = useCallback(async ({ email, password }: Credentials) => {
    const response = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      throw new Error(await readError(response, 'Не удалось войти'));
    }

    const data = (await response.json()) as {
      token?: string;
      account: Account;
      capabilities?: ServerCapabilities;
    };

    if (data.token) setAuthToken(data.token);
    try {
      setAccount(await initializeTenantContext(data.account, data.capabilities));
    } catch (error) {
      clearAuthToken();
      await clearTenantClientState(queryClient);
      setTenantContextCapability(false);
      setAccount(null);
      setTenantContext(null);
      setTenantCacheRealtimeEnabled(false);
      setTenantContextEnabled(false);
      setTenantReady(false);
      throw error;
    }
    setSetupRequired(false);
  }, [initializeTenantContext]);

  const bootstrap = useCallback(async (data: BootstrapData) => {
    const response = await apiFetch('/api/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(await readError(response, 'Не удалось создать аккаунт'));
    }

    const session = (await response.json()) as {
      token?: string;
      account: Account;
      capabilities?: ServerCapabilities;
    };

    if (session.token) setAuthToken(session.token);
    try {
      setAccount(await initializeTenantContext(session.account, session.capabilities));
    } catch (error) {
      clearAuthToken();
      await clearTenantClientState(queryClient);
      setTenantContextCapability(false);
      setAccount(null);
      setTenantContext(null);
      setTenantCacheRealtimeEnabled(false);
      setTenantContextEnabled(false);
      setTenantReady(false);
      throw error;
    }
    setSetupRequired(false);
  }, [initializeTenantContext]);

  const value = useMemo(
    () => ({
      account,
      loading,
      setupRequired,
      tenantContext,
      tenantDiscovery,
      tenantCacheRealtimeEnabled,
      tenantContextEnabled,
      tenantError,
      tenantReady,
      tenantSwitching,
      login,
      bootstrap,
      logout,
      switchTenantContext,
    }),
    [
      account,
      bootstrap,
      loading,
      login,
      logout,
      setupRequired,
      tenantContext,
      tenantDiscovery,
      tenantCacheRealtimeEnabled,
      tenantContextEnabled,
      tenantError,
      tenantReady,
      tenantSwitching,
      switchTenantContext,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
