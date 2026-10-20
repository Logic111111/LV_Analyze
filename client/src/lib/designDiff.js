// Field-level difference between two versions of a design (P7.3), for the version history: which
// settings changed, and which transformers, poles, loads, PV, BESS and open points were added,
// removed or changed (and in which fields) — matched by id, so a reordered list isn't a change.
const COLLECTIONS = [['transformers', 'Transformer'], ['poles', 'Pole'], ['loads', 'Load'], ['pv', 'PV'], ['bess', 'BESS'], ['openPoints', 'Open point'], ['scenarios', 'Scenario']];
const IGNORE = new Set(['id', 'updatedAt']);
const show = (v) => (v === undefined ? '—' : v === null ? 'blank' : typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param {any} a older design @param {any} b newer design
 * @returns {{ settings: { field: string, from: string, to: string }[], items: { kind: string, id: string, change: 'added' | 'removed' | 'changed', fields?: string[] }[], total: number }}
 */
export function designDiff(a, b) {
  const settings = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  keys.forEach(k => {
    if (IGNORE.has(k) || COLLECTIONS.some(([c]) => c === k)) return;
    if (!same(a[k], b[k])) settings.push({ field: k, from: show(a[k]), to: show(b[k]) });
  });
  const items = [];
  COLLECTIONS.forEach(([key, kind]) => {
    const A = new Map(((a && a[key]) || []).map(x => [x.id, x])), B = new Map(((b && b[key]) || []).map(x => [x.id, x]));
    A.forEach((x, id) => { if (!B.has(id)) items.push({ kind, id, change: 'removed' }); });
    B.forEach((y, id) => {
      const x = A.get(id);
      if (!x) { items.push({ kind, id, change: 'added' }); return; }
      const fields = [...new Set([...Object.keys(x), ...Object.keys(y)])].filter(f => !same(x[f], y[f])).map(f => `${f} ${show(x[f])}→${show(y[f])}`);
      if (fields.length) items.push({ kind, id, change: 'changed', fields });
    });
  });
  return { settings: settings.sort((p, q) => p.field.localeCompare(q.field)), items, total: settings.length + items.length };
}
