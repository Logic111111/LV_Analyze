// Data for the engineering charts (P5.3), as plain series — kept out of the page so it's tested
// without a browser. Inputs are engine results (snapshots, a 24 h scan, fault levels).
import { C, PHASES, isTransformerId, poleById } from './loadflow.js';

/**
 * Phasor diagram of one pole: the transformer star point at the origin, the local neutral point
 * N′ displaced by the neutral shift `vn`, and each phase tip at N′ + V(phase-to-local-neutral).
 * So the tips are the phase-to-star voltages, and N′→tip are what customers get.
 * @param {any} pr a poleResult (needs vph and vn)
 */
export function phasorData(pr) {
  const vn = pr.vn || C.zero();
  const tips = {};
  PHASES.forEach(ph => { tips[ph] = C.add(vn, pr.vph[ph]); });
  return {
    star: { re: 0, im: 0 }, neutral: vn, tips,
    neutralShiftV: C.abs(vn), neutralShiftDeg: Math.atan2(vn.im, vn.re) * 180 / Math.PI,
    toNeutral: Object.fromEntries(PHASES.map(ph => [ph, { mag: C.abs(pr.vph[ph]), deg: Math.atan2(pr.vph[ph].im, pr.vph[ph].re) * 180 / Math.PI }])),
    toStar: Object.fromEntries(PHASES.map(ph => [ph, { mag: C.abs(tips[ph]), deg: Math.atan2(tips[ph].im, tips[ph].re) * 180 / Math.PI }]))
  };
}

/** 24 h × pole-phase voltages: rows in pole order, A/B/C; `values[h]` per hour. @param {any[]} daily runDailyScan result */
export function voltageHeatmap(daily) {
  if (!daily.length) return { hours: [], rows: [] };
  const poles = daily[0].poleResults.map(p => p.id);
  const rows = poles.flatMap(id => PHASES.map(ph => ({
    pole: id, phase: ph,
    values: daily.map(r => { const p = r.poleResults.find(x => x.id === id); return p ? p.volt[ph] : null; })
  })));
  return { hours: daily.map(r => r.hour), rows, vLimLow: daily[0].vLimLow, vLimHigh: daily[0].vLimHigh };
}

/**
 * Loading-duration curves over the scanned hours: for each transformer (loading %) and each span
 * (worst phase loading %), the hourly values sorted from highest to lowest. The x axis is "hours
 * at or above this loading".
 * @param {any[]} daily
 */
export function loadingDuration(daily) {
  const desc = (a) => [...a].sort((x, y) => y - x);
  const txIds = daily.length ? daily[0].transformers.map(t => t.id) : [];
  const spanIds = daily.length ? daily[0].poleResults.map(p => p.id) : [];
  return {
    transformers: txIds.map(id => ({ id, name: daily[0].transformers.find(t => t.id === id).name || id, values: desc(daily.map(r => r.transformers.find(t => t.id === id).txPct)) })),
    spans: spanIds.map(id => ({ id, values: desc(daily.map(r => { const p = r.poleResults.find(x => x.id === id); return Math.max(p.condPct.A, p.condPct.B, p.condPct.C); })) }))
  };
}

/** VUF at every pole for one snapshot, and the worst over a scan (if given). */
export function vufByPole(res, daily = null) {
  return res.poleResults.map(p => ({
    pole: p.id, vuf: p.vufPct,
    dailyMax: daily ? Math.max(...daily.map(r => (r.poleResults.find(x => x.id === p.id) || { vufPct: 0 }).vufPct)) : null
  }));
}

/**
 * Prospective fault current along each root-to-leaf path: Ik3max and Ik1min against distance from
 * the transformer, starting with the LV bus at 0 m. @param {any} faults faultLevels(design) @param {any} design
 */
export function faultAlongFeeder(faults, design) {
  const byPole = new Map(faults.poles.map(f => [f.id, f]));
  const txF = new Map(faults.transformers.map(t => [t.id, t]));
  const kids = new Map();
  design.poles.forEach(p => { if (!kids.has(p.parent)) kids.set(p.parent, []); kids.get(p.parent).push(p.id); });
  const paths = [];
  const walk = (id, chain) => {
    const next = [...chain, id];
    const k = kids.get(id) || [];
    if (!k.length) paths.push(next);
    k.forEach(c => walk(c, next));
  };
  design.poles.filter(p => isTransformerId(design, p.parent)).forEach(p => walk(p.id, []));
  return paths.map(chain => {
    const txId = poleById(design, chain[0]).parent;
    const t = txF.get(txId);
    return {
      txId, leaf: chain[chain.length - 1],
      points: [{ pole: txId, distanceM: 0, ik3kA: t.ik3MaxA / 1000, ik1kA: t.ik1MinA / 1000 },
        ...chain.map(id => { const f = byPole.get(id); return { pole: id, distanceM: f.distanceM, ik3kA: f.ik3MaxA / 1000, ik1kA: f.ik1MinA / 1000 }; })]
    };
  });
}
