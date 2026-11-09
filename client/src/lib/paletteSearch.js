// Command-palette matching (UI stage 1). Pure functions, unit-tested in Node.

/** Lower-case and strip Latin combining accents (U+0300–U+036F) only — Sinhala and Tamil vowel
 *  signs are combining marks too, and removing them would change the word. */
export function normalizeForSearch(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const WORD_SPLIT = /[\s\-–—/&(),·.:]+/;

/** 3 = prefix of the text, 2 = prefix of a word in it, 1 = in-order subsequence, 0 = no match. */
export function matchScore(query, text) {
  const q = normalizeForSearch(query).trim();
  const t = normalizeForSearch(text);
  if (!q || !t) return 0;
  if (t.startsWith(q)) return 3;
  if (t.split(WORD_SPLIT).some(w => w.startsWith(q))) return 2;
  let i = 0;
  for (const ch of t) { if (ch === q[i]) i++; if (i === q.length) return 1; }
  return 0;
}

/**
 * Items ranked by their best score over label and keywords (highest first, ties in input order);
 * items that do not match are dropped. A blank query returns `items` itself.
 * @param {string} query
 * @param {{ id: string, label: string, keywords: string[], group: string|null, kind: 'page'|'action' }[]} items
 */
export function searchPalette(query, items) {
  if (!String(query ?? '').trim()) return items;
  return items
    .map((item, idx) => ({ item, idx, score: Math.max(matchScore(query, item.label), ...(item.keywords || []).map(k => matchScore(query, k))) }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .map(r => r.item);
}
