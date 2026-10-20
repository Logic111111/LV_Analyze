// @ts-check
// Fault levels and an LV fuse protection check — a simplified IEC 60909-0 method, the usual hand
// calculation for a radial LV distributor fed from a Dyn11 transformer.
//
// Assumptions (all deliberate, all conservative or neutral for the checks they feed):
//   - Voltage: U_LN = design.vnom (230 V), U_LL = √3·U_LN. Voltage factors cMax / cMin default to
//     1.05 / 0.95 — IEC 60909-0 Table 1 for LV systems with a +6 % tolerance band, matching the
//     app's ±6 % statutory band.
//   - Source (HV network) impedance referred to LV: Zq = cMax·U_LL² / S''k, split by the HV X/R.
//     A blank fault level means an infinite source (Zq = 0) — the highest Ik3 and the highest
//     Ik1, i.e. conservative for breaking capacity, not for disconnection. cMax is used in Zq for
//     both cases, as IEC 60909 derives ZQ from S''kQ with cmax.
//   - Transformer: the same per-phase R + jX the load flow uses (txImpedance), not temperature
//     corrected.
//   - Lines: the conductor library's R values are 20 °C DC resistances (the built-in 70 mm² and
//     50 mm² Al entries, 0.443 and 0.641 Ω/km, are the IEC 60228 class-2 maxima). For the minimum
//     fault they are raised to the conductor temperature θ (default 80 °C, a loaded ABC conductor
//     at the moment of the fault): R_θ = R20·(1 + α(θ − 20)), α_Al = 0.00403 /K. Reactance is not
//     temperature dependent. The maximum fault uses R20.
//   - Maximum (three-phase) fault at a node: Ik3max = cMax·U_LN / |Zq + Ztx + ΣZph(20 °C)|.
//   - Minimum (single-phase, phase–neutral) fault at a node:
//       Ik1min = cMin·U_LN / |Zq + Ztx + Σ(Zph + Zn)(θ)|
//     From symmetrical components Ik1 = 3c·U_LN / |Z1 + Z2 + Z0|. A Dyn11 transformer's
//     zero-sequence impedance seen from the LV side is ≈ its positive-sequence one (Z0 ≈ Z1),
//     so it contributes 3·Ztx; a four-wire line whose fault current returns in its own neutral
//     contributes Z1 + Z2 + Z0 = 3(Zph + Zn) (the same uncoupled phase + neutral model the load
//     flow uses). Dividing by 3 gives the loop impedance above. The delta HV winding blocks
//     zero sequence, so strictly the source adds only (2/3)·Zq; using the full Zq (the brief's
//     formula) slightly lowers Ik1min — conservative for the disconnection check.
//   - Earth-path return (MEN electrodes) is ignored: the fault is assumed to return entirely in
//     the neutral conductor, which again errs low for Ik1min.
import { C } from './complex.js';
import { conductorParams, getConductor, poleById, txImpedance } from './model.js';
import { topologyOf } from './solver.js';
import { feederTrees } from './advisors/feederSplit.js';
import { standardsOf } from './standards.js';
/** @import { Design, SnapshotResult } from './types.js' */

/** Temperature coefficient of resistance of aluminium at 20 °C, 1/K. */
export const ALPHA_AL_PER_K = 0.00403;

/**
 * @typedef {object} FaultSettings
 * @property {number | null} hvFaultMVA  HV network short-circuit level S''k, MVA; null = infinite source.
 * @property {number} hvXR       HV network X/R.
 * @property {number} cMax       Voltage factor for maximum fault current (IEC 60909: 1.05 for LV, +6 %).
 * @property {number} cMin       Voltage factor for minimum fault current (IEC 60909: 0.95 for LV).
 * @property {number} condTempC  Conductor temperature for the minimum fault, °C.
 */
