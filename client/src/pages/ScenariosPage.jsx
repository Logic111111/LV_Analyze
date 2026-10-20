import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import TaskProgress from '../components/TaskProgress.jsx';
import { ConvergenceWarning } from '../components/Convergence.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import {
  TAPS, BUILTIN_STANDARDS_PROFILES, CURRENT_DESIGN_SCENARIO, MAX_COMPARED_SCENARIOS, SCENARIO_ROWS, describePatch, applyScenario
} from '../lib/loadflow.js';

// Scenario manager (P5.4): named overrides of the design (year, multipliers, taps, standards
// profile, and network changes kept from an advisor preview via "Keep as scenario"), compared up
// to four at a time. The best value in each row is marked with ★ and bold, not by colour alone.
const newId = () => 'sc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export default function ScenariosPage() {
  const { design, setDesign } = useDesign();
  const scenarios = design.scenarios || [];
  const [selected, setSelected] = useState(['__current']);
  const [result, setResult] = useState(null);
  const [msg, setMsg] = useState('');
  const task = useEngineTask();

  const update = (id, patch) => setDesign(d => ({ ...d, scenarios: (d.scenarios || []).map(s => (s.id === id ? { ...s, ...patch } : s)) }));
  const add = (base = {}) => setDesign(d => ({ ...d, scenarios: [...(d.scenarios || []), { id: newId(), name: `Scenario ${(d.scenarios || []).length + 1}`, year: 0, loadMult: 1, solarMult: 1, taps: {}, standardsProfileId: null, patch: null, note: '', ...base }] }));
  const remove = (id) => { setDesign(d => ({ ...d, scenarios: (d.scenarios || []).filter(s => s.id !== id) })); setSelected(s => s.filter(x => x !== id)); };
  const toggle = (id) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : s.length >= MAX_COMPARED_SCENARIOS ? s : [...s, id]));
  function applyToDesign(sc) {
    if (!window.confirm(`Apply "${sc.name}" to the design? Its network changes, taps and standards profile become part of the design (the year and multipliers are study settings and are not applied).`)) return;
    const a = applyScenario(design, sc);
    setDesign(() => a.design);
    setMsg(`Applied "${sc.name}" to the design.`);
  }

  async function compare() {
    const list = selected.map(id => (id === '__current' ? CURRENT_DESIGN_SCENARIO : scenarios.find(s => s.id === id))).filter(Boolean);
    const r = await task.run('compareScenarios', { design, scenarios: list }, 'Comparing scenarios');
    if (r.ok) setResult(r.result);
  }

  const fmt = (v, digits) => (Number.isFinite(v) ? v.toFixed(digits) : '—');

  return (
    <div>
      <div className="card">
        <h2>Scenarios</h2>
        <p className="hint">A scenario is a named set of overrides on this design: study year, load and solar multipliers, transformer taps, a standards profile, and network changes kept from any advisor's preview (the "Keep as scenario" button under a before/after diagram). A scenario keeps its own copy of each item it changes, so later edits to those same items in the design are overridden while the scenario is applied.</p>
        <button className="ghost" onClick={() => add()}>New scenario</button>
        {msg && <p className="hint" role="status">{msg}</p>}
      </div>

      {scenarios.map(sc => (
        <div key={sc.id} className="card" style={{ marginTop: 12 }}>
          <div className="grid g3">
            <label className="field"><span>Name</span><input value={sc.name} onChange={e => update(sc.id, { name: e.target.value })} /></label>
            <label className="field"><span>Study year</span><input type="number" min={0} max={30} value={sc.year} onChange={e => update(sc.id, { year: Number(e.target.value) || 0 })} /></label>
            <label className="field"><span>Standards profile</span>
              <select value={sc.standardsProfileId || ''} onChange={e => update(sc.id, { standardsProfileId: e.target.value || null })}>
                <option value="">The design's own</option>
                {BUILTIN_STANDARDS_PROFILES.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
            <label className="field"><span>Load multiplier</span><input type="number" min={0} step={0.05} value={sc.loadMult} onChange={e => update(sc.id, { loadMult: Number(e.target.value) })} /></label>
            <label className="field"><span>Solar multiplier</span><input type="number" min={0} step={0.05} value={sc.solarMult} onChange={e => update(sc.id, { solarMult: Number(e.target.value) })} /></label>
            {design.transformers.map(t => (
              <label key={t.id} className="field"><span>Tap — {t.name || t.id} (design: {t.tap})</span>
                <select value={(sc.taps || {})[t.id] ?? ''} onChange={e => update(sc.id, { taps: { ...(sc.taps || {}), [t.id]: e.target.value === '' ? undefined : Number(e.target.value) } })}>
                  <option value="">As designed</option>
                  {Object.keys(TAPS).map(k => <option key={k} value={k}>{k} ({TAPS[k]} V)</option>)}
                </select></label>
            ))}
          </div>
          <p className="hint" style={{ margin: '4px 0 8px' }}>Network changes: {describePatch(sc.patch)}{sc.patch && <> · <button className="mini" onClick={() => update(sc.id, { patch: null })}>clear them</button></>}</p>
          <label className="field"><span>Note</span><input value={sc.note || ''} onChange={e => update(sc.id, { note: e.target.value })} /></label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="chk"><input type="checkbox" checked={selected.includes(sc.id)} onChange={() => toggle(sc.id)} disabled={!selected.includes(sc.id) && selected.length >= MAX_COMPARED_SCENARIOS} /> Compare</label>
            <button className="mini" onClick={() => add({ ...sc, id: undefined, name: sc.name + ' (copy)' })}>Duplicate</button>
            <button className="mini" onClick={() => applyToDesign(sc)}>Apply to design…</button>
            <button className="mini" onClick={() => remove(sc.id)}>Delete</button>
          </div>
        </div>
      ))}

      <div className="card" style={{ marginTop: 12 }}>
        <h2>Compare (up to {MAX_COMPARED_SCENARIOS})</h2>
        <label className="chk"><input type="checkbox" checked={selected.includes('__current')} onChange={() => toggle('__current')} disabled={!selected.includes('__current') && selected.length >= MAX_COMPARED_SCENARIOS} /> Current design (as it is)</label>
        <p className="hint">{selected.length} selected. Each runs a 24 h scan at its own year and multipliers, plus the protection check.</p>
        <button className="primary" onClick={compare} disabled={task.running || selected.length === 0}>Compare</button>
        <TaskProgress task={task} />
        {result && (
          <>
            <ConvergenceWarning show={result.columns.some(c => !c.converged)}>Some hours did not converge in at least one scenario — treat those figures with caution.</ConvergenceWarning>
            <div className="tbl-wrap" style={{ marginTop: 10 }}><table>
              <thead><tr><th scope="col">Quantity</th>{result.columns.map(c => <th key={c.id} scope="col">{c.name}<div style={{ fontWeight: 400, textTransform: 'none' }}>yr {c.year} · ×{c.loadMult}/×{c.solarMult}</div></th>)}</tr></thead>
              <tbody>
                {SCENARIO_ROWS.map(row => (
                  <tr key={row.key}>
                    <th scope="row" style={{ textAlign: 'left' }}>{row.label}</th>
                    {result.columns.map(c => {
                      const isBest = (result.best[row.key] || []).includes(c.id);
                      const v = c[row.key];
                      let extra = '';
                      if (row.key === 'minV' && c.minAt) extra = ` (${c.minAt})`;
                      if (row.key === 'maxV' && c.maxAt) extra = ` (${c.maxAt})`;
                      if (row.key === 'protectionFails') extra = ` (${c.protection.pass} pass, ${c.protection.missing} data missing)`;
                      if (row.key === 'lossLkrYear' && v == null) extra = 'not set';
                      if (row.key === 'capexLkr' && v == null) extra = c.capexMissing.length ? `needs ${c.capexMissing.join(', ')}` : '';
                      return (
                        <td key={c.id} style={{ fontWeight: isBest ? 800 : 400, background: isBest ? 'color-mix(in srgb, var(--good) 14%, transparent)' : undefined }}>
                          {isBest ? '★ ' : ''}{fmt(v, row.digits)}{extra && <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}> {extra}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table></div>
            <p className="hint">★ = best in the row (ties all marked; rows with fewer than two numbers mark none). LKR/yr needs the energy cost of losses (Economics).</p>
          </>
        )}
      </div>
    </div>
  );
}
