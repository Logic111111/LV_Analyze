import { describe, it, expect } from 'vitest';
import { parseAmiCsv, amiAnalysis, applyAmiSuggestions, parseWallClock } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P6.3 — smart-meter import. Synthetic test data only.

/** Two general meters (M1 on L1, M2 on L2), hourly kWh over a Thursday and a Saturday. */
function fixture() {
  const d = walkthroughIsland();
  d.loads = d.loads.map(l => (l.id === d.loads[0].id ? { ...l, meterId: 'M1' } : l.id === d.loads[1].id ? { ...l, meterId: 'M2', type: 'general' } : l));
  const lines = ['meter_id,timestamp,kwh'];
  for (const day of ['2026-10-15', '2026-10-17']) {           // Thursday, Saturday
    for (let h = 0; h < 24; h++) {
      const weekend = day === '2026-10-17';
      lines.push(`M1,${day} ${String(h).padStart(2, '0')}:00,${(h === 19 ? 2 : 0.5) * (weekend ? 2 : 1)}`);
      lines.push(`M2,${day}T${String(h).padStart(2, '0')}:00,${h === 20 ? 3 : 0.5}`);
      lines.push(`X9,${day} ${String(h).padStart(2, '0')}:00,1`); // a meter not in the design
    }
  }
  return { d, csv: lines.join('\n') };
}

describe('AMI', () => {
  it('reads wall-clock timestamps without time-zone shifts, and weekdays', () => {
    expect(parseWallClock('2026-10-17 23:30')).toMatchObject({ day: '2026-10-17', hour: 23, minute: 30, weekend: true });
    expect(parseWallClock('2026-10-15T07:00:00')).toMatchObject({ hour: 7, weekend: false });
    expect(parseWallClock('17/10/2026 23:30')).toBeNull();
  });

  it('parses CSV, maps meters, reports unmapped meters and bad lines', () => {
    const { d, csv } = fixture();
    const { readings, errors } = parseAmiCsv(csv + '\nM1,not-a-date,1');
    expect(errors).toHaveLength(1);
    const a = amiAnalysis(d, readings, { intervalMin: 60 });
    expect(a.unmapped).toEqual(['X9']);
    expect(a.mappedMeters).toBe(2);
    expect(a.days).toBe(2);
  });

  it('curve = mean hourly demand ÷ its max; per-customer peaks; ADMD = coincident peak ÷ N ÷ pf', () => {
    const { d, csv } = fixture();
    const a = amiAnalysis(d, parseAmiCsv(csv).readings, { intervalMin: 60 });
    const c = a.curves.general.all.curve;
    // hour 19: M1 (2 + 4)/2 = 3, M2 0.5 → mean of 4 readings = (2 + 4 + 0.5 + 0.5)/4 = 1.75;
    // hour 20: (0.5 + 1 + 3 + 3)/4 = 1.875 (the max); hour 3: (0.5 + 1 + 0.5 + 0.5)/4 = 0.625
    expect(c[20]).toBe(1);
    expect(c[19]).toBeCloseTo(1.75 / 1.875, 3);
    expect(c[3]).toBeCloseTo(0.625 / 1.875, 3);
    expect(a.perCustomer.find(p => p.meterId === 'M1').peakKw).toBe(4);
    // coincident peak: Saturday 19:00 → 4 + 0.5 = 4.5; Saturday/Thursday 20:00 → 1 + 3 = 4 / 0.5 + 3 = 3.5
    expect(a.admd.general.coincidentPeakKw).toBe(4.5);
    expect(a.admd.general.admdKva).toBeCloseTo(4.5 / 2 / d.pf, 12);
  });

  it('kWh per interval becomes kW by the interval length', () => {
    const { d, csv } = fixture();
    const a = amiAnalysis(d, parseAmiCsv(csv).readings, { intervalMin: 30 });
    expect(a.perCustomer.find(p => p.meterId === 'M1').peakKw).toBe(8);
  });

  it('weekday / weekend split, and suggestions apply only when chosen', () => {
    const { d, csv } = fixture();
    const a = amiAnalysis(d, parseAmiCsv(csv).readings, { intervalMin: 60, split: true });
    expect(a.curves.general.weekday.curve[20]).toBe(1);
    // weekend: hour 19 mean (4 + 0.5)/2 = 2.25 is the maximum; hour 20 (1 + 3)/2 = 2
    expect(a.curves.general.weekend.curve[19]).toBe(1);
    expect(a.curves.general.weekend.curve[20]).toBeCloseTo(2 / 2.25, 3);
    expect(applyAmiSuggestions(d, a, {})).toEqual(d);
    const applied = applyAmiSuggestions(d, a, { curves: { general: 'weekday' }, admd: true });
    expect(applied.loadCurve).toEqual(a.curves.general.weekday.curve);
    expect(applied.admd).toBe(Math.round(a.admd.general.admdKva * 100) / 100);
    expect(applied.evCurve).toEqual(d.evCurve);
  });
});
