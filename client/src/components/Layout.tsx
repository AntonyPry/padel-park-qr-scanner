import { Outlet, useLocation } from 'react-router-dom';
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { AppSidebar } from './app-sidebar';
import { TrainingModeBanner } from './training-mode-banner';

export const Layout = () => {
  const location = useLocation();

  return (
    <SidebarProvider defaultOpen className="bg-muted/35 p-3 md:p-4 xl:p-6">
      <div className="mx-auto flex w-full max-w-[1680px] gap-3 md:gap-4">
        <AppSidebar />

        <SidebarInset className="min-w-0 overflow-hidden rounded-2xl border bg-background shadow-sm shadow-foreground/5 md:min-h-[calc(100svh-2rem)] xl:min-h-[calc(100svh-3rem)]">
          <SidebarTrigger className="fixed left-4 top-4 z-40 rounded-xl border bg-background/90 shadow-sm backdrop-blur md:hidden" />
          <TrainingModeBanner />
          <div className="min-w-0 flex-1 overflow-auto px-4 pb-6 pt-14 sm:px-5 md:px-6 md:pt-6 lg:px-8">
            <div
              key={location.pathname}
              className="crm-page-enter mx-auto w-full max-w-[1320px]"
            >
              <Outlet />
            </div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
};
