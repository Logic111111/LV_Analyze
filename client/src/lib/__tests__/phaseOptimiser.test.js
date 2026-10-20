import { describe, it, expect } from 'vitest';
import {
  optimisePhaseBalance, pathImpedanceOhm, proposePhaseBalance, conductorParams, mulberry32, randomInt, DAILY_HOURS
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P4.1 — phase balancing v2.

describe('mulberry32', () => {
  it('repeats exactly for a seed and differs between seeds', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
    const sa = Array.from({ length: 5 }, a), sb = Array.from({ length: 5 }, b), sc = Array.from({ length: 5 }, c);
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
    sa.forEach(x => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); });
    const r = mulberry32(1);
    for (let i = 0; i < 200; i++) { const k = randomInt(r, 3); expect([0, 1, 2]).toContain(k); }
  });
});

describe('impedance weight', () => {
  it('is |Σ (Zph + Zn)| along the path (hand check, P3 of the fixture)', () => {
    const d = walkthroughIsland();
    let re = 0, im = 0;
    ['P1', 'P2', 'P3'].forEach(id => {
      const p = d.poles.find(x => x.id === id), cp = conductorParams(d, p.cond), km = p.spanM / 1000;
      re += (cp.R + cp.Rn) * km; im += (cp.X + cp.Xn) * km;
    });
    expect(pathImpedanceOhm(d, 'P3')).toBeCloseTo(Math.hypot(re, im), 12);
    expect(pathImpedanceOhm(d, 'P3')).toBeGreaterThan(pathImpedanceOhm(d, 'P1'));
  });
});

describe('optimisePhaseBalance on the fixture', () => {
  const runs = {
    nameplate: optimisePhaseBalance(walkthroughIsland(), 'TX', { objective: 'nameplate', kMax: 9 }),
    impedance: optimisePhaseBalance(walkthroughIsland(), 'TX', { objective: 'impedance', kMax: 9 }),
    loadflow: optimisePhaseBalance(walkthroughIsland(), 'TX', { objective: 'loadflow', kMax: 9, hours: DAILY_HOURS })
  };

  it.each(Object.keys(runs))('%s: K = 0 is today, and each K is never worse than K − 1 and uses ≤ K moves', (name) => {
    const r = runs[name];
    expect(r.pareto).toHaveLength(10);
    expect(r.pareto[0].moves).toBe(0);
    expect(r.pareto[0].changed).toEqual([]);
    r.pareto.forEach((row, k) => {
      expect(row.k).toBe(k);
      expect(row.moves).toBeLessThanOrEqual(k);
      expect(row.changed).toHaveLength(row.moves);
      if (k > 0) expect(row.objectiveValue).toBeLessThanOrEqual(r.pareto[k - 1].objectiveValue);
    });
  });

  it.each(Object.keys(runs))('%s: the K = 9 objective is ≤ the legacy proposal\'s', (name) => {
    const r = runs[name];
    expect(r.legacy.moves).toBe(9);
    // The same physical arrangement as Quick (equal loads may be picked by different ids).
    expect(r.legacy.after).toEqual(proposePhaseBalance(walkthroughIsland(), 'TX').after);
    expect(r.pareto[9].objectiveValue).toBeLessThanOrEqual(r.legacy.objectiveValue);
  });

  it('the load-flow objective reaches 0 voltage violations (24 h) within 9 moves', () => {
    const r = runs.loadflow;
    expect(r.pareto[0].metrics.voltageViolationCount).toBeGreaterThan(0);
    const first = r.pareto.find(row => row.metrics.voltageViolationCount === 0);
    expect(first).toBeTruthy();
    expect(first.moves).toBeLessThanOrEqual(9);
    expect(r.pareto[9].parts.violations).toBe(0);
    // The load-flow ranking actually uses the neutral loss and VUF: more moves keep improving them.
    expect(r.pareto[9].parts.neutralLossW).toBeLessThan(r.pareto[1].parts.neutralLossW);
  });

  it('the nameplate objective is the legacy spread (max − min connected kVA per phase)', () => {
    const r = runs.nameplate;
    expect(r.before).toEqual({ A: 30.5, B: 8, C: 8.5 });
    expect(r.pareto[0].objectiveValue).toBeCloseTo(22.5, 12);
    expect(r.legacy.objectiveValue).toBeCloseTo(1, 12);
  });
});

describe('determinism and options', () => {
  it('a fixed seed gives identical results, with annealing restarts', () => {
    const opts = { objective: 'impedance', kMax: 6, restarts: 3, iterations: 150, seed: 7 };
    const a = optimisePhaseBalance(walkthroughIsland(), 'TX', opts);
    const b = optimisePhaseBalance(walkthroughIsland(), 'TX', opts);
    expect(a).toEqual(b);
    const lf = { objective: 'loadflow', kMax: 4, restarts: 1, iterations: 40, seed: 3, hours: [20], solarMult: 0 };
    expect(optimisePhaseBalance(walkthroughIsland(), 'TX', lf)).toEqual(optimisePhaseBalance(walkthroughIsland(), 'TX', lf));
  });

  it('annealing never makes a row worse than plain local search', () => {
    const plain = optimisePhaseBalance(walkthroughIsland(), 'TX', { objective: 'nameplate', kMax: 9, withMetrics: false });
    const sa = optimisePhaseBalance(walkthroughIsland(), 'TX', { objective: 'nameplate', kMax: 9, restarts: 4, iterations: 300, seed: 11, withMetrics: false });
    sa.pareto.forEach((row, k) => expect(row.objectiveValue).toBeLessThanOrEqual(plain.pareto[k].objectiveValue + 1e-9));
  });

  it('kMax 0 returns today\'s arrangement only', () => {
    const r = optimisePhaseBalance(walkthroughIsland(), 'TX', { objective: 'nameplate', kMax: 0, withMetrics: false });
    expect(r.pareto).toHaveLength(1);
    expect(r.pareto[0].changed).toEqual([]);
  });

  it('identical connections are interchangeable: swapping two equal loads is not a move', () => {
    // L7–L11 are five identical ADMD loads on P2, all on A. Put two of them on B: whichever two
    // the search picks, the arrangement costs exactly two moves and is reported once.
    const r = optimisePhaseBalance(walkthroughIsland(), 'TX', { objective: 'nameplate', kMax: 9, withMetrics: false });
    r.pareto.forEach(row => expect(new Set(row.changed.map(c => c.id)).size).toBe(row.changed.length));
    const ids = r.items.map(it => it.id);
    expect(ids.filter(id => ['L7', 'L8', 'L9', 'L10', 'L11'].includes(id))).toHaveLength(5);
  });

  it('only touches the chosen transformer, and its load flow ignores the others', () => {
    const d = walkthroughIsland();
    d.transformers.push({ ...d.transformers[0], id: 'TX2', name: 'TX2' });
    d.poles.push({ ...d.poles[0], id: 'Q1', parent: 'TX2', spanM: 40 });
    d.loads.push({ id: 'Q1L', pole: 'Q1', type: 'general', phase: 'A', kva: 10 });
    const r = optimisePhaseBalance(d, 'TX', { objective: 'loadflow', kMax: 3, hours: [20], solarMult: 0 });
    expect(r.items.some(it => it.pole === 'Q1')).toBe(false);
    const alone = optimisePhaseBalance(walkthroughIsland(), 'TX', { objective: 'loadflow', kMax: 3, hours: [20], solarMult: 0, withMetrics: false });
    expect(r.pareto.map(row => row.objectiveValue)).toEqual(alone.pareto.map(row => row.objectiveValue));
  });
});
