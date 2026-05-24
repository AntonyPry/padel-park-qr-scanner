import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthGate } from './components/AuthGate';
import { Layout } from './components/Layout';
import { HomeRedirect, RequireRoles } from './components/RequireRoles';
import { ROUTE_ACCESS } from './lib/permissions';
import { AuthProvider } from './lib/auth';

const AdminPage = lazy(() => import('./pages/Admin'));
const StaffPage = lazy(() => import('./pages/StaffPage'));
const ClientsPage = lazy(() => import('./pages/ClientsPage'));
const FinancePage = lazy(() => import('./pages/FinancePage'));
const VisitsAnalyticsPage = lazy(() => import('./pages/VisitsAnalyticsPage'));
const UtilizationPage = lazy(() => import('./pages/UtilizationPage'));
const CatalogPage = lazy(() => import('./pages/CatalogPage'));
const AdminMotivationPage = lazy(() => import('./pages/AdminMotivationPage'));
const SystemUsersPage = lazy(() => import('./pages/SystemUsersPage'));
const ClientBasesPage = lazy(() => import('./pages/ClientBasesPage'));
const CallTasksPage = lazy(() => import('./pages/CallTasksPage'));
const ReferencesPage = lazy(() => import('./pages/ReferencesPage'));
const AuditLogPage = lazy(() => import('./pages/AuditLogPage'));
const TrainerPage = lazy(() => import('./pages/TrainerPage'));

function PageLoader() {
  return (
    <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
      Загрузка раздела...
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TooltipProvider delayDuration={0}>
          <AuthGate>
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
                    path="/admin/clients"
                    element={
                      <RequireRoles roles={ROUTE_ACCESS['/admin/clients']}>
                        <ClientsPage />
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
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </Suspense>
          </AuthGate>
        </TooltipProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
