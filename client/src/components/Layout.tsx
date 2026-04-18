import { Outlet } from 'react-router-dom';
import {
  SidebarProvider,
  SidebarTrigger,
  SidebarInset,
} from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';

export const Layout = () => {
  return (
    <SidebarProvider>
      <AppSidebar />

      <SidebarInset>
        {/* ЕСЛИ ЭТОТ БЛОК НЕ ПОЯВИТСЯ - ПРОБЛЕМА В РОУТЕРЕ (App.tsx) */}
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-card px-6">
          {/* Вот эта самая кнопка [ | ] */}
          <SidebarTrigger className="h-10 w-10 border bg-background" />
          <span className="font-bold text-primary">Панель управления</span>
        </header>

        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};
