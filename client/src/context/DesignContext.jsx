import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { defaultDesign, withDefaults } from '../lib/loadflow.js';
import { api } from '../api.js';
import { runInWorker } from '../lib/runInWorker.js';

const DesignContext = createContext(null);

export function DesignProvider({ children }) {
  // Every way a design enters the app goes through withDefaults (see loadflow.js), so pages can
  // rely on every field existing and old saved designs pick up new fields' off-by-default values.
  const [design, setDesign] = useState(() => withDefaults(defaultDesign()));
  const [designId, setDesignId] = useState(null); // backend id of the currently loaded design, if any
  const [designMeta, setDesignMeta] = useState(null); // server-side status/ownership of it (P7.3/P7.4)
  const [savedList, setSavedList] = useState([]);
  const [lastResults, setLastResults] = useState(null); // most recent Reports snapshot, used by AI Insights
  const [lastHosting, setLastHosting] = useState(null);
  const [lastBessHosting, setLastBessHosting] = useState(null); // most recent BESS system-hosting scan
  const [lastDaily, setLastDaily] = useState(null); // most recent 24-hour scan, used by the downloadable report
  const [lastTapAdvice, setLastTapAdvice] = useState(null); // most recent tap advisor run (P2.4), for the report
  const [lastReconductor, setLastReconductor] = useState(null); // most recent reconductoring advisor run (P2.5)
  const [lastFixIt, setLastFixIt] = useState(null); // most recent fix-it ladder run (P2.6)
  const [lastScenarios, setLastScenarios] = useState(null); // most recent scenario comparison (P5.4), for the report
  const [lastMonteCarlo, setLastMonteCarlo] = useState(null); // most recent Monte Carlo study (P4.4), for the report

  const refreshSavedList = useCallback(async () => {
    try { const d = await api.listDesigns(); setSavedList(d.designs); }
    catch (e) { /* not signed in yet, or transient — ignore */ }
  }, []);

  useEffect(() => { refreshSavedList(); }, [refreshSavedList]);

  // Save (P6.5, P7.3): the fleet-dashboard summary is computed in the worker and stored with the
  // design; every save is a new version (with an optional note). A design shared by someone else
  // is saved into that design by id; one's own is saved by name, as before.
  const saveDesign = useCallback(async (note) => {
    let summary = null;
    try {
      const hostingTotalKva = lastHosting && lastHosting.length ? lastHosting.reduce((s, r) => s + r.kva, 0) : null;
      summary = await runInWorker('designSummary', { design, hostingTotalKva });
    } catch (e) { /* the save still goes ahead without a summary */ }
    const result = await api.saveDesign(design, { summary, note: typeof note === 'string' ? note : undefined, designId: designMeta && !designMeta.own ? designId : undefined });
    setDesignId(result.id);
    try { const d = await api.getDesign(result.id); setDesignMeta(d.meta || null); } catch (e) { /* list refresh below still runs */ }
    await refreshSavedList();
    return result;
  }, [design, designId, designMeta, lastHosting, refreshSavedList]);

  const loadDesign = useCallback(async (id) => {
    const d = await api.getDesign(id);
    setDesign(withDefaults(d.design));
    setDesignId(d.design.id);
    setDesignMeta(d.meta || null);
    setLastResults(null);
    setLastHosting(null);
    setLastBessHosting(null);
    setLastDaily(null);
    setLastTapAdvice(null);
    setLastReconductor(null);
    setLastFixIt(null);
    setLastScenarios(null);
    setLastMonteCarlo(null);
  }, []);

  // A blank design, or a built one (the new-design wizard, P5.8).
  const newDesign = useCallback((built) => {
    setDesign(withDefaults(built && typeof built === 'object' && built.transformers ? built : defaultDesign()));
    setDesignId(null);
    setDesignMeta(null);
    setLastResults(null);
    setLastHosting(null);
    setLastBessHosting(null);
    setLastDaily(null);
    setLastTapAdvice(null);
    setLastReconductor(null);
    setLastFixIt(null);
    setLastScenarios(null);
    setLastMonteCarlo(null);
  }, []);

  const removeDesign = useCallback(async (id) => {
    await api.deleteDesign(id);
    if (id === designId) newDesign();
    await refreshSavedList();
  }, [designId, newDesign, refreshSavedList]);

  return (
    <DesignContext.Provider value={{
      design, setDesign, designId, designMeta, setDesignMeta, savedList, refreshSavedList,
      saveDesign, loadDesign, newDesign, removeDesign,
      lastResults, setLastResults, lastHosting, setLastHosting, lastBessHosting, setLastBessHosting, lastDaily, setLastDaily,
      lastTapAdvice, setLastTapAdvice, lastReconductor, setLastReconductor, lastFixIt, setLastFixIt,
      lastScenarios, setLastScenarios, lastMonteCarlo, setLastMonteCarlo
    }}>
      {children}
    </DesignContext.Provider>
  );
}

export function useDesign() { return useContext(DesignContext); }
