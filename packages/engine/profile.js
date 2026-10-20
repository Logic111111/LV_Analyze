// @ts-check
// Voltage-vs-distance profiles along feeder paths — the data behind the "voltage vs distance"
// chart (P5.3). A path runs from the transformer's LV bus (0 m) out to a leaf pole; a branchy
// feeder has one path per leaf, so a side branch shows as its own line diverging from the trunk.
import { isTransformerId, poleById } from './model.js';
import { topologyOf } from './solver.js';
/** @import { Design, SnapshotResult } from './types.js' */

/**
 * Cable distance from the pole's transformer (sum of every span on the way), m.
 * @param {Design} design @param {string} poleId @returns {number}
 */
export function distanceFromTx(design, poleId) {
  let d = 0, cur = poleId;
  const seen = new Set();
  while (!isTransformerId(design, cur)) {
    const p = poleById(design, cur);
    if (!p) throw new Error(`Pole "${cur}" is not in the design.`);
    if (seen.has(cur)) throw new Error(`Pole "${poleId}" has a parent loop.`);
    seen.add(cur);
    d += Number(p.spanM) || 0;
    cur = p.parent;
  }
  return d;
}

/**
 * @typedef {{ distanceM: number, poleId: string, isBus: boolean, A: number, B: number, C: number }} ProfilePoint
 * @typedef {{ txId: string, rootPoleId: string, leafPoleId: string, points: ProfilePoint[] }} ProfilePath
 */

/**
 * Phase voltages along feeder paths of one snapshot.
 *   - opts.path: an explicit list of pole ids, outward along one parent chain (e.g. a path the
 *     user picked) — one profile;
 *   - opts.feederRoot: a feeder's root pole (its parent is a transformer) — one profile per leaf
 *     of that feeder;
 *   - neither: every path of every feeder.
 * Each profile starts at the transformer LV bus (0 m, isBus) and lists every pole on the way.
 * @param {SnapshotResult} result @param {Design} design
 * @param {{ path?: string[], feederRoot?: string }} [opts]
 * @returns {ProfilePath[]}
 */
export function voltageProfile(result, design, opts = {}) {
  const pr = new Map(result.poleResults.map(p => [p.id, p]));
  const busOf = new Map(result.transformers.map(t => [t.id, t]));
  const { kidsMap } = topologyOf(design);

  /** @param {string[]} chain pole ids from the root out to a leaf @returns {ProfilePath} */
  const buildPath = (chain) => {
    const root = poleById(design, chain[0]);
    if (!root || !isTransformerId(design, root.parent)) throw new Error(`A profile path must start at a feeder root pole (got "${chain[0]}").`);
    const bus = busOf.get(root.parent);
    /** @type {ProfilePoint[]} */
    const points = [{ distanceM: 0, poleId: root.parent, isBus: true, A: bus.busVoltPct.A, B: bus.busVoltPct.B, C: bus.busVoltPct.C }];
    let d = 0;
    chain.forEach((id, i) => {
      const p = poleById(design, id);
      if (!p) throw new Error(`Pole "${id}" is not in the design.`);
      if (i > 0 && p.parent !== chain[i - 1]) throw new Error(`"${id}" is not fed from "${chain[i - 1]}" — a path must follow the feeder outwards.`);
      d += Number(p.spanM) || 0;
      const r = pr.get(id);
      points.push({ distanceM: d, poleId: id, isBus: false, A: r.volt.A, B: r.volt.B, C: r.volt.C });
    });
    return { txId: root.parent, rootPoleId: chain[0], leafPoleId: chain[chain.length - 1], points };
  };

  // Every root-to-leaf chain under `rootId`, depth first, children in design order.
  /** @param {string} rootId @returns {string[][]} */
  const leafChains = (rootId) => {
    /** @type {string[][]} */
    const out = [];
    /** @param {string} id @param {string[]} chain */
    const walk = (id, chain) => {
      const next = [...chain, id];
      const kids = kidsMap.get(id) || [];
      if (!kids.length) out.push(next);
      kids.forEach(k => walk(k, next));
    };
    walk(rootId, []);
    return out;
  };

  if (opts.path) return [buildPath(opts.path)];
  const roots = opts.feederRoot ? [opts.feederRoot] : design.poles.filter(p => isTransformerId(design, p.parent)).map(p => p.id);
  return roots.flatMap(r => leafChains(r).map(buildPath));
}
