import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import BaselineBanner from '../components/BaselineBanner.jsx';
import TaskProgress from '../components/TaskProgress.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import { HostingLimitCell, HostingNonConvergenceWarning } from '../components/Convergence.jsx';

function windowLabel(design) {
  const h = (n) => String(n).padStart(2, '0') + ':00';
  return `charge ${h(design.bessChargeStartHour)}–${h(design.bessChargeEndHour)}, discharge ${h(design.bessDischargeStartHour)}–${h(design.bessDischargeEndHour)}`;
}

export default function BessHostingPage() {
  const { design, lastBessHosting, setLastBessHosting } = useDesign();
  const [results, setResults] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const system = lastBessHosting;
  // Both searches run in the engine worker, with progress and Cancel.
  const indep = useEngineTask();
  const sys = useEngineTask();

  async function run() {
    sys.cancel();
    const r = await indep.run('bessHostingCapacity', { design }, 'Computing BESS hosting capacity');
    if (!r.ok) return;
    setBaseline(r.result.baseline);
    setResults(r.result.rows);
    setLastBessHosting(null);
  }

  async function runSystem() {
    const r = await sys.run('systemBessHostingCapacity', { design }, 'Computing maximum simultaneous BESS capacity');
    if (r.ok) setLastBessHosting(r.result);
  }

  return (
    <div>
      <div className="card">
        <h2>Additional BESS hosting capacity</h2>
        <p className="hint">Tests adding single-phase BESS (up to the cap set in Setup) at every pole and phase, across both the charge and discharge windows ({windowLabel(design)}). Charging can only pull voltage down and discharging can only push it up, so overvoltage seen while charging (e.g. from high midday solar) and undervoltage seen while discharging (e.g. at evening peak) are treated as exactly what the BESS is there to relieve, not as a reason to reject it — a candidate is only rejected for undervoltage/thermal/import-overload it causes while charging, or overvoltage/thermal it causes while discharging. Ranks poles by the extra capacity that can be absorbed under that test.</p>
        <button className="primary" onClick={run} disabled={indep.running}>Compute hosting capacity</button>
        <TaskProgress task={indep} />
      </div>

      <BaselineBanner baseline={baseline} kind={'BESS charge/discharge (' + windowLabel(design) + ')'} />

      {results && (
        <div style={{ marginTop: 18 }}>
          {results.length === 0 ? (
            <div className="empty">No additional BESS headroom found across the charge/discharge windows — the island is already at its statutory or thermal limit under this design.</div>
          ) : (
            <div className="card">
              <p className="hint">Ranked best-to-worst. Values are the extra single-phase BESS (kVA) that can be added at that pole/phase before a voltage or thermal limit is reached in either direction, capped at {design.maxbess} kW. Each row is tested independently, so the total below is an upper bound, not a guaranteed simultaneous addition.</p>
              <p><strong>Total additional BESS headroom: {results.reduce((sum, r) => sum + r.kva, 0).toFixed(2)} kVA</strong> across {results.length} pole/phase location{results.length === 1 ? '' : 's'}</p>
              <HostingNonConvergenceWarning rows={results} />
              <div className="tbl-wrap"><table>
                <thead><tr><th>Rank</th><th>Pole</th><th>Phase</th><th>Additional BESS headroom (kVA)</th><th>Limited by</th></tr></thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i}><td>{i + 1}</td><td>{r.pole}</td><td className={'phase' + r.phase}>{r.phase}</td><td>{r.kva.toFixed(2)}</td><HostingLimitCell row={r} capLabel={`Setup cap (${design.maxbess} kW)`} /></tr>
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
              <h2>Maximum simultaneous BESS hosting capacity</h2>
              <p className="hint">Unlike the ranking above, this scan re-orders locations by <b>loss-reduction impact</b> rather than raw headroom — the pole/phase where adding BESS cuts total network loss (line + transformer) the most is prioritised first — then processes them in that order like an interconnection queue, each candidate tested with every higher-priority addition already committed, against the <b>uncapped</b> voltage/thermal limit (ignoring the Setup cap, to show what the network can physically absorb). This gives both the true maximum that can be added <b>all at once</b> without a voltage deviation or thermal violation, and the resulting effect on daily distribution energy loss.</p>
              <button className="primary" onClick={runSystem} disabled={sys.running}>Compute maximum simultaneous capacity</button>
              <TaskProgress task={sys} />

              {system && (
                <div style={{ marginTop: 14 }}>
                  <p><strong>Maximum further BESS hosting capacity for this design: {system.totalKva.toFixed(2)} kVA</strong> addable simultaneously across {system.results.filter(r => r.achievableKva > 0).length} location{system.results.filter(r => r.achievableKva > 0).length === 1 ? '' : 's'}.</p>

                  <div className="grid g3" style={{ marginBottom: 14 }}>
                    <div className="stat"><div className="v">{system.baselineLossKwh.totalKwh.toFixed(2)} kWh/day</div><div className="l">Baseline network loss (no BESS)</div></div>
                    <div className="stat"><div className="v">{system.withBessLossKwh.totalKwh.toFixed(2)} kWh/day</div><div className="l">Loss with accepted BESS allocation</div></div>
                    <div className={'stat ' + (system.lossReductionKwh >= 0 ? 'ok' : 'warn')}>
                      <div className="v">{system.lossReductionKwh >= 0 ? '−' : '+'}{Math.abs(system.lossReductionKwh).toFixed(2)} kWh/day</div>
                      <div className="l">Loss {system.lossReductionKwh >= 0 ? 'reduction' : 'increase'} ({system.baselineLossKwh.totalKwh > 0 ? (Math.abs(system.lossReductionKwh) / system.baselineLossKwh.totalKwh * 100).toFixed(1) : '0.0'}%)</div>
                    </div>
                  </div>

                  <HostingNonConvergenceWarning rows={system.results} />
                  <div className="tbl-wrap"><table>
                    <thead><tr><th>Priority</th><th>Pole</th><th>Phase</th><th>Independent, uncapped estimate (kVA)</th><th>Loss-reduction score (W)</th><th>Achievable simultaneously (kVA)</th><th>Limited by</th></tr></thead>
                    <tbody>
                      {system.results.map((r, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td><td>{r.pole}</td><td className={'phase' + r.phase}>{r.phase}</td>
                          <td>{r.independentKva.toFixed(2)}</td>
                          <td>{r.lossScore.toFixed(2)}</td>
                          <td>{r.achievableKva > 0 ? r.achievableKva.toFixed(2) : <span style={{ color: 'var(--muted)' }}>0 — absorbed by higher-priority locations</span>}</td>
                          <HostingLimitCell row={r} capLabel="its independent estimate still fits" />
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr><td colSpan={5}><strong>Total achievable simultaneously</strong></td><td><strong>{system.totalKva.toFixed(2)}</strong></td><td></td></tr>
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
