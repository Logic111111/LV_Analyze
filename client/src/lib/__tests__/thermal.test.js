import { describe, it, expect } from 'vitest';
import { simulateHotSpot, thermalSettings, ageingRate, transformerAgeing, runDailyScan, THERMAL_DEFAULTS, withDefaults } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P3.3 — transformer thermal ageing (IEC 60076-7).

const p = thermalSettings({});
const flat = (v) => Array(24).fill(v);

describe('IEC 60076-7 hot-spot model', () => {
  it('ageing rate: V = 1 at 98 °C and doubles every 6 K', () => {
    expect(ageingRate(98)).toBe(1);
    expect(ageingRate(104)).toBeCloseTo(2, 12);
    expect(ageingRate(92)).toBeCloseTo(0.5, 12);
  });

  it('constant rated load at the 20 °C reference ambient: hot spot 98 °C, V ≈ 1, 24 equivalent hours per day', () => {
    const r = simulateHotSpot(flat(1), flat(20), p);
    expect(r.periodic).toBe(true);
    r.hours.forEach(h => expect(h.hotSpotC).toBeCloseTo(98, 3));
    expect(r.relativeAgeing).toBeCloseTo(1, 3);
    expect(r.lossOfLifeHoursPerDay).toBeCloseTo(24, 2);
  });

  it('steady state at other loads: θh = θa + Δθor·[(1+K²R)/(1+R)]^x + Hgr·K^y', () => {
    const K = 0.6;
    const expected = 30 + 55 * Math.pow((1 + K * K * 5) / 6, 0.8) + 23 * Math.pow(K, 1.6);
    expect(simulateHotSpot(flat(K), flat(30), p).hours[12].hotSpotC).toBeCloseTo(expected, 3);
  });

  it('responds to a load step with the oil time constant (not instantly)', () => {
    const k = [...flat(0.5).slice(0, 18), ...flat(1.3).slice(0, 6)];
    const r = simulateHotSpot(k, flat(20), p);
    const steady13 = 20 + 55 * Math.pow((1 + 1.69 * 5) / 6, 0.8) + 23 * Math.pow(1.3, 1.6);
    expect(r.hours[18].hotSpotC).toBeLessThan(steady13 - 5); // 1 h into a 3 h-time-constant rise
    expect(r.peakHour).toBe(23);
    expect(r.relativeAgeing).toBeGreaterThan(simulateHotSpot(flat(0.5), flat(20), p).relativeAgeing);
  });

  it('defaults: the ambient is the flat 20 °C reference and every parameter is editable via design.thermal', () => {
    expect(thermalSettings(withDefaults(walkthroughIsland())).ambientC).toEqual(flat(20));
    expect(THERMAL_DEFAULTS).toMatchObject({ oilExponentX: 0.8, windingExponentY: 1.6, lossRatioR: 5, tauOilMin: 180, tauWindingMin: 4 });
    expect(thermalSettings({ thermal: { topOilRiseK: 60, ambientC: flat(30) } })).toMatchObject({ topOilRiseK: 60, hotSpotGradientK: 23, ambientC: flat(30) });
  });
});

describe('from a 24 h scan', () => {
  it('Walkthrough Island: a lightly loaded 100 kVA transformer ages far slower than the reference', () => {
    const d = walkthroughIsland();
    const [tx] = transformerAgeing(d, runDailyScan(d, 0));
    expect(tx.id).toBe('TX');
    expect(tx.hours).toHaveLength(24);
    expect(tx.peakHotSpotC).toBeLessThan(98);
    expect(tx.relativeAgeing).toBeLessThan(0.1);
    expect(tx.hours[20].K).toBeCloseTo(0.38974, 4); // 38.97 % at 20:00 (golden)
  });
});
