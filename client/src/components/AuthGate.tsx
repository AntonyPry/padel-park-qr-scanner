import type { ReactNode } from 'react';
import LoginPage from '@/pages/LoginPage';
import { useAuth } from '@/lib/useAuth';

export function AuthGate({ children }: { children: ReactNode }) {
  const { account, loading, setupRequired } = useAuth();

  if (loading) {
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
