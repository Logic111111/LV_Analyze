import { useState } from 'react';
import TaskProgress from './TaskProgress.jsx';
import CsvButton from './CsvButton.jsx';
import OptimiserCertificate from './OptimiserCertificate.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import { optSummary } from '../lib/optSummary.js';
import { useDesign } from '../context/DesignContext.jsx';

// BESS sizing for losses (O4): the battery sizes that minimise the daily network loss with no new
// or worsened violation in any hour — not the most battery that fits (the legacy queue above).
export default function BessLossCard({ design }) {
  const [restarts, setRestarts] = useState(10);
  const [budget, setBudget] = useState(1500);
  const [seed, setSeed] = useState(1);
  const [cap, setCap] = useState('');
  const [res, setRes] = useState(null);
  const task = useEngineTask();
  const { recordOptimisation } = useDesign();
  async function run() {
    const r = await task.run('bessLossOptimal', { design, restarts: Number(restarts) || 1, budget: Number(budget) || 10, seed: Number(seed) || 1, caps: cap === '' ? undefined : Math.max(0, Number(cap)) }, 'Sizing batteries for minimum loss');
    if (!r.ok) return;
    setRes(r.result);
    const x = r.result;
    recordOptimisation('bessLoss', optSummary('BESS sizes for minimum loss', `${x.lossKwh.toFixed(3)} kWh/day with ${x.totalKva.toFixed(2)} kVA (none: ${x.baselineLossKwh.toFixed(3)}; legacy queue ${x.legacy.totalKva.toFixed(2)} kVA: ${x.legacy.lossKwh.toFixed(3)})`, x));
  }
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Size batteries for minimum loss</h2>
      <p className="hint">Finds the battery size at each location that minimises the daily network loss (24 h load flows), with no new or worsened violation in any hour. The queue above maximises how much battery fits; past a point, more battery adds loss. Starts: no battery, the queue's allocation at 25 % and 50 %, then seeded random points.</p>
      <div className="grid g3">
        <label className="field"><span>Starts</span><input type="number" min="1" max="30" value={restarts} onChange={e => setRestarts(e.target.value)} /></label>
        <label className="field"><span>24 h scans budget</span><input type="number" min="10" max="20000" value={budget} onChange={e => setBudget(e.target.value)} /></label>
        <label className="field"><span>Seed</span><input type="number" value={seed} onChange={e => setSeed(e.target.value)} /></label>
        <label className="field"><span>Per-location cap, kVA (blank = each location's own limit)</span><input type="number" min="0" step="0.5" value={cap} onChange={e => setCap(e.target.value)} placeholder="own limit" /></label>
      </div>
      <button className="primary" onClick={run} disabled={task.running}>Optimise sizes</button>
      <TaskProgress task={task} />
      {res && (
        <div style={{ marginTop: 12 }}>
          <p><b>Daily loss {res.lossKwh.toFixed(3)} kWh</b> with {res.totalKva.toFixed(2)} kVA of batteries — against {res.baselineLossKwh.toFixed(3)} kWh with none and {res.legacy.lossKwh.toFixed(3)} kWh with the queue's {res.legacy.totalKva.toFixed(2)} kVA.</p>
          <OptimiserCertificate result={res} space={`${res.locations.length} locations, sizes 0 to each cap in 0.05 kVA steps, ${res.runs.length} starts; every accepted step verified by 24 h load flows${res.years.length > 1 ? ` in years ${res.years.join(', ')}` : ''}`}
            why="the queue ranks locations by the loss saving of a 1 kVA probe — the slope at zero size — and then fills each to its maximum; the loss is not linear in size, so the most battery is far from the least loss." />
          {res.allocation.length ? (
            <div className="tbl-wrap" style={{ marginTop: 8 }}><table>
              <thead><tr><th scope="col">Pole</th><th scope="col">Phase</th><th scope="col">Size (kVA)</th></tr></thead>
              <tbody>{res.allocation.map(a => <tr key={a.pole + a.phase}><td>{a.pole}</td><td className={'phase' + a.phase}>{a.phase}</td><td>{a.kva.toFixed(2)}</td></tr>)}</tbody>
            </table></div>
          ) : <p className="hint">No battery reduces the loss under this schedule — the optimum is none.</p>}
          <CsvButton name="BESS sizes for minimum loss" columns={['Pole', 'Phase', 'kVA']} rows={res.allocation.map(a => [a.pole, a.phase, a.kva])} />
          <details style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer' }}>Each start</summary>
            <div className="tbl-wrap"><table>
              <thead><tr><th scope="col">Start</th><th scope="col">Final loss (kWh/day)</th><th scope="col">Total (kVA)</th></tr></thead>
              <tbody>{res.runs.map((r, i) => <tr key={i}><td>{r.start}</td><td>{r.lossKwh.toFixed(3)}</td><td>{r.totalKva.toFixed(2)}</td></tr>)}</tbody>
            </table></div></details>
        </div>
      )}
    </div>
  );
}
