import { useEffect, useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { api } from '../api.js';
import { designDiff } from '../lib/designDiff.js';

// Version history (P7.3): every save of the loaded design is a numbered version. Pick one to see
// a field-level summary of what changed (against the design open now, or the version before it),
// restore it (a new version with that content — nothing is overwritten), or duplicate the design.
function DiffView({ diff }) {
  if (!diff) return null;
  if (!diff.total) return <p className="hint">No differences.</p>;
  return (
    <div style={{ fontSize: 12.5 }}>
      {diff.settings.length > 0 && <><div className="section-title">Settings</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{diff.settings.slice(0, 40).map(s => <li key={s.field}><b>{s.field}</b>: {s.from} → {s.to}</li>)}</ul></>}
      {diff.items.length > 0 && <><div className="section-title">Network</div>
        <ul style={{ margin: 0, paddingLeft: 18 }}>{diff.items.slice(0, 60).map((x, i) => <li key={i}>{x.kind} <b>{x.id}</b> {x.change}{x.fields ? `: ${x.fields.join(', ')}` : ''}</li>)}</ul></>}
      {(diff.settings.length > 40 || diff.items.length > 60) && <p className="hint">… and more.</p>}
    </div>
  );
}

export default function VersionHistoryCard() {
  const { design, designId, designMeta, loadDesign, refreshSavedList } = useDesign();
  const [versions, setVersions] = useState(null);
  const [sel, setSel] = useState(null); // { version, data }
  const [against, setAgainst] = useState('current');
  const [diff, setDiff] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setVersions(null); setSel(null); setDiff(null);
    if (!designId) return;
    api.listVersions(designId).then(r => setVersions(r)).catch(e => setMsg(e.message));
  }, [designId, designMeta && designMeta.currentVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(v) {
    setMsg('');
    const r = await api.getVersion(designId, v);
    setSel(r.version);
    await compare(r.version, against);
  }
  async function compare(s = sel, mode = against) {
    if (!s) return;
    if (mode === 'current') { setDiff(designDiff(s.data, design)); return; }
    if (s.version <= 1) { setDiff({ settings: [], items: [], total: 0, first: true }); return; }
    const prev = await api.getVersion(designId, s.version - 1);
    setDiff(designDiff(prev.version.data, s.data));
  }
  async function restore() {
    if (!window.confirm(`Restore version ${sel.version}? It is saved as a new version; nothing is lost.`)) return;
    try { const r = await api.restoreVersion(designId, sel.version); await loadDesign(designId); setMsg(`Restored version ${sel.version} as version ${r.version}.`); }
    catch (e) { setMsg('Restore failed: ' + e.message); }
  }
  async function duplicate() {
    try { const r = await api.duplicateDesign(designId); await refreshSavedList(); setMsg(`Duplicated as "${r.name}" — it is in your saved designs.`); }
    catch (e) { setMsg('Duplicate failed: ' + e.message); }
  }

  if (!designId) return <div className="card" style={{ marginTop: 14 }}><h2>Version history</h2><p className="hint">Save the design (or load a saved one) to start its version history.</p></div>;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Version history — {design.name}</h2>
        <button className="mini" onClick={duplicate}>Duplicate design</button>
      </div>
      {msg && <p className="hint" role="status">{msg}</p>}
      {!versions ? <p className="hint">Loading…</p> : (
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <div className="tbl-wrap" style={{ minWidth: 0 }}><table>
            <thead><tr><th scope="col">Version</th><th scope="col">Saved</th><th scope="col">By</th><th scope="col">Note</th><th scope="col"></th></tr></thead>
            <tbody>{versions.versions.map(v => (
              <tr key={v.version} className={sel && sel.version === v.version ? 'selected' : ''}>
                <td>{v.version}{v.version === versions.currentVersion ? ' (current)' : ''}{v.version === versions.lockedVersion ? ' 🔒 approved' : ''}</td>
                <td>{new Date(v.createdAt).toLocaleString()}</td><td>{v.createdBy || '—'}</td><td>{v.note || ''}</td>
                <td><button className="mini" onClick={() => pick(v.version)} aria-label={`Show version ${v.version}`}>View</button></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div style={{ minWidth: 0 }}>
            {!sel ? <p className="hint">Pick a version to see what changed.</p> : (
              <>
                <div role="radiogroup" aria-label="Compare with" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <label className="chk"><input type="radio" name="diffAgainst" checked={against === 'current'} onChange={() => { setAgainst('current'); compare(sel, 'current'); }} /> v{sel.version} → design open now</label>
                  <label className="chk"><input type="radio" name="diffAgainst" checked={against === 'previous'} onChange={() => { setAgainst('previous'); compare(sel, 'previous'); }} /> v{sel.version - 1} → v{sel.version}</label>
                </div>
                {diff && diff.first ? <p className="hint">Version 1 is the first save.</p> : <DiffView diff={diff} />}
                {designMeta && designMeta.canEdit !== false && sel.version !== versions.currentVersion && <button className="ghost" style={{ marginTop: 8 }} onClick={restore}>Restore version {sel.version}</button>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
