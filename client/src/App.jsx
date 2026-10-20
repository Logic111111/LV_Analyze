import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { DesignProvider } from './context/DesignContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { I18nProvider } from './i18n/i18n.jsx';
import TopNav from './components/TopNav.jsx';
import IssuesPanel from './components/IssuesPanel.jsx';

import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
// Every page is its own chunk, loaded on first visit (the map alone brings Leaflet, the charts
// Chart.js), so the first screen doesn't wait for all of them.
const SetupPage = lazy(() => import('./pages/SetupPage.jsx'));
const NetworkPage = lazy(() => import('./pages/NetworkPage.jsx'));
const DiagramPage = lazy(() => import('./pages/DiagramPage.jsx'));
const ReportsPage = lazy(() => import('./pages/ReportsPage.jsx'));
const DailyPage = lazy(() => import('./pages/DailyPage.jsx'));
const HostingPage = lazy(() => import('./pages/HostingPage.jsx'));
const BessHostingPage = lazy(() => import('./pages/BessHostingPage.jsx'));
const FeederSplitPage = lazy(() => import('./pages/FeederSplitPage.jsx'));
const LoadBalancePage = lazy(() => import('./pages/LoadBalancePage.jsx'));
const ProtectionPage = lazy(() => import('./pages/ProtectionPage.jsx'));
const ReconductorPage = lazy(() => import('./pages/ReconductorPage.jsx'));
const FixItPage = lazy(() => import('./pages/FixItPage.jsx'));
const MonteCarloPage = lazy(() => import('./pages/MonteCarloPage.jsx'));
const ChartsPage = lazy(() => import('./pages/ChartsPage.jsx'));
const ScenariosPage = lazy(() => import('./pages/ScenariosPage.jsx'));
const MapPage = lazy(() => import('./pages/MapPage.jsx'));
const WizardPage = lazy(() => import('./pages/WizardPage.jsx'));
const InsightsPage = lazy(() => import('./pages/InsightsPage.jsx'));
const DesignsPage = lazy(() => import('./pages/DesignsPage.jsx'));
const AboutPage = lazy(() => import('./pages/AboutPage.jsx'));

function ProtectedShell() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <DesignProvider>
      <TopNav />
      <main id="main" tabIndex={-1}>
        <Suspense fallback={<div className="card" role="status">Loading…</div>}>
        <Routes>
          <Route path="setup" element={<SetupPage />} />
          <Route path="network" element={<NetworkPage />} />
          <Route path="diagram" element={<DiagramPage />} />
          <Route path="map" element={<MapPage />} />
          <Route path="wizard" element={<WizardPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="daily" element={<DailyPage />} />
          <Route path="charts" element={<ChartsPage />} />
          <Route path="hosting" element={<HostingPage />} />
          <Route path="bess-hosting" element={<BessHostingPage />} />
          <Route path="feeder-split" element={<FeederSplitPage />} />
          <Route path="load-balance" element={<LoadBalancePage />} />
          <Route path="protection" element={<ProtectionPage />} />
          <Route path="reconductor" element={<ReconductorPage />} />
          <Route path="fix-it" element={<FixItPage />} />
          <Route path="monte-carlo" element={<MonteCarloPage />} />
          <Route path="scenarios" element={<ScenariosPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="designs" element={<DesignsPage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="setup" replace />} />
        </Routes>
        </Suspense>
      </main>
      <IssuesPanel />
    </DesignProvider>
  );
}

function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/app/setup" replace />;
  return children;
}

export default function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
          <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
          <Route path="/app/*" element={<ProtectedShell />} />
          <Route path="*" element={<Navigate to="/app/setup" replace />} />
        </Routes>
      </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
