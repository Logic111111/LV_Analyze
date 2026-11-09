// Pure helpers for the comparison app (compare.html): turn the OpenDSS check's answer
// (server/src/routes/opendss.js with full: true) into diagram inputs, cards and table rows.
// points: [id, phase, appV, dssV]; currents: [id, phase, appA, dssA]; transformers: [id, appKVA, dssKVA].

/** A copy of a runSnapshotAt result with each point's voltage from column `col` (2 = app, 3 = OpenDSS). */
export function withVoltages(res, points, col) {
  const byId = new Map();
  points.forEach(p => { if (!byId.has(p[0])) byId.set(p[0], {}); byId.get(p[0])[p[1]] = p[col]; });
  return {
    ...res,
    poleResults: res.poleResults.map(p => (byId.has(p.id) ? { ...p, volt: { ...p.volt, ...byId.get(p.id) } } : p)),
    transformers: res.transformers.map(t => (byId.has(t.id) ? { ...t, busVoltPct: { ...t.busVoltPct, ...byId.get(t.id) } } : t))
  };
}

// Smallest or largest of each tool's column; null for an empty list.
const pair = (rows, pick) => (rows.length
  ? { app: pick(...rows.map(r => r[2])), dss: pick(...rows.map(r => r[3])) }
  : { app: null, dss: null });

/** The five headline cards, each value from both tools. */
export function headline(check) {
  return {
    lossKW: { app: check.losses.appW / 1000, dss: check.losses.dssW / 1000 },
    minV: pair(check.points, Math.min),
    maxV: pair(check.points, Math.max),
    neutralA: pair(check.currents.filter(c => c[1] === 'N'), Math.max),
    transformers: check.transformers.map(([id, app, dss]) => ({ id, app, dss }))
  };
}

/** Every bus and phase with its difference in mV, largest first. */
export function tableRows(points) {
  return points
    .map(([id, phase, app, dss]) => ({ id, phase, app, dss, diffMV: (app - dss) * 1000 }))
    .sort((a, b) => Math.abs(b.diffMV) - Math.abs(a.diffMV));
}
