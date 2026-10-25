import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { findNavItem } from '../lib/nav.js';
import { useI18n } from '../i18n/i18n.jsx';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import PageHeader from './PageHeader.jsx';

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

  const found = findNavItem(location.pathname);

  return (
    <>
      <a className="skip-link" href="#main">{t('Skip to main content')}</a>
      <div className={'shell' + (collapsed ? ' collapsed' : '')}>
        <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed(c => !c)}
          drawerOpen={drawerOpen} onCloseDrawer={closeDrawer} sidebarRef={sidebarRef} />
        {drawerOpen && <div className="sidebar-backdrop" onClick={closeDrawer} aria-hidden="true" />}
        <div className="shell-main">
          <TopBar onOpenMenu={() => setDrawerOpen(true)} onOpenPalette={() => {}} menuButtonRef={menuButtonRef} />
          <main id="main" tabIndex={-1}>
            {found && <PageHeader eyebrow={found.group ? t(found.group.label) : undefined} title={t(found.item.label)} desc={t(found.item.desc)} />}
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
