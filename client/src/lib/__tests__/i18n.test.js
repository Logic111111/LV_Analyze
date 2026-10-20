import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import en from '../../i18n/en.json';
import si from '../../i18n/si.json';
import ta from '../../i18n/ta.json';

// P5.10 — the i18n dictionaries and lookups. (translate() lives in a .jsx module; its logic is
// mirrored here to keep this test free of JSX — see i18n.jsx.)
function translate(dict, key, vars) {
  let s = Object.prototype.hasOwnProperty.call(dict, key) && key !== '_meta' ? dict[key] : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return s;
}
const keys = (d) => Object.keys(d).filter(k => k !== '_meta').sort();

describe('dictionaries', () => {
  it('English is the source: every value equals its key', () => {
    keys(en).forEach(k => expect(en[k]).toBe(k));
  });
  it('Sinhala and Tamil have exactly the English keys and are marked as machine drafts', () => {
    expect(keys(si)).toEqual(keys(en));
    expect(keys(ta)).toEqual(keys(en));
    [si, ta].forEach(d => expect(d._meta.status).toMatch(/machine draft — needs native-speaker review/));
  });
  it('placeholders survive translation', () => {
    keys(en).filter(k => /\{\w+\}/.test(k)).forEach(k => {
      const ph = (s) => (s.match(/\{\w+\}/g) || []).sort();
      expect(ph(si[k])).toEqual(ph(k));
      expect(ph(ta[k])).toEqual(ph(k));
    });
  });
  it('a missing key falls back to the English text; placeholders are filled', () => {
    expect(translate(si, 'Not extracted yet')).toBe('Not extracted yet');
    expect(translate(en, '{n} errors', { n: 3 })).toBe('3 errors');
    expect(translate(ta, '{n} errors', { n: 3 })).toBe('3 பிழைகள்');
  });
  it("every literal t('…') key used in the source is in en.json", () => {
    const root = path.resolve(__dirname, '../..');
    const files = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['__tests__', 'engine'].includes(e.name)) walk(p); } else if (/\.jsx?$/.test(e.name)) files.push(p);
    });
    walk(root);
    const used = new Set();
    files.forEach(f => { for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bt\('((?:[^'\\]|\\.)+)'/g)) used.add(m[1]); });
    expect(used.size).toBeGreaterThan(20);
    const missing = [...used].filter(k => !Object.prototype.hasOwnProperty.call(en, k));
    expect(missing).toEqual([]);
  });
});
