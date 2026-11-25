import { describe, it, expect } from 'vitest';
import { normalizeForSearch, matchScore, searchPalette } from '../paletteSearch.js';
import si from '../../i18n/si.json';

// UI stage 1 — Ctrl/⌘+K palette matching (lib/paletteSearch.js).
const items = [
  { id: 'p:hosting', label: 'Solar Hosting', keywords: [], group: 'Optimise', kind: 'page' },
  { id: 'p:bess', label: 'BESS Hosting', keywords: [], group: 'Optimise', kind: 'page' },
  { id: 'p:fix', label: 'Fix-it Ladder', keywords: [], group: 'Optimise', kind: 'page' },
  { id: 'p:net', label: si['Network'], keywords: ['Network'], group: si['Build'], kind: 'page' }
];

describe('palette search', () => {
  it('scores prefix over word start over subsequence', () => {
    expect(matchScore('sol', 'Solar Hosting')).toBe(3);
    expect(matchScore('host', 'Solar Hosting')).toBe(2);
    expect(matchScore('slh', 'Solar Hosting')).toBe(1);
    expect(matchScore('xyz', 'Solar Hosting')).toBe(0);
  });

  it('ranks results by score, keeping input order on ties, case-insensitively', () => {
    expect(searchPalette('bess', items)[0].id).toBe('p:bess');
    expect(searchPalette('HOSTING', items).map(i => i.id)).toEqual(['p:hosting', 'p:bess']);
    expect(searchPalette('ladder', items)[0].id).toBe('p:fix');
  });

  it('removes Latin accents but keeps Sinhala vowel signs', () => {
    expect(normalizeForSearch('Café')).toBe('cafe');
    expect(normalizeForSearch(si['Network'])).toBe(si['Network'].normalize('NFD').toLowerCase());
  });

  it('finds a page by its translated label and by its English name', () => {
    expect(searchPalette(si['Network'].slice(0, 2), items)[0].id).toBe('p:net');
    expect(searchPalette('network', items)[0].id).toBe('p:net');
  });

  it('a blank query returns every item unchanged; no match returns none', () => {
    expect(searchPalette('   ', items)).toBe(items);
    expect(searchPalette('zzz', items)).toEqual([]);
  });
});
