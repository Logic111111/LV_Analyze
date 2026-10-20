// @ts-check
// Symmetrical components and the voltage unbalance factor (VUF).
//
// With the operator a = 1∠120°, a three-phase set (Va, Vb, Vc) decomposes into
//   V0 = (Va +    Vb +    Vc) / 3      zero sequence
//   V1 = (Va + a·Vb + a²·Vc) / 3      positive sequence
//   V2 = (Va + a²·Vb + a·Vc) / 3      negative sequence
// and VUF % = |V2| / |V1| × 100 (the "true" definition used by EN 50160 / IEC 61000-4-30).
//
// The engine's source phasors are A at 0°, B at −120°, C at +120° (positive sequence A→B→C), so
// a balanced set gives V1 = |V|, V2 = V0 = 0.
//
// The solver reports phase-to-*local*-neutral voltages, and EN 50160 states VUF on line-to-line
// voltages — but the ratio comes out identical. A neutral shift Vn moves every phase-to-neutral
// voltage by the same phasor (Va − Vn, Vb − Vn, Vc − Vn): that is a pure zero-sequence term, so it
// changes only V0, never V1 or V2. And the line-to-line set (Va−Vb, Vb−Vc, Vc−Va) has sequence
// components V1·(1 − a²) and V2·(1 − a), with |1 − a²| = |1 − a| = √3, so |V2|/|V1| is unchanged.
// (Both facts are checked in sequence.test.js.)
import { C } from './complex.js';
/** @import { Complex, PhaseMap } from './types.js' */

const A = C.fromPolar(1, 120);
const A2 = C.fromPolar(1, 240);

/** @param {PhaseMap<Complex>} v @returns {{ V0: Complex, V1: Complex, V2: Complex }} */
export function sequenceComponents(v) {
  const third = 1 / 3;
  return {
    V0: C.mulS(C.add(C.add(v.A, v.B), v.C), third),
    V1: C.mulS(C.add(C.add(v.A, C.mul(A, v.B)), C.mul(A2, v.C)), third),
    V2: C.mulS(C.add(C.add(v.A, C.mul(A2, v.B)), C.mul(A, v.C)), third)
  };
}

/** Voltage unbalance factor, % (|V2| / |V1| × 100); 0 for a dead set. @param {PhaseMap<Complex>} v */
export function vufPct(v) {
  const { V1, V2 } = sequenceComponents(v);
  const m1 = C.abs(V1);
  return m1 > 0 ? C.abs(V2) / m1 * 100 : 0;
}
