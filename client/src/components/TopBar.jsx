import { useAuth } from '../context/AuthContext.jsx';
import { useDesign } from '../context/DesignContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useI18n, LANGUAGES } from '../i18n/i18n.jsx';
import Icon from './icons.jsx';

// Slim sticky top bar (UI stage 1). Keeps `header.top` — SetupPage measures it to scroll a
// section clear of it. Undo/redo keep their Ctrl/⌘+Z shortcuts (DesignContext).
export default function TopBar({ onOpenMenu, onOpenPalette, menuButtonRef }) {
  const { user, logout } = useAuth();
  const { design, undo, redo, canUndo, canRedo } = useDesign();
  const { theme, toggleTheme } = useTheme();
  const { t, lang, setLang } = useI18n();
  const nTx = design.transformers.length;
  const draft = LANGUAGES.find(l => l.code === lang)?.draft;
  const themeLabel = theme === 'dark' ? t('Light mode') : t('Dark mode');

  return (
    <header className="top">
      <div className="topbar-row">
        <button type="button" className="iconbtn topbar-menu" ref={menuButtonRef} onClick={onOpenMenu} aria-label={t('Open menu')}>
          <Icon name="menu" />
        </button>
        <div className="topbar-design">
          <div className="topbar-name">{design.name}</div>
          <div className="topbar-meta">
            {t(nTx === 1 ? '{n} transformer' : '{n} transformers', { n: nTx })} · {t('{kva} kVA total', { kva: design.transformers.reduce((s, x) => s + x.txRating, 0) })}
          </div>
        </div>
        <button type="button" className="palette-trigger" onClick={onOpenPalette}>
          <Icon name="search" size={16} />
          <span className="palette-trigger-text">{t('Search pages and actions…')}</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="headright">
          <button type="button" className="iconbtn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/⌘+Z)" aria-label={t('Undo')}><Icon name="undo" /></button>
          <button type="button" className="iconbtn" onClick={redo} disabled={!canRedo} title="Redo (Shift+Ctrl/⌘+Z)" aria-label={t('Redo')}><Icon name="redo" /></button>
          <button type="button" className="iconbtn" onClick={toggleTheme} title={themeLabel} aria-label={themeLabel}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
          <select className="lang-select" aria-label={t('Language')} value={lang} onChange={e => setLang(e.target.value)}>
            {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <details className="account">
            <summary className="iconbtn" aria-label={t('Account')} title={user?.email}><Icon name="user" /></summary>
            <div className="account-menu">
              <div className="account-email">{user?.email}</div>
              <button type="button" className="ghost" onClick={logout}>{t('Sign out')}</button>
            </div>
          </details>
        </div>
      </div>
      {draft && <div className="draft-banner" role="note">{t('Machine-draft translation — needs native-speaker review.')} <span lang="en">(Machine-draft translation — needs native-speaker review.)</span></div>}
    </header>
  );
}
