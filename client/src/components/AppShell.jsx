import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { NAV_GROUPS, EXTRA_ITEMS, findNavItem } from '../lib/nav.js';
import { useI18n } from '../i18n/i18n.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useDesign } from '../context/DesignContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import { useTiltDelegate } from '../hooks/useTiltDelegate.js';
import { useKeyboardScrollRegions } from '../hooks/useKeyboardScrollRegions.js';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import PageHeader from './PageHeader.jsx';
import CommandPalette from './CommandPalette.jsx';

const SIDEBAR_KEY = 'fi-sidebar';
const PHONE = '(max-width: 720px)';

function initialCollapsed() {
  try { return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'; } catch (e) { return false; }
}

// The signed-in layout (UI stage 1): sidebar + top bar + main, the phone drawer's state and
// closing rules, and the page header derived from the route.
export default function AppShell({ children }) {
  const { t } = useI18n();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sidebarRef = useRef(null);
  const menuButtonRef = useRef(null);
  const mainRef = useRef(null);
  useTiltDelegate(mainRef);
  // The entrance animation is for moving between pages; the first page after load appears at once
  // (fading it in from opacity 0 delayed Largest Contentful Paint by ~90 ms).
  const firstPage = useRef(true);
  useEffect(() => { firstPage.current = false; }, []);
  useKeyboardScrollRegions();

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded'); } catch (e) { /* storage unavailable */ }
  }, [collapsed]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // The drawer closes on navigation, on Escape, and when the window grows past the phone width.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(PHONE);
    const onChange = () => { if (!mq.matches) setDrawerOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const side = sidebarRef.current, menu = menuButtonRef.current;
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('drawer-lock');
    (side?.querySelector('.sidebar-item.active') || side?.querySelector('.sidebar-item'))?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('drawer-lock');
      if (side?.contains(document.activeElement)) menu?.focus();
    };
  }, [drawerOpen]);
  useFocusTrap(sidebarRef, drawerOpen);

  // Command palette: Ctrl/⌘+K toggles it from anywhere (also while typing in a field); focus goes
  // back to wherever it was when the palette opened.
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const { undo, redo, canUndo, canRedo } = useDesign();
  const { logout } = useAuth();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const returnFocusRef = useRef(null);
  const openPalette = useCallback(() => { returnFocusRef.current = document.activeElement; setPaletteOpen(true); }, []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      setPaletteOpen(o => { if (!o) returnFocusRef.current = document.activeElement; return !o; });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !paletteOpen) {
      const el = returnFocusRef.current;
      if (el && el.isConnected && typeof el.focus === 'function') el.focus();
    }
    wasOpen.current = paletteOpen;
  }, [paletteOpen]);

  const paletteItems = useMemo(() => {
    const page = (i, g) => ({ id: 'page:' + i.path, label: t(i.label), keywords: [i.label], group: g ? t(g.label) : null, kind: 'page', icon: i.icon, path: i.path });
    const pages = [...NAV_GROUPS.flatMap(g => g.items.map(i => page(i, g))), ...EXTRA_ITEMS.map(i => page(i, null))];
    const actions = [
      { id: 'act:theme', label: theme === 'dark' ? t('Light mode') : t('Dark mode'), keywords: ['Light mode', 'Dark mode', 'theme'], group: null, kind: 'action', icon: theme === 'dark' ? 'sun' : 'moon', run: toggleTheme },
      canUndo && { id: 'act:undo', label: t('Undo'), keywords: ['Undo'], group: null, kind: 'action', icon: 'undo', run: undo },
      canRedo && { id: 'act:redo', label: t('Redo'), keywords: ['Redo'], group: null, kind: 'action', icon: 'redo', run: redo },
      { id: 'act:signout', label: t('Sign out'), keywords: ['Sign out', 'log out'], group: null, kind: 'action', icon: 'user', run: logout }
    ].filter(Boolean);
    return [...pages, ...actions];
  }, [t, theme, toggleTheme, canUndo, canRedo, undo, redo, logout]);
  const onSelect = useCallback((item) => {
    setPaletteOpen(false);
    if (item.kind === 'page') navigate('/app/' + item.path);
    else item.run();
  }, [navigate]);

  const found = findNavItem(location.pathname);

  return (
    <>
      <a className="skip-link" href="#main">{t('Skip to main content')}</a>
      <div className={'shell' + (collapsed ? ' collapsed' : '')}>
        <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed(c => !c)}
          drawerOpen={drawerOpen} onCloseDrawer={closeDrawer} sidebarRef={sidebarRef} />
        {drawerOpen && <div className="sidebar-backdrop" onClick={closeDrawer} aria-hidden="true" />}
        <div className="shell-main">
          <TopBar onOpenMenu={() => setDrawerOpen(true)} onOpenPalette={openPalette} menuButtonRef={menuButtonRef} />
          <main id="main" tabIndex={-1} ref={mainRef}>
            {/* Keyed on the route so each page plays the entrance animation; the shell stays still. */}
            <div className={'page' + (firstPage.current ? '' : ' page-enter')} key={location.pathname}>
              {found && <PageHeader eyebrow={found.group ? t(found.group.label) : undefined} title={t(found.item.label)} desc={t(found.item.desc)} />}
              {children}
            </div>
          </main>
        </div>
      </div>
      <CommandPalette open={paletteOpen} onClose={closePalette} items={paletteItems} onSelect={onSelect} />
    </>
  );
}
