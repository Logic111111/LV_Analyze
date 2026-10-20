import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { conductorCodes, getConductor, conductorParams, parseZMatrix, diagonalZMatrix, conductorIssues } from '../lib/loadflow.js';

// Coupled line model (P3.5). Matrices are the user's (e.g. from Carson's equations for their cable
// geometry) — nothing is derived from assumed geometry. "Fill diagonal" pre-fills the simple
// model's values as a starting point; with only diagonal terms the results are identical.
export default function LineModelCard() {
  const { design, setDesign } = useDesign();
  const codes = conductorCodes(design);
  const [code, setCode] = useState(codes[0]);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  const cur = getConductor(design, code);
  const hasM = (c) => !!parseZMatrix(getConductor(design, c).zMatrix);

  function load(c) {
    setCode(c);
    const m = parseZMatrix(getConductor(design, c).zMatrix);
    setText(m ? JSON.stringify(m.map(r => r.map(z => [z.re, z.im]))) : '');
    setMsg('');
  }
  function save() {
    let raw;
    try { raw = JSON.parse(text); } catch { setMsg('Not valid JSON — enter 4 rows of 4 [R, X] pairs.'); return; }
    const m = parseZMatrix(raw);
    if (!m) { setMsg('Need exactly 4 rows × 4 entries, each [R, X] in Ω/km (order A, B, C, N).'); return; }
    setDesign(d => ({ ...d, conductorLibrary: { ...(d.conductorLibrary || {}), [code]: { ...getConductor(d, code), zMatrix: m } } }));
    setMsg(`Saved the matrix for ${code}.`);
  }
  function clear() {
    setDesign(d => { const c = { ...getConductor(d, code) }; delete c.zMatrix; return { ...d, conductorLibrary: { ...(d.conductorLibrary || {}), [code]: c } }; });
    setText(''); setMsg(`Removed the matrix for ${code}.`);
  }
  function fillDiagonal() {
    if (conductorIssues(cur).length) { setMsg('This conductor is incomplete.'); return; }
    const m = diagonalZMatrix(conductorParams(design, code));
    setText(JSON.stringify(m.map(r => r.map(z => [Number(z.re.toFixed(6)), Number(z.im.toFixed(6))]))));
  }

  return (
    <div className="card">
      <h2>Line model</h2>
      <p className="hint">Simple (default): each span is phase and neutral self-impedance only — the historical model. Coupled: conductors with a 4×4 series impedance matrix (phases A, B, C and neutral, Ω/km, from your own Carson's-equations or manufacturer data) use full mutual coupling. Subtrees with earth electrodes keep the simple model.</p>
      <label className="field"><span>Model</span>
        <select value={design.lineModel || 'simple'} onChange={e => setDesign(d => ({ ...d, lineModel: e.target.value }))}>
          <option value="simple">Simple (self-impedance only)</option>
          <option value="coupled">Coupled (use matrices where given)</option>
        </select></label>
      <div className="grid g2">
        <label className="field"><span>Conductor</span>
          <select value={code} onChange={e => load(e.target.value)}>
            {codes.map(c => <option key={c} value={c}>{c}{hasM(c) ? ' — matrix set' : ''}</option>)}
          </select></label>
        <div style={{ alignSelf: 'end', marginBottom: 12 }}>
          <button className="mini" onClick={fillDiagonal}>Fill diagonal from R/X</button>{' '}
          <button className="mini" onClick={() => load(code)}>Reload saved</button>
        </div>
      </div>
      <label className="field"><span>Series impedance matrix (JSON, 4 rows × 4 [R, X] pairs, Ω/km, order A, B, C, N)</span>
        <textarea rows={4} style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }}
          value={text} onChange={e => setText(e.target.value)} placeholder='[[[0.443,0.095],[0,0],[0,0],[0,0]], …]' /></label>
      <button className="ghost" onClick={save}>Save matrix</button>{' '}
      {hasM(code) && <button className="mini" onClick={clear}>remove matrix</button>}
      {msg && <p className="hint" role="status" style={{ marginTop: 6 }}>{msg}</p>}
    </div>
  );
}
