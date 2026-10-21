import { useMemo, useState } from 'react';
import TaskProgress from './TaskProgress.jsx';
import CsvButton from './CsvButton.jsx';
import ChartCanvas from './ChartCanvas.jsx';
import OptimiserCertificate from './OptimiserCertificate.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import { optSummary } from '../lib/optSummary.js';
import { useDesign } from '../context/DesignContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { CHART_PALETTES, themedScales } from '../lib/chartTheme.js';

// Balancing on the real goal (O2.2): every arrangement is judged by full load flows over the
// chosen years and hours — voltage violations first, then thermal/transformer, then daily loss,
// then the number of moves. Move budgets small enough to enumerate are solved exhaustively
// (exact); larger ones by seeded annealing + tabu with restarts (best found).
const YEAR_CHOICES = [0, 5, 10];
const fmtViol = (v) => `${v.voltage} V${v.thermal + v.transformer ? ` · ${v.thermal + v.transformer} thermal/tx` : ''}${v.vuf ? ` · ${v.vuf} VUF` : ''}`;

export default function BalanceLoadflowCard({ design, txId, testOpts, onPreview }) {
  const { theme } = useTheme();
  const palette = CHART_PALETTES[theme] || CHART_PALETTES.light;
  const [years, setYears] = useState([0, 5]);
  const [maxMoves, setMaxMoves] = useState(3);
  const [exactCap, setExactCap] = useState(5000);
  const [restarts, setRestarts] = useState(20);
  const [budget, setBudget] = useState(3000);
  const [seed, setSeed] = useState(1);
  const [result, setResult] = useState(null);
  const [sel, setSel] = useState(null);
  const task = useEngineTask();
  const { recordOptimisation } = useDesign();

  async function run() {
    const r = await task.run('balanceOptimise', {
      design, txId, years, hours: testOpts.hours, solarMult: testOpts.solarMult, maxMoves: Number(maxMoves) || 0,
      exactCap: Number(exactCap) || 0, restarts: Number(restarts) || 0, budget: Number(budget) || 1, seed: Number(seed) || 1
    }, 'Balancing on the load-flow goal');
    if (!r.ok) return;
    setResult({ ...r.result, periodLabel: testOpts.periodLabel });
    setSel(r.result.recommended ? 'rec' : r.result.table.length - 1);
    const rec = r.result.recommended;
    recordOptimisation('balanceLoadflow', optSummary('Phase balance on the load-flow goal', rec
      ? `Recommended ${rec.moves} move(s): ${rec.changed.map(c => `${c.pole} ${c.id} ${c.from}→${c.to}`).join(', ') || 'none'}; ${rec.totalViolations} violation-hours, ${rec.lossKwh.toFixed(3)} kWh/day (today ${r.result.today.totalViolations} / ${r.result.today.lossKwh.toFixed(3)}; greedy ${r.result.legacy.moves} moves / ${r.result.legacy.lossKwh.toFixed(3)})`
      : `No zero-violation arrangement within ${r.result.maxMoves} moves`, r.result));
  }
  const toggleYear = (y) => setYears(ys => (ys.includes(y) ? ys.filter(x => x !== y) : [...ys, y].sort((a, b) => a - b)));
  const picked = !result ? null : sel === 'rec' ? result.recommended : typeof sel === 'string' && sel.startsWith('alt') ? result.alternatives[Number(sel.slice(3))] : result.table[sel] && result.table[sel].bestWithin;

  const chart = useMemo(() => {
    if (!result) return null;
    const pts = (ok) => result.pareto.filter(p => (p.violations === 0) === ok).map(p => ({ x: p.moves, y: p.lossKwh, v: p.violations }));
    return {
      data: { datasets: [
        { label: 'No violations (▲)', data: pts(true), pointStyle: 'triangle', pointRadius: 7, backgroundColor: palette.seriesColors[0] },
        { label: 'With violations (●)', data: pts(false), pointStyle: 'circle', pointRadius: 5, backgroundColor: palette.axisColor }
      ] },
      options: {
        animation: false,
        plugins: { legend: { labels: { color: palette.legendColor, usePointStyle: true } }, tooltip: { callbacks: { label: (c) => `${c.raw.x} moves · ${c.raw.y.toFixed(3)} kWh/day · ${c.raw.v} violation-hours` } } },
        scales: themedScales(palette, { xTitle: 'Moves', yTitle: 'Loss, kWh/day (first year)' })
      }
    };
  }, [result, palette]);

  const why = result && result.recommended ? (() => {
    const rec = result.recommended, leg = result.legacy;
    const biggest = rec.changed.slice().sort((a, b) => b.kva - a.kva)[0];
    return <>The greedy balances nameplate kVA and ignores where a connection is and when it draws power: it makes {leg.moves} move{leg.moves === 1 ? '' : 's'} for {leg.totalViolations} violation-hours and {leg.lossKwh.toFixed(3)} kWh/day. The load-flow optimum needs {rec.moves} move{rec.moves === 1 ? '' : 's'} for {rec.totalViolations} violation-hours and {rec.lossKwh.toFixed(3)} kWh/day{biggest ? <> — e.g. the {biggest.kva} kVA {biggest.label} at {biggest.pole} ({biggest.from}→{biggest.to}): far down the feeder, its current crosses every span and returns on the neutral, so it shifts voltages far more than the same kVA near the transformer</> : null}.</>;
  })() : null;

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Optimised on load flow</h2>
      <p className="hint">Judges every arrangement by full load flows {testOpts.periodLabel} in each chosen year: fewest voltage violations first, then thermal/transformer, then daily loss, then fewest moves. Small move budgets are searched exhaustively (exact); beyond the cap, seeded annealing with a tabu list and restarts.</p>
      <fieldset style={{ border: 0, padding: 0, margin: '0 0 8px' }}>
        <legend className="hint" style={{ padding: 0 }}>Years checked</legend>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{YEAR_CHOICES.map(y => <label key={y} className="chk"><input type="checkbox" checked={years.includes(y)} onChange={() => toggleYear(y)} /> Year {y}</label>)}</div>
      </fieldset>
      <div className="grid g3">
        <label className="field"><span>Move budget</span><input type="number" min="0" max="20" value={maxMoves} onChange={e => setMaxMoves(e.target.value)} /></label>
        <label className="field"><span>Exhaustive up to (designs per level)</span><input type="number" min="0" max="50000" value={exactCap} onChange={e => setExactCap(e.target.value)} /></label>
        <label className="field"><span>Annealing restarts</span><input type="number" min="0" max="50" value={restarts} onChange={e => setRestarts(e.target.value)} /></label>
        <label className="field"><span>Evaluations per restart</span><input type="number" min="1" max="20000" value={budget} onChange={e => setBudget(e.target.value)} /></label>
        <label className="field"><span>Seed (same seed → same result)</span><input type="number" value={seed} onChange={e => setSeed(e.target.value)} /></label>
      </div>
      <button className="primary" onClick={run} disabled={task.running || !txId || !years.length}>Optimise</button>
      <TaskProgress task={task} />

      {result && (
        <div style={{ marginTop: 12 }}>
          <OptimiserCertificate result={result}
            space={`arrangements of ${result.items.length} connections with up to ${result.maxMoves} moves (identical connections counted once), ${result.years.map(y => `year ${y}`).join(' and ')}, ${result.hours.length} hours each`}
            why={why} />
          {result.recommended ? (
            <p style={{ marginTop: 8 }}><b>Recommended:</b> {result.recommended.moves} move{result.recommended.moves === 1 ? '' : 's'} — no violations, {result.recommended.lossKwh.toFixed(3)} kWh/day. <button className="mini" onClick={() => setSel('rec')}>Show</button>
              {result.alternatives.map((a, i) => <span key={i}> · Best loss with +{a.extraMoves}: {a.lossKwh.toFixed(3)} kWh/day ({a.moves} moves) <button className="mini" onClick={() => setSel('alt' + i)}>Show</button></span>)}</p>
          ) : <p className="hint" style={{ marginTop: 8 }}>No arrangement within {result.maxMoves} moves clears every violation — raise the move budget, or look at the best rows below.</p>}
          <p className="hint">Today: {fmtViol(result.today.violations)} violation-hours, {result.today.lossKwh.toFixed(3)} kWh/day. Quick (legacy greedy): {result.legacy.moves} moves, {fmtViol(result.legacy.violations)}, {result.legacy.lossKwh.toFixed(3)} kWh/day.</p>
          <div className="tbl-wrap"><table>
            <thead><tr><th scope="col">Moves (≤)</th><th scope="col">Designs</th><th scope="col">With 0 violations</th><th scope="col">Best: violation-hours</th><th scope="col">Best: kWh/day</th><th scope="col">Search</th><th scope="col"></th></tr></thead>
            <tbody>{result.table.map((t, i) => (
              <tr key={t.k} className={sel === i ? 'selected' : ''}>
                <td>{t.k}</td><td>{t.distinct.toLocaleString()}{t.exact ? '' : ' visited'}</td><td>{t.feasible}</td>
                <td>{t.bestWithin ? fmtViol(t.bestWithin.violations) : '—'}</td><td>{t.bestWithin ? t.bestWithin.lossKwh.toFixed(3) : '—'}</td>
                <td>{t.exact ? 'exhaustive' : 'annealing'}</td>
                <td><button className="mini" onClick={() => setSel(i)} aria-label={`Show the best arrangement with at most ${t.k} moves`}>Select</button></td>
              </tr>
            ))}</tbody>
          </table></div>
          <CsvButton name="Load-flow balancing by move budget" columns={['Max moves', 'Designs', 'Zero-violation designs', 'Best violation-hours', 'Best kWh/day', 'Search']} rows={result.table.map(t => [t.k, t.distinct, t.feasible, t.bestWithin ? t.bestWithin.totalViolations : '', t.bestWithin ? t.bestWithin.lossKwh : '', t.exact ? 'exhaustive' : 'annealing'])} />
          {chart && result.pareto.length > 1 && (
            <div style={{ marginTop: 10, minWidth: 0 }}>
              <div className="section-title">Moves vs loss (non-dominated arrangements)</div>
              <ChartCanvas type="scatter" data={chart.data} options={chart.options} height={110} label="Pareto chart: moves against daily loss; triangles have no violations" />
            </div>
          )}
          {picked && (
            <div style={{ marginTop: 10 }}>
              <div className="section-title">{picked.moves} move{picked.moves === 1 ? '' : 's'}: {fmtViol(picked.violations)} violation-hours, {picked.lossKwh.toFixed(3)} kWh/day</div>
              {!picked.changed.length ? <p className="hint">No moves — today's arrangement.</p> : (
                <>
                  <div className="tbl-wrap"><table>
                    <thead><tr><th scope="col">Pole</th><th scope="col">Connection</th><th scope="col">kVA</th><th scope="col">From</th><th scope="col">To</th></tr></thead>
                    <tbody>{picked.changed.map(c => <tr key={c.kind + c.id}><td>{c.pole}</td><td>{c.id} — {c.label}</td><td>{c.kva.toFixed(2)}</td><td className={'phase' + c.from}>{c.from}</td><td className={'phase' + c.to}>{c.to}</td></tr>)}</tbody>
                  </table></div>
                  <button className="mini" style={{ marginTop: 8 }} onClick={() => onPreview(picked.changed.map(c => ({ ...c, phase: c.from, newPhase: c.to })), `load-flow optimised, ${picked.moves} moves`)}>Preview</button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
