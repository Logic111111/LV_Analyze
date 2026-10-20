import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import BaselineBanner from '../components/BaselineBanner.jsx';
import TaskProgress from '../components/TaskProgress.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import { HostingLimitCell, HostingNonConvergenceWarning } from '../components/Convergence.jsx';

export default function HostingPage() {
  const { design, setLastHosting } = useDesign();
  const [results, setResults] = useState(null);
  const [system, setSystem] = useState(null);
  const [baseline, setBaseline] = useState(null);
  // Both searches run in the engine worker (seconds on a large feeder), with progress and Cancel.
  const indep = useEngineTask();
  const sys = useEngineTask();

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
        <p className="hint">Tests adding single-phase PV (up to the cap set in Setup) at every pole and phase across the solar shoulder hours (09:00–15:00), then ranks poles by the extra capacity that can be absorbed before it creates a statutory voltage or conductor-thermal violation (or makes one the design already has worse). The transformer is not a limiting factor here when the result is a net export — reverse flow back to the grid is unrestricted.</p>
        <button className="primary" onClick={run} disabled={indep.running}>Compute hosting capacity</button>
        <TaskProgress task={indep} />
      </div>

      <BaselineBanner baseline={baseline} kind="solar shoulder (09:00–15:00)" />

      {results && (
        <div style={{ marginTop: 18 }}>
          {results.length === 0 ? (
            <div className="empty">No additional headroom found at solar-peak conditions — the island is already at its statutory or thermal limit under this design.</div>
          ) : (
            <div className="card">
              <p className="hint">Ranked best-to-worst. Values are the extra single-phase PV (kVA) that can be added at that pole/phase before a voltage or thermal limit is reached, capped at {design.maxpv} kW. Each row is tested independently, so the total below is an upper bound, not a guaranteed simultaneous addition.</p>
              <p><strong>Total additional PV headroom: {results.reduce((sum, r) => sum + r.kva, 0).toFixed(2)} kVA</strong> across {results.length} pole/phase location{results.length === 1 ? '' : 's'}</p>
              <HostingNonConvergenceWarning rows={results} />
              <div className="tbl-wrap"><table>
                <thead><tr><th>Rank</th><th>Pole</th><th>Phase</th><th>Additional PV headroom (kVA)</th><th>Limited by</th></tr></thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i}><td>{i + 1}</td><td>{r.pole}</td><td className={'phase' + r.phase}>{r.phase}</td><td>{r.kva.toFixed(2)}</td><HostingLimitCell row={r} capLabel={`Setup cap (${design.maxpv} kW)`} /></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={3}><strong>Total</strong></td><td><strong>{results.reduce((sum, r) => sum + r.kva, 0).toFixed(2)}</strong></td><td></td></tr>
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
