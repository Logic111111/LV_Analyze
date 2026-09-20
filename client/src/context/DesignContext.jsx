import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { defaultDesign, normalizeDesign } from '../lib/loadflow.js';
import { api } from '../api.js';

const DesignContext = createContext(null);

export function DesignProvider({ children }) {
  const [design, setDesign] = useState(defaultDesign());
  const [designId, setDesignId] = useState(null); // backend id of the currently loaded design, if any
  const [savedList, setSavedList] = useState([]);
  const [lastResults, setLastResults] = useState(null); // most recent Reports snapshot, used by AI Insights
  const [lastHosting, setLastHosting] = useState(null);
  const [lastBessHosting, setLastBessHosting] = useState(null); // most recent BESS system-hosting scan
  const [lastDaily, setLastDaily] = useState(null); // most recent 24-hour scan, used by the downloadable report

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
    setDesign({ ...defaultDesign(), ...normalizeDesign(d.design) });
    setDesignId(d.design.id);
    setLastResults(null);
    setLastHosting(null);
    setLastBessHosting(null);
    setLastDaily(null);
  }, []);

  const newDesign = useCallback(() => {
    setDesign(defaultDesign());
    setDesignId(null);
    setLastResults(null);
    setLastHosting(null);
    setLastBessHosting(null);
    setLastDaily(null);
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
      lastResults, setLastResults, lastHosting, setLastHosting, lastBessHosting, setLastBessHosting, lastDaily, setLastDaily
    }}>
      {children}
    </DesignContext.Provider>
  );
}

export function useDesign() { return useContext(DesignContext); }
