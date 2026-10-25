import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { NAV_GROUPS } from '../lib/nav.js';
import { useI18n } from '../i18n/i18n.jsx';
import Icon from './icons.jsx';

// Grouped navigation (UI stage 1). Desktop: a sticky column, 248 px or 64 px (icons only).
// Phones (≤720 px): an off-canvas drawer opened from the top bar's menu button; AppShell owns
// its open state, focus trap and closing rules. One indicator bar slides to the active item.
export default function Sidebar({ collapsed, onToggleCollapsed, drawerOpen, onCloseDrawer, sidebarRef }) {
  const { t } = useI18n();
  const location = useLocation();
  const navRef = useRef(null);
  const [bar, setBar] = useState({ top: 0, height: 0, visible: false });

  useLayoutEffect(() => {
    const active = navRef.current?.querySelector('.sidebar-item.active');
    setBar(active ? { top: active.offsetTop, height: active.offsetHeight, visible: true } : b => ({ ...b, visible: false }));
  }, [location.pathname, collapsed]);

  return (
    <aside className={'sidebar' + (drawerOpen ? ' open' : '')} ref={sidebarRef}>
      <div className="sidebar-brand">
        <div className="mark" aria-hidden="true"></div>
        <div className="brand-name">Feeder Island</div>
        <button type="button" className="iconbtn sidebar-close" onClick={onCloseDrawer} aria-label={t('Close menu')}>
          <Icon name="close" />
        </button>
      </div>
      <nav className="sidebar-nav" aria-label={t('Main navigation')} ref={navRef}>
        <span className={'sidebar-indicator' + (bar.visible ? ' on' : '')} aria-hidden="true"
          style={{ transform: `translateY(${bar.top}px)`, height: bar.height }} />
        {NAV_GROUPS.map(g => (
          <div className="sidebar-section" key={g.id}>
            <div className="sidebar-group" id={'nav-group-' + g.id}>{t(g.label)}</div>
            <ul aria-labelledby={'nav-group-' + g.id}>
              {g.items.map(i => (
                <li key={i.path}>
                  <NavLink to={'/app/' + i.path} title={collapsed ? t(i.label) : undefined}
                    className={({ isActive }) => 'sidebar-item' + (isActive ? ' active' : '')}>
                    <Icon name={i.icon} />
                    <span className="sidebar-label">{t(i.label)}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <button type="button" className="sidebar-collapse" onClick={onToggleCollapsed}
        aria-label={collapsed ? t('Expand sidebar') : t('Collapse sidebar')} title={collapsed ? t('Expand sidebar') : t('Collapse sidebar')}>
        <Icon name={collapsed ? 'chevrons-right' : 'chevrons-left'} />
        <span className="sidebar-label">{t('Collapse sidebar')}</span>
      </button>
    </aside>
  );
}
