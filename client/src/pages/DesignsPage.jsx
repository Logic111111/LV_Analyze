import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDesign } from '../context/DesignContext.jsx';
import { withDefaults } from '../lib/loadflow.js';
import VersionHistoryCard from '../components/VersionHistoryCard.jsx';

export default function DesignsPage() {
  const { design, savedList, saveDesign, loadDesign, newDesign, removeDesign } = useDesign();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef(null);
  const { setDesign } = useDesign();

  async function onSave() {
    setBusy(true); setMsg('');
    try { const r = await saveDesign(note); setNote(''); setMsg(`Saved "${design.name}" as version ${r.version}.`); }
    catch (e) { setMsg('Save failed: ' + e.message); }
    finally { setBusy(false); }
  }
  async function onLoad(id) {
    setBusy(true); setMsg('');
    try { await loadDesign(id); }
    catch (e) { setMsg('Load failed: ' + e.message); }
    finally { setBusy(false); }
  }
  async function onDelete(id, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try { await removeDesign(id); }
    catch (e) { alert('Delete failed: ' + e.message); }
  }
  function onExport() {
    const blob = new Blob([JSON.stringify(design, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = (design.name || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function onImportClick() { fileRef.current.click(); }
  function onImportFile(e) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const loaded = JSON.parse(reader.result);
        if (!loaded.poles || (!loaded.txRating && !loaded.transformers)) throw new Error('This file does not look like a Feeder Island design.');
        setDesign(withDefaults(loaded));
        setMsg('Imported "' + loaded.name + '" — click Save to add it to your account.');
      } catch (err) { alert('Import failed: ' + err.message); }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  return (
    <div>
      <div className="card">
        <h2>Current design</h2>
        <p className="hint">Saving stores this design (its full network, curves and settings) to your account under its name. Saving again with the same name adds a new version — every earlier version stays in the history below.</p>
        <label className="field" style={{ maxWidth: 520 }}><span>Version note (optional)</span><input value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="e.g. rebalanced P3 after the site visit" /></label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="primary" onClick={onSave} disabled={busy}>Save "{design.name}"</button>
          <button className="ghost" onClick={() => newDesign()}>New blank design</button>{' '}
          <Link className="ghost btn-link" to="/app/wizard">New design wizard…</Link>
          <button className="ghost" onClick={onExport}>Export JSON</button>
          <button className="ghost" onClick={onImportClick}>Import JSON</button>
          <input type="file" ref={fileRef} accept="application/json" style={{ display: 'none' }} onChange={onImportFile} />
        </div>
        {msg && <div className="note" style={{ marginTop: 12 }}>{msg}</div>}
      </div>

      <VersionHistoryCard />

      <div className="section-title">Saved designs</div>
      <div className="card">
        {savedList.length === 0 ? (
          <div className="empty">No saved designs yet — save the current one above to get started.</div>
        ) : (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Name</th><th>Total kVA</th><th>Last updated</th><th></th></tr></thead>
            <tbody>
              {savedList.map(d => (
                <tr key={d.id}>
                  <td>{d.name}</td><td>{d.txRating} kVA</td>
                  <td>{new Date(d.updatedAt).toLocaleString()}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="mini" onClick={() => onLoad(d.id)}>load</button>
                    <button className="mini" onClick={() => onDelete(d.id, d.name)}>delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
