import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { CONDUCTORS, conductorCodes, getConductor, conductorParams, conductorIssues, IEC60228_AL_R20_OHM_PER_KM } from '../lib/loadflow.js';

// Editable conductor library (P2.5). The two built-in conductors keep their electrical data
// exactly (only label, cost and notes are editable on them); every other size is the user's,
// entered from its datasheet. Entries are added/edited through a validated form, so an incomplete
// entry can never reach the solver. IEC 60228 resistances are offered as a fill-in hint for R only
// — X, the neutral and the rating depend on the cable's construction and are never guessed.

const EMPTY_FORM = { code: '', label: '', R: '', X: '', neutralMode: 'scale', neutralValue: '', Xn: '', I: '', costPerM: '', notes: '' };
const numOrNull = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

export default function ConductorLibraryEditor() {
  const { design, setDesign } = useDesign();
  const codes = conductorCodes(design);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState(null); // code being edited, or null when adding
  const [msg, setMsg] = useState('');

  const usedBy = (code) => design.poles.filter(p => p.cond === code).map(p => p.id)
    .concat(design.openPoints.filter(o => o.cond === code).map(o => o.id));
  const setEntry = (code, entry) => setDesign(d => ({ ...d, conductorLibrary: { ...(d.conductorLibrary || {}), [code]: entry } }));

  function setBuiltinField(code, field, value) {
    const cur = getConductor(design, code);
    setEntry(code, { ...cur, [field]: field === 'costPerM' ? numOrNull(value) : value });
  }
  function startEdit(code) {
    const c = getConductor(design, code);
    setEditing(code);
    setForm({
      code, label: c.label ?? '', R: c.R ?? '', X: c.X ?? '', neutralMode: c.Rn != null ? 'R' : 'scale',
      neutralValue: c.Rn != null ? c.Rn : (c.neutralScale ?? ''), Xn: c.Xn ?? '', I: c.I ?? '', costPerM: c.costPerM ?? '', notes: c.notes ?? ''
    });
    setMsg('');
  }
  function remove(code) {
    const users = usedBy(code);
    if (users.length) { setMsg(`"${code}" is used by ${users.join(', ')} — change those spans first.`); return; }
    setDesign(d => { const next = { ...(d.conductorLibrary || {}) }; delete next[code]; return { ...d, conductorLibrary: next }; });
    if (editing === code) { setEditing(null); setForm(EMPTY_FORM); }
  }
  function save() {
    const code = form.code.trim();
    if (!code) { setMsg('Enter a code (e.g. 95ABC).'); return; }
    if (CONDUCTORS[code]) { setMsg(`"${code}" is a built-in conductor — choose another code.`); return; }
    if (!editing && codes.includes(code)) { setMsg(`"${code}" is already in the library.`); return; }
    const entry = {
      label: form.label.trim(), R: numOrNull(form.R), X: numOrNull(form.X),
      ...(form.neutralMode === 'R' ? { Rn: numOrNull(form.neutralValue) } : { neutralScale: numOrNull(form.neutralValue) }),
      ...(numOrNull(form.Xn) !== null ? { Xn: numOrNull(form.Xn) } : {}),
      I: numOrNull(form.I), costPerM: numOrNull(form.costPerM), notes: form.notes.trim()
    };
    const issues = conductorIssues(entry);
    if (issues.length) { setMsg(`Missing or invalid: ${issues.join(', ')}.`); return; }
    if (editing && editing !== code && usedBy(editing).length) { setMsg(`"${editing}" is in use by ${usedBy(editing).join(', ')} — its code can't change.`); return; }
    setDesign(d => {
      const next = { ...(d.conductorLibrary || {}) };
      if (editing && editing !== code) delete next[editing];
      next[code] = entry;
      return { ...d, conductorLibrary: next };
    });
    setMsg(`Saved "${code}".`);
    setEditing(null); setForm(EMPTY_FORM);
  }

  const f = (field) => ({ value: form[field], onChange: (e) => setForm({ ...form, [field]: e.target.value }) });

  return (
    <div className="card" style={{ padding: '8px 12px' }}>
      <div className="tbl-wrap"><table>
        <thead><tr><th>Code</th><th>Label</th><th>R (Ω/km, 20 °C)</th><th>X (Ω/km)</th><th>Neutral R (Ω/km)</th><th>Neutral X (Ω/km)</th><th>Rating (A)</th><th>Cost (LKR/m)</th><th>Notes</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {codes.map(code => {
            const c = getConductor(design, code);
            const builtIn = !!CONDUCTORS[code];
            const issues = conductorIssues(c);
            const p = issues.length ? null : conductorParams(design, code);
            return (
              <tr key={code}>
                <td>{code}{builtIn && <> <span className="pill ok" style={{ fontSize: 9.5 }}>built-in</span></>}</td>
                <td>{builtIn ? <input type="text" aria-label={`Label for ${code}`} value={c.label ?? ''} onChange={e => setBuiltinField(code, 'label', e.target.value)} /> : (c.label || '—')}</td>
                <td>{c.R ?? '—'}</td>
                <td>{p ? p.X.toFixed(3) : (c.X ?? '—')}{builtIn && <span style={{ color: 'var(--muted)' }}> (from |Z| {c.Z})</span>}</td>
                <td>{p ? p.Rn.toFixed(3) : '—'}{c.neutralScale != null && c.Rn == null ? <span style={{ color: 'var(--muted)' }}> (×{Number(c.neutralScale).toFixed(2)})</span> : ''}</td>
                <td>{p ? p.Xn.toFixed(3) : '—'}</td>
                <td>{c.I ?? '—'}</td>
                <td>{builtIn
                  ? <input type="number" aria-label={`Cost per metre for ${code}`} style={{ width: 90 }} value={c.costPerM ?? ''} onChange={e => setBuiltinField(code, 'costPerM', e.target.value)} />
                  : (c.costPerM ?? <span style={{ color: 'var(--muted)' }}>not set</span>)}</td>
                <td>{builtIn ? <input type="text" aria-label={`Notes for ${code}`} value={c.notes ?? ''} onChange={e => setBuiltinField(code, 'notes', e.target.value)} /> : (c.notes || '')}</td>
                <td>{issues.length ? <span className="pill bad" title={'Missing: ' + issues.join(', ')}>incomplete</span> : <span className="pill ok">usable</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{!builtIn && <><button className="mini" onClick={() => startEdit(code)}>edit</button>{' '}<button className="mini" onClick={() => remove(code)}>remove</button></>}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>

      <div style={{ marginTop: 14 }}>
        <b style={{ fontSize: 13 }}>{editing ? `Edit ${editing}` : 'Add a conductor size'}</b>
        <p className="hint" style={{ marginTop: 4 }}>Enter the values from the cable's datasheet. Nothing is pre-filled except, on request, R from IEC 60228 (aluminium, class 2, maximum DC resistance at 20 °C) — X, the neutral and the current rating depend on the cable's construction and must come from the manufacturer. Cost is used by the reconductoring advisor; leave it blank if unknown.</p>
        <div className="grid g4">
          <label className="field"><span>Code</span><input type="text" placeholder="e.g. 95ABC" {...f('code')} /></label>
          <label className="field"><span>Label</span><input type="text" placeholder="e.g. 3×95+70 mm² Al ABC" {...f('label')} /></label>
          <label className="field"><span>Phase R at 20 °C (Ω/km)</span><input type="number" step={0.001} min={0} {...f('R')} /></label>
          <label className="field"><span>R hint: IEC 60228 Al size</span>
            <select value="" onChange={e => { if (e.target.value) setForm({ ...form, R: String(IEC60228_AL_R20_OHM_PER_KM[e.target.value]) }); }}>
              <option value="">— fill R from a size —</option>
              {Object.entries(IEC60228_AL_R20_OHM_PER_KM).map(([mm2, r]) => <option key={mm2} value={mm2}>{mm2} mm² → {r} Ω/km</option>)}
            </select></label>
          <label className="field"><span>Phase X (Ω/km)</span><input type="number" step={0.001} min={0} {...f('X')} /></label>
          <label className="field"><span>Neutral given as</span>
            <select value={form.neutralMode} onChange={e => setForm({ ...form, neutralMode: e.target.value })}>
              <option value="scale">scale × phase R</option><option value="R">neutral R (Ω/km)</option>
            </select></label>
          <label className="field"><span>{form.neutralMode === 'R' ? 'Neutral R (Ω/km)' : 'Neutral R ÷ phase R'}</span><input type="number" step={0.001} min={0} {...f('neutralValue')} /></label>
          <label className="field"><span>Neutral X (Ω/km, blank = phase X)</span><input type="number" step={0.001} min={0} {...f('Xn')} /></label>
          <label className="field"><span>Current rating (A)</span><input type="number" step={1} min={0} {...f('I')} /></label>
          <label className="field"><span>Cost (LKR per metre)</span><input type="number" step={10} min={0} {...f('costPerM')} /></label>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Notes / source</span><input type="text" placeholder="datasheet reference" {...f('notes')} /></label>
        </div>
        <button className="primary" onClick={save}>{editing ? 'Save changes' : '+ Add conductor'}</button>{' '}
        {editing && <button className="ghost" onClick={() => { setEditing(null); setForm(EMPTY_FORM); setMsg(''); }}>Cancel edit</button>}
        {msg && <p className="hint" role="status" style={{ marginTop: 8 }}>{msg}</p>}
      </div>
    </div>
  );
}
