import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from './en.json';
import si from './si.json';
import ta from './ta.json';

// Lightweight internationalisation (P5.10). Keys are the English UI text itself, so a string that
// hasn't been extracted yet, or is missing from a dictionary, simply shows in English. Values may
// use {name} placeholders. Sinhala and Tamil are machine drafts and say so in the UI until a
// native speaker has reviewed them (PROGRESS.md "waiting on data").
const DICTS = { en, si, ta };
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'si', label: 'සිංහල (draft)', draft: true },
  { code: 'ta', label: 'தமிழ் (draft)', draft: true }
];
const STORAGE_KEY = 'fi-lang';

/** Pure lookup (tested): the translation, or the key itself, with {placeholders} filled. */
export function translate(lang, key, vars) {
  const dict = DICTS[lang] || {};
  let s = Object.prototype.hasOwnProperty.call(dict, key) && key !== '_meta' ? dict[key] : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return s;
}
export const DICTIONARIES = DICTS;

const I18nContext = createContext({ lang: 'en', setLang: () => {}, t: (k, v) => translate('en', k, v) });

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s && DICTS[s]) return s; } catch (e) { /* storage unavailable */ }
    return 'en';
  });
  const setLang = useCallback((l) => {
    if (!DICTS[l]) return;
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch (e) { /* ignore */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const value = useMemo(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v) }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() { return useContext(I18nContext); }
export function useT() { return useContext(I18nContext).t; }
