import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { defaultDesign, withDefaults } from '../lib/loadflow.js';
import { api } from '../api.js';

const DesignContext = createContext(null);

export function DesignProvider({ children }) {
  // Every way a design enters the app goes through withDefaults (see loadflow.js), so pages can
  // rely on every field existing and old saved designs pick up new fields' off-by-default values.
  const [design, setDesign] = useState(() => withDefaults(defaultDesign()));
  const [designId, setDesignId] = useState(null); // backend id of the currently loaded design, if any
  const [savedList, setSavedList] = useState([]);
  const [lastResults, setLastResults] = useState(null); // most recent Reports snapshot, used by AI Insights
  const [lastHosting, setLastHosting] = useState(null);
  const [lastBessHosting, setLastBessHosting] = useState(null); // most recent BESS system-hosting scan
  const [lastDaily, setLastDaily] = useState(null); // most recent 24-hour scan, used by the downloadable report
  const [lastTapAdvice, setLastTapAdvice] = useState(null); // most recent tap advisor run (P2.4), for the report

  const refreshSavedList = useCallback(async () => {
    try { const d = await api.listDesigns(); setSavedList(d.designs); }
    catch (e) { /* not signed in yet, or transient — ignore */ }
  }, []);

  useEffect(() => { refreshSavedList(); }, [refreshSavedList]);

  const saveDesign = useCallback(async () => {
    const result = await api.saveDesign(design);
    setDesignId(result.id);
    await refreshSavedList();
    return result;
  }, [design, refreshSavedList]);

  const loadDesign = useCallback(async (id) => {
    const d = await api.getDesign(id);
    setDesign(withDefaults(d.design));
    setDesignId(d.design.id);
    setLastResults(null);
    setLastHosting(null);
    setLastBessHosting(null);
    setLastDaily(null);
    setLastTapAdvice(null);
  }, []);

  const newDesign = useCallback(() => {
    setDesign(withDefaults(defaultDesign()));
    setDesignId(null);
    setLastResults(null);
    setLastHosting(null);
    setLastBessHosting(null);
    setLastDaily(null);
    setLastTapAdvice(null);
  }, []);

  const removeDesign = useCallback(async (id) => {
    await api.deleteDesign(id);
    if (id === designId) newDesign();
    await refreshSavedList();
  }, [designId, newDesign, refreshSavedList]);

  return (
    <DesignContext.Provider value={{
      design, setDesign, designId, savedList, refreshSavedList,
      saveDesign, loadDesign, newDesign, removeDesign,
      lastResults, setLastResults, lastHosting, setLastHosting, lastBessHosting, setLastBessHosting, lastDaily, setLastDaily,
      lastTapAdvice, setLastTapAdvice
    }}>
      {children}
    </DesignContext.Provider>
  );
}

export function useDesign() { return useContext(DesignContext); }
