import { describe, it, expect } from 'vitest';
import {
  withDefaults, normalizeDesign, defaultDesign, runSnapshot, scanAndSummarize, proposePhaseBalance
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// Brief rule 2: an old saved design must load and give identical results. "Old" here is the
// earliest format the code still migrates — a flat txRating/tap/hvActual/txXR with no
// transformers[] — and it also predates every feature added since (no grounding, BESS, open
// points, ZIP, shop/EVCS curves, per-rating no-load table).
function oldFormatWalkthrough() {
  const d = walkthroughIsland();
  const tx = d.transformers[0];
  const old = {
    name: d.name, txRating: tx.txRating, tap: tx.tap, hvActual: tx.hvActual, txXR: tx.txXR,
    admd: d.admd, pf: d.pf, growth: d.growth, vnom: d.vnom, vdev: d.vdev, maxpv: d.maxpv,
    includeGeneral: d.includeGeneral, includeEV: d.includeEV, includeSolar: d.includeSolar,
    loadCurve: d.loadCurve, evCurve: d.evCurve, solarCurve: d.solarCurve,
    poles: d.poles.map(({ grounded, groundOhms, ...p }) => p),
    loads: d.loads, pv: d.pv
  };
  return JSON.parse(JSON.stringify(old)); // as it would come back from the server
}

function deepFreeze(o) {
  Object.values(o).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); });
  return Object.freeze(o);
}

const OPTS = [
  { year: 0, hour: 20, solarMult: 0 },
  { year: 5, hour: 20, solarMult: 0 },
  { year: 0, hour: 12, solarMult: 1 },
  { year: 0, hour: 12, solarMult: 1.5 }
];

describe('withDefaults: old-format designs', () => {
  const migrated = withDefaults(oldFormatWalkthrough());

  it('builds transformers[] from the flat fields, with the solver\'s own fallbacks', () => {
    expect(migrated.transformers).toEqual([{ id: 'TX', name: 'TX', txRating: 100, tap: 2, hvActual: 10800, txXR: 3, txGroundOhms: 7.5 }]);
  });

  it('defaults later-added collections to empty, not to the sample network', () => {
    expect(migrated.bess).toEqual([]);
    expect(migrated.openPoints).toEqual([]);
    expect(migrated.poles.every(p => p.grounded === false && p.groundOhms === 20)).toBe(true);
  });

  it.each(OPTS)('gives identical snapshot results to the current-format fixture: %o', (opts) => {
    expect(runSnapshot(migrated, opts)).toEqual(runSnapshot(walkthroughIsland(), opts));
  });

  it('gives an identical 24 h scan and phase-balance proposal', () => {
    expect(scanAndSummarize(migrated)).toEqual(scanAndSummarize(walkthroughIsland()));
    expect(proposePhaseBalance(migrated, 'TX')).toEqual(proposePhaseBalance(walkthroughIsland(), 'TX'));
  });

  it('matches what the app used to do on load ({...defaultDesign(), ...normalizeDesign(d)})', () => {
    const legacy = { ...defaultDesign(), ...normalizeDesign(oldFormatWalkthrough()) };
    OPTS.forEach(opts => expect(runSnapshot(migrated, opts)).toEqual(runSnapshot(legacy, opts)));
  });
});

describe('withDefaults: general behaviour', () => {
  it('passes a complete current design through unchanged', () => {
    expect(withDefaults(walkthroughIsland())).toEqual(walkthroughIsland());
    expect(withDefaults(defaultDesign())).toEqual(defaultDesign());
  });

  it('is idempotent', () => {
    const once = withDefaults(oldFormatWalkthrough());
    expect(withDefaults(once)).toEqual(once);
  });

  it('never mutates its input', () => {
    const frozen = deepFreeze(oldFormatWalkthrough());
    expect(() => withDefaults(frozen)).not.toThrow();
    expect(frozen.transformers).toBeUndefined();
  });

  it('a design missing pv gets [] — not the sample network\'s S1/S2', () => {
    const { pv, ...noPv } = walkthroughIsland();
    expect(withDefaults(noPv).pv).toEqual([]);
  });

  it('never overwrites a value that is present, including null', () => {
    const d = { ...walkthroughIsland(), admd: 2.2, vdev: 10 };
    const out = withDefaults(d);
    expect(out.admd).toBe(2.2);
    expect(out.vdev).toBe(10);
    expect(out.loads[0].kva).toBeNull();
  });

  it('keeps server-side metadata (id, updatedAt) that rides along on a loaded design', () => {
    const out = withDefaults({ ...walkthroughIsland(), id: 42, updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(out.id).toBe(42);
    expect(out.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
