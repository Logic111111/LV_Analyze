import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import BaselineBanner from '../components/BaselineBanner.jsx';
import TaskProgress from '../components/TaskProgress.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import { HostingLimitCell, HostingNonConvergenceWarning } from '../components/Convergence.jsx';
import ExplainDrawer from '../components/ExplainDrawer.jsx';
import CsvButton from '../components/CsvButton.jsx';
import HostingCompareCard from '../components/HostingCompareCard.jsx';

export default function HostingPage() {
  const { design, setLastHosting } = useDesign();
  const [results, setResults] = useState(null);
  const [system, setSystem] = useState(null);
  const [baseline, setBaseline] = useState(null);
  // Both searches run in the engine worker (seconds on a large feeder), with progress and Cancel.
  const indep = useEngineTask();
  const sys = useEngineTask();
  const quick = useEngineTask();
  const [estimate, setEstimate] = useState(null);
  const explainTask = useEngineTask();
  const [explain, setExplain] = useState(null);
  async function runExplain(r) {
    const t = await explainTask.run('explainHosting', { design, pole: r.pole, phase: r.phase }, `Tracing the search at ${r.pole} ${r.phase}`);
    if (t.ok) setExplain(t.result);
  }

  // Linear first estimate (P4.2): seconds faster than the search, voltage limits only, one hour.
  async function runEstimate() {
    const r = await quick.run('linearHostingEstimate', { design, hour: 12 }, 'Computing voltage sensitivities');
    if (r.ok) setEstimate(r.result);
  }

  async function run() {
    sys.cancel();
    const r = await indep.run('hostingCapacity', { design }, 'Computing hosting capacity');
    if (!r.ok) return;
    setBaseline(r.result.baseline);
    setResults(r.result.rows);
    setLastHosting(r.result.rows);
    setSystem(null);
  }

  async function runSystem() {
    const r = await sys.run('systemHostingCapacity', { design }, 'Computing maximum simultaneous capacity');
    if (r.ok) setSystem(r.result);
  }

  return (
    <div>
      <div className="card">
        <h2>Additional solar hosting capacity</h2>
        <p className="hint">Tests adding single-phase PV (up to the cap set in Setup) at every pole and phase across the solar shoulder hours (09:00–15:00), then ranks poles by the extra capacity that can be absorbed before it creates a statutory voltage or conductor-thermal violation (or makes one the design already has worse). The transformer is not a limiting factor here when the result is a net export — reverse flow back to the grid is unrestricted, unless Setup → Standards applies the transformer limit to reverse flow too.</p>
        <button className="primary" onClick={run} disabled={indep.running}>Compute hosting capacity</button>{' '}
        <button className="ghost" onClick={runEstimate} disabled={quick.running}>Instant linear estimate</button>
        <TaskProgress task={indep} />
        <TaskProgress task={quick} />
      </div>

      {estimate && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>Instant linear estimate (12:00)</h2>
          <p className="hint">From the voltage sensitivity matrix at 12:00 (nominal solar): the unity-pf PV each pole/phase could take before a voltage would leave the band, if voltage changed linearly. It ignores thermal limits, the other shoulder hours and the Setup cap. It is a first look only; use "Compute hosting capacity" for the confirmed figures, which are full load flows.</p>
          {!estimate.converged && <p className="hint" style={{ color: 'var(--warn)' }}>⚠ Some sensitivity load flows did not converge — treat the estimate with caution.</p>}
          <div className="tbl-wrap"><table>
            <thead><tr><th>Pole</th><th>Phase</th><th>Estimate (kW)</th><th>First limit reached</th></tr></thead>
            <tbody>
              {estimate.rows.map(r => (
                <tr key={r.pole + r.phase}>
                  <td>{r.pole}</td><td className={'phase' + r.phase}>{r.phase}</td>
                  <td>{Number.isFinite(r.kw) ? r.kw.toFixed(2) : 'no voltage limit'}</td>
                  <td>{r.limitPole ? `${r.limit === 'high' ? 'over' : 'under'}voltage at ${r.limitPole} ${r.limitPhase}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      <BaselineBanner baseline={baseline} kind="solar shoulder (09:00–15:00)" />
      <HostingCompareCard design={design} />

      {results && (
        <div style={{ marginTop: 18 }}>
          {results.length === 0 ? (
            <div className="empty">No additional headroom found at solar-peak conditions — the island is already at its statutory or thermal limit under this design.</div>
          ) : (
            <div className="card">
              <p className="hint">Ranked best-to-worst. Values are the extra single-phase PV (kVA) that can be added at that pole/phase before a voltage or thermal limit is reached, capped at {design.maxpv} kW. Each row is tested independently, so the total below is an upper bound, not a guaranteed simultaneous addition.</p>
              <p><strong>Total additional PV headroom: {results.reduce((sum, r) => sum + r.kva, 0).toFixed(2)} kVA</strong> across {results.length} pole/phase location{results.length === 1 ? '' : 's'}</p>
              <HostingNonConvergenceWarning rows={results} />
              <CsvButton name="PV hosting (independent)" columns={['Rank', 'Pole', 'Phase', 'kVA', 'Limited by']} rows={results.map((r, i) => [i + 1, r.pole, r.phase, r.kva, r.limit])} />
              <TaskProgress task={explainTask} />
              <ExplainDrawer trace={explain} onClose={() => setExplain(null)} />
              <div className="tbl-wrap"><table>
                <thead><tr><th>Rank</th><th>Pole</th><th>Phase</th><th>Additional PV headroom (kVA)</th><th>Limited by</th><th></th></tr></thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i}><td>{i + 1}</td><td>{r.pole}</td><td className={'phase' + r.phase}>{r.phase}</td><td>{r.kva.toFixed(2)}{r.nonMonotonic && <> <span className="pill warn" title={`Bisection first stopped at ${r.nonMonotonic.firstBoundaryKva} kVA, but ${r.nonMonotonic.probePassKva} kVA passed: feasibility isn't one interval from zero here (e.g. PV first relieves a problem, then creates one). The true upper boundary is shown.`}>non-monotonic</span></>}</td><HostingLimitCell row={r} capLabel={`Setup cap (${design.maxpv} kW)`} />
                      <td><button className="mini" onClick={() => runExplain(r)} disabled={explainTask.running} aria-label={`Explain the result at ${r.pole} phase ${r.phase}`}>Explain</button></td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={3}><strong>Total</strong></td><td><strong>{results.reduce((sum, r) => sum + r.kva, 0).toFixed(2)}</strong></td><td></td><td></td></tr>
                </tfoot>
              </table></div>
            </div>
          )}

          {results.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <h2>Maximum simultaneous hosting capacity</h2>
              <p className="hint">The ranking above tests each location on its own, capped at the {design.maxpv} kW per-connection limit set in Setup — but real headroom shrinks once other locations also start exporting, because the voltage rise and thermal loading compound. This scan re-ranks locations by their true, <b>uncapped</b> voltage/thermal limit (ignoring the Setup cap, to show what the network itself can physically absorb), then processes them in that priority order like an interconnection queue — each candidate tested with every higher-ranked addition already committed — giving the true maximum that can be added to this design <b>all at once</b>, and the realistic amount to allocate at each location.</p>
              <button className="primary" onClick={runSystem} disabled={sys.running}>Compute maximum simultaneous capacity</button>
              <TaskProgress task={sys} />

              {system && (
                <div style={{ marginTop: 14 }}>
                  <p><strong>Maximum further solar hosting capacity for this design: {system.totalKva.toFixed(2)} kVA</strong> addable simultaneously across {system.results.filter(r => r.achievableKva > 0).length} location{system.results.filter(r => r.achievableKva > 0).length === 1 ? '' : 's'}.</p>
                  <HostingNonConvergenceWarning rows={system.results} />
                  <div className="tbl-wrap"><table>
                    <thead><tr><th>Priority</th><th>Pole</th><th>Phase</th><th>Independent, uncapped estimate (kVA)</th><th>Achievable simultaneously (kVA)</th><th>Limited by</th></tr></thead>
                    <tbody>
                      {system.results.map((r, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td><td>{r.pole}</td><td className={'phase' + r.phase}>{r.phase}</td>
                          <td>{r.independentKva.toFixed(2)}</td>
                          <td>{r.achievableKva > 0 ? r.achievableKva.toFixed(2) : <span style={{ color: 'var(--muted)' }}>0 — absorbed by higher-priority locations</span>}</td>
                          <HostingLimitCell row={r} capLabel="its independent estimate still fits" />
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr><td colSpan={4}><strong>Total achievable simultaneously</strong></td><td><strong>{system.totalKva.toFixed(2)}</strong></td><td></td></tr>
                    </tfoot>
                  </table></div>
                  <p className="hint" style={{ marginTop: 10 }}>Recommended build order is this same priority list, top to bottom — allocate each location the "achievable simultaneously" amount, not the independent estimate.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
