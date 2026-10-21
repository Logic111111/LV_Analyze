import { describe, it, expect } from 'vitest';
import { solveLP, solveLPRowGeneration, lpKkt, rngFor, randInt, shuffle, choice, optResult, certificateLabel } from '../loadflow.js';

// O1.2 — the hand-written LP solver, checked on textbook cases with known optima, the classic
// cycling example, infeasible / unbounded / bounds-only problems, and random LPs by the KKT
// conditions. Also O1.1 (seeded PRNG) and O1.6 (result shape).
const close = (a, b, tol = 1e-7) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const expectKkt = (p, s, tol = 1e-6) => {
  const k = lpKkt(p, s);
  expect(k.primal, 'primal feasibility').toBeLessThanOrEqual(tol);
  expect(k.dual, 'dual feasibility').toBeLessThanOrEqual(tol);
  expect(k.complementarity, 'complementary slackness').toBeLessThanOrEqual(tol);
};

describe('solveLP', () => {
  it('textbook: max 3x + 5y, x ≤ 4, 2y ≤ 12, 3x + 2y ≤ 18 → 36 at (2, 6)', () => {
    const p = { c: [3, 5], A: [[1, 0], [0, 2], [3, 2]], b: [4, 12, 18] };
    const s = solveLP(p);
    expect(s.status).toBe('optimal');
    close(s.objective, 36); close(s.x[0], 2); close(s.x[1], 6);
    // Shadow prices: 0 on the slack row, 1.5 and 1 on the binding ones.
    close(s.duals[0], 0); close(s.duals[1], 1.5); close(s.duals[2], 1);
    expectKkt(p, s);
  });
  it('needs phase 1 (≥ rows and a negative right-hand side): min x + y with x + 2y ≥ 4, 3x + y ≥ 6', () => {
    // As max −x − y with −x − 2y ≤ −4, −3x − y ≤ −6 → optimum at (1.6, 1.2), value −2.8.
    const p = { c: [-1, -1], A: [[-1, -2], [-3, -1]], b: [-4, -6] };
    const s = solveLP(p);
    expect(s.status).toBe('optimal');
    close(s.objective, -2.8); close(s.x[0], 1.6); close(s.x[1], 1.2);
    expectKkt(p, s);
  });
  it("Beale's cycling example terminates at the optimum (1.25)", () => {
    const p = {
      c: [0.75, -20, 0.5, -6],
      A: [[0.25, -8, -1, 9], [0.5, -12, -0.5, 3], [0, 0, 1, 0]],
      b: [0, 0, 1]
    };
    const s = solveLP(p);
    expect(s.status).toBe('optimal');
    close(s.objective, 1.25);
    expectKkt(p, s);
  });
  it('a highly degenerate LP (many rows through one vertex)', () => {
    const rows = [];
    for (let k = 1; k <= 30; k++) rows.push([k, 31 - k]);
    const p = { c: [1, 1], A: rows, b: rows.map(r => r[0] + r[1]) }; // every row passes through (1, 1)
    const s = solveLP(p);
    expect(s.status).toBe('optimal');
    close(s.objective, 2);
    expectKkt(p, s);
  });
  it('infeasible, unbounded and bounds-only problems', () => {
    expect(solveLP({ c: [1, 1], A: [[1, 1], [-1, -1]], b: [1, -3] }).status).toBe('infeasible');
    expect(solveLP({ c: [1, 0], A: [[1, -1]], b: [1] }).status).toBe('unbounded');
    expect(solveLP({ c: [1], A: [], b: [], l: [2], u: [1] }).status).toBe('infeasible');
    const s = solveLP({ c: [2, -1, 0], A: [], b: [], l: [-1, -2, 0], u: [3, 5, 4] });
    expect(s.status).toBe('optimal');
    expect(s.x).toEqual([3, -2, 0]);
    close(s.objective, 8);
  });
  it('bounded variables with negative lower bounds (the hosting trust region shape)', () => {
    // max x + y, x + y ≤ 1.5, −1 ≤ x, y ≤ 1
    const p = { c: [1, 1], A: [[1, 1]], b: [1.5], l: [-1, -1], u: [1, 1] };
    const s = solveLP(p);
    expect(s.status).toBe('optimal');
    close(s.objective, 1.5);
    expectKkt(p, s);
  });
  it('random 200-variable LPs satisfy the KKT conditions; row generation reaches the same optimum', () => {
    const rand = rngFor(7);
    for (let trial = 0; trial < 3; trial++) {
      const n = 200, m = 120;
      const A = Array.from({ length: m }, () => Array.from({ length: n }, () => (rand() < 0.3 ? rand() * 2 - 0.5 : 0)));
      const b = Array.from({ length: m }, () => 5 + rand() * 20);
      const c = Array.from({ length: n }, () => rand() * 2 - 0.4);
      const l = Array.from({ length: n }, () => -rand());
      const u = Array.from({ length: n }, () => 1 + rand() * 3);
      const p = { c, A, b, l, u };
      const s = solveLP(p);
      expect(s.status).toBe('optimal');
      expectKkt(p, s);
      const g = solveLPRowGeneration(p, { batch: 10 });
      expect(g.status).toBe('optimal');
      close(g.objective, s.objective, 1e-6 * (1 + Math.abs(s.objective)));
      expect(g.rowsUsed).toBeLessThanOrEqual(m);
      expectKkt(p, g);
    }
  });
  it('agrees with brute-force vertex enumeration on small random LPs', () => {
    const rand = rngFor(3);
    for (let trial = 0; trial < 20; trial++) {
      // 2 variables in a box, 4 random rows: the optimum is at a vertex (intersection of 2 lines).
      const A = Array.from({ length: 4 }, () => [rand() * 2 - 1, rand() * 2 - 1]);
      const b = A.map(() => rand() * 3);
      const c = [rand() * 2 - 1, rand() * 2 - 1];
      const l = [-2, -2], u = [2, 2];
      const lines = [...A.map((a, i) => [a[0], a[1], b[i]]), [1, 0, -2], [1, 0, 2], [0, 1, -2], [0, 1, 2]];
      let best = -Infinity;
      for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
        const [a1, b1, c1] = lines[i], [a2, b2, c2] = lines[j];
        const det = a1 * b2 - a2 * b1;
        if (Math.abs(det) < 1e-12) continue;
        const x = [(c1 * b2 - c2 * b1) / det, (a1 * c2 - a2 * c1) / det];
        const ok = x.every((v, k) => v >= l[k] - 1e-9 && v <= u[k] + 1e-9) && A.every((a, k) => a[0] * x[0] + a[1] * x[1] <= b[k] + 1e-9);
        if (ok) best = Math.max(best, c[0] * x[0] + c[1] * x[1]);
      }
      const s = solveLP({ c, A, b, l, u });
      if (best === -Infinity) expect(s.status).toBe('infeasible');
      else { expect(s.status).toBe('optimal'); close(s.objective, best, 1e-7); }
    }
  });
});

