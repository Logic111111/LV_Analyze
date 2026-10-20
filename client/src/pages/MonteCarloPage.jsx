import { useMemo, useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import YearPicker from '../components/YearPicker.jsx';
import TaskProgress from '../components/TaskProgress.jsx';
import ChartCanvas from '../components/ChartCanvas.jsx';
import SizeListEditor from '../components/SizeListEditor.jsx';
import { ConvergenceWarning } from '../components/Convergence.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import { adoptionSizesFromDesign, MC_CRITICAL_HOURS } from '../lib/loadflow.js';
import { CHART_PALETTES, themedScales } from '../lib/chartTheme.js';

// Probabilistic planning (P4.4): random EV / PV adoption, many runs, in the engine worker.
const METRICS = [
  { key: 'minV', label: 'Minimum voltage', unit: 'V', digits: 1 },
  { key: 'maxV', label: 'Maximum voltage', unit: 'V', digits: 1 },
  { key: 'txPeakPct', label: 'Transformer peak loading', unit: '%', digits: 0 },
  { key: 'lossKwh', label: 'Losses over the scanned hours', unit: 'kWh', digits: 2 }
];
const pct = (p) => (p * 100).toFixed(p > 0 && p < 0.01 ? 1 : 0) + ' %';

function Histogram({ dist, metric, palette }) {
  const data = useMemo(() => ({
    labels: dist.histogram.counts.map((_, i) => dist.histogram.edges[i].toFixed(metric.digits)),
    datasets: [{ label: 'Runs', data: dist.histogram.counts, backgroundColor: palette.seriesColors[0] }]
  }), [dist, metric, palette]);
  const options = useMemo(() => ({
    animation: false, plugins: { legend: { display: false } },
    scales: themedScales(palette, { xTitle: `${metric.label} (${metric.unit}), bin start`, yTitle: 'Runs' })
  }), [metric, palette]);
  return <ChartCanvas type="bar" data={data} options={options} height={140} label={`Histogram of ${metric.label} over the runs`} />;
}

export default function MonteCarloPage() {
  const { design } = useDesign();
  const { theme } = useTheme();
  const palette = CHART_PALETTES[theme] || CHART_PALETTES.light;
  const fromDesign = () => adoptionSizesFromDesign(design);
  const [year, setYear] = useState(0);
  const [evPct, setEvPct] = useState(20);
  const [pvPct, setPvPct] = useState(20);
  const [evSizes, setEvSizes] = useState(() => fromDesign().ev);
  const [pvSizes, setPvSizes] = useState(() => fromDesign().pv);
  const [runs, setRuns] = useState(500);
  const [seed, setSeed] = useState(1);
  const [fullDay, setFullDay] = useState(false);
  const [result, setResult] = useState(null);
  const task = useEngineTask();

  async function run() {
    const r = await task.run('monteCarlo', {
      design, year, evPct: Number(evPct) || 0, pvPct: Number(pvPct) || 0,
      evSizes: evSizes.map(s => ({ kva: Number(s.kva), weight: Number(s.weight) })),
      pvSizes: pvSizes.map(s => ({ kva: Number(s.kva), weight: Number(s.weight) })),
      runs: Number(runs) || 1, seed: Number(seed) || 0, hours: fullDay ? [...Array(24).keys()] : [...MC_CRITICAL_HOURS]
    }, 'Monte Carlo study');
    if (r.ok) setResult(r.result);
  }

  const maxNodeP = result ? Math.max(0, ...result.nodeProbability.flatMap(n => [n.A, n.B, n.C])) : 0;

  return (
    <div>
      <div className="card">
        <h2>Probabilistic planning (Monte Carlo)</h2>
        <p className="hint">Each run gives a random set of household customers an EV charger and/or rooftop PV — exactly the adoption % of them, each on its own pole and phase, sized from the lists below — and solves the chosen hours. Over many runs this shows how likely a violation is, and where. The same inputs and seed always give the same result.</p>
        <div className="grid g3">
          <div className="field"><span>Target year</span><YearPicker value={year} onChange={setYear} /></div>
          <label className="field"><span>EV adoption (% of household customers)</span>
            <input type="number" min="0" max="100" value={evPct} onChange={e => setEvPct(e.target.value)} /></label>
          <label className="field"><span>PV adoption (% of household customers)</span>
            <input type="number" min="0" max="100" value={pvPct} onChange={e => setPvPct(e.target.value)} /></label>
        </div>
        <div className="grid g2" style={{ marginBottom: 12 }}>
          <SizeListEditor label="EV charger sizes" sizes={evSizes} onChange={setEvSizes} onLoadFromDesign={() => setEvSizes(fromDesign().ev)} />
          <SizeListEditor label="PV system sizes" sizes={pvSizes} onChange={setPvSizes} onLoadFromDesign={() => setPvSizes(fromDesign().pv)} />
        </div>
        <div className="grid g3">
          <label className="field"><span>Number of runs</span>
            <input type="number" min="1" max="5000" value={runs} onChange={e => setRuns(e.target.value)} /></label>
          <label className="field"><span>Seed</span>
            <input type="number" value={seed} onChange={e => setSeed(e.target.value)} /></label>
          <div className="field"><span>Hours solved</span>
            <label className="chk"><input type="radio" name="mcHours" checked={!fullDay} onChange={() => setFullDay(false)} /> Critical hours (12:00, 20:00)</label>
            <label className="chk"><input type="radio" name="mcHours" checked={fullDay} onChange={() => setFullDay(true)} /> Full day (24 h, 12× slower)</label>
          </div>
        </div>
        <button className="primary" onClick={run} disabled={task.running}>Run study</button>
        <TaskProgress task={task} />
      </div>

      {result && (
        <div style={{ marginTop: 18 }}>
          <div className="grid g4">
            <div className={'stat ' + (result.probabilityAnyViolation > 0 ? 'bad' : 'ok')}><div className="v">{pct(result.probabilityAnyViolation)}</div><div className="l">Probability of any violation</div></div>
            <div className={'stat ' + (result.base.anyViolation ? 'bad' : 'ok')}><div className="v">{result.base.anyViolation ? 'Yes' : 'No'}</div><div className="l">Violation without new adoption</div></div>
            <div className="stat"><div className="v">{result.evPerRun} EV · {result.pvPerRun} PV</div><div className="l">Added per run, of {result.customers} customers</div></div>
            <div className="stat"><div className="v">{result.inputs.runs}</div><div className="l">Runs · seed {result.inputs.seed} · hours {result.inputs.hours.length === 24 ? 'full day' : result.inputs.hours.map(h => h + ':00').join(', ')}</div></div>
          </div>
          {(result.forcedOn.ev || result.forcedOn.solar) && (
            <div className="note" style={{ marginTop: 12 }}>{[result.forcedOn.ev && 'EV loads', result.forcedOn.solar && 'Solar'].filter(Boolean).join(' and ')}: switched off in Setup, switched on for this study so the adopted units count.</div>
          )}
          <ConvergenceWarning show={result.nonConvergedRuns > 0}>{result.nonConvergedRuns} run{result.nonConvergedRuns === 1 ? '' : 's'} had an hour that did not converge — their figures are unreliable.</ConvergenceWarning>

          <div className="card" style={{ marginTop: 14 }}>
            <h2>Where violations happen</h2>
            <p className="hint">Share of runs with a voltage or thermal violation at each pole and phase, at any of the solved hours. Shading deepens with probability; the number is always printed.</p>
            <div className="tbl-wrap"><table>
              <thead><tr><th scope="col">Pole</th><th scope="col">Phase A</th><th scope="col">Phase B</th><th scope="col">Phase C</th></tr></thead>
              <tbody>
                {result.nodeProbability.map(n => (
                  <tr key={n.pole}>
                    <th scope="row" style={{ textAlign: 'left' }}>{n.pole}</th>
                    {['A', 'B', 'C'].map(ph => (
                      <td key={ph} style={{ background: n[ph] > 0 ? `color-mix(in srgb, var(--bad) ${Math.round(10 + 50 * n[ph] / (maxNodeP || 1))}%, transparent)` : undefined }}>
                        {ph} {pct(n[ph])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h2>Distributions</h2>
            <div className="tbl-wrap"><table>
              <thead><tr><th scope="col">Quantity</th><th scope="col">Without adoption</th><th scope="col">P5</th><th scope="col">P10</th><th scope="col">P50</th><th scope="col">P90</th><th scope="col">P95</th><th scope="col">Mean</th></tr></thead>
              <tbody>
                {METRICS.map(m => {
                  const d = result.distributions[m.key];
                  return (
                    <tr key={m.key}>
                      <th scope="row" style={{ textAlign: 'left' }}>{m.label} ({m.unit})</th>
                      <td>{result.base[m.key].toFixed(m.digits)}</td>
                      {['P5', 'P10', 'P50', 'P90', 'P95'].map(q => <td key={q}>{d.quantiles[q].toFixed(m.digits)}</td>)}
                      <td>{d.mean.toFixed(m.digits)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            <p className="hint">P90 = 90 % of runs are at or below this value. For minimum voltage, the low quantiles (P5, P10) are the planning figures.</p>
            <div className="grid g2">
              {METRICS.map(m => (
                // minWidth 0 lets the grid cell shrink below the canvas's drawn width (a grid item's
                // default minimum is its content), so Chart.js resizes instead of overflowing.
                <div key={m.key} style={{ minWidth: 0, position: 'relative' }}>
                  <div className="section-title">{m.label}</div>
                  <Histogram dist={result.distributions[m.key]} metric={m} palette={palette} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
