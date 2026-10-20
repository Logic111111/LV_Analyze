import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { applyReconductor, describeReconductor, runSnapshot, usableConductorCodes } from '../lib/loadflow.js';
import { buildDiagramSVG } from '../lib/diagram.js';
import TaskProgress from '../components/TaskProgress.jsx';
import { ConvergenceWarning } from '../components/Convergence.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';

// Reconductoring advisor (P2.5): which spans to restring, ranked by violations removed, then cost
// (when every option in a tier has one), then energy loss. Each candidate is an exact 24 h scan
// per checked year, run in the engine worker.
const lkr = (v) => (v == null ? null : Math.round(v).toLocaleString('en-US'));

export default function ReconductorPage() {
  const { design, setDesign, setLastReconductor } = useDesign();
  const { theme } = useTheme();
  const [horizon, setHorizon] = useState(5);
  const [checkHorizon, setCheckHorizon] = useState(true);
  const [maxCandidates, setMaxCandidates] = useState(200);
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [applied, setApplied] = useState('');
  const task = useEngineTask();
  const usable = usableConductorCodes(design);

  async function run() {
    const years = checkHorizon && Number(horizon) > 0 ? [0, Math.round(Number(horizon))] : [0];
    setPreview(null); setApplied('');
    const r = await task.run('reconductor', { design, years, maxCandidates: Math.max(1, Math.round(Number(maxCandidates) || 200)) }, 'Scanning reconductoring options');
    if (!r.ok) return;
    setResult(r.result);
    setLastReconductor(r.result);
  }
  function apply(c) {
    setDesign(d => applyReconductor(d, c.changes));
    setApplied(`Restrung ${describeReconductor(c.changes)}.`);
    setPreview(null); setResult(null);
  }

  const previewView = preview ? (() => {
    const d = applyReconductor(design, preview.changes);
    const res = runSnapshot(d, { year: 0, hour: 20, loadMult: 1, solarMult: 1 });
    return { res, svg: buildDiagramSVG(d, res, theme) };
  })() : null;

  return (
    <div>
      <div className="card">
        <h2>Reconductoring advisor</h2>
        <p className="hint">
          Tries restringing spans with a lower-resistance conductor from this design's library ({usable.join(', ')} — add sizes on the Setup page): every span on its own,
          and for each violating pole, the first 1, 2, … spans of its path from the transformer together. Each option is an exact 24 h scan per checked year. Ranked by
          voltage + thermal violations, then capital cost (when every option in a tier has a cost per metre), then daily energy loss.
        </p>
        <div className="grid g3">
          <label className="chk"><input type="checkbox" checked={checkHorizon} onChange={e => setCheckHorizon(e.target.checked)} /> Also check growth year</label>
          <label className="field"><span>Growth year</span><input type="number" min={1} max={30} value={horizon} disabled={!checkHorizon} onChange={e => setHorizon(e.target.value)} /></label>
          <label className="field"><span>Maximum options to scan</span><input type="number" min={1} step={10} value={maxCandidates} onChange={e => setMaxCandidates(e.target.value)} /></label>
        </div>
        <button className="primary" onClick={run} disabled={task.running}>Find reconductoring options</button>
        <TaskProgress task={task} />
      </div>
      {applied && <div className="note" style={{ marginTop: 14 }}>Applied — {applied} Review it on Network or Diagram.</div>}

      {result && !preview && (
        <div className="card" style={{ marginTop: 14 }}>
          <p className="hint" style={{ marginBottom: 6 }}>
            Current design: {result.years.map(y => `${result.baseline.violationsByYear[y]} violation(s) in year ${y}`).join(', ')} · {result.baseline.kwhYear0.toFixed(2)} kWh/day loss (year 0).
            {result.truncated && <b> Only the first {result.candidates.length} of {result.candidateCount} options were scanned — raise the maximum to see the rest.</b>}
          </p>
          <ConvergenceWarning show={result.candidates.some(c => !c.converged)}>Some options had hours that did not converge — their figures are unreliable.</ConvergenceWarning>
          {result.candidates.length === 0 ? (
            <div className="empty">No option to test: no span uses a conductor with a higher resistance than another one in the library. Add larger sizes on the Setup page.</div>
          ) : (
            <div className="tbl-wrap"><table>
              <thead><tr>
                <th>Rank</th><th>Restring</th><th>Length</th>
                {result.years.map(y => <th key={y}>Violations yr {y}</th>)}
                <th>Loss (kWh/day)</th><th>Saved (kWh/day)</th><th>Capex (LKR)</th><th>LKR per violation removed</th><th></th>
              </tr></thead>
              <tbody>
                {result.candidates.map((c, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: 220 }}>{describeReconductor(c.changes)} <span style={{ color: 'var(--muted)' }}>({c.kind})</span></td>
                    <td>{c.lengthM} m</td>
                    {result.years.map(y => <td key={y}><span className={'pill ' + (c.violationsByYear[y] ? 'bad' : 'ok')}>{c.violationsByYear[y]}</span></td>)}
                    <td>{c.kwhYear0.toFixed(2)}</td>
                    <td>{c.kwhSavedPerDay.toFixed(2)}</td>
                    <td>{c.capex == null ? <span style={{ color: 'var(--muted)' }}>cost unknown</span> : lkr(c.capex)}</td>
                    <td>{c.lkrPerViolationRemoved == null ? '—' : lkr(c.lkrPerViolationRemoved)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><button className="mini" onClick={() => setPreview(c)}>Preview</button> <button className="mini" onClick={() => apply(c)}>Apply</button></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {preview && previewView && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>Preview — {describeReconductor(preview.changes)}</h2>
            <span><button className="primary" onClick={() => apply(preview)}>Apply this design</button> <button className="mini" onClick={() => setPreview(null)}>Discard preview</button></span>
          </div>
          <p className="hint">Shown at night peak (20:00, year 0). Restrung spans are labelled with their new conductor.</p>
          <p><span className={'pill ' + (previewView.res.violations.length ? 'bad' : 'ok')}>{previewView.res.violations.length} violation{previewView.res.violations.length === 1 ? '' : 's'} at 20:00</span></p>
          <ConvergenceWarning show={!previewView.res.converged}>The preview load flow did not converge — the diagram may be inaccurate.</ConvergenceWarning>
          <div className="diagram" dangerouslySetInnerHTML={{ __html: previewView.svg }} />
        </div>
      )}
    </div>
  );
}
