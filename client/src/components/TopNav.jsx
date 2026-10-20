import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useDesign } from '../context/DesignContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';

const TABS = [
  ['setup', 'Setup'], ['network', 'Network'], ['diagram', 'Diagram'], ['map', 'Map'], ['reports', 'Run & Reports'],
  ['daily', '24h Profile'], ['charts', 'Charts'], ['hosting', 'Solar Hosting'], ['bess-hosting', 'BESS Hosting'], ['feeder-split', 'Feeder Split'], ['load-balance', 'Load Balance'], ['reconductor', 'Reconductor'], ['fix-it', 'Fix-it Ladder'], ['monte-carlo', 'Probabilistic'], ['scenarios', 'Scenarios'], ['protection', 'Protection'], ['insights', 'AI Insights'],
  ['designs', 'Designs'], ['about', 'About']
];

export default function TopNav() {
  const { user, logout } = useAuth();
  const { design } = useDesign();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="top">
      <div className="brand">
        <div className="mark"></div>
        <div>
          <h1 style={{ fontSize: 16, margin: 0 }}>Feeder Island</h1>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
            {design.name} · {design.transformers.length} transformer{design.transformers.length === 1 ? '' : 's'} · {design.transformers.reduce((s, t) => s + t.txRating, 0)} kVA total
          </span>
        </div>
      </div>
      <nav className="tabs">
        {TABS.map(([path, label]) => (
          <NavLink key={path} to={'/app/' + path} className={({ isActive }) => isActive ? 'active' : ''}>{label}</NavLink>
        ))}
      </nav>
      <div className="headright">
        <button className="iconbtn" onClick={toggleTheme} title="Toggle colour theme">
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{user?.email}</span>
        <button className="iconbtn" onClick={logout}>Sign out</button>
      </div>
    </header>
  );
}
