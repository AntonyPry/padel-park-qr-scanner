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
  selectTenantContext,
  setTenantContextCapability,
  type ActiveTenantContext,
  type TenantDiscoveryResponse,
} from '@/lib/tenant-context';

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
  const [tenantContextEnabled, setTenantContextEnabled] = useState(false);
  const [tenantReady, setTenantReady] = useState(true);

  const initializeTenantContext = useCallback(
    async (identityAccount: Account, enabled: boolean) => {
      setTenantContextCapability(enabled);
      setTenantContextEnabled(enabled);
      if (!enabled) {
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
      setTenantContext(selected);
      setTenantReady(true);
      return identityAccount;
    },
    [],
  );

  const logout = useCallback(() => {
    clearAuthToken();
    clearActiveTenantContext();
    setAccount(null);
    setTenantContext(null);
    setTenantContextEnabled(false);
    setTenantReady(true);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const statusRes = await apiFetch('/api/auth/status');
      const status = (await statusRes.json()) as {
        capabilities?: { tenantContext?: boolean };
        setupRequired: boolean;
      };
      const contextEnabled = Boolean(status.capabilities?.tenantContext);
      setTenantContextCapability(contextEnabled);
      setTenantContextEnabled(contextEnabled);
      setSetupRequired(Boolean(status.setupRequired));

      if (status.setupRequired) {
        clearAuthToken();
        setAccount(null);
        setTenantReady(true);
        return;
      }

      if (!getAuthToken()) {
        setAccount(null);
        setTenantReady(true);
        return;
      }

      const meRes = await apiFetch('/api/auth/me');
      if (!meRes.ok) {
        clearAuthToken();
        setAccount(null);
        return;
      }

      const data = (await meRes.json()) as { account: Account };
      setAccount(await initializeTenantContext(data.account, contextEnabled));
    } catch (error) {
      console.error('Auth refresh failed:', error);
      clearActiveTenantContext();
      setAccount(null);
      setTenantContext(null);
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
      setAccount(null);
      setTenantContext(null);
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
      capabilities?: { tenantContext?: boolean };
    };

    setAuthToken(data.token);
    const contextEnabled = Boolean(data.capabilities?.tenantContext);
    try {
      setAccount(await initializeTenantContext(data.account, contextEnabled));
    } catch (error) {
      clearAuthToken();
      setAccount(null);
      setTenantContext(null);
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
      capabilities?: { tenantContext?: boolean };
    };

    setAuthToken(session.token);
    const contextEnabled = Boolean(session.capabilities?.tenantContext);
    try {
      setAccount(await initializeTenantContext(session.account, contextEnabled));
    } catch (error) {
      clearAuthToken();
      setAccount(null);
      setTenantContext(null);
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
      tenantContextEnabled,
      tenantReady,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
