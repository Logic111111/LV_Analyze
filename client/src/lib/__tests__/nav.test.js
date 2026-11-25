import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NAV_GROUPS, NAV_ITEMS, findNavItem, navGroupsFor } from '../nav.js';
import en from '../../i18n/en.json';

// UI stage 1 — the sidebar/palette navigation model (lib/nav.js).
const OLD_TABS = ['setup', 'network', 'diagram', 'map', 'reports', 'daily', 'charts', 'hosting', 'bess-hosting', 'feeder-split', 'load-balance', 'reconductor', 'fix-it', 'monte-carlo', 'scenarios', 'field-data', 'field-survey', 'protection', 'insights', 'dashboard', 'designs', 'about', 'validation'];
const appJsx = path.resolve(__dirname, '../../App.jsx');

describe('navigation model', () => {
  it('the 24 sidebar pages are exactly the old tabs plus Validation and the wizard, each in one group', () => {
    expect([...NAV_ITEMS.map(i => i.path)].sort()).toEqual([...OLD_TABS, 'wizard'].sort());
    expect(new Set(NAV_ITEMS.map(i => i.path)).size).toBe(24);
    expect(NAV_GROUPS.map(g => g.id)).toEqual(['build', 'analyse', 'optimise', 'field', 'workspace']);
    expect(NAV_GROUPS.map(g => g.items.length)).toEqual([5, 6, 6, 2, 5]);
  });

  it('every nav path is a route in App.jsx, and every App route is in nav', () => {
    const routes = [...fs.readFileSync(appJsx, 'utf8').matchAll(/<Route path="([a-z-]+)"/g)].map(m => m[1]);
    expect(new Set(routes)).toEqual(new Set(NAV_ITEMS.map(i => i.path)));
  });

  it('Advanced shows every page; Basic shows the 14 Basic pages in sidebar order', () => {
    expect(navGroupsFor('advanced')).toBe(NAV_GROUPS);
    const basic = navGroupsFor('basic');
    expect(basic.map(g => g.id)).toEqual(['build', 'analyse', 'optimise', 'field', 'workspace']);
    expect(basic.flatMap(g => g.items.map(i => i.path))).toEqual(['wizard', 'setup', 'network', 'diagram', 'map', 'reports', 'daily', 'hosting', 'fix-it', 'field-survey', 'dashboard', 'designs', 'insights', 'about']);
  });

  it('findNavItem resolves a pathname to its page and group', () => {
    expect(findNavItem('/app/network').item.label).toBe('Network');
    expect(findNavItem('/app/network/').group.id).toBe('build');
    expect(findNavItem('/app/setup?section=tx').item.path).toBe('setup');
    expect(findNavItem('/app/wizard').group.id).toBe('build');
    expect(findNavItem('/app/nope')).toBeNull();
    expect(findNavItem('/login')).toBeNull();
  });

  it('labels, group names and descriptions are translatable keys in en.json', () => {
    [...NAV_GROUPS.map(g => g.label), ...NAV_ITEMS.map(i => i.label), ...NAV_ITEMS.map(i => i.desc)]
      .forEach(k => expect(en[k], k).toBe(k));
  });
});
