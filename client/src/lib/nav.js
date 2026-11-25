// Navigation model (UI stage 1): the five sidebar groups; `basic: true` marks the pages Basic mode
// shows. Labels, group names and descriptions are English i18n keys, translated with t() where
// they are shown. Plain JS (no JSX) so it is unit-tested in Node.

export const NAV_GROUPS = [
  { id: 'build', label: 'Build', items: [
    { path: 'wizard', label: 'New design wizard', icon: 'wand', desc: 'Build a new network step by step', basic: true },
    { path: 'setup', label: 'Setup', icon: 'sliders', desc: 'Transformers, loads, conductors and study settings', basic: true },
    { path: 'network', label: 'Network', icon: 'network', desc: 'Poles, spans and connections for every feeder', basic: true },
    { path: 'diagram', label: 'Diagram', icon: 'diagram', desc: 'Single-line diagram with live result overlays', basic: true },
    { path: 'map', label: 'Map', icon: 'map', desc: 'Optional geographic positions for the transformer and poles', basic: true }
  ] },
  { id: 'analyse', label: 'Analyse', items: [
    { path: 'reports', label: 'Run & Reports', icon: 'report', desc: 'Run the load flow and build the printable report', basic: true },
    { path: 'daily', label: '24h Profile', icon: 'clock', desc: '24-hour profile with load, EV and solar applied together', basic: true },
    { path: 'charts', label: 'Charts', icon: 'chart', desc: 'Engineering charts from one 24-hour scan' },
    { path: 'protection', label: 'Protection', icon: 'shield', desc: 'Fault levels and fuse protection checks' },
    { path: 'monte-carlo', label: 'Probabilistic', icon: 'dice', desc: 'Monte Carlo planning for EV and solar adoption' },
    { path: 'scenarios', label: 'Scenarios', icon: 'layers', desc: 'Named sets of overrides, compared side by side' }
  ] },
  { id: 'optimise', label: 'Optimise', items: [
    { path: 'hosting', label: 'Solar Hosting', icon: 'sun', desc: 'Additional solar the network can host, per location', basic: true },
    { path: 'bess-hosting', label: 'BESS Hosting', icon: 'battery', desc: 'Additional battery storage the network can host' },
    { path: 'feeder-split', label: 'Feeder Split', icon: 'split', desc: 'Where to split an overloaded feeder onto a new transformer' },
    { path: 'load-balance', label: 'Load Balance', icon: 'balance', desc: 'Rebalance connections across phases A, B and C' },
    { path: 'reconductor', label: 'Reconductor', icon: 'cable', desc: 'Restring spans with lower-resistance conductors' },
    { path: 'fix-it', label: 'Fix-it Ladder', icon: 'wrench', desc: 'Try remedies in turn until no voltage violation remains', basic: true }
  ] },
  { id: 'field', label: 'Field', items: [
    { path: 'field-data', label: 'Field data', icon: 'meter', desc: 'Import smart-meter (AMI) interval data' },
    { path: 'field-survey', label: 'Field survey', icon: 'clipboard', desc: 'Offline survey of poles and connections on site', basic: true }
  ] },
  { id: 'workspace', label: 'Workspace', items: [
    { path: 'dashboard', label: 'Dashboard', icon: 'grid', desc: 'Every design you can open, worst first', basic: true },
    { path: 'designs', label: 'Designs', icon: 'folder', desc: 'Save, open, version and share designs', basic: true },
    { path: 'insights', label: 'AI Insights', icon: 'sparkle', desc: 'Claude reviews this design with the app engine', basic: true },
    { path: 'validation', label: 'OpenDSS Validation', icon: 'check', desc: 'Accuracy of the load flow against OpenDSS' },
    { path: 'about', label: 'About', icon: 'info', desc: 'About this deployment', basic: true }
  ] }
];

export const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items.map(i => ({ ...i, group: g.id })));

const BASIC_GROUPS = NAV_GROUPS.map(g => ({ ...g, items: g.items.filter(i => i.basic) })).filter(g => g.items.length);

/** The sidebar groups for a mode: every page in Advanced, only the Basic pages in Basic. */
export function navGroupsFor(mode) {
  return mode === 'advanced' ? NAV_GROUPS : BASIC_GROUPS;
}

/** The page and group for an /app/<path> URL (query, hash and a trailing slash ignored), or null. */
export function findNavItem(pathname) {
  const m = /^\/app\/([^/?#]+)\/?(?:[?#].*)?$/.exec(pathname || '');
  if (!m) return null;
  for (const g of NAV_GROUPS) {
    const item = g.items.find(i => i.path === m[1]);
    if (item) return { item, group: { id: g.id, label: g.label } };
  }
  return null;
}
