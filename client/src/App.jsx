import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { DesignProvider } from './context/DesignContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import TopNav from './components/TopNav.jsx';

import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import SetupPage from './pages/SetupPage.jsx';
import NetworkPage from './pages/NetworkPage.jsx';
import DiagramPage from './pages/DiagramPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import DailyPage from './pages/DailyPage.jsx';
import HostingPage from './pages/HostingPage.jsx';
import BessHostingPage from './pages/BessHostingPage.jsx';
import FeederSplitPage from './pages/FeederSplitPage.jsx';
import LoadBalancePage from './pages/LoadBalancePage.jsx';
import InsightsPage from './pages/InsightsPage.jsx';
import DesignsPage from './pages/DesignsPage.jsx';
import AboutPage from './pages/AboutPage.jsx';

function ProtectedShell() {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <DesignProvider>
      <TopNav />
      <main>
        <Routes>
          <Route path="setup" element={<SetupPage />} />
          <Route path="network" element={<NetworkPage />} />
          <Route path="diagram" element={<DiagramPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="daily" element={<DailyPage />} />
          <Route path="hosting" element={<HostingPage />} />
          <Route path="bess-hosting" element={<BessHostingPage />} />
          <Route path="feeder-split" element={<FeederSplitPage />} />
          <Route path="load-balance" element={<LoadBalancePage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="designs" element={<DesignsPage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="*" element={<Navigate to="setup" replace />} />
        </Routes>
      </main>
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
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
          <Route path="/register" element={<PublicOnly><RegisterPage /></PublicOnly>} />
          <Route path="/app/*" element={<ProtectedShell />} />
          <Route path="*" element={<Navigate to="/app/setup" replace />} />
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  );
}
