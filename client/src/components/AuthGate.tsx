import type { ReactNode } from 'react';
import LoginPage from '@/pages/LoginPage';
import { useAuth } from '@/lib/useAuth';

export function AuthGate({ children }: { children: ReactNode }) {
  const { account, loading, setupRequired, tenantReady } = useAuth();

  if (loading || (account && !tenantReady)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-sm text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  if (setupRequired) return <LoginPage mode="setup" />;
  if (!account) return <LoginPage mode="login" />;

  return children;
}
