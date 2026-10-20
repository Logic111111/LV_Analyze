import { describe, it, expect } from 'vitest';
import {
  voltageSensitivity, predictVoltages, phaseMoveChanges, linearHostingEstimateKw, runSnapshot,
  transformerSubDesign, PHASES
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P4.2 — voltage sensitivity matrix.

/** Every |V| of a snapshot as pole → phase → V. */
const voltsOf = (res) => Object.fromEntries(res.poleResults.map(pr => [pr.id, { ...pr.volt }]));

describe('extraS test injections', () => {
  it('a −1 kW injection equals 1 kW of unity-pf PV at the same pole-phase', () => {
    const d = walkthroughIsland();
    const viaS = runSnapshot(d, { year: 0, hour: 12, extraS: [{ pole: 'P2', phase: 'B', p: -1, q: 0 }] });
    const viaPv = runSnapshot(d, { year: 0, hour: 12, solarMult: 1, extraPV: [{ id: 'X', pole: 'P2', phase: 'B', kva: 1 }] });
    viaS.poleResults.forEach((pr, i) => PHASES.forEach(ph => expect(pr.volt[ph]).toBeCloseTo(viaPv.poleResults[i].volt[ph], 9)));
  });
});

describe('voltageSensitivity on the fixture', () => {
  const cases = [
    ['20:00 night peak', { year: 0, hour: 20, solarMult: 0 }],
    ['12:00 solar peak', { year: 0, hour: 12, solarMult: 1 }]
  ];

  it.each(cases)('%s: linear predictions are within 0.2 V of the load flow for ±1 kW and ±1 kvar at every pole-phase', (_n, op) => {
    const d = walkthroughIsland();
    const sens = voltageSensitivity(d, op);
    expect(sens.blocks).toHaveLength(1);
    const b = sens.blocks[0];
    expect(b.converged).toBe(true);
    expect(b.nodes).toHaveLength(9);
    let worst = 0;
    for (const n of b.nodes) {
      for (const [dP, dQ] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const pred = predictVoltages(sens, [{ pole: n.pole, phase: n.phase, dP, dQ }]);
        const truth = voltsOf(runSnapshot(d, { ...op, extraS: [{ pole: n.pole, phase: n.phase, p: -dP, q: -dQ }] }));
        Object.keys(truth).forEach(pole => PHASES.forEach(ph => { worst = Math.max(worst, Math.abs(pred[pole][ph] - truth[pole][ph])); }));
      }
    }
    expect(worst).toBeLessThan(0.2);
  });

  it('exporting raises the local voltage, and a far pole is more sensitive than a near one', () => {
    const sens = voltageSensitivity(walkthroughIsland(), { hour: 20, solarMult: 0 });
    const b = sens.blocks[0];
    const at = (pole, ph) => b.nodes.findIndex(n => n.pole === pole && n.phase === ph);
    expect(b.dVdP[at('P3', 'A')][at('P3', 'A')]).toBeGreaterThan(0);
    expect(b.dVdP[at('P3', 'A')][at('P3', 'A')]).toBeGreaterThan(b.dVdP[at('P1', 'A')][at('P1', 'A')]);
    // Single-phase export lifts its own phase and, through the neutral, pulls the others down.
    expect(b.dVdP[at('P3', 'A')][at('P3', 'B')]).toBeLessThan(b.dVdP[at('P3', 'A')][at('P3', 'A')]);
  });

  it('predicts a phase move (a 2 kW load from A to B at P3) within 0.2 V', () => {
    const d = walkthroughIsland();
    const sens = voltageSensitivity(d, { hour: 20, solarMult: 0 });
    const pred = predictVoltages(sens, phaseMoveChanges({ pole: 'P3', from: 'A', to: 'B', pKw: 2 }));
    const truth = voltsOf(runSnapshot(d, { year: 0, hour: 20, solarMult: 0, extraS: [{ pole: 'P3', phase: 'A', p: -2, q: 0 }, { pole: 'P3', phase: 'B', p: 2, q: 0 }] }));
    Object.keys(truth).forEach(pole => PHASES.forEach(ph => expect(Math.abs(pred[pole][ph] - truth[pole][ph])).toBeLessThan(0.2)));
    expect(pred.P3.A).toBeGreaterThan(sens.blocks[0].baseV[sens.blocks[0].nodes.findIndex(n => n.pole === 'P3' && n.phase === 'A')]);
  });

  it('the hosting estimate is where the linear prediction meets the band', () => {
    const d = walkthroughIsland();
    const sens = voltageSensitivity(d, { hour: 12, solarMult: 1 });
    const est = linearHostingEstimateKw(sens, 'P3', 'B');
    expect(est.kw).toBeGreaterThan(0);
    expect(Number.isFinite(est.kw)).toBe(true);
    const b = sens.blocks[0];
    const pred = predictVoltages(sens, [{ pole: 'P3', phase: 'B', dP: est.kw }]);
    const lim = est.limit === 'high' ? b.vLimHigh : b.vLimLow;
    expect(pred[est.limitPole][est.limitPhase]).toBeCloseTo(lim, 6);
  });

  it('is exact per transformer: a second transformer changes nothing in the first block', () => {
    const d = walkthroughIsland();
    d.transformers.push({ ...d.transformers[0], id: 'TX2', name: 'TX2' });
    d.poles.push({ ...d.poles[0], id: 'Q1', parent: 'TX2', spanM: 40 });
    d.loads.push({ id: 'Q1L', pole: 'Q1', type: 'general', phase: 'A', kva: 10 });
    const two = voltageSensitivity(d, { hour: 20, solarMult: 0 });
    expect(two.blocks.map(b => b.txId)).toEqual(['TX', 'TX2']);
    expect(two.blocks[0]).toEqual(voltageSensitivity(walkthroughIsland(), { hour: 20, solarMult: 0 }).blocks[0]);
    expect(transformerSubDesign(d, 'TX2').poles.map(p => p.id)).toEqual(['Q1']);
  });
});

describe('worker tasks', () => {
  it('voltageSensitivity and linearHostingEstimate return plain, cloneable data', async () => {
    const { ENGINE_TASKS } = await import('../engineTasks.js');
    const d = walkthroughIsland();
    const s = ENGINE_TASKS.voltageSensitivity({ design: d, year: 0, hour: 20, solarMult: 0 }, {});
    expect(s).toEqual(voltageSensitivity(d, { year: 0, hour: 20, solarMult: 0 }));
    const e = ENGINE_TASKS.linearHostingEstimate({ design: d }, {});
    expect(e.rows).toHaveLength(9);
    expect(structuredClone(e)).toEqual(e);
    for (let i = 1; i < e.rows.length; i++) expect(e.rows[i].kw).toBeLessThanOrEqual(e.rows[i - 1].kw);
  });
});