/** @type {FaultSettings} */
export const FAULT_DEFAULTS = Object.freeze({ hvFaultMVA: null, hvXR: 10, cMax: 1.05, cMin: 0.95, condTempC: 80 });

/** @param {Design} design @returns {FaultSettings} */
export function faultSettings(design) {
  const f = /** @type {any} */ (design).fault || {};
  const num = (v, d) => (v === null || v === '' || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
  const mva = f.hvFaultMVA === null || f.hvFaultMVA === '' || f.hvFaultMVA === undefined ? null : Number(f.hvFaultMVA);
  return {
    hvFaultMVA: mva !== null && Number.isFinite(mva) && mva > 0 ? mva : null,
    hvXR: num(f.hvXR, FAULT_DEFAULTS.hvXR),
    cMax: num(f.cMax, FAULT_DEFAULTS.cMax),
    cMin: num(f.cMin, FAULT_DEFAULTS.cMin),
    condTempC: num(f.condTempC, FAULT_DEFAULTS.condTempC)
  };
}

/**
 * HV source impedance referred to the LV side, per phase: Zq = cMax·U_LL² / S''k, split by X/R.
 * Zero for an infinite source.
 * @param {Design} design @param {FaultSettings} [settings] @returns {import('./types.js').Complex} Ω
 */
export function sourceImpedance(design, settings = faultSettings(design)) {
  if (settings.hvFaultMVA == null) return C.zero();
  const uLL = Math.sqrt(3) * design.vnom;
  const zq = settings.cMax * uLL * uLL / (settings.hvFaultMVA * 1e6);
  const xr = settings.hvXR > 0 ? settings.hvXR : 0;
  const r = zq / Math.sqrt(1 + xr * xr);
  return { re: r, im: r * xr };
}

/**
 * @typedef {object} PoleFault
 * @property {string} id
 * @property {string} txId
 * @property {number} distanceM
 * @property {import('./types.js').Complex} zMax   Zq + Ztx + ΣZph at 20 °C, Ω (three-phase path).
 * @property {import('./types.js').Complex} zLoop  Zq + Ztx + Σ(Zph + Zn) at θ, Ω (phase–neutral loop).
 * @property {number} ik3MaxA
 * @property {number} ik1MinA
 */
/**
 * @typedef {object} TxFault
 * @property {string} id
 * @property {import('./types.js').Complex} zSource
 * @property {import('./types.js').Complex} zTx
 * @property {number} ik3MaxA   At the LV terminals.
 * @property {number} ik1MinA   At the LV terminals.
 */

/**
 * Maximum three-phase and minimum phase–neutral fault currents at every transformer's LV terminals
 * and every pole (see the module comment for the method).
 * @param {Design} design
 * @returns {{ settings: FaultSettings, transformers: TxFault[], poles: PoleFault[] }}
 */
export function faultLevels(design) {
  const settings = faultSettings(design);
  const uLN = design.vnom;
  const zq = sourceImpedance(design, settings);
  const kTheta = 1 + ALPHA_AL_PER_K * (settings.condTempC - 20);
  const { kidsMap } = topologyOf(design);

  /** @type {TxFault[]} */
  const transformers = [];
  /** @type {PoleFault[]} */
  const poles = [];
  design.transformers.forEach(tx => {
    const t = txImpedance(tx, design);
    const zTx = { re: t.r, im: t.x };
    const zUp = C.add(zq, zTx);
    transformers.push({
      id: tx.id, zSource: zq, zTx,
      ik3MaxA: settings.cMax * uLN / C.abs(zUp),
      ik1MinA: settings.cMin * uLN / C.abs(zUp)
    });
    // Walk outwards accumulating the series impedances along each path.
    /** @param {string} id @param {import('./types.js').Complex} zMaxUp @param {import('./types.js').Complex} zLoopUp @param {number} dUp */
    const walk = (id, zMaxUp, zLoopUp, dUp) => {
      const p = poleById(design, id);
      const km = (Number(p.spanM) || 0) / 1000;
      const cp = conductorParams(design, p.cond);
      const zMax = C.add(zMaxUp, { re: cp.R * km, im: cp.X * km });
      const zLoop = C.add(zLoopUp, { re: (cp.R + cp.Rn) * kTheta * km, im: (cp.X + cp.Xn) * km });
      const distanceM = dUp + (Number(p.spanM) || 0);
      poles.push({
        id, txId: tx.id, distanceM, zMax, zLoop,
        ik3MaxA: settings.cMax * uLN / C.abs(zMax),
        ik1MinA: settings.cMin * uLN / C.abs(zLoop)
      });
      (kidsMap.get(id) || []).forEach(k => walk(k, zMax, zLoop, distanceM));
    };
    (kidsMap.get(tx.id) || []).forEach(root => walk(root, zUp, zUp, 0));
  });
  return { settings, transformers, poles };
}

/* ============================================================
   PROTECTION CHECK
============================================================ */
// A fuse library is user data only: Ia (the current that blows the fuse within the disconnection
// time) comes from the manufacturer's time-current curves and is never guessed here. The library
// is empty by default and every check that needs a missing number says "data missing".
/**
 * @typedef {object} FuseType
 * @property {string} id
 * @property {number} ratingA        Rated current In.
 * @property {string} [type]         e.g. "gG NH00" — label only.
 * @property {number | null} [ia5sA]  Current that operates the fuse within 5 s, A.
 * @property {number | null} [ia04sA] Current that operates the fuse within 0.4 s, A.
 * @property {number | null} [breakingKA] Rated breaking capacity, kA.
 * @property {string} [source]       Where the numbers came from.
 */
/** @typedef {'pass' | 'fail' | 'missing'} CheckStatus */
/** @typedef {{ status: CheckStatus, detail: string }} CheckResult */

/** Key of a feeder's head fuse in design.protection.feederFuses. @param {string} txId @param {string} feederName */
export function feederFuseKey(txId, feederName) { return `${txId}|${feederName}`; }

/**
 * Every protective device position in the design, with the zone it must clear:
 *   - one head position per feeder (transformer + feeder name), at the transformer's LV board;
 *   - one per pole fuse in design.protection.poleFuses. A fuse "at pole X" sits at the upstream
 *     end of the span that feeds X: it protects X and everything downstream of it, its
 *     prospective fault current is the one at X's parent node, and its "first span" is the span
 *     into X.
 * A device's zone runs downstream until the next device (the downstream fuse clears faults
 * beyond it); positions with no fuse selected are listed too, so the gap is visible.
 * @param {Design} design
 */
export function protectionDevices(design) {
  const prot = /** @type {any} */ (design).protection || {};
  const feederFuses = prot.feederFuses || {};
  const poleFuses = prot.poleFuses || {};
  const { kidsMap } = topologyOf(design);
  const hasPoleFuse = (/** @type {string} */ id) => !!poleFuses[id];
  /** @param {string[]} starts */
  const zoneFrom = (starts) => {
    const zone = [];
    const stack = [...starts];
    while (stack.length) {
      const id = stack.shift();
      zone.push(id);
      (kidsMap.get(id) || []).forEach(k => { if (!hasPoleFuse(k)) stack.push(k); });
    }
    return zone;
  };
  const devices = [];
  feederTrees(design).forEach(t => {
    const roots = design.poles.filter(p => p.parent === t.txId && p.feeder === t.feederName).map(p => p.id);
    const key = feederFuseKey(t.txId, t.feederName);
    devices.push({
      kind: 'feeder', key, label: `${t.feederName} head (${t.txId})`, fuseId: feederFuses[key] || null,
      locationNode: t.txId, firstSpanPoles: roots,
      zonePoles: zoneFrom(roots.filter(r => !hasPoleFuse(r)))
    });
  });
  design.poles.filter(p => hasPoleFuse(p.id)).forEach(p => {
    devices.push({
      kind: 'pole', key: p.id, label: `Section fuse into ${p.id}`, fuseId: poleFuses[p.id],
      locationNode: p.parent, firstSpanPoles: [p.id], zonePoles: zoneFrom([p.id])
    });
  });
  return devices;
}

/**
 * The four checks per protective device:
 *   (a) disconnection — Ik1min at every pole in the zone ≥ the fuse's Ia for the selected
 *       disconnection time (design.standards.disconnectTimeS: 5 s or 0.4 s);
 *   (b) breaking capacity — Ik3max at the device ≤ its breaking capacity;
 *   (c) load — fuse rating ≥ the peak phase current through the device over the 24 h scan (with
 *       more than one root span under a head fuse, their phase-current magnitudes are added — an
 *       upper bound on the true phasor sum, i.e. conservative);
 *   (d) cable overload protection — fuse rating ≤ the current rating Iz of the first span (the
 *       lowest, if several).
 * Each is pass / fail / missing (no fuse chosen, or the number the check needs isn't in the
 * library). These are reported in their own panel and report section, never added to the
 * load-flow violations that hosting and the advisors rank on.
 * @param {Design} design
 * @param {SnapshotResult[]} scan The 24 h scan the load check (c) uses.
 */
export function protectionCheck(design, scan) {
  const fl = faultLevels(design);
  const fuses = /** @type {FuseType[]} */ (/** @type {any} */ (design).fuseLibrary || []);
  const fuseById = new Map(fuses.map(f => [f.id, f]));
  const disconnectTimeS = standardsOf(design).disconnectTimeS;
  const ik1At = new Map(fl.poles.map(p => [p.id, p.ik1MinA]));
  /** @type {Map<string, number>} */
  const ik3At = new Map();
  fl.transformers.forEach(t => ik3At.set(t.id, t.ik3MaxA));
  fl.poles.forEach(p => ik3At.set(p.id, p.ik3MaxA));
  // Peak |I| per phase in each pole's incoming span, over the scan.
  /** @type {Map<string, { A: number, B: number, C: number }>} */
  const peakCur = new Map();
  scan.forEach(res => res.poleResults.forEach(pr => {
    const m = peakCur.get(pr.id) || { A: 0, B: 0, C: 0 };
    ['A', 'B', 'C'].forEach(ph => { if (pr.cur[ph] > m[ph]) m[ph] = pr.cur[ph]; });
    peakCur.set(pr.id, m);
  }));
  // Scans give each hour's currents; for a device with several first spans the per-hour sums
  // would be tighter, but the magnitude sum of each span's own peak is a safe upper bound.
  /** @param {string[]} poleIds */
  const peakThrough = (poleIds) => {
    const sum = { A: 0, B: 0, C: 0 };
    poleIds.forEach(id => { const m = peakCur.get(id); if (m) ['A', 'B', 'C'].forEach(ph => { sum[ph] += m[ph]; }); });
    return Math.max(sum.A, sum.B, sum.C);
  };
  const fmtA = (/** @type {number} */ a) => `${a.toFixed(0)} A`;

  const devices = protectionDevices(design).map(dev => {
    const fuse = dev.fuseId ? fuseById.get(dev.fuseId) || null : null;
    const noFuse = (/** @type {string} */ what) => ({ status: /** @type {CheckStatus} */ ('missing'), detail: dev.fuseId ? `Fuse "${dev.fuseId}" is not in the fuse library — ${what}` : `No fuse selected — ${what}` });
    const has = (/** @type {any} */ v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
    let worstPole = null, minIk1 = Infinity;
    dev.zonePoles.forEach(id => { const ik = ik1At.get(id); if (ik < minIk1) { minIk1 = ik; worstPole = id; } });
    const ik3Here = ik3At.get(dev.locationNode);
    const peakA = peakThrough(dev.firstSpanPoles);
    const izA = Math.min(...dev.firstSpanPoles.map(id => getConductor(design, poleById(design, id).cond).I));

    /** @type {CheckResult} */
    let disconnection;
    const iaField = disconnectTimeS === 0.4 ? 'ia04sA' : 'ia5sA';
    if (!fuse) disconnection = noFuse('cannot check disconnection.');
    else if (!has(fuse[iaField])) disconnection = { status: 'missing', detail: `No Ia for ${disconnectTimeS} s in the fuse library entry "${fuse.id}".` };
    else if (!dev.zonePoles.length) disconnection = { status: 'missing', detail: 'The zone has no poles.' };
    else {
      const ia = Number(fuse[iaField]);
      disconnection = minIk1 >= ia
        ? { status: 'pass', detail: `Lowest Ik1min in the zone ${fmtA(minIk1)} (at ${worstPole}) ≥ Ia ${fmtA(ia)} for ${disconnectTimeS} s.` }
        : { status: 'fail', detail: `Ik1min ${fmtA(minIk1)} at ${worstPole} < Ia ${fmtA(ia)} for ${disconnectTimeS} s — the fuse may not clear an end-of-zone fault in time.` };
    }
    /** @type {CheckResult} */
    let breaking;
    if (!fuse) breaking = noFuse('cannot check breaking capacity.');
    else if (!has(fuse.breakingKA)) breaking = { status: 'missing', detail: `No breaking capacity in the fuse library entry "${fuse.id}".` };
    else breaking = ik3Here <= Number(fuse.breakingKA) * 1000
      ? { status: 'pass', detail: `Ik3max ${(ik3Here / 1000).toFixed(2)} kA at the device ≤ ${Number(fuse.breakingKA)} kA breaking capacity.` }
      : { status: 'fail', detail: `Ik3max ${(ik3Here / 1000).toFixed(2)} kA at the device exceeds the ${Number(fuse.breakingKA)} kA breaking capacity.` };
    /** @type {CheckResult} */
    let load;
    if (!fuse) load = noFuse('cannot check against load current.');
    else if (!has(fuse.ratingA)) load = { status: 'missing', detail: `No rating in the fuse library entry "${fuse.id}".` };
    else load = Number(fuse.ratingA) >= peakA
      ? { status: 'pass', detail: `Rating ${fmtA(Number(fuse.ratingA))} ≥ peak phase current ${fmtA(peakA)} over the 24 h scan.` }
      : { status: 'fail', detail: `Peak phase current ${fmtA(peakA)} over the 24 h scan exceeds the ${fmtA(Number(fuse.ratingA))} rating — nuisance operation.` };
    /** @type {CheckResult} */
    let cable;
    if (!fuse) cable = noFuse('cannot check cable overload protection.');
    else if (!has(fuse.ratingA)) cable = { status: 'missing', detail: `No rating in the fuse library entry "${fuse.id}".` };
    else cable = Number(fuse.ratingA) <= izA
      ? { status: 'pass', detail: `Rating ${fmtA(Number(fuse.ratingA))} ≤ first-span rating Iz ${fmtA(izA)}.` }
      : { status: 'fail', detail: `Rating ${fmtA(Number(fuse.ratingA))} exceeds the first span's rating Iz ${fmtA(izA)} — the cable is not protected against overload.` };

    const checks = { disconnection, breaking, load, cable };
    const statuses = Object.values(checks).map(c => c.status);
    const overall = statuses.includes('fail') ? 'fail' : statuses.includes('missing') ? 'missing' : 'pass';
    return { ...dev, fuse, minIk1A: Number.isFinite(minIk1) ? minIk1 : null, worstPole, ik3AtDeviceA: ik3Here, peakCurrentA: peakA, izA, checks, overall };
  });
  return { disconnectTimeS, faults: fl, devices, fuseLibraryEmpty: fuses.length === 0 };
}

