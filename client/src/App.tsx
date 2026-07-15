import { lazy, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toast';
import { PrepaymentsPageShell } from '@/components/prepayments-page-shell';
import { AuthGate } from './components/AuthGate';
import { Layout } from './components/Layout';
import { OnboardingRouteEvents } from './components/onboarding-route-events';
import { HomeRedirect, RequireRoles } from './components/RequireRoles';
import { ROUTE_ACCESS } from './lib/permissions';
import { AuthProvider } from './lib/auth';
import { queryClient } from './lib/query-client';
import { RealtimeProvider } from './lib/realtime-provider';
import { ThemeProvider } from './lib/theme';
import { TrainingModeProvider } from './lib/training-mode';

const AdminPage = lazy(() => import('./pages/Admin'));
const ManagerControlDashboardPage = lazy(
  () => import('./pages/ManagerControlDashboardPage'),
);
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const BookingsPage = lazy(() => import('./pages/BookingsPage'));
const StaffPage = lazy(() => import('./pages/StaffPage'));
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const FinancePage = lazy(() => import('./pages/FinancePage'));
const VisitsAnalyticsPage = lazy(() => import('./pages/VisitsAnalyticsPage'));
const UtilizationPage = lazy(() => import('./pages/UtilizationPage'));
const CatalogPage = lazy(() => import('./pages/CatalogPage'));
const AdminMotivationPage = lazy(() => import('./pages/AdminMotivationPage'));
const ShiftReportsPage = lazy(() => import('./pages/ShiftReportsPage'));
const ShiftCashPage = lazy(() => import('./pages/ShiftCashPage'));
const SystemUsersPage = lazy(() => import('./pages/SystemUsersPage'));
const ClientBasesPage = lazy(() => import('./pages/ClientBasesPage'));
const CallTasksPage = lazy(() => import('./pages/CallTasksPage'));
const PrepaymentsPage = lazy(() => import('./pages/PrepaymentsPage'));
const CertificatesPage = lazy(() => import('./pages/CertificatesPage'));
const CorporateClientsPage = lazy(() => import('./pages/CorporateClientsPage'));
const TelephonyPage = lazy(() => import('./pages/TelephonyPage'));
const ReferencesPage = lazy(() => import('./pages/ReferencesPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const TrainerPage = lazy(() => import('./pages/TrainerPage'));
const MethodologyPage = lazy(() => import('./pages/MethodologyPage'));
const MethodologyAnalyticsPage = lazy(() => import('./pages/MethodologyAnalyticsPage'));

function PageLoader() {
  return (
    <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
      Загрузка раздела...
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <TooltipProvider delayDuration={0}>
              <AuthGate>
                <RealtimeProvider>
                <TrainingModeProvider>
                <OnboardingRouteEvents />
                <Suspense fallback={<PageLoader />}>
                  <Routes>
                    <Route element={<Layout />}>
                    <Route path="/" element={<HomeRedirect />} />
                    <Route
                      path="/admin"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin']}>
                          <AdminPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/manager-control"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/manager-control']}>
                          <ManagerControlDashboardPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/clients"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/clients']}>
                          <ClientsPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/onboarding"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/onboarding']}>
                          <OnboardingPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/onboarding/:taskKey"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/onboarding']}>
                          <OnboardingPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/bookings"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/bookings']}>
                          <BookingsPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/trainer"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/trainer']}>
                          <TrainerPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/methodology"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/methodology']}>
                          <MethodologyPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/methodology-analytics"
                      element={
                        <RequireRoles
                          roles={ROUTE_ACCESS['/admin/methodology-analytics']}
                        >
                          <MethodologyAnalyticsPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/client-bases"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/client-bases']}>
                          <ClientBasesPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/call-tasks"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/call-tasks']}>
                          <CallTasksPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/prepayments"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/prepayments']}>
                          <Suspense fallback={<PrepaymentsPageShell />}>
                            <PrepaymentsPage />
                          </Suspense>
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/certificates"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/certificates']}>
                          <CertificatesPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/corporate-clients"
                      element={
                        <RequireRoles
                          roles={ROUTE_ACCESS['/admin/corporate-clients']}
                        >
                          <CorporateClientsPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/telephony"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/telephony']}>
                          <TelephonyPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/staff"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/staff']}>
                          <StaffPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/finances"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/finances']}>
                          <FinancePage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/users"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/users']}>
                          <SystemUsersPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/audit"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/audit']}>
                          <AuditLogPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/visits-analytics"
                      element={
                        <RequireRoles
                          roles={ROUTE_ACCESS['/admin/visits-analytics']}
                        >
                          <VisitsAnalyticsPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/utilization"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/utilization']}>
                          <UtilizationPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/catalog"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/catalog']}>
                          <CatalogPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/references"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/references']}>
                          <ReferencesPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/motivation"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/motivation']}>
                          <AdminMotivationPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/shift-reports"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/shift-reports']}>
                          <ShiftReportsPage />
                        </RequireRoles>
                      }
                    />
                    <Route
                      path="/admin/shift-cash"
                      element={
                        <RequireRoles roles={ROUTE_ACCESS['/admin/shift-cash']}>
                          <ShiftCashPage />
                        </RequireRoles>
                      }
                    />
                    <Route path="*" element={<Navigate to="/" replace />} />
                    </Route>
                  </Routes>
                </Suspense>
                </TrainingModeProvider>
                </RealtimeProvider>
              </AuthGate>
              <Toaster />
            </TooltipProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
