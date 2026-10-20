import { describe, it, expect } from 'vitest';
import {
  simulateBessDay, bessParams, runDailyScan, runSnapshot, runSnapshotAt, scanAndSummarize,
  computeSystemBessHostingCapacity, rangeHours
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { balancedIsland } from './fixtures/referenceCases.js';
import { expectGolden } from './helpers.js';

// P3.2 — BESS with state of charge. The 10 kWh / 5 kVA unit below is test input (the app never
// assumes a battery's energy capacity).

function withBess(base, unit) {
  return { ...base, bess: [{ id: 'B1', pole: 'P3', phase: 'A', kva: 5, kWh: 10, socInitial: 0.5, socMin: 0.1, socMax: 0.9, ...unit }] };
}

function energyBalance(day, p, socInitial) {
  let inKwh = 0, outKwh = 0;
  day.forEach(h => { const b = h.bess[0]; if (b.pKw < 0) inKwh += -b.pKw; else outKwh += b.pKw; });
  const stored = (day[day.length - 1].bess[0].socEnd - socInitial) * p.kWh;
  return { stored, expected: inKwh * p.etaCharge - outKwh / p.etaDischarge, inKwh, outKwh };
}

describe('socSchedule', () => {
  const d = withBess(walkthroughIsland(), { mode: 'socSchedule' });
  const day = simulateBessDay(d, 0);
  const p = bessParams(d, d.bess[0]);

  it('defaults the efficiencies to √RTE each', () => {
    expect(p.etaCharge).toBeCloseTo(Math.sqrt(0.9), 12);
    expect(p.etaDischarge).toBeCloseTo(Math.sqrt(0.9), 12);
  });

  it('energy balance: Δstored = charge·ηc − discharge/ηd', () => {
    const e = energyBalance(day, p, 0.5);
    expect(e.inKwh).toBeGreaterThan(0);
    expect(e.outKwh).toBeGreaterThan(0);
    expect(e.stored).toBeCloseTo(e.expected, 9);
  });

  it('SOC stays within [socMin, socMax], charging only in the charge window and discharging only in the discharge window', () => {
    const charge = new Set(rangeHours(d.bessChargeStartHour, d.bessChargeEndHour));
    const dis = new Set(rangeHours(d.bessDischargeStartHour, d.bessDischargeEndHour));
    day.forEach((h, hour) => {
      const b = h.bess[0];
      expect(b.socEnd).toBeGreaterThanOrEqual(0.1 - 1e-9);
      expect(b.socEnd).toBeLessThanOrEqual(0.9 + 1e-9);
      if (b.pKw < 0) expect(charge.has(hour)).toBe(true);
      if (b.pKw > 0) expect(dis.has(hour)).toBe(true);
      expect(Math.abs(b.pKw)).toBeLessThanOrEqual(5 + 1e-9);
    });
    expect(day[d.bessChargeEndHour - 1].bess[0].socEnd).toBeCloseTo(0.9, 9); // charged to the top
  });

  it('every hour of a day scan carries the SOC trace, and single-hour scans agree with the full day', () => {
    const scan = runDailyScan(d, 0);
    expect(scan.every(r => Array.isArray(r.bess))).toBe(true);
    const at20 = scanAndSummarize(d, [20], 0);
    expect(at20.lossKwh).toBeCloseTo(scanAndSummarize(d, [20], 0).lossKwh, 12);
    expect(runSnapshotAt(d, { year: 0, hour: 20 }).bess[0]).toEqual(day[20].bess[0]);
  });
});

describe('solarFollowing', () => {
  it('charges when the transformer exports or local PV exceeds local load, discharges in the evening, stays in limits', () => {
    const base = walkthroughIsland();
    base.pv = [...base.pv, { id: 'S9', pole: 'P3', phase: 'A', kva: 20 }]; // strong local surplus at midday
    const d = withBess(base, { mode: 'solarFollowing', socInitial: 0.2 });
    const day = simulateBessDay(d, 0);
    const p = bessParams(d, d.bess[0]);
    const chargedAt = day.filter(h => h.bess[0].pKw < 0).map(h => h.hour);
    expect(chargedAt.length).toBeGreaterThan(0);
    chargedAt.forEach(h => expect(d.solarCurve[h]).toBeGreaterThan(0));
    expect(day.filter(h => h.bess[0].pKw > 0).every(h => rangeHours(d.bessDischargeStartHour, d.bessDischargeEndHour).includes(h.hour))).toBe(true);
    const e = energyBalance(day, p, 0.2);
    expect(e.stored).toBeCloseTo(e.expected, 9);
    day.forEach(h => { expect(h.bess[0].socEnd).toBeGreaterThanOrEqual(0.1 - 1e-9); expect(h.bess[0].socEnd).toBeLessThanOrEqual(0.9 + 1e-9); });
  });
});

describe('defaults and data', () => {
  it('"schedule" mode (the default) keeps the BESS goldens: system BESS hosting 69.95 kVA on the balanced island', () => {
    expect(simulateBessDay(balancedIsland(), 0)).toBeNull();
    expectGolden(computeSystemBessHostingCapacity(balancedIsland()).totalKva, 69.95, 2, 'total');
  });

  it('a schedule-mode unit behaves exactly as before (no SOC simulation)', () => {
    const d = withBess(walkthroughIsland(), { mode: undefined });
    expect(simulateBessDay(d, 0)).toBeNull();
    expect(runDailyScan(d, 0, { warmStart: false })[20]).toEqual(runSnapshot(d, { year: 0, hour: 20, loadMult: 1, solarMult: 1, extraBess: [] }));
  });

  it('a SOC-mode unit without kWh stays idle and is flagged, never guessed', () => {
    const d = withBess(walkthroughIsland(), { mode: 'socSchedule', kWh: null });
    const day = simulateBessDay(d, 0);
    expect(day.every(h => h.bess[0].pKw === 0 && h.bess[0].dataMissing)).toBe(true);
  });
});
