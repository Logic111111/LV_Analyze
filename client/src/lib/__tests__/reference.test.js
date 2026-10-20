import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { REFERENCE_CASES, computeCase, caseLabel } from './fixtures/referenceCases.js';
import { diffReference } from './helpers.js';

// Full-precision regression lock: every number the engine produced for these cases at commit
// 69ac75a (before the upgrade programme), asserted to 1e-9. This is stricter than the brief's
// golden table on purpose — a refactor that drifts in the 6th decimal fails here long before it
// would show up at 2–3 decimals. If this fails, the engine's results moved: find out why. Do not
// regenerate the reference to make it pass (see scripts/gen-reference.mjs).
//
// Multi-hour cases are checked twice: cold-started (warmStart: false), which must still match to
// 1e-9, and on the default warm-started path (P1.4), which the brief holds to 1e-3 — the solver
// stops at |ΔV| < 1e-4 V, so two starts land within that band of the same fixed point. Counts
// (violations) must match exactly either way.
const reference = JSON.parse(readFileSync(new URL('./fixtures/reference.json', import.meta.url), 'utf8'));

describe('full-precision reference lock (1e-9)', () => {
  it('covers exactly the cases in referenceCases.js', () => {
    expect(reference.map(r => r.label)).toEqual(REFERENCE_CASES.map(caseLabel));
  });

  REFERENCE_CASES.forEach((c, i) => {
    it(caseLabel(c), () => {
      const mismatches = diffReference(reference[i].result, computeCase(c, { warmStart: false }), 1e-9);
      expect(mismatches.slice(0, 20), `${mismatches.length} value(s) drifted`).toEqual([]);
    });
    if (c.kind !== 'snapshot') {
      it(caseLabel(c) + ' — default warm-started path, to 1e-3', () => {
        const mismatches = diffReference(reference[i].result, computeCase(c, { warmStart: true }), 1e-3);
        expect(mismatches.slice(0, 20), `${mismatches.length} value(s) drifted`).toEqual([]);
      });
    }
  });
});
