import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { BUILTIN_STANDARDS_PROFILES, applyStandardsProfile, profileFromDesign, matchesProfile, standardsOf } from '../lib/loadflow.js';

// Standards profiles (P2.7). Built-in profiles ship only with a stated source; a utility's own
// limits are saved by the user. Saved profiles live in this browser (localStorage — a per-user
// convenience; shared organisation profiles come with teams, P7.4); the limits actually applied
// always travel inside the design itself, so a saved design is judged the same way anywhere.
const STORE_KEY = 'feeder-island.standards-profiles.v1';
function loadUserProfiles() {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
function storeUserProfiles(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* storage unavailable — profiles just won't persist */ }
}

export default function StandardsCard() {
  const { design, setDesign } = useDesign();
  const [userProfiles, setUserProfiles] = useState(loadUserProfiles);
  const [saveName, setSaveName] = useState('');
  const [msg, setMsg] = useState('');
  const all = [...BUILTIN_STANDARDS_PROFILES, ...userProfiles];
  const s = standardsOf(design);
  const active = all.find(p => matchesProfile(design, p) && p.name === s.profileName) || all.find(p => matchesProfile(design, p)) || null;
  const num = (v) => Number(v);

  // Editing a single limit keeps the profile name but marks it custom.
  const setStd = (patch) => setDesign(d => ({ ...d, standards: { ...d.standards, ...patch, profileName: customName(d) } }));
  const setBand = (patch) => setDesign(d => ({ ...d, ...patch, standards: { ...d.standards, profileName: customName(d) } }));
  function customName(d) {
    const n = (d.standards && d.standards.profileName) || 'Current app defaults';
    return n.endsWith(' (custom)') ? n : n + ' (custom)';
  }
  function choose(id) {
    const p = all.find(x => x.id === id);
    if (p) { setDesign(d => applyStandardsProfile(d, p)); setMsg(`Applied "${p.name}".`); }
  }
  function save() {
    const name = saveName.trim();
    if (!name) { setMsg('Enter a name for the profile.'); return; }
    if (BUILTIN_STANDARDS_PROFILES.some(p => p.name === name)) { setMsg('That name belongs to a built-in profile.'); return; }
    const p = profileFromDesign(design, name);
    const next = [...userProfiles.filter(x => x.id !== p.id), p];
    setUserProfiles(next); storeUserProfiles(next);
    setDesign(d => applyStandardsProfile(d, p));
    setSaveName(''); setMsg(`Saved "${name}" in this browser.`);
  }
  function remove(id) {
    const next = userProfiles.filter(x => x.id !== id);
    setUserProfiles(next); storeUserProfiles(next); setMsg('Profile deleted from this browser.');
  }

  return (
    <div className="card">
      <h2>Standards</h2>
      <p className="hint">The limits every result is judged against. Pick a profile or edit the values; save your utility's own set to reuse it.</p>
      <label className="field"><span>Profile</span>
        <select value={active ? active.id : ''} onChange={e => choose(e.target.value)}>
          {!active && <option value="">{s.profileName}</option>}
          {all.map(p => <option key={p.id} value={p.id}>{p.name}{userProfiles.includes(p) ? ' (saved)' : ''}</option>)}
        </select></label>
      {active && active.source && <p className="hint" style={{ marginTop: -6 }}>{active.source}</p>}
      <div className="grid g2">
        <label className="field"><span>Nominal phase-neutral voltage (V)</span>
          <input type="number" value={design.vnom} step={1} onChange={e => setBand({ vnom: num(e.target.value) })} /></label>
        <label className="field"><span>Allowed deviation (± %)</span>
          <input type="number" value={design.vdev} step={0.5} onChange={e => setBand({ vdev: num(e.target.value) })} /></label>
        <label className="field"><span>Voltage unbalance factor limit (%)</span>
          <input type="number" value={s.vufLimitPct} step={0.1} min={0} onChange={e => setStd({ vufLimitPct: num(e.target.value) })} /></label>
        <label className="field"><span>Cable loading limit (% of rating)</span>
          <input type="number" value={s.cableLoadingLimitPct} step={5} min={1} onChange={e => setStd({ cableLoadingLimitPct: num(e.target.value) })} /></label>
        <label className="field"><span>Transformer loading limit (% of rating, importing)</span>
          <input type="number" value={s.txLoadingLimitPct} step={5} min={1} onChange={e => setStd({ txLoadingLimitPct: num(e.target.value) })} /></label>
        <label className="field"><span>Fuse disconnection time</span>
          <select value={String(s.disconnectTimeS)} onChange={e => setStd({ disconnectTimeS: num(e.target.value) })}>
            <option value="5">5 s (distribution circuits)</option>
            <option value="0.4">0.4 s (final circuits)</option>
          </select></label>
      </div>
      <label className="chk"><input type="checkbox" checked={s.vufAsViolation} onChange={e => setStd({ vufAsViolation: e.target.checked })} /> Count VUF above the limit as a violation (affects hosting and the advisors)</label>
      <div className="addrow" style={{ marginTop: 8 }}>
        <input type="text" placeholder="Save these limits as… (e.g. my utility 2026)" value={saveName} onChange={e => setSaveName(e.target.value)} aria-label="Profile name" />
        <button className="ghost" onClick={save}>Save profile</button>
        {active && userProfiles.includes(active) && <button className="mini" onClick={() => remove(active.id)}>delete this saved profile</button>}
      </div>
      {msg && <p className="hint" role="status" style={{ marginTop: 6 }}>{msg}</p>}
    </div>
  );
}
