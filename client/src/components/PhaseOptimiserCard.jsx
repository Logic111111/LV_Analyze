import { useState } from 'react';
import TaskProgress from './TaskProgress.jsx';
import { ConvergenceWarning } from './Convergence.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';

// Phase balancing v2 (P4.1): the "Optimised" method. Runs optimisePhaseBalance in the engine
// worker and shows the "moves vs benefit" table. Each row is the best arrangement found with at
// most K moves. Picking a row lists its moves and hands them to the page's Preview / Apply.
const OBJECTIVES = {
  nameplate: { label: 'Nameplate spread (legacy objective)', unit: 'kVA', hint: 'max − min of connected kVA per phase.' },
  impedance: { label: 'Impedance-weighted spread', unit: 'kVA·Ω', hint: 'each connection weighted by |Zph + Zn| of its path to the transformer, so far-end customers count for more.' },
  loadflow: { label: 'Load-flow based', unit: 'score', hint: 'full load flows at the scanned hours: each voltage violation-hour costs 1 MW-equivalent, plus neutral I²R (W) and 1 kW per % of VUF above the limit per pole. Slowest; on large transformers use night-peak or solar-peak test conditions.' }
};
const KIND_LABEL = { load: 'load', pv: 'PV', bess: 'BESS' };

function fmtObjective(v, objective) {
  if (objective === 'loadflow') return v >= 1e5 ? v.toExponential(2) : v.toFixed(1);
  return v.toFixed(objective === 'impedance' ? 3 : 2);
}

