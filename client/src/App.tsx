import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthGate } from './components/AuthGate';
import { Layout } from './components/Layout';
import { HomeRedirect, RequireRoles } from './components/RequireRoles';
import { ROUTE_ACCESS } from './lib/permissions';
import { AuthProvider } from './lib/auth';
import AdminPage from './pages/Admin';
import StaffPage from './pages/StaffPage';
import ClientsPage from './pages/ClientsPage';
import FinancePage from './pages/FinancePage';
import VisitsAnalyticsPage from './pages/VisitsAnalyticsPage';
import UtilizationPage from './pages/UtilizationPage';
import CatalogPage from './pages/CatalogPage';
import AdminMotivationPage from './pages/AdminMotivationPage';
import SystemUsersPage from './pages/SystemUsersPage';
import ClientBasesPage from './pages/ClientBasesPage';
import CallTasksPage from './pages/CallTasksPage';
import ReferencesPage from './pages/ReferencesPage';
import AuditLogPage from './pages/AuditLogPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TooltipProvider delayDuration={0}>
          <AuthGate>
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
          </AuthGate>
        </TooltipProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
