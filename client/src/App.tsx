import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Layout } from './components/Layout';
import AdminPage from './pages/Admin';
import StaffPage from './pages/StaffPage';
import FinancePage from './pages/FinancePage';
import VisitsAnalyticsPage from './pages/VisitsAnalyticsPage';
import UtilizationPage from './pages/UtilizationPage';
import CatalogPage from './pages/CatalogPage';

function App() {
  return (
    <BrowserRouter>
      <TooltipProvider delayDuration={0}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/admin" replace />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/staff" element={<StaffPage />} />
            <Route path="/admin/finances" element={<FinancePage />} />
            <Route
              path="/admin/visits-analytics"
              element={<VisitsAnalyticsPage />}
            />
            <Route path="/admin/utilization" element={<UtilizationPage />} />
            <Route path="/admin/catalog" element={<CatalogPage />} />
          </Route>
        </Routes>
      </TooltipProvider>
    </BrowserRouter>
  );
}

export default App;
