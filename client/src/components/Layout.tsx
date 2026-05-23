import { Outlet } from 'react-router-dom';
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';

export const Layout = () => {
  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar />

      <SidebarInset className="min-w-0">
        <SidebarTrigger className="fixed left-3 top-3 z-40 md:hidden" />
        <main className="min-w-0 flex-1 overflow-auto pt-12 md:pt-0">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
};
