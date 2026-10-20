import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDesign } from '../context/DesignContext.jsx';
import { withDefaults, defaultDesign, transformerRatings, usableConductorCodes, TAPS, runSnapshot } from '../lib/loadflow.js';
import { initialWizard, generatePoles, buildWizardDesign, validateWizard } from '../lib/wizard.js';

// Guided new-design wizard (P5.8): five steps with inline validation; nothing is created until
// the last step. Steps are a list of buttons (keyboard-reachable), errors and warnings are written
// out per step.
const STEPS = ['Transformer', 'Feeders & poles', 'Customers', 'PV & EV', 'Review & run'];

export default function WizardPage() {
  const { newDesign } = useDesign();
  const navigate = useNavigate();
  const lib = useMemo(() => withDefaults(defaultDesign()), []);
  const [w, setW] = useState(() => initialWizard(lib));
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState(null);
  const issues = validateWizard(w, lib);
  const stepIssues = (i) => issues.filter(x => x.step === i + 1);
  const errors = issues.filter(x => x.level === 'error');
  const conds = usableConductorCodes(lib);
  const set = (patch) => setW(s => ({ ...s, ...patch }));
  const setTx = (patch) => setW(s => ({ ...s, tx: { ...s.tx, ...patch } }));

  function generate() {
    const poles = generatePoles(w.feeders);
    const perPole = Object.fromEntries(poles.map(p => [p.id, w.customers.perPole[p.id] ?? w.customers.defaultPerPole]));
    setW(s => ({ ...s, poles, customers: { ...s.customers, perPole } }));
  }
  function runCheck() {
    const d = withDefaults(buildWizardDesign(w));
    const night = runSnapshot(d, { year: 0, hour: 20, solarMult: 0 });
    const noon = runSnapshot(d, { year: 0, hour: 12, solarMult: 1 });
    setPreview({ night, noon, d });
  }
  function create() {
    newDesign(buildWizardDesign(w));
    navigate('/app/diagram');
  }

  const Issues = ({ i }) => stepIssues(i).length ? (
    <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12 }}>
      {stepIssues(i).map((x, k) => <li key={k} style={{ color: x.level === 'error' ? 'var(--bad)' : 'var(--warn)' }}><b>{x.level === 'error' ? 'Error' : 'Check'}:</b> {x.text}</li>)}
    </ul>
  ) : null;

  return (
    <div>
      <div className="card">
        <h2>New design wizard</h2>
        <ol className="wizard-steps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s}><button type="button" className={'mini' + (i === step ? ' on' : '')} aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)}>
              {i + 1}. {s}{stepIssues(i).some(x => x.level === 'error') ? ' ✖' : stepIssues(i).length ? ' ⚠' : ''}
            </button></li>
          ))}
        </ol>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        {step === 0 && (
          <>
            <h2>1. Transformer</h2>
            <div className="grid g3">
              <label className="field"><span>Design name</span><input value={w.name} onChange={e => set({ name: e.target.value })} /></label>
              <label className="field"><span>Transformer name</span><input value={w.tx.name} onChange={e => setTx({ name: e.target.value })} /></label>
              <label className="field"><span>Rating (kVA)</span>
                <select value={w.tx.txRating} onChange={e => setTx({ txRating: Number(e.target.value) })}>{transformerRatings(lib).map(r => <option key={r} value={r}>{r}</option>)}</select></label>
              <label className="field"><span>Tap</span>
                <select value={w.tx.tap} onChange={e => setTx({ tap: Number(e.target.value) })}>{Object.keys(TAPS).map(k => <option key={k} value={k}>{k} ({TAPS[k]} V)</option>)}</select></label>
              <label className="field"><span>HV supply (V, line-line)</span><input type="number" value={w.tx.hvActual} onChange={e => setTx({ hvActual: e.target.value })} /></label>
              <label className="field"><span>X/R</span><input type="number" value={w.tx.txXR} onChange={e => setTx({ txXR: e.target.value })} /></label>
              <label className="field"><span>Neutral earth Rg (Ω)</span><input type="number" value={w.tx.txGroundOhms} onChange={e => setTx({ txGroundOhms: e.target.value })} /></label>
            </div>
            <Issues i={0} />
          </>
        )}
        {step === 1 && (
          <>
            <h2>2. Feeders and poles</h2>
            <p className="hint">Each feeder is generated as a chain of poles from the transformer; edit spans and conductors after generating.</p>
            {w.feeders.map((f, i) => (
              <div key={i} className="grid g4">
                <label className="field"><span>Feeder</span><input value={f.name} onChange={e => set({ feeders: w.feeders.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)) })} /></label>
                <label className="field"><span>Poles</span><input type="number" min={1} max={60} value={f.poles} onChange={e => set({ feeders: w.feeders.map((x, k) => (k === i ? { ...x, poles: e.target.value } : x)) })} /></label>
                <label className="field"><span>Typical span (m)</span><input type="number" min={1} value={f.spanM} onChange={e => set({ feeders: w.feeders.map((x, k) => (k === i ? { ...x, spanM: e.target.value } : x)) })} /></label>
                <label className="field"><span>Conductor</span>
                  <select value={f.cond} onChange={e => set({ feeders: w.feeders.map((x, k) => (k === i ? { ...x, cond: e.target.value } : x)) })}>{conds.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
              </div>
            ))}
            <button className="mini" onClick={() => set({ feeders: [...w.feeders, { name: 'F' + (w.feeders.length + 1), poles: 3, spanM: 40, cond: w.feeders[0]?.cond || conds[0] }] })}>Add feeder</button>{' '}
            {w.feeders.length > 1 && <button className="mini" onClick={() => set({ feeders: w.feeders.slice(0, -1) })}>Remove last feeder</button>}{' '}
            <button className="ghost" onClick={generate}>Generate poles</button>
            {w.poles.length > 0 && (
              <div className="tbl-wrap" style={{ marginTop: 10 }}><table>
                <thead><tr><th scope="col">Pole</th><th scope="col">Feeder</th><th scope="col">Fed from</th><th scope="col">Span (m)</th><th scope="col">Conductor</th></tr></thead>
                <tbody>{w.poles.map((p, i) => (
                  <tr key={p.id}>
                    <td>{p.id}</td><td>{p.feeder}</td><td>{p.parent}</td>
                    <td><input type="number" aria-label={`Span into ${p.id} (m)`} value={p.spanM} onChange={e => set({ poles: w.poles.map((x, k) => (k === i ? { ...x, spanM: e.target.value } : x)) })} /></td>
                    <td><select aria-label={`Conductor into ${p.id}`} value={p.cond} onChange={e => set({ poles: w.poles.map((x, k) => (k === i ? { ...x, cond: e.target.value } : x)) })}>{Object.keys(lib.conductorLibrary).map(c => <option key={c} value={c}>{c}</option>)}</select></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <Issues i={1} />
          </>
        )}
        {step === 2 && (
          <>
            <h2>3. Customers</h2>
            <div className="grid g3">
              <label className="field"><span>Phases</span>
                <select value={w.customers.phase} onChange={e => set({ customers: { ...w.customers, phase: e.target.value } })}>
                  <option value="distribute">Rotate A → B → C</option><option value="A">All on A</option><option value="B">All on B</option><option value="C">All on C</option>
                </select></label>
              <label className="field"><span>kVA each (blank = ADMD {lib.admd} kVA)</span><input type="number" min={0} step={0.1} value={w.customers.kva} onChange={e => set({ customers: { ...w.customers, kva: e.target.value } })} /></label>
              <label className="field"><span>Set every pole to</span>
                <input type="number" min={0} value={w.customers.defaultPerPole} onChange={e => set({ customers: { ...w.customers, defaultPerPole: e.target.value, perPole: Object.fromEntries(w.poles.map(p => [p.id, e.target.value])) } })} /></label>
            </div>
            {!w.poles.length ? <p className="hint">Generate the poles in step 2 first.</p> : (
              <div className="tbl-wrap"><table>
                <thead><tr><th scope="col">Pole</th><th scope="col">Customers</th></tr></thead>
                <tbody>{w.poles.map(p => (
                  <tr key={p.id}><td>{p.id}</td><td><input type="number" min={0} aria-label={`Customers at ${p.id}`} value={w.customers.perPole[p.id] ?? 0} onChange={e => set({ customers: { ...w.customers, perPole: { ...w.customers.perPole, [p.id]: e.target.value } } })} /></td></tr>
                ))}</tbody>
              </table></div>
            )}
            <Issues i={2} />
          </>
        )}
        {step === 3 && (
          <>
            <h2>4. PV and EV</h2>
            <p className="hint">Spread evenly over the customers, each on its customer's pole and phase. No sizes are assumed: enter them, or leave the count at 0.</p>
            <div className="grid g4">
              <label className="field"><span>PV systems</span><input type="number" min={0} value={w.pv.count} onChange={e => set({ pv: { ...w.pv, count: e.target.value } })} /></label>
              <label className="field"><span>PV size (kVA)</span><input type="number" min={0} step={0.1} value={w.pv.kva} onChange={e => set({ pv: { ...w.pv, kva: e.target.value } })} /></label>
              <label className="field"><span>EV chargers</span><input type="number" min={0} value={w.ev.count} onChange={e => set({ ev: { ...w.ev, count: e.target.value } })} /></label>
              <label className="field"><span>EV charger size (kVA)</span><input type="number" min={0} step={0.1} value={w.ev.kva} onChange={e => set({ ev: { ...w.ev, kva: e.target.value } })} /></label>
            </div>
            <Issues i={3} />
          </>
        )}
        {step === 4 && (
          <>
            <h2>5. Review and run</h2>
            <p>{w.name}: {w.tx.txRating} kVA transformer, {w.feeders.length} feeder{w.feeders.length === 1 ? '' : 's'}, {w.poles.length} poles, {w.poles.reduce((s, p) => s + Math.max(0, Math.floor(Number(w.customers.perPole[p.id] ?? 0))), 0)} customers, {Number(w.pv.kva) > 0 ? w.pv.count : 0} PV, {Number(w.ev.kva) > 0 ? w.ev.count : 0} EV.</p>
            {issues.length ? (
              <ul style={{ paddingLeft: 18, fontSize: 12 }}>{issues.map((x, k) => <li key={k} style={{ color: x.level === 'error' ? 'var(--bad)' : 'var(--warn)' }}><b>Step {x.step} {x.level === 'error' ? 'error' : 'check'}:</b> {x.text}</li>)}</ul>
            ) : <p className="hint">No problems found.</p>}
            <button className="ghost" onClick={runCheck} disabled={errors.length > 0 || !w.poles.length}>Quick check (20:00 and 12:00)</button>{' '}
            <button className="primary" onClick={create} disabled={errors.length > 0 || !w.poles.length}>Create design</button>
            {preview && (
              <p className="hint" role="status" style={{ marginTop: 10 }}>
                20:00 — {preview.night.violations.filter(v => v.type.endsWith('voltage')).length} voltage violation(s), lowest {Math.min(...preview.night.poleResults.flatMap(p => [p.volt.A, p.volt.B, p.volt.C])).toFixed(1)} V, transformer {preview.night.transformers[0].txPct.toFixed(0)} %{!preview.night.converged ? ' (not converged)' : ''}.
                {' '}12:00 — {preview.noon.violations.filter(v => v.type.endsWith('voltage')).length} voltage violation(s), highest {Math.max(...preview.noon.poleResults.flatMap(p => [p.volt.A, p.volt.B, p.volt.C])).toFixed(1)} V.
              </p>
            )}
            <p className="hint">Creating replaces the design open now (save it first if needed). You land on the diagram.</p>
          </>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="mini" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>← Back</button>
          <button className="mini" onClick={() => { if (step === 1 && !w.poles.length) generate(); setStep(s => Math.min(STEPS.length - 1, s + 1)); }} disabled={step === STEPS.length - 1}>Next →</button>
        </div>
      </div>
    </div>
  );
}
