import { useMemo, useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { LADDER_STEPS, LADDER_STEP_LABELS, runSnapshotAt, capexOf, optionEconomics } from '../lib/loadflow.js';
import SldPreview from '../components/SldPreview.jsx';
import TaskProgress from '../components/TaskProgress.jsx';
import { ConvergenceWarning } from '../components/Convergence.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import MultiCriteriaView from '../components/MultiCriteriaView.jsx';

// Fix-it ladder (P2.6): tries the usual remedies in order and stops at the first one that leaves
// no voltage violation in any checked year. Runs in the engine worker.

export function ladderCost(s) {
  const parts = [];
  if (s.moves) parts.push(`${s.moves} connection move${s.moves === 1 ? '' : 's'}`);
  if (s.tapChanges) parts.push(`${s.tapChanges} tap change${s.tapChanges === 1 ? '' : 's'} (outage)`);
  if (s.lengthM) parts.push(`${s.lengthM} m restrung${s.capex != null ? `, ${Math.round(s.capex).toLocaleString('en-US')} LKR` : ' (cost unknown)'}`);
  if (s.newTransformers) parts.push(`${s.newTransformers} new transformer (cost not set)`);
  return parts.join('; ') || '—';
}

export default function FixItPage() {
  const { design, setDesign, setLastFixIt } = useDesign();
  const [order, setOrder] = useState(LADDER_STEPS.map(step => ({ step, on: true })));
  const [horizon, setHorizon] = useState(5);
  const [stopAtFirst, setStopAtFirst] = useState(true);
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [applied, setApplied] = useState('');
  const task = useEngineTask();

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  }
  async function run() {
    setPreview(null); setApplied('');
    const years = Number(horizon) > 0 ? [0, Math.round(Number(horizon))] : [0];
    const r = await task.run('fixItLadder', { design, years, order: order.filter(o => o.on).map(o => o.step), stopAtFirst }, 'Running the fix-it ladder');
    if (!r.ok) return;
    setResult(r.result);
    setLastFixIt(r.result);
  }
  function apply(s) {
    setDesign(s.design);
    setApplied(`${s.label}: ${s.actions.join('; ')}.`);
    setPreview(null); setResult(null);
  }

  const previewView = useMemo(() => (preview ? { res: runSnapshotAt(preview.design, { year: 0, hour: 20, loadMult: 1, solarMult: 1 }) } : null), [preview]);
  const kwhDay = (v) => v.toFixed(2);

  return (
    <div>
      <div className="card">
        <h2>Fix-it ladder</h2>
        <p className="hint">
          Tries each remedy below in turn and stops at the first that leaves <b>no voltage violation in any checked year</b> (full 24 h scans).
          Each step reuses the matching advisor (Load Balance, Tap advisor, Reconductor, Feeder Split), so the details on those pages always agree.
          Reorder or skip steps to match how your utility prefers to fix things.
        </p>
        <div className="grid g2">
          <div>
            <div className="section-title" style={{ marginTop: 0 }}>Order</div>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {order.map((o, i) => (
                <li key={o.step} style={{ marginBottom: 6 }}>
                  <label className="chk" style={{ display: 'inline-flex', padding: 0 }}>
                    <input type="checkbox" checked={o.on} onChange={e => setOrder(order.map((x, k) => (k === i ? { ...x, on: e.target.checked } : x)))} /> {LADDER_STEP_LABELS[o.step]}
                  </label>{' '}
                  <button className="mini" aria-label={`Move ${LADDER_STEP_LABELS[o.step]} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>{' '}
                  <button className="mini" aria-label={`Move ${LADDER_STEP_LABELS[o.step]} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</button>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <label className="field"><span>Check years 0 and … (growth horizon)</span>
              <input type="number" min={0} max={30} value={horizon} onChange={e => setHorizon(e.target.value)} /></label>
            <label className="chk"><input type="checkbox" checked={stopAtFirst} onChange={e => setStopAtFirst(e.target.checked)} /> Stop at the first step that fixes everything</label>
          </div>
        </div>
        <button className="primary" onClick={run} disabled={task.running || !order.some(o => o.on)}>Run the ladder</button>
        <TaskProgress task={task} />
      </div>
      {applied && <div className="note" style={{ marginTop: 14 }}>Applied — {applied}</div>}

      {result && !preview && (
        <div className="card" style={{ marginTop: 14 }}>
          {result.alreadyCompliant ? (
            <div className="empty">The design already has no voltage violation in years {result.years.join(' and ')} — nothing to fix.</div>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                {result.solvedBy
                  ? <span className="pill ok">Fixed by: {result.steps.find(s => s.step === result.solvedBy).label}</span>
                  : <span className="pill bad">No step on its own (or combined) fixed every violation</span>}
              </p>
              <ConvergenceWarning show={!result.baseline.converged || result.steps.some(s => s.metrics && !s.metrics.converged)}>Some scanned hours did not converge — treat those figures with caution.</ConvergenceWarning>
              <div className="tbl-wrap"><table>
                <thead><tr>
                  <th>#</th><th>Remedy</th>{result.years.map(y => <th key={y}>Violations yr {y}</th>)}
                  <th>Loss (kWh/day)</th><th>Saved (kWh/yr)</th><th>LKR/yr saved</th><th>Capex (LKR)</th><th>Payback (yr)</th><th>NPV (LKR)</th><th>What it takes</th><th>Result</th><th></th>
                </tr></thead>
                <tbody>
                  <tr>
                    <td>—</td><td>Current design</td>
                    {result.years.map(y => <td key={y}><span className={'pill ' + (result.baseline.violationsByYear[y] ? 'bad' : 'ok')}>{result.baseline.violationsByYear[y]}</span></td>)}
                    <td>{kwhDay(result.baseline.kwhYear0)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td></td><td></td>
                  </tr>
                  {result.steps.map((s, i) => {
                    const saved = s.metrics ? (result.baseline.kwhYear0 - s.metrics.kwhYear0) * 365 : null;
                    // Economics (P6.1): from the user's costs only; "not set" where an input is missing.
                    const cx = s.design ? capexOf(design, s.design, design) : null;
                    const ec = s.metrics ? optionEconomics(design, { baseKwhDay: result.baseline.kwhYear0, optionKwhDay: s.metrics.kwhYear0, capexLkr: cx ? cx.lkr : null }) : null;
                    const notSet = (title) => <span style={{ color: 'var(--muted)' }} title={title}>not set</span>;
                    return (
                      <tr key={s.step}>
                        <td>{i + 1}</td>
                        <td style={{ whiteSpace: 'normal', minWidth: 200 }}>{s.label}{s.actions.length > 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.actions.join('; ')}</div>}{s.note && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.note}</div>}</td>
                        {result.years.map(y => <td key={y}>{s.metrics ? <span className={'pill ' + (s.metrics.violationsByYear[y] ? 'bad' : 'ok')}>{s.metrics.violationsByYear[y]}</span> : '—'}</td>)}
                        <td>{s.metrics ? kwhDay(s.metrics.kwhYear0) : '—'}</td>
                        <td>{saved == null ? '—' : saved.toFixed(0)}</td>
                        <td>{!ec ? '—' : ec.lkrYearSaved == null ? notSet('Needs the energy cost of losses (Setup → Economics)') : Math.round(ec.lkrYearSaved).toLocaleString('en-US')}</td>
                        <td>{!cx ? '—' : cx.lkr == null ? notSet(`Needs: ${cx.missing.join(', ')}`) : Math.round(cx.lkr).toLocaleString('en-US')}</td>
                        <td>{!ec ? '—' : ec.paybackYears == null ? (ec.lkrYearSaved != null && ec.lkrYearSaved <= 0 ? 'no saving' : notSet('Needs the loss cost and the capex')) : ec.paybackYears.toFixed(1)}</td>
                        <td>{!ec ? '—' : ec.npvLkr == null ? notSet('Needs the loss cost, capex, discount rate and study period') : Math.round(ec.npvLkr).toLocaleString('en-US')}</td>
                        <td style={{ whiteSpace: 'normal', minWidth: 160 }}>{ladderCost(s)}</td>
                        <td>{!s.design ? <span className="pill warn">Nothing to change</span> : s.solves ? <span className="pill ok">Fixes it</span> : <span className="pill bad">Not enough</span>}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{s.design && <><button className="mini" onClick={() => setPreview(s)}>Preview</button> <button className="mini" onClick={() => apply(s)}>Apply</button></>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
              <p className="hint" style={{ marginTop: 8 }}>kWh/yr = the year-0 daily figure × 365 (a simplification: one representative day). LKR figures use the costs under Setup → Economics and the conductor library; "not set" means an input is missing (hover for which). NPV = −capex + Σ saving / (1 + r)^t over the study period.</p>
              <MultiCriteriaView
                title="Compare remedies by criteria"
                items={[
                  { id: '__current', label: 'Current design', values: { violations: result.baseline.totalViolations, kwh: result.baseline.kwhYear0, capex: 0, vuf: result.baseline.worstVufPct ?? null } },
                  ...result.steps.filter(s => s.metrics).map(s => ({ id: s.step, label: s.label, values: { violations: s.metrics.totalViolations, kwh: s.metrics.kwhYear0, capex: s.design ? capexOf(design, s.design, design).lkr : null, vuf: s.metrics.worstVufPct ?? null } }))
                ]}
                criteria={[
                  { key: 'violations', label: `Voltage violations (yrs ${result.years.join(' + ')})`, digits: 0 },
                  { key: 'kwh', label: 'Loss kWh/day (yr 0)', digits: 2 },
                  { key: 'capex', label: 'Capex LKR (where known)', digits: 0, missing: 'a remedy whose unit costs are not all entered (Setup → Economics, conductor library) shows "—" and is not compared on capex.' },
                  { key: 'vuf', label: 'Worst VUF %', digits: 2 }
                ]}
                onPreview={(id) => { const s = result.steps.find(x => x.step === id); if (s && s.design) setPreview(s); }}
              />
            </>
          )}
        </div>
      )}

      {preview && previewView && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>Preview — {preview.label}</h2>
            <span><button className="primary" onClick={() => apply(preview)}>Apply this design</button> <button className="mini" onClick={() => setPreview(null)}>Discard preview</button></span>
          </div>
          <p className="hint">{preview.actions.join('; ')}. Shown at night peak (20:00, year 0).</p>
          <p><span className={'pill ' + (previewView.res.violations.length ? 'bad' : 'ok')}>{previewView.res.violations.length} violation{previewView.res.violations.length === 1 ? '' : 's'} at 20:00</span></p>
          <ConvergenceWarning show={!previewView.res.converged}>The preview load flow did not converge — the diagram may be inaccurate.</ConvergenceWarning>
          <SldPreview design={preview.design} before={design} res={previewView.res} label="Fix-it remedy preview, 20:00" />
        </div>
      )}
    </div>
  );
}