export default function PhaseOptimiserCard({ design, txId, testOpts, onPreview }) {
  const [objective, setObjective] = useState('impedance');
  const [kMax, setKMax] = useState(9);
  const [restarts, setRestarts] = useState(0);
  const [iterations, setIterations] = useState(200);
  const [seed, setSeed] = useState(1);
  const [result, setResult] = useState(null);
  const [selectedK, setSelectedK] = useState(null);
  const task = useEngineTask();

  async function run() {
    const { hours, solarMult, periodLabel } = testOpts;
    const r = await task.run('phaseBalanceOptimised', {
      design, txId, objective, kMax: Number(kMax) || 0, hours, solarMult,
      restarts: Number(restarts) || 0, iterations: Number(iterations) || 1, seed: Number(seed) || 0
    }, 'Optimising the phase balance');
    if (!r.ok) return;
    setResult({ ...r.result, periodLabel });
    setSelectedK(r.result.recommendedK);
  }

  const row = result && selectedK != null ? result.pareto[selectedK] : null;
  const unit = result ? OBJECTIVES[result.objective].unit : '';
  const anyNotConverged = result && result.pareto.some(r => r.metrics && !r.metrics.converged);

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Optimised phase balance</h2>
      <p className="hint">Searches from today's arrangement — single moves and pair swaps, steepest descent — and keeps the best arrangement for every move budget K, so you can see what each extra re-termination buys. The Quick proposal is included as a candidate, so Optimised is never worse at the same number of moves.</p>
      <div className="grid g3">
        <label className="field"><span>Objective</span>
          <select value={objective} onChange={e => setObjective(e.target.value)}>
            {Object.entries(OBJECTIVES).map(([k, o]) => <option key={k} value={k}>{o.label}</option>)}
          </select></label>
        <label className="field"><span>Max moves (Kmax)</span>
          <input type="number" min="0" max="40" value={kMax} onChange={e => setKMax(e.target.value)} /></label>
        <label className="field"><span>Annealing restarts (0 = off)</span>
          <input type="number" min="0" max="20" value={restarts} onChange={e => setRestarts(e.target.value)} /></label>
      </div>
      {Number(restarts) > 0 && (
        <div className="grid g3">
          <label className="field"><span>Iterations per restart</span>
            <input type="number" min="1" max="5000" value={iterations} onChange={e => setIterations(e.target.value)} /></label>
          <label className="field"><span>Seed (same seed → same result)</span>
            <input type="number" value={seed} onChange={e => setSeed(e.target.value)} /></label>
        </div>
      )}
      <p className="hint" style={{ marginTop: 0 }}>{OBJECTIVES[objective].label}: {OBJECTIVES[objective].hint}</p>
      <button className="primary" onClick={run} disabled={task.running || !txId}>Optimise</button>
      <TaskProgress task={task} />

      {result && (
        <div style={{ marginTop: 14 }}>
          <div className="section-title">Moves vs benefit, {result.periodLabel}</div>
          <p className="hint">Objective: {OBJECTIVES[result.objective].label} ({unit}). {result.evaluations} arrangements evaluated. Recommended: K = {result.recommendedK} (fewest moves reaching the best objective found). Select a row to see its moves.</p>
          <div className="tbl-wrap"><table>
            <thead><tr>
              <th scope="col">K (max moves)</th><th scope="col">Moves</th><th scope="col">Objective ({unit})</th>
              <th scope="col">Voltage violations</th><th scope="col">Losses kWh (scanned hours)</th><th scope="col">Worst VUF %</th><th scope="col">Tx max phase A</th><th scope="col"></th>
            </tr></thead>
            <tbody>
              {result.pareto.map(r => {
                const same = r.k > 0 && r.moves === result.pareto[r.k - 1].moves && r.objectiveValue === result.pareto[r.k - 1].objectiveValue;
                return (
                  <tr key={r.k} className={selectedK === r.k ? 'selected' : ''} aria-selected={selectedK === r.k}>
                    <td>{r.k}{r.k === result.recommendedK ? ' ★' : ''}</td>
                    <td>{r.moves}</td>
                    <td>{fmtObjective(r.objectiveValue, result.objective)}{same ? ' (no further gain)' : ''}</td>
                    <td>{r.metrics ? r.metrics.voltageViolationCount : '—'}</td>
                    <td>{r.metrics ? r.metrics.lossKwh.toFixed(2) : '—'}</td>
                    <td>{r.metrics && r.metrics.worstVuf ? r.metrics.worstVuf.value.toFixed(2) : '—'}</td>
                    <td>{r.metrics ? Math.max(...r.metrics.transformers.map(t => t.txMaxPhaseCurrentA)).toFixed(0) : '—'}</td>
                    <td><button className="mini" onClick={() => setSelectedK(r.k)} aria-label={`Show the moves for K = ${r.k}`}>Select</button></td>
                  </tr>
                );
              })}
              <tr>
                <td>Quick</td><td>{result.legacy.moves}</td><td>{fmtObjective(result.legacy.objectiveValue, result.objective)}</td>
                <td>{result.legacy.metrics?.voltageViolationCount ?? '—'}</td>
                <td>{result.legacy.metrics ? result.legacy.metrics.lossKwh.toFixed(2) : '—'}</td>
                <td>{result.legacy.metrics?.worstVuf ? result.legacy.metrics.worstVuf.value.toFixed(2) : '—'}</td>
                <td>{result.legacy.metrics ? Math.max(...result.legacy.metrics.transformers.map(t => t.txMaxPhaseCurrentA)).toFixed(0) : '—'}</td>
                <td><span className="hint">reference</span></td>
              </tr>
            </tbody>
          </table></div>
          <ConvergenceWarning show={!!anyNotConverged}>One or more scanned hours did not converge for some rows — treat those rows with caution.</ConvergenceWarning>

          {row && (
            <div style={{ marginTop: 12 }}>
              <div className="section-title">K = {row.k}: {row.moves} move{row.moves === 1 ? '' : 's'}</div>
              {row.parts && <p className="hint">Violation-hours {row.parts.violations} · neutral I²R Σ {row.parts.neutralLossW.toFixed(1)} W·h · VUF above limit Σ {row.parts.vufExcessPct.toFixed(2)} %·h</p>}
              <p className="hint">Per-phase connected kVA — before: A {result.before.A.toFixed(1)} / B {result.before.B.toFixed(1)} / C {result.before.C.toFixed(1)} · after: A {row.after.A.toFixed(1)} / B {row.after.B.toFixed(1)} / C {row.after.C.toFixed(1)}</p>
              {row.changed.length === 0 ? <div className="empty">No moves — today's arrangement.</div> : (
                <>
                  <div className="tbl-wrap"><table>
                    <thead><tr><th>Pole</th><th>Connection</th><th>kVA</th><th>Path |Z| Ω</th><th>Current phase</th><th>Proposed phase</th></tr></thead>
                    <tbody>{row.changed.map(c => (
                      <tr key={c.kind + c.id}>
                        <td>{c.pole}</td><td>{c.id} — {KIND_LABEL[c.kind] || c.kind}{c.kind === 'load' ? ` (${c.label})` : ''}</td>
                        <td>{c.kva.toFixed(2)}</td><td>{c.weight.toFixed(4)}</td>
                        <td className={'phase' + c.phase}>{c.phase}</td><td className={'phase' + c.newPhase}>{c.newPhase}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                  <button className="mini" style={{ marginTop: 10 }} onClick={() => onPreview(row.changed, `optimised, K = ${row.k}`)}>Preview</button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
