import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// UI stage 1 — the colour tokens in styles.css meet WCAG 2.1 AA (4.5:1) for text in both themes,
// including each status colour on its own 14% tinted pill and the ink on accent-filled buttons.
const css = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');

function tokens(selector) {
  const start = css.indexOf(selector + '{');
  if (start < 0) throw new Error('missing block ' + selector);
  const body = css.slice(start + selector.length + 1, css.indexOf('}', start));
  const out = {};
  for (const m of body.matchAll(/--([\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})\b/g)) out[m[1]] = m[2].toUpperCase();
  return out;
}
const T = { light: tokens(':root'), dark: tokens(":root[data-theme='dark']") };

const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const lum = (c) => {
  const [r, g, b] = c.map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratioRgb = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const ratio = (a, b) => ratioRgb(rgb(a), rgb(b));
const blend = (fg, bg, alpha) => rgb(fg).map((v, i) => v * alpha + rgb(bg)[i] * (1 - alpha));

describe('colour tokens meet WCAG 2.1 AA', () => {
  for (const theme of ['light', 'dark']) {
    it(`${theme}: text colours on every surface`, () => {
      for (const fg of ['text', 'muted', 'accent', 'accent-2', 'good', 'warn', 'bad']) {
        for (const bg of ['bg', 'panel', 'panel-2']) expect(ratio(T[theme][fg], T[theme][bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${theme}: status colours on their own pill, ink on accent fills`, () => {
      for (const s of ['accent', 'good', 'warn', 'bad']) {
        expect(ratioRgb(rgb(T[theme][s]), blend(T[theme][s], T[theme].panel, 0.14)), `${s} pill`).toBeGreaterThanOrEqual(4.5);
      }
      for (const a of ['accent', 'accent-2']) expect(ratio(T[theme]['accent-ink'], T[theme][a]), `ink on ${a}`).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('uses the stage 1 palette', () => {
    expect(T.light.accent).toBe('#086A61');
    expect(T.dark.bg).toBe('#070B12');
  });
});
