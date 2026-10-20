// @ts-check
// Load balance advisor: move single-phase connections between phases to even out a transformer.
import { PHASES } from '../complex.js';
import { transformerOfPole } from '../model.js';
import { basePeakKva } from '../velander.js';
/** @import { Design, Phase } from '../types.js' */
/** @typedef {{ kind: 'load' | 'pv' | 'bess', label: string, id: string, pole: string, phase: Phase, kva: number, newPhase?: Phase }} BalanceItem */

/* ============================================================
   LOAD BALANCE ADVISOR
============================================================ */
// Every single-phase (phase !== 'ABC') connection fed from transformer `txId` — general/EV/EVCS/
// shop loads, rooftop PV, and BESS pooled together, each as its peak-equivalent kVA magnitude
// (ADMD-substituted for a null-kva load, same fallback the rest of the app already uses; the
// plain kva field for PV/BESS). Loads and PV/BESS are pooled deliberately: concentrating *either*
// heavy load or heavy generation on one phase stresses that phase at its own peak condition (night
// peak for load, midday for PV) — spreading either kind out by magnitude is the same practical
// fix, regardless of sign. 3-phase connections are skipped — already balanced by definition.
/** @param {Design} design @param {string} txId @returns {BalanceItem[]} */
export function balanceableConnections(design, txId) {
  const items = [];
  design.loads.forEach(l => {
    if (l.phase === 'ABC' || transformerOfPole(design, l.pole) !== txId) return;
    const kva = basePeakKva(design, l);
    items.push({ kind: 'load', label: l.type, id: l.id, pole: l.pole, phase: l.phase, kva });
  });
  design.pv.forEach(p => {
    if (p.phase === 'ABC' || transformerOfPole(design, p.pole) !== txId) return;
    items.push({ kind: 'pv', label: 'PV', id: p.id, pole: p.pole, phase: p.phase, kva: Number(p.kva) });
  });
  design.bess.forEach(b => {
    if (b.phase === 'ABC' || transformerOfPole(design, b.pole) !== txId) return;
    items.push({ kind: 'bess', label: 'BESS', id: b.id, pole: b.pole, phase: b.phase, kva: Number(b.kva) });
  });
  return items;
}

// Greedy largest-first phase balancing for transformer `txId`: sort every balanceable connection
// by kVA descending, repeatedly assign the next one to whichever phase currently has the smallest
// running total. The standard fast heuristic for this kind of balanced-partition problem — exact
// optimal partitioning is NP-hard, but largest-first greedy reliably lands close at the scale of a
// real LV island's connection count. Returns `before`/`after` per-phase kVA totals and `changed`
// (the subset whose phase actually differs from today — only these need rewiring).
/** @param {Design} design @param {string} txId @returns {{ items: BalanceItem[], before: import('../types.js').PhaseMap<number>, after: import('../types.js').PhaseMap<number>, changed: BalanceItem[] }} */
export function proposePhaseBalance(design, txId) {
  const items = balanceableConnections(design, txId);
  const before = { A: 0, B: 0, C: 0 };
  items.forEach(i => { before[i.phase] += i.kva; });
  const totals = { A: 0, B: 0, C: 0 };
  const sorted = [...items].sort((a, b) => b.kva - a.kva);
  // Ties break in favour of the connection's *current* phase (starting the reduction there
  // instead of always 'A') — otherwise an already near-balanced design would still "propose"
  // churning connections around for a differently-shaped but equally-good result, which is just
  // needless rewiring for zero benefit.
  const withNewPhase = sorted.map(item => {
    const lightest = PHASES.reduce((min, ph) => (totals[ph] < totals[min] ? ph : min), item.phase);
    totals[lightest] += item.kva;
    return { ...item, newPhase: lightest };
  });
  // The tie-break above only protects against *exact* ties; re-running the greedy pass in a fresh
  // size order can still land on a different-but-equally-balanced arrangement when several
  // connections happen to be close in size, which would otherwise "propose" real rewiring for zero
  // actual benefit. So only keep the proposal if it's a genuine improvement in max-min spread —
  // otherwise leave every connection right where it already is.
  const spread = (t) => Math.max(t.A, t.B, t.C) - Math.min(t.A, t.B, t.C);
  if (spread(totals) >= spread(before)) {
    return { items: items.map(i => ({ ...i, newPhase: i.phase })), before, after: before, changed: [] };
  }
  const changed = withNewPhase.filter(i => i.newPhase !== i.phase);
  return { items: withNewPhase, before, after: totals, changed };
}

// Applies a phase-balance proposal (see proposePhaseBalance) — updates only the matching
// loads/pv/bess entries' `phase` field; everything else is untouched. Pure, like
// buildSplitCandidate, so the same result can build both the preview design and the real Apply.
/** @param {Design} design @param {{ id: string, newPhase?: Phase }[]} changed @returns {Design} */
export function applyPhaseBalance(design, changed) {
  const byId = {}; changed.forEach(c => { byId[c.id] = c.newPhase; });
  return {
    ...design,
    loads: design.loads.map(l => byId[l.id] ? { ...l, phase: byId[l.id] } : l),
    pv: design.pv.map(p => byId[p.id] ? { ...p, phase: byId[p.id] } : p),
    bess: design.bess.map(b => byId[b.id] ? { ...b, phase: byId[b.id] } : b)
  };
}
