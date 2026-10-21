import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useDesign } from '../context/DesignContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useI18n, LANGUAGES } from '../i18n/i18n.jsx';

const TABS = [
  ['setup', 'Setup'], ['network', 'Network'], ['diagram', 'Diagram'], ['map', 'Map'], ['reports', 'Run & Reports'],
  ['daily', '24h Profile'], ['charts', 'Charts'], ['hosting', 'Solar Hosting'], ['bess-hosting', 'BESS Hosting'], ['feeder-split', 'Feeder Split'], ['load-balance', 'Load Balance'], ['reconductor', 'Reconductor'], ['fix-it', 'Fix-it Ladder'], ['monte-carlo', 'Probabilistic'], ['scenarios', 'Scenarios'], ['field-data', 'Field data'], ['field-survey', 'Field survey'], ['protection', 'Protection'], ['insights', 'AI Insights'],
  ['dashboard', 'Dashboard'], ['designs', 'Designs'], ['about', 'About']
];

export default function TopNav() {
  const { user, logout } = useAuth();
  const { design, undo, redo, canUndo, canRedo } = useDesign();
  const { theme, toggleTheme } = useTheme();
  const { t, lang, setLang } = useI18n();
  const nTx = design.transformers.length;
  const draft = LANGUAGES.find(l => l.code === lang)?.draft;

  return (
    <>
    <a className="skip-link" href="#main">{t('Skip to main content')}</a>
    <header className="top">
      <div className="brand">
        <div className="mark"></div>
        <div>
          <h1 style={{ fontSize: 16, margin: 0 }}>Feeder Island</h1>
          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'var(--mono)' }}>
            {design.name} · {t(nTx === 1 ? '{n} transformer' : '{n} transformers', { n: nTx })} · {t('{kva} kVA total', { kva: design.transformers.reduce((s, x) => s + x.txRating, 0) })}
          </span>
        </div>
      </div>
      <nav className="tabs" aria-label={t('Main navigation')}>
        {TABS.map(([path, label]) => (
          <NavLink key={path} to={'/app/' + path} className={({ isActive }) => isActive ? 'active' : ''}>{t(label)}</NavLink>
        ))}
      </nav>
      <div className="headright">
        {/* Undo / redo every edit (P7.3); also Ctrl/⌘+Z and Shift+Ctrl/⌘+Z. */}
        <button className="iconbtn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/⌘+Z)" aria-label={t('Undo')}>↶ {t('Undo')}</button>
        <button className="iconbtn" onClick={redo} disabled={!canRedo} title="Redo (Shift+Ctrl/⌘+Z)" aria-label={t('Redo')}>↷ {t('Redo')}</button>
        <button className="iconbtn" onClick={toggleTheme} title="Toggle colour theme">
          {theme === 'dark' ? t('Light mode') : t('Dark mode')}
        </button>
        <select className="lang-select" aria-label={t('Language')} value={lang} onChange={e => setLang(e.target.value)}>
          {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{user?.email}</span>
        <button className="iconbtn" onClick={logout}>{t('Sign out')}</button>
      </div>
      {draft && <div className="draft-banner" role="note">{t('Machine-draft translation — needs native-speaker review.')} <span lang="en">(Machine-draft translation — needs native-speaker review.)</span></div>}
    </header>
    </>
  );
}
