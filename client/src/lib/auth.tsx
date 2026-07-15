import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  apiFetch,
  clearAuthToken,
  getAuthToken,
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
  getActiveTenantContext,
  isTenantCacheRealtimeCapabilityEnabled,
  selectTenantContext,
  setTenantCacheRealtimeCapability,
  setTenantContextCapability,
  type ActiveTenantContext,
  type TenantDiscoveryResponse,
} from '@/lib/tenant-context';
import {
  clearTenantSensitiveQueryCache,
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
  const [tenantCacheRealtimeEnabled, setTenantCacheRealtimeEnabled] = useState(false);
  const [tenantContextEnabled, setTenantContextEnabled] = useState(false);
  const [tenantReady, setTenantReady] = useState(true);

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
          clearTenantSensitiveQueryCache(queryClient);
        } else {
          await transitionTenantQueryCache(queryClient, previousContext, null);
        }
        clearActiveTenantContext();
        setTenantContext(null);
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
        clearTenantSensitiveQueryCache(queryClient);
      } else {
        await transitionTenantQueryCache(queryClient, previousContext, selected);
      }
      setTenantContext(selected);
      setTenantReady(true);
      return identityAccount;
    },
    [],
  );

  const logout = useCallback(() => {
    clearAuthToken();
    clearTenantSensitiveQueryCache(queryClient);
    clearActiveTenantContext();
    setTenantContextCapability(false);
    setAccount(null);
    setTenantContext(null);
    setTenantCacheRealtimeEnabled(false);
    setTenantContextEnabled(false);
    setTenantReady(true);
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
        clearTenantSensitiveQueryCache(queryClient);
        setAccount(null);
        setTenantReady(true);
        return;
      }

      if (!getAuthToken()) {
        setTenantContextCapability(contextEnabled);
        setTenantCacheRealtimeCapability(cacheRealtimeEnabled);
        setTenantContextEnabled(contextEnabled);
        setTenantCacheRealtimeEnabled(cacheRealtimeEnabled);
        setAccount(null);
        setTenantReady(true);
        return;
      }

      const meRes = await apiFetch('/api/auth/me');
      if (!meRes.ok) {
        clearAuthToken();
        clearTenantSensitiveQueryCache(queryClient);
        setAccount(null);
        return;
      }

      const data = (await meRes.json()) as { account: Account };
      setAccount(await initializeTenantContext(data.account, status.capabilities));
    } catch (error) {
      console.error('Auth refresh failed:', error);
      clearActiveTenantContext();
      clearTenantSensitiveQueryCache(queryClient);
      setTenantContextCapability(false);
      setAccount(null);
      setTenantContext(null);
      setTenantCacheRealtimeEnabled(false);
      setTenantContextEnabled(false);
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
      clearActiveTenantContext();
      clearTenantSensitiveQueryCache(queryClient);
      setTenantContextCapability(false);
      setAccount(null);
      setTenantContext(null);
      setTenantCacheRealtimeEnabled(false);
      setTenantContextEnabled(false);
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
      token: string;
      account: Account;
      capabilities?: ServerCapabilities;
    };

    setAuthToken(data.token);
    try {
      setAccount(await initializeTenantContext(data.account, data.capabilities));
    } catch (error) {
      clearAuthToken();
      clearTenantSensitiveQueryCache(queryClient);
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
      token: string;
      account: Account;
      capabilities?: ServerCapabilities;
    };

    setAuthToken(session.token);
    try {
      setAccount(await initializeTenantContext(session.account, session.capabilities));
    } catch (error) {
      clearAuthToken();
      clearTenantSensitiveQueryCache(queryClient);
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
      tenantCacheRealtimeEnabled,
      tenantContextEnabled,
      tenantReady,
      login,
      bootstrap,
      logout,
    }),
    [
      account,
      bootstrap,
      loading,
      login,
      logout,
      setupRequired,
      tenantContext,
      tenantCacheRealtimeEnabled,
      tenantContextEnabled,
      tenantReady,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
