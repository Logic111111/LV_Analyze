import { useState } from 'react';
import TaskProgress from './TaskProgress.jsx';
import OptimiserCertificate from './OptimiserCertificate.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import { describeReconductor } from '../lib/loadflow.js';

// Reconductoring as an optimisation (O6): a conductor for every span at once — keep, or upgrade
// to a lower-R library conductor — by enumeration, branch-and-bound, or annealing when the
// evaluation budget runs out. Hands the best set to the page's Preview / Apply.
export default function ReconductorOptCard({ design, years, onPreview }) {
  const [budget, setBudget] = useState(2000);
  const [seed, setSeed] = useState(1);
  const [res, setRes] = useState(null);
  const task = useEngineTask();
  async function run() {
    const r = await task.run('reconductorOptimise', { design, years, budgetEvaluations: Math.max(1, Number(budget) || 1), seed: Number(seed) || 1 }, 'Optimising conductors for every span');
    if (r.ok) setRes(r.result);
  }
  const b = res && res.best;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Optimise every span together</h2>
      <p className="hint">Chooses a conductor for every span at once (keep, or a lower-resistance one from the library): fewest violations first, then capital cost when every candidate conductor has a cost per metre — otherwise daily loss — then fewest spans changed. Small problems are enumerated; larger ones are solved by branch-and-bound from the transformer outward, with annealing if the evaluation budget runs out.</p>
      <div className="grid g3">
        <label className="field"><span>Evaluation budget (scans)</span><input type="number" min="1" max="50000" value={budget} onChange={e => setBudget(e.target.value)} /></label>
        <label className="field"><span>Seed (annealing)</span><input type="number" value={seed} onChange={e => setSeed(e.target.value)} /></label>
      </div>
      <button className="primary" onClick={run} disabled={task.running}>Optimise conductors</button>
      <TaskProgress task={task} />
      {res && (
        <div style={{ marginTop: 12 }}>
          <OptimiserCertificate result={res} space={`${res.spans} spans, ${res.combinations.toLocaleString()} conductor combinations, years ${res.years.join(' and ')}`}
            why="the legacy advisor tries single spans and trunks towards violating poles; this searches combinations of spans, so it can find a cheaper (or lower-loss) set that clears the same violations." />
          <p style={{ marginTop: 8 }}><b>{b.changes.length ? describeReconductor(b.changes) : 'Keep every conductor'}</b> — {b.totalViolations} violation-hour{b.totalViolations === 1 ? '' : 's'} (now {res.baseline.totalViolations}), {b.lossKwh.toFixed(3)} kWh/day{b.capex != null ? `, capex ${Math.round(b.capex).toLocaleString()}` : ' (no costs entered — ranked by loss)'}.</p>
          {b.changes.length > 0 && <button className="mini" onClick={() => onPreview({ changes: b.changes })}>Preview</button>}
        </div>
      )}
    </div>
  );
}
