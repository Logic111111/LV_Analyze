import { describe, it, expect } from 'vitest';
import { designSummary } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { balancedIsland } from './fixtures/referenceCases.js';

// P6.5 — the fleet-dashboard summary (goldens from the Phase 0 table).
describe('designSummary', () => {
  it('Walkthrough Island: 3 undervoltage violations, 19.16 kWh/day, worst 212.5 V at P3 A 19:00 (the day minimum; 212.9 V is the 20:00 golden), no fuse data', () => {
    const s = designSummary(walkthroughIsland());
    expect(s.violations).toMatchObject({ undervoltage: 3, total: 3 });
    expect(s.lossKwhDay).toBeCloseTo(19.16, 1);
    expect(s.worstV).toBeCloseTo(212.5, 1);
    expect(s.worstAt).toBe('P3 A 19:00');
    expect(s.protection).toBe('no fuse data');
    expect(s.hostingTotalKva).toBeNull();
    expect(JSON.stringify(s).length).toBeLessThan(8 * 1024); // the server's summary cap
  });
  it('balanced island: no violations, 13.29 kWh/day; a hosting total is carried when given', () => {
    const s = designSummary(balancedIsland(), { hostingTotalKva: 42.35 });
    expect(s.violations.total).toBe(0);
    expect(s.lossKwhDay).toBeCloseTo(13.29, 1);
    expect(s.hostingTotalKva).toBe(42.4);
  });
});
