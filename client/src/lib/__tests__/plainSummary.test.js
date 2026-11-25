import { describe, it, expect } from 'vitest';
import { plainSummary } from '../plainSummary.js';

// Basic mode's "What this means" card: a snapshot result in plain words, with where to go next.
const res = (violations, hour = 20, transformers = [{ id: 'TX1', name: 'TX1' }]) => ({ violations, hour, transformers });
const v = (pole, phase, type, value) => ({ pole, phase, type, value });

describe('plainSummary', () => {
  it('says all is well when nothing is violated', () => {
    expect(plainSummary(res([]))).toEqual({ ok: true, lines: [{ text: 'All customers are within limits at 20:00.', to: null, linkLabel: null }] });
  });

  it('counts low-voltage poles once each and names the worst (the run hour, not a slider)', () => {
    const r = plainSummary(res([v('P12', 'A', 'undervoltage', 205.3), v('P12', 'B', 'undervoltage', 207), v('P14', 'A', 'undervoltage', 210)], 20));
    expect(r.ok).toBe(false);
    expect(r.lines).toEqual([{ text: 'Voltage is too low at 2 poles at 20:00. Worst: P12 (205 V).', to: '/app/fix-it', linkLabel: 'Try the Fix-it Ladder' }]);
  });

  it('reports high voltage in the singular', () => {
    expect(plainSummary(res([v('P3', 'C', 'overvoltage', 254.6)], 12)).lines)
      .toEqual([{ text: 'Voltage is too high at 1 pole at 12:00. Worst: P3 (255 V).', to: '/app/fix-it', linkLabel: 'Try the Fix-it Ladder' }]);
  });

  it('reports overloaded cables with the worst span', () => {
    expect(plainSummary(res([v('P8', 'A', 'thermal', 101), v('P7', 'B', 'thermal', 134.2)])).lines)
      .toEqual([{ text: 'Cables are overloaded on 2 spans. Worst: the span to P7 (134 % of rating).', to: '/app/reconductor', linkLabel: 'See Reconductor' }]);
  });

  it('names each overloaded transformer', () => {
    const r = plainSummary(res([v('TX1', '-', 'transformer overload', 112.4), v('TX2', '-', 'transformer overload', 101)], 20, [{ id: 'TX1', name: 'North' }, { id: 'TX2', name: 'South' }]));
    expect(r.lines).toEqual([
      { text: 'Transformer North is overloaded (112 %).', to: '/app/feeder-split', linkLabel: 'See Feeder Split' },
      { text: 'Transformer South is overloaded (101 %).', to: '/app/feeder-split', linkLabel: 'See Feeder Split' }
    ]);
  });

  it('reports unbalance over the limit', () => {
    expect(plainSummary(res([v('P5', '-', 'unbalance', 2.6)])).lines)
      .toEqual([{ text: 'Voltage unbalance is over the limit at 1 pole.', to: '/app/load-balance', linkLabel: 'See Load Balance' }]);
  });

  it('never says all is well when the calculation did not converge', () => {
    const r = plainSummary({ ...res([], 20), converged: false, status: 'not-converged' });
    expect(r.ok).toBe(false);
    expect(r.lines).toEqual([{ text: 'The calculation did not settle at 20:00, so these results may be wrong.', to: null, linkLabel: null }]);
  });

  it('puts voltage collapse first, then the violations', () => {
    const r = plainSummary({ ...res([v('P9', 'A', 'undervoltage', 100)], 19), converged: true, status: 'collapse' });
    expect(r.ok).toBe(false);
    expect(r.lines.map(l => l.text)).toEqual([
      'The network cannot supply this load at 19:00 (voltage collapse). Reduce the load or strengthen the network.',
      'Voltage is too low at 1 pole at 19:00. Worst: P9 (100 V).'
    ]);
    expect(r.lines[0].to).toBe('/app/fix-it');
  });

  it('orders the lines low voltage, high voltage, cables, transformers, unbalance', () => {
    const r = plainSummary(res([v('P5', '-', 'unbalance', 3), v('TX1', '-', 'transformer overload', 120), v('P7', 'A', 'thermal', 110), v('P3', 'A', 'overvoltage', 260), v('P9', 'B', 'undervoltage', 200)]));
    expect(r.lines.map(l => l.to)).toEqual(['/app/fix-it', '/app/fix-it', '/app/reconductor', '/app/feeder-split', '/app/load-balance']);
    expect(r.lines[0].text).toMatch(/^Voltage is too low/);
    expect(r.lines[1].text).toMatch(/^Voltage is too high/);
  });
});
