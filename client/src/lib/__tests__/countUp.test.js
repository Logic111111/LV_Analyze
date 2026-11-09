import { describe, it, expect } from 'vitest';
import { easeOutCubic, countUpValue } from '../countUp.js';

// UI stage 1 — the number interpolation behind <Readout> (lib/countUp.js).
describe('count-up', () => {
  it('easeOutCubic runs 0 → 1, clamped, and only rises', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    const s = [0, 0.1, 0.2, 0.4, 0.6, 0.8, 1].map(easeOutCubic);
    s.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(s[i]));
  });

  it('interpolates from the old value to the new one, ahead of linear', () => {
    expect(countUpValue(10, 20, 0)).toBe(10);
    expect(countUpValue(10, 20, 400)).toBe(20);
    expect(countUpValue(10, 20, 200)).toBeGreaterThan(15);
    expect(countUpValue(20, 10, 200)).toBeLessThan(15);
  });

  it('jumps straight to the target for non-finite values or a zero duration', () => {
    expect(countUpValue(NaN, 20, 100)).toBe(20);
    expect(countUpValue(10, Infinity, 100)).toBe(Infinity);
    expect(countUpValue(10, 20, 100, 0)).toBe(20);
  });
});
