import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import YearPicker from '../components/YearPicker.jsx';
import LineChart from '../components/LineChart.jsx';
import TaskProgress from '../components/TaskProgress.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';

// Chart.js needs literal colour strings (not CSS var()), so the two themes' chart palettes are
// kept here in step with the --* custom properties in styles.css.
const CHART_PALETTES = {
  light: {
    axisColor: '#5B6B85', gridColor: '#E4E9F1', legendColor: '#17202E',
    seriesColors: ['#2563EB', '#7C3AED', '#16A34A', '#DC2626'],
    maxColor: '#DC2626', minColor: '#16A34A',
    phaseColors: { A: '#C2410C', B: '#2563EB', C: '#15803D' }
  },
  dark: {
    axisColor: '#7F94B5', gridColor: '#22304A', legendColor: '#DCE6F5',
    seriesColors: ['#4F8CFF', '#B25CFF', '#4FD98A', '#F0546A'],
    maxColor: '#F0546A', minColor: '#4FD98A',
    phaseColors: { A: '#FF9B71', B: '#4F8CFF', C: '#4FD98A' }
  }
};
const TX_DASH_PATTERNS = [[], [6, 4], [2, 2], [8, 3, 2, 3]];

// Which pole/phase actually holds the highest (or lowest) voltage at this hour — not just the
// value — so the profile can point at the specific location driving each hour's extreme.
function extremeVoltage(poleResults, better) {
  let best = null;
  poleResults.forEach(p => {
    ['A', 'B', 'C'].forEach(ph => {
      const value = p.volt[ph];
      if (!best || better(value, best.value)) best = { value, pole: p.id, phase: ph };
    });
  });
  return best;
}

export default function DailyPage() {
  const { design, setLastDaily } = useDesign();
  const [year, setYear] = useState(0);
  const [rows, setRows] = useState(null);
  const [lowLoadPct, setLowLoadPct] = useState(50);
  const [rowsLowLoad, setRowsLowLoad] = useState(null);
  const [lowSolarPct, setLowSolarPct] = useState(50);
  const [rowsLowSolar, setRowsLowSolar] = useState(null);
  // Each scenario's 24 h scan runs in the engine worker (it can take a few hundred ms on a large
  // feeder), with progress and Cancel.
  const combinedTask = useEngineTask();
  const lowLoadTask = useEngineTask();
  const lowSolarTask = useEngineTask();

  async function run() {
    const r = await combinedTask.run('dailyScan', { design, year, loadMult: 1, solarMult: 1 }, 'Running the 24-hour scan');
    if (!r.ok) return;
    setRows(r.result);
    setLastDaily(d => ({ ...(d || {}), combined: { rows: r.result, loadMult: 1, solarMult: 1 } }));
  }
  async function runLowLoad() {
    const loadMult = (Number(lowLoadPct) || 0) / 100;
    const r = await lowLoadTask.run('dailyScan', { design, year, loadMult, solarMult: 1 }, 'Running the low-load scan');
    if (!r.ok) return;
    setRowsLowLoad(r.result);
    setLastDaily(d => ({ ...(d || {}), lowLoad: { rows: r.result, loadMult, solarMult: 1 } }));
  }
  async function runLowSolar() {
    const solarMult = (Number(lowSolarPct) || 0) / 100;
    const r = await lowSolarTask.run('dailyScan', { design, year, loadMult: 1, solarMult }, 'Running the low-solar scan');
    if (!r.ok) return;
    setRowsLowSolar(r.result);
    setLastDaily(d => ({ ...(d || {}), lowSolar: { rows: r.result, loadMult: 1, solarMult } }));
  }

  return (
    <div>
      <div className="card" style={{ padding: '12px 18px', marginBottom: 14 }}>
        <span style={{ fontFamily: 'var(--disp)', fontWeight: 600, fontSize: 15 }}>{design.name}</span>
      </div>

      <div className="card">
        <h2>24-hour combined profile</h2>
        <p className="hint">Runs the load flow once per hour with the general-load, EV-charging and solar curves all applied simultaneously at their normal (100%) curve values, for the selected year.</p>
        <div className="grid g2">
          <label className="field"><span>Year</span><YearPicker value={year} onChange={setYear} /></label>
          <div>
            <label className="field"><span>&nbsp;</span></label>
            <button className="primary" onClick={run} disabled={combinedTask.running}>Run 24-hour scan</button>
            <TaskProgress task={combinedTask} />
          </div>
        </div>
      </div>
      {rows && <DailyResults rows={rows} title="Combined — typical load & solar (100% / 100%)" />}

      <div className="section-title">Scenario — typical solar, low load</div>
      <div className="card">
        <p className="hint">Same 24-hour scan with solar held at its normal curve but general/EV/shop load scaled to the percentage below — e.g. a mild, sunny low-demand day.</p>
        <div className="grid g3">
          <label className="field"><span>Load multiplier (% of normal)</span>
            <input type="number" min={0} max={200} step={5} value={lowLoadPct} onChange={e => setLowLoadPct(e.target.value)} /></label>
          <div>
            <label className="field"><span>&nbsp;</span></label>
            <button className="primary" onClick={runLowLoad} disabled={lowLoadTask.running}>Run scenario</button>
            <TaskProgress task={lowLoadTask} />
          </div>
        </div>
      </div>
      {rowsLowLoad && <DailyResults rows={rowsLowLoad} title={`Typical solar / low load (100% solar, ${lowLoadPct}% load)`} />}

      <div className="section-title">Scenario — low solar, typical load</div>
      <div className="card">
        <p className="hint">Same 24-hour scan with load held at its normal curve but solar irradiance scaled to the percentage below — e.g. an overcast, normal-demand day.</p>
        <div className="grid g3">
          <label className="field"><span>Solar multiplier (% of normal)</span>
            <input type="number" min={0} max={150} step={5} value={lowSolarPct} onChange={e => setLowSolarPct(e.target.value)} /></label>
          <div>
            <label className="field"><span>&nbsp;</span></label>
            <button className="primary" onClick={runLowSolar} disabled={lowSolarTask.running}>Run scenario</button>
            <TaskProgress task={lowSolarTask} />
          </div>
        </div>
      </div>
      {rowsLowSolar && <DailyResults rows={rowsLowSolar} title={`Low solar (${lowSolarPct}%) / typical load (100%)`} />}
    </div>
  );
}