describe('prng and result shape (O1.1, O1.6)', () => {
  it('same seed, same sequence; helpers stay in range', () => {
    const a = rngFor(1), b = rngFor(1);
    const seqA = Array.from({ length: 5 }, () => a()), seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
    const r = rngFor(9);
    for (let i = 0; i < 200; i++) { const k = randInt(r, 7); expect(k >= 0 && k < 7 && Number.isInteger(k)).toBe(true); }
    expect(shuffle(rngFor(4), [1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(shuffle(rngFor(4), [1, 2, 3, 4, 5])).toEqual(shuffle(rngFor(4), [1, 2, 3, 4, 5]));
    expect(['x', 'y']).toContain(choice(rngFor(2), ['x', 'y']));
  });
  it('certificates and badge text', () => {
    expect(certificateLabel(optResult({ method: 'm', certificate: 'exact' }))).toBe('Exact optimum');
    expect(certificateLabel({ certificate: 'lp-bound', gapPct: 0.42 })).toBe('Within 0.4 % of bound');
    expect(certificateLabel({ certificate: 'heuristic', restartsFoundBest: { found: 17, of: 20 } })).toBe('Best found (17/20 restarts agree)');
    expect(() => optResult({ method: 'm', certificate: 'proven' })).toThrow();
    expect(optResult({ method: 'm', certificate: 'heuristic' })).toMatchObject({ verified: true, notes: [], evaluations: 0 });
  });
});
