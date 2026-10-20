import { describe, it, expect } from 'vitest';
import { historyInit, historyApply, historyUndo, historyRedo, HISTORY_LIMIT, COALESCE_MS } from '../history.js';

// P7.3 — undo / redo.
describe('history', () => {
  const t0 = 1_000_000;
  it('undo and redo walk the edits; a new edit clears redo', () => {
    let h = historyInit({ n: 0 });
    h = historyApply(h, d => ({ n: d.n + 1 }), t0);
    h = historyApply(h, d => ({ n: d.n + 1 }), t0 + 5000);
    expect(h.design.n).toBe(2);
    h = historyUndo(h); expect(h.design.n).toBe(1);
    h = historyUndo(h); expect(h.design.n).toBe(0);
    expect(historyUndo(h)).toBe(h); // nothing more to undo
    h = historyRedo(h); expect(h.design.n).toBe(1);
    h = historyApply(h, { n: 9 }, t0 + 9000);
    expect(h.future).toEqual([]);
    expect(historyRedo(h)).toBe(h);
  });
  it('a burst of quick edits is one undo step', () => {
    let h = historyInit({ s: '' });
    'hello'.split('').forEach((c, i) => { h = historyApply(h, d => ({ s: d.s + c }), t0 + i * (COALESCE_MS / 3)); });
    expect(h.design.s).toBe('hello');
    expect(historyUndo(h).design.s).toBe('');
  });
  it('no-op updates are not recorded; history is capped', () => {
    let h = historyInit({ n: 0 });
    expect(historyApply(h, d => d, t0)).toBe(h);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = historyApply(h, { n: i }, t0 + i * 10000);
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});
