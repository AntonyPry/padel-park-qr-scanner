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

  const logout = useCallback(() => {
    clearAuthToken();
    setAccount(null);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);

    try {
      const statusRes = await apiFetch('/api/auth/status');
      const status = (await statusRes.json()) as { setupRequired: boolean };
      setSetupRequired(Boolean(status.setupRequired));

      if (status.setupRequired) {
        clearAuthToken();
        setAccount(null);
        return;
      }

      if (!getAuthToken()) {
        setAccount(null);
        return;
      }

      const meRes = await apiFetch('/api/auth/me');
      if (!meRes.ok) {
        clearAuthToken();
        setAccount(null);
        return;
      }

      const data = (await meRes.json()) as { account: Account };
      setAccount(data.account);
    } catch (error) {
      console.error('Auth refresh failed:', error);
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const handleExpired = () => setAccount(null);
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
    };

    setAuthToken(data.token);
    setAccount(data.account);
    setSetupRequired(false);
  }, []);

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
    };

    setAuthToken(session.token);
    setAccount(session.account);
    setSetupRequired(false);
  }, []);

  const value = useMemo(
    () => ({
      account,
      loading,
      setupRequired,
      login,
      bootstrap,
      logout,
    }),
    [account, bootstrap, loading, login, logout, setupRequired],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
