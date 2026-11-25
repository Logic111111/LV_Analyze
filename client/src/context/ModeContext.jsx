import { createContext, useContext, useEffect, useState } from 'react';
import { MODE_KEY, parseMode } from '../lib/mode.js';

// Basic hides the advanced pages and settings; Advanced shows everything. Remembered per browser.
const ModeContext = createContext({ mode: 'basic', setMode: () => {} });

function initialMode() {
  try { return parseMode(localStorage.getItem(MODE_KEY)); } catch (e) { return 'basic'; }
}

export function ModeProvider({ children }) {
  const [mode, setMode] = useState(initialMode);
  useEffect(() => {
    try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* storage unavailable */ }
  }, [mode]);
  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}

export function useMode() { return useContext(ModeContext); }
