import { Outlet } from 'react-router-dom';
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';
import { AppSidebar } from './app-sidebar';
import { useAuth } from '@/lib/useAuth';
import { getAccountRoleLabel } from '@/lib/roles';

export const Layout = () => {
  const { account, logout } = useAuth();
  const displayName = account?.Staff?.name || account?.email;

  return (
    <SidebarProvider>
      <AppSidebar />

      <SidebarInset className="min-w-0">
        <header className="flex h-16 min-w-0 shrink-0 items-center gap-4 border-b border-border bg-card px-6">
          <SidebarTrigger className="h-10 w-10 border bg-background" />
          <span className="font-bold text-primary truncate">
            Панель управления
          </span>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            {displayName && (
              <span className="hidden sm:inline truncate text-sm text-muted-foreground">
                {displayName} · {getAccountRoleLabel(account?.role)}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="h-4 w-4" />
              Выйти
            </Button>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};