function DailyResults({ rows, title }) {
  const { theme } = useTheme();
  const P = CHART_PALETTES[theme] || CHART_PALETTES.light;
  const { axisColor, gridColor, legendColor, seriesColors, phaseColors } = P;
  const hours = rows.map(r => r.hour);
  const labels = hours.map(h => String(h).padStart(2, '0') + ':00');
  const txIds = rows[0].transformers.map(t => t.id);
  const txName = id => rows[0].transformers.find(t => t.id === id)?.name || id;
  const maxVInfo = rows.map(r => extremeVoltage(r.poleResults, (v, best) => v > best));
  const minVInfo = rows.map(r => extremeVoltage(r.poleResults, (v, best) => v < best));
  const maxV = maxVInfo.map(i => i.value);
  const minV = minVInfo.map(i => i.value);
  const vHigh = rows[0].vLimHigh, vLow = rows[0].vLimLow;

  const allViolations = [];
  rows.forEach(r => r.violations.forEach(v => allViolations.push({ hour: r.hour, ...v })));
  const anyNonConverged = rows.some(r => !r.converged);
  const hoursExporting = rows.filter(r => r.transformers.some(t => t.flowDirection === 'export')).length;
  const hoursWithViolations = new Set(allViolations.map(v => v.hour)).size;
  const worstOver = allViolations.filter(v => v.type === 'overvoltage').sort((a, b) => b.value - a.value)[0];
  const worstUnder = allViolations.filter(v => v.type === 'undervoltage').sort((a, b) => a.value - b.value)[0];

  const chart1Data = {
    labels,
    datasets: txIds.flatMap((id, i) => {
      const color = seriesColors[i % seriesColors.length];
      const txPctSeries = rows.map(r => { const t = r.transformers.find(t => t.id === id); return t.flowDirection === 'export' ? -t.txPct : t.txPct; });
      const netKWSeries = rows.map(r => r.transformers.find(t => t.id === id).netKW);
      return [
        { label: `${txName(id)} loading % (−ve = export)`, data: txPctSeries, borderColor: color, backgroundColor: color + '20', tension: 0.3, yAxisID: 'y', pointRadius: 2 },
        { label: `${txName(id)} net real power (kW, +import/−export)`, data: netKWSeries, borderColor: color, tension: 0.3, yAxisID: 'y1', pointRadius: 2, borderDash: [4, 3] }
      ];
    })
  };
  const chart1Opts = {
    responsive: true, interaction: { mode: 'index', intersect: false },
    scales: {
      y: { title: { display: true, text: '% of rating', color: axisColor }, grid: { color: gridColor }, ticks: { color: axisColor } },
      y1: { position: 'right', title: { display: true, text: 'kW', color: axisColor }, grid: { drawOnChartArea: false }, ticks: { color: axisColor } },
      x: { grid: { color: gridColor }, ticks: { color: axisColor } }
    },
    plugins: { legend: { labels: { color: legendColor } } }
  };
  const chart2Data = {
    labels,
    datasets: [
      { label: 'Max pole voltage', data: maxV, borderColor: P.maxColor, tension: 0.3, pointRadius: 2 },
      { label: 'Min pole voltage', data: minV, borderColor: P.minColor, tension: 0.3, pointRadius: 2 },
      { label: 'Upper limit', data: hours.map(() => vHigh), borderColor: axisColor, borderDash: [6, 4], pointRadius: 0 },
      { label: 'Lower limit', data: hours.map(() => vLow), borderColor: axisColor, borderDash: [6, 4], pointRadius: 0 }
    ]
  };
  const chart2Opts = {
    responsive: true, interaction: { mode: 'index', intersect: false },
    scales: {
      y: { title: { display: true, text: 'Volts (phase-neutral)', color: axisColor }, grid: { color: gridColor }, ticks: { color: axisColor } },
      x: { grid: { color: gridColor }, ticks: { color: axisColor } }
    },
    plugins: {
      legend: { labels: { color: legendColor } },
      tooltip: {
        callbacks: {
          afterLabel: (ctx) => {
            const info = ctx.dataset.label === 'Max pole voltage' ? maxVInfo[ctx.dataIndex] : ctx.dataset.label === 'Min pole voltage' ? minVInfo[ctx.dataIndex] : null;
            return info ? `Pole ${info.pole}, phase ${info.phase}` : undefined;
          }
        }
      }
    }
  };

  const txBusChart = txIds.length && rows[0].transformers[0].busVoltPct
    ? {
      data: {
        labels,
        datasets: [
          ...txIds.flatMap((id, ti) => ['A', 'B', 'C'].map(ph => ({
            label: `${txName(id)} bus V-${ph}`,
            data: rows.map(r => r.transformers.find(t => t.id === id).busVoltPct[ph]),
            borderColor: phaseColors[ph],
            borderDash: TX_DASH_PATTERNS[ti % TX_DASH_PATTERNS.length],
            tension: 0.3, pointRadius: 2
          }))),
          { label: 'Upper limit', data: hours.map(() => vHigh), borderColor: axisColor, borderDash: [6, 4], pointRadius: 0 },
          { label: 'Lower limit', data: hours.map(() => vLow), borderColor: axisColor, borderDash: [6, 4], pointRadius: 0 }
        ]
      },
      opts: {
        responsive: true, interaction: { mode: 'index', intersect: false },
        scales: {
          y: { title: { display: true, text: 'Volts (phase-neutral)', color: axisColor }, grid: { color: gridColor }, ticks: { color: axisColor } },
          x: { grid: { color: gridColor }, ticks: { color: axisColor } }
        },
        plugins: { legend: { labels: { color: legendColor } } }
      }
    }
    : null;

  return (
    <div style={{ marginTop: 18, marginBottom: 28, paddingTop: 14, borderTop: '1px solid var(--line, #22304A)' }}>
      {title && <div className="section-title" style={{ marginTop: 0 }}>{title}</div>}
      {anyNonConverged && <div className="note" style={{ borderColor: 'var(--bad)', color: 'var(--bad)', marginBottom: 14 }}>One or more hours did not fully converge — treat those hours' figures with caution.</div>}
      <div className="grid g4">
        <div className={'stat ' + (hoursWithViolations ? 'bad' : 'ok')}><div className="v">{hoursWithViolations}/24</div><div className="l">Hours with a violation</div></div>
        <div className={'stat ' + (hoursExporting ? 'warn' : 'ok')}><div className="v">{hoursExporting}/24</div><div className="l">Hours exporting to grid</div></div>
        <div className={'stat ' + (worstOver ? 'bad' : 'ok')}><div className="v">{worstOver ? worstOver.value.toFixed(1) + ' V' : '—'}</div><div className="l">Peak overvoltage{worstOver ? ` (h${worstOver.hour}, ${worstOver.pole}/${worstOver.phase})` : ''}</div></div>
        <div className={'stat ' + (worstUnder ? 'bad' : 'ok')}><div className="v">{worstUnder ? worstUnder.value.toFixed(1) + ' V' : '—'}</div><div className="l">Worst undervoltage{worstUnder ? ` (h${worstUnder.hour}, ${worstUnder.pole}/${worstUnder.phase})` : ''}</div></div>
      </div>

      <div className="section-title">Transformer loading &amp; grid direction</div>
      <div className="card"><LineChart data={chart1Data} options={chart1Opts} />
        <p className="hint" style={{ marginTop: 10 }}>Loading is plotted as negative while exporting. No violation is raised for high export loading.</p></div>

      {txBusChart && (
        <>
          <div className="section-title">Transformer LV bus voltage</div>
          <div className="card"><LineChart data={txBusChart.data} options={txBusChart.opts} />
            <p className="hint" style={{ marginTop: 10 }}>Per-phase voltage at each transformer's secondary bus — i.e. right after the transformer's own impedance drop, before any feeder/span drop further out. {txIds.length > 1 ? 'Line dash pattern distinguishes transformers; ' : ''}Line colour is phase (A/B/C). Statutory band: {vLow.toFixed(1)} – {vHigh.toFixed(1)} V phase-neutral (dashed grey lines).</p></div>
        </>
      )}

      <div className="section-title">Feeder voltage envelope (min/max across all poles)</div>
      <div className="card"><LineChart data={chart2Data} options={chart2Opts} />
        <p className="hint" style={{ marginTop: 10 }}>Statutory band: {vLow.toFixed(1)} – {vHigh.toFixed(1)} V phase-neutral (dashed lines). Hover a point for the pole/phase holding that hour's extreme.</p></div>

      <div className="section-title">Hour-by-hour summary</div>
      <div className="card"><div className="tbl-wrap"><table>
        <thead><tr><th>Hour</th>{txIds.map(id => <th key={id}>{txName(id)}</th>)}<th>Min V (pole/phase)</th><th>Max V (pole/phase)</th><th>Violations</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const vcount = r.violations.length;
            return (
              <tr key={r.hour}>
                <td>{String(r.hour).padStart(2, '0')}:00</td>
                {txIds.map(id => {
                  const t = r.transformers.find(t => t.id === id);
                  const exp = t.flowDirection === 'export';
                  return <td key={id}>{exp ? '⭯ EXPORT' : 'IMPORT'} {t.netKW.toFixed(1)}kW · {t.txPct.toFixed(0)}%{exp ? ' (uncapped)' : ''}</td>;
                })}
                <td>{minVInfo[i].value.toFixed(1)} <span style={{ color: 'var(--muted)' }}>({minVInfo[i].pole}/{minVInfo[i].phase})</span></td>
                <td>{maxVInfo[i].value.toFixed(1)} <span style={{ color: 'var(--muted)' }}>({maxVInfo[i].pole}/{maxVInfo[i].phase})</span></td>
                <td><span className={'pill ' + (vcount ? 'bad' : 'ok')}>{vcount}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table></div></div>

      {allViolations.length > 0 ? (
        <>
          <div className="section-title">Violations — all 24 hours</div>
          <div className="card"><div className="tbl-wrap"><table>
            <thead><tr><th>Hour</th><th>Pole</th><th>Phase</th><th>Issue</th><th>Value</th></tr></thead>
            <tbody>
              {allViolations.map((v, i) => (
                <tr key={i}><td>{String(v.hour).padStart(2, '0')}:00</td><td>{v.pole}</td><td>{v.phase}</td><td>{v.type}</td><td>{v.value.toFixed(1)}</td></tr>
              ))}
            </tbody>
          </table></div></div>
        </>
      ) : <div className="empty">No voltage, thermal or transformer-import violations across the full 24-hour profile.</div>}
    </div>
  );
}
