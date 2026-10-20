// Multi-criteria helpers (P4.5) for advisor result tables: Pareto dominance and column sorting.
// Every criterion is "lower is better" (violations, kWh, capex, VUF). A missing value (null — e.g.
// capex before costs are entered) is left out of the comparison rather than treated as zero.

/** a dominates b: no worse on every criterion both have, strictly better on at least one. */
export function dominates(a, b, keys) {
  let strictly = false, compared = 0;
  for (const k of keys) {
    const x = a[k], y = b[k];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    compared++;
    if (x > y) return false;
    if (x < y) strictly = true;
  }
  return compared > 0 && strictly;
}

/** Indices of the rows no other row dominates. @param {Record<string, number | null>[]} rows @param {string[]} keys */
export function nonDominatedIndices(rows, keys) {
  return rows.map((r, i) => i).filter(i => !rows.some((o, j) => j !== i && dominates(o, rows[i], keys)));
}

// Stable sort by one column; missing values always last, whichever direction.
export function sortRows(rows, key, dir = 'asc') {
  const sign = dir === 'desc' ? -1 : 1;
  return rows.map((r, i) => [r, i]).sort(([a, i], [b, j]) => {
    const x = a.values[key], y = b.values[key];
    const fx = Number.isFinite(x), fy = Number.isFinite(y);
    if (!fx || !fy) return fx === fy ? i - j : fx ? -1 : 1;
    return (x - y) * sign || i - j;
  }).map(([r]) => r);
}
