import { describe, it, expect } from 'vitest';
import { generatePoles, generateCustomers, buildWizardDesign, validateWizard, initialWizard } from '../wizard.js';
import { defaultDesign, withDefaults, runSnapshot } from '../loadflow.js';

// P5.8 — new-design wizard.

const lib = withDefaults(defaultDesign());

describe('wizard', () => {
  it('generates one radial chain per feeder, numbered across feeders', () => {
    const poles = generatePoles([{ name: 'F1', poles: 3, spanM: 40, cond: '70ABC' }, { name: 'F2', poles: 2, spanM: 35, cond: '50ABC' }]);
    expect(poles.map(p => `${p.id}<${p.parent}`)).toEqual(['P1<TX', 'P2<P1', 'P3<P2', 'P4<TX', 'P5<P4']);
    expect(poles[3].feeder).toBe('F2');
    expect(poles[4].cond).toBe('50ABC');
  });

  it('distributes customers A → B → C across the island', () => {
    const poles = generatePoles([{ name: 'F1', poles: 2, spanM: 40, cond: '70ABC' }]);
    const loads = generateCustomers(poles, { P1: 4, P2: 3 }, 'distribute');
    expect(loads.map(l => l.phase).join('')).toBe('ABCABCA');
    expect(loads.every(l => l.kva === null)).toBe(true); // ADMD
  });

  it('builds a solvable design; PV/EV only with user sizes, spread over customers', () => {
    const w = initialWizard(lib);
    w.poles = generatePoles(w.feeders);
    w.customers.perPole = { P1: 4, P2: 4, P3: 4 };
    w.pv = { count: 3, kva: 5 }; w.ev = { count: 2, kva: '' };
    const d = withDefaults(buildWizardDesign(w));
    expect(d.loads.filter(l => l.type === 'general')).toHaveLength(12);
    expect(d.pv).toHaveLength(3);
    expect(d.pv.every(p => p.kva === 5)).toBe(true);
    expect(d.loads.filter(l => l.type === 'ev')).toHaveLength(0); // no size → none
    const r = runSnapshot(d, { year: 0, hour: 20 });
    expect(r.converged).toBe(true);
    expect(r.poleResults).toHaveLength(3);
  });

  it('validates inline: long spans warn, missing conductor data and sizeless PV/EV are errors', () => {
    const w = initialWizard(lib);
    w.poles = generatePoles([{ name: 'F1', poles: 2, spanM: 75, cond: '70ABC' }]);
    w.customers.perPole = { P1: 2, P2: 2 };
    w.pv = { count: 2, kva: '' };
    const lib2 = { ...lib, conductorLibrary: { ...lib.conductorLibrary, BAD: { R: 0.4 } } };
    w.poles[1].cond = 'BAD';
    const v = validateWizard(w, lib2);
    expect(v.filter(x => x.level === 'warning' && /long LV span/.test(x.text))).toHaveLength(2);
    expect(v.some(x => x.level === 'error' && /Conductor BAD: data missing/.test(x.text))).toBe(true);
    expect(v.some(x => x.level === 'error' && /PV system size/.test(x.text))).toBe(true);
  });

  it('warns when connected ADMD exceeds the transformer', () => {
    const w = initialWizard(lib);
    w.poles = generatePoles(w.feeders);
    w.customers.perPole = { P1: 40, P2: 40, P3: 40 };
    expect(validateWizard(w, lib).some(x => /exceeds the 100 kVA transformer/.test(x.text))).toBe(true);
  });
});
