import { useState } from 'react';
import TaskProgress from './TaskProgress.jsx';
import CsvButton from './CsvButton.jsx';
import OptimiserCertificate from './OptimiserCertificate.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import { optSummary } from '../lib/optSummary.js';
import { useDesign } from '../context/DesignContext.jsx';

// Exact phase balancing (O2.1): dynamic programming gives, for every move budget, the smallest
// possible spread between the phase totals — a proof, not a search. A linear goal: rows are
// previewed with a load flow before anything is applied.
const KIND_LABEL = { load: 'load', pv: 'PV', bess: 'BESS' };

export default function BalanceDPCard({ design, txId, onPreview }) {
  const [objective, setObjective] = useState('nameplate');
  const [maxMoves, setMaxMoves] = useState(9);
  const [result, setResult] = useState(null);
  const [sel, setSel] = useState(null);
  const task = useEngineTask();
  const { recordOptimisation } = useDesign();

  async function run() {
    const r = await task.run('balanceExactDP', { design, txId, objective, maxMoves: Number(maxMoves) || 0 }, 'Exact balancing (dynamic programming)');
    if (!r.ok) return;
    setResult(r.result);
    setSel(r.result.table.length - 1);
    const g = r.result.table[r.result.table.length - 1];
    recordOptimisation('balanceDP', optSummary(`Exact phase balance (${r.result.objective === 'impedanceWeighted' ? 'impedance-weighted' : 'nameplate'})`, `Smallest spread ${g.spread} with ${g.moves} moves; by move budget 0…${g.k}: ${r.result.table.map(t => t.spread).join(', ')}`, r.result));
  }
  const unit = result && result.objective === 'impedanceWeighted' ? 'kVA·(|Z|/|Z₁|)' : 'kVA';
  const row = result && sel != null ? result.table[sel] : null;

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Exact balance (dynamic programming)</h2>
      <p className="hint">The best possible balance of the per-phase totals for every move budget, proven by dynamic programming over all arrangements (not a greedy pass). "Impedance-weighted" counts each connection's kVA × the impedance of its path to the transformer, so far-end customers count for more.</p>
      <div className="grid g3">
        <label className="field"><span>Goal</span>
          <select value={objective} onChange={e => setObjective(e.target.value)}>
            <option value="nameplate">Nameplate kVA spread</option>
            <option value="impedanceWeighted">Impedance-weighted spread</option>
          </select></label>
        <label className="field"><span>Max moves</span><input type="number" min="0" max="200" value={maxMoves} onChange={e => setMaxMoves(e.target.value)} /></label>
      </div>
      <button className="primary" onClick={run} disabled={task.running || !txId}>Solve exactly</button>
      <TaskProgress task={task} />
      {result && (
        <div style={{ marginTop: 12 }}>
          <OptimiserCertificate result={result}
            space={`every arrangement of ${result.items.length} connections on 3 phases with up to ${result.table.length - 1} moves, as ${result.states.toLocaleString()} distinct partial-sum states at ${result.resolution} ${unit} resolution`}
            why="the greedy places the largest connection on the lightest phase once and never revisits; the exact method considers every combination, and shows what each extra move buys." />
          <div className="tbl-wrap" style={{ marginTop: 8 }}><table>
            <thead><tr><th scope="col">Max moves</th><th scope="col">Smallest spread ({unit})</th><th scope="col">Moves used</th><th scope="col">Per-phase kVA (A / B / C)</th><th scope="col"></th></tr></thead>
            <tbody>{result.table.map((t, i) => (
              <tr key={t.k} className={sel === i ? 'selected' : ''}>
                <td>{t.k}</td><td>{t.spread == null ? '—' : t.spread.toFixed(2)}</td><td>{t.moves ?? '—'}</td>
                <td>{t.kvaTotals ? `${t.kvaTotals.A.toFixed(1)} / ${t.kvaTotals.B.toFixed(1)} / ${t.kvaTotals.C.toFixed(1)}` : '—'}</td>
                <td><button className="mini" onClick={() => setSel(i)} aria-label={`Show the moves for at most ${t.k} moves`}>Select</button></td>
              </tr>
            ))}</tbody>
          </table></div>
          <CsvButton name="Exact balance by move budget" columns={['Max moves', `Spread (${unit})`, 'Moves used']} rows={result.table.map(t => [t.k, t.spread ?? '', t.moves ?? ''])} />
          {row && row.changed && (
            <div style={{ marginTop: 10 }}>
              <div className="section-title">At most {row.k} moves: {row.moves} used</div>
              {!row.changed.length ? <p className="hint">No moves — today's arrangement.</p> : (
                <>
                  <div className="tbl-wrap"><table>
                    <thead><tr><th scope="col">Pole</th><th scope="col">Connection</th><th scope="col">kVA</th><th scope="col">From</th><th scope="col">To</th></tr></thead>
                    <tbody>{row.changed.map(c => <tr key={c.kind + c.id}><td>{c.pole}</td><td>{c.id} — {KIND_LABEL[c.kind] || c.kind}{c.kind === 'load' ? ` (${c.label})` : ''}</td><td>{c.kva.toFixed(2)}</td><td className={'phase' + c.phase}>{c.phase}</td><td className={'phase' + c.newPhase}>{c.newPhase}</td></tr>)}</tbody>
                  </table></div>
                  <button className="mini" style={{ marginTop: 8 }} onClick={() => onPreview(row.changed, `exact DP, ≤ ${row.k} moves`)}>Preview</button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
