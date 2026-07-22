import type { ReactNode } from 'react';
import LoginPage from '@/pages/LoginPage';
import { useAuth } from '@/lib/useAuth';

export function AuthGate({ children }: { children: ReactNode }) {
  const {
    account,
    loading,
    logout,
    setupRequired,
    tenantError,
    tenantReady,
    tenantSwitching,
  } = useAuth();

  if (account && tenantError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Контекст клуба недоступен</h1>
          <p className="mt-2 text-sm text-muted-foreground">{tenantError}</p>
          <button
            type="button"
            className="mt-5 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            onClick={logout}
          >
            Войти снова
          </button>
        </div>
      </div>
    );
  }

  if (loading || (account && !tenantReady)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-sm text-muted-foreground">
        {tenantSwitching ? 'Переключаем клуб...' : 'Загрузка...'}
      </div>
    );
  }

  if (setupRequired) return <LoginPage mode="setup" />;
  if (!account) return <LoginPage mode="login" />;

  return children;
}
