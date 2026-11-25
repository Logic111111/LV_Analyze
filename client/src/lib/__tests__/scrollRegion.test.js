import { describe, it, expect } from 'vitest';
import { needsTabStop } from '../scrollRegion.js';

// UI stage 1 — a table wrapper that actually scrolls must be reachable by keyboard (WCAG 2.1.1,
// axe scrollable-region-focusable); one that fits needs no extra tab stop.
describe('needsTabStop', () => {
  it('is true when the content overflows sideways or downwards', () => {
    expect(needsTabStop({ scrollWidth: 900, clientWidth: 360, scrollHeight: 200, clientHeight: 200 })).toBe(true);
    expect(needsTabStop({ scrollWidth: 360, clientWidth: 360, scrollHeight: 900, clientHeight: 420 })).toBe(true);
  });

  it('is false when everything fits, allowing a 1 px rounding difference', () => {
    expect(needsTabStop({ scrollWidth: 360, clientWidth: 360, scrollHeight: 200, clientHeight: 200 })).toBe(false);
    expect(needsTabStop({ scrollWidth: 361, clientWidth: 360, scrollHeight: 201, clientHeight: 200 })).toBe(false);
  });
});
