import { useEffect, useMemo, useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import YearPicker from '../components/YearPicker.jsx';
import TaskProgress from '../components/TaskProgress.jsx';
import ChartCanvas from '../components/ChartCanvas.jsx';
import { ConvergenceWarning } from '../components/Convergence.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import { voltageProfile, faultLevels, PHASES } from '../lib/loadflow.js';
import { phasorData, voltageHeatmap, loadingDuration, vufByPole, faultAlongFeeder } from '../lib/chartData.js';
import { CHART_PALETTES, themedScales } from '../lib/chartTheme.js';
import { useT } from '../i18n/i18n.jsx';

// Engineering charts (P5.3), all from one 24 h scan (run in the worker, re-run when the inputs
// change): voltage vs distance, the phasor diagram of a pole, a 24 h × pole-phase voltage heatmap,
// loading-duration curves, VUF by pole and fault level along the feeder. Every chart has an
// accessible name, and its key numbers are printed beside it.
const hh = (h) => String(h).padStart(2, '0') + ':00';
const DASHES = [[], [6, 3], [2, 2], [8, 3, 2, 3], [4, 4]];

export default function ChartsPage() {
  const { design } = useDesign();
  const { theme } = useTheme();
  const t = useT();
  const P = CHART_PALETTES[theme] || CHART_PALETTES.light;
  const [year, setYear] = useState(0);
  const [loadMult, setLoadMult] = useState(1);
  const [solarMult, setSolarMult] = useState(1);
  const [hour, setHour] = useState(20);
  const [daily, setDaily] = useState(null);
  const [scanDesign, setScanDesign] = useState(null);
  const [pole, setPole] = useState(design.poles[0]?.id || '');
  const [feederRoot, setFeederRoot] = useState('');
  const task = useEngineTask();

  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await task.run('dailyScan', { design, year, loadMult, solarMult }, 'Solving 24 hours');
      if (r.ok) { setDaily(r.result); setScanDesign(design); }
    }, 300);
    return () => clearTimeout(t);
  }, [design, year, loadMult, solarMult]); // eslint-disable-line react-hooks/exhaustive-deps

  const d = scanDesign || design;
  const res = daily ? daily[hour] : null;
  const roots = d.poles.filter(p => d.transformers.some(t => t.id === p.parent));
  const faults = useMemo(() => faultLevels(d), [d]);

  // ---- voltage vs distance ----
  const profile = useMemo(() => {
    if (!res) return null;
    const paths = voltageProfile(res, d, feederRoot ? { feederRoot } : {});
    const maxD = Math.max(1, ...paths.flatMap(p => p.points.map(q => q.distanceM)));
    const datasets = paths.flatMap((path, pi) => PHASES.map(ph => ({
      label: `${ph} → ${path.leafPoleId}`, data: path.points.map(q => ({ x: q.distanceM, y: q[ph] })), showLine: true,
      borderColor: P.phaseColors[ph], backgroundColor: P.phaseColors[ph], borderDash: DASHES[pi % DASHES.length], pointRadius: 3, tension: 0
    })));
    datasets.push(
      { label: `Lower limit ${res.vLimLow.toFixed(1)} V`, data: [{ x: 0, y: res.vLimLow }, { x: maxD, y: res.vLimLow }], showLine: true, borderColor: P.maxColor, borderDash: [4, 4], pointRadius: 0 },
      { label: `Upper limit ${res.vLimHigh.toFixed(1)} V`, data: [{ x: 0, y: res.vLimHigh }, { x: maxD, y: res.vLimHigh }], showLine: true, borderColor: P.maxColor, borderDash: [4, 4], pointRadius: 0 }
    );
    return {
      paths,
      data: { datasets },
      options: { animation: false, plugins: { legend: { labels: { color: P.legendColor, boxWidth: 18 } } }, scales: themedScales(P, { xTitle: 'Distance from the transformer (m)', yTitle: 'Phase-to-neutral voltage (V)' }) }
    };
  }, [res, d, feederRoot, P]);

  // ---- phasor diagram ----
  const phasor = useMemo(() => {
    const pr = res && res.poleResults.find(p => p.id === pole);
    if (!pr || !pr.vn) return null;
    const ph = phasorData(pr);
    const max = Math.max(...PHASES.map(k => Math.hypot(ph.tips[k].re, ph.tips[k].im))) * 1.12;
    const seg = (a, b) => [{ x: a.re, y: a.im }, { x: b.re, y: b.im }];
    const datasets = [
      ...PHASES.map(k => ({ label: `${k}: N′→${k} ${ph.toNeutral[k].mag.toFixed(1)} V`, data: seg(ph.neutral, ph.tips[k]), showLine: true, borderColor: P.phaseColors[k], backgroundColor: P.phaseColors[k], borderWidth: 2.5, pointRadius: [0, 4] })),
      ...PHASES.map(k => ({ label: `${k} to star point`, data: seg(ph.star, ph.tips[k]), showLine: true, borderColor: P.gridColor, borderDash: [3, 3], pointRadius: 0 })),
      { label: `Neutral shift ${ph.neutralShiftV.toFixed(2)} V`, data: seg(ph.star, ph.neutral), showLine: true, borderColor: P.legendColor, borderWidth: 2, pointRadius: [3, 4] }
    ];
    const zoom = Math.max(ph.neutralShiftV * 1.4, 0.5);
    const scale = (m) => ({ min: -m, max: m, ticks: { color: P.axisColor }, grid: { color: P.gridColor } });
    return {
      ph,
      main: { data: { datasets }, options: { animation: false, aspectRatio: 1, plugins: { legend: { labels: { color: P.legendColor, boxWidth: 14, filter: (it) => !it.text.endsWith('to star point') } } }, scales: { x: scale(max), y: scale(max) } } },
      zoom: {
        data: { datasets: [{ label: 'Star point O → local neutral N′', data: seg(ph.star, ph.neutral), showLine: true, borderColor: P.legendColor, backgroundColor: P.legendColor, borderWidth: 2, pointRadius: [4, 5] }] },
        options: { animation: false, aspectRatio: 1, plugins: { legend: { labels: { color: P.legendColor } } }, scales: { x: scale(zoom), y: scale(zoom) } }
      }
    };
  }, [res, pole, P]);

  // ---- heatmap, duration curves, VUF, faults ----
  const heat = useMemo(() => (daily ? voltageHeatmap(daily) : null), [daily]);
  const duration = useMemo(() => {
    if (!daily) return null;
    const ld = loadingDuration(daily);
    const xs = daily.map((_, i) => i + 1);
    const datasets = [
      ...ld.transformers.map((t, i) => ({ label: `Transformer ${t.name}`, data: t.values, borderColor: P.seriesColors[i % 4], backgroundColor: P.seriesColors[i % 4], borderWidth: 2.5, pointRadius: 0 })),
      ...ld.spans.map((s, i) => ({ label: `Span into ${s.id}`, data: s.values, borderColor: P.axisColor, borderDash: DASHES[1 + (i % 4)], borderWidth: 1.2, pointRadius: 0 })),
      { label: '100 % rating', data: xs.map(() => 100), borderColor: P.maxColor, borderDash: [4, 4], pointRadius: 0 }
    ];
    return { ld, data: { labels: xs, datasets }, options: { animation: false, plugins: { legend: { labels: { color: P.legendColor, boxWidth: 18 } } }, scales: themedScales(P, { xTitle: 'Hours at or above (of the scanned day)', yTitle: 'Loading (% of rating)' }) } };
  }, [daily, P]);
  const vuf = useMemo(() => {
    if (!res) return null;
    const rows = vufByPole(res, daily);
    return {
      rows,
      data: {
        labels: rows.map(r => r.pole),
        datasets: [
          { type: 'bar', label: `VUF at ${hh(hour)}`, data: rows.map(r => r.vuf), backgroundColor: P.seriesColors[0] },
          { type: 'bar', label: 'Highest over the day', data: rows.map(r => r.dailyMax), backgroundColor: P.seriesColors[1] },
          { type: 'line', label: `Limit ${res.vufLimitPct} %`, data: rows.map(() => res.vufLimitPct), borderColor: P.maxColor, borderDash: [4, 4], pointRadius: 0 }
        ]
      },
      options: { animation: false, plugins: { legend: { labels: { color: P.legendColor } } }, scales: themedScales(P, { xTitle: 'Pole', yTitle: 'VUF (%)' }) }
    };
  }, [res, daily, hour, P]);
  const fault = useMemo(() => {
    const paths = faultAlongFeeder(faults, d);
    const datasets = paths.flatMap((p, i) => [
      { label: `Ik3max → ${p.leaf}`, data: p.points.map(q => ({ x: q.distanceM, y: q.ik3kA })), showLine: true, borderColor: P.seriesColors[0], backgroundColor: P.seriesColors[0], borderDash: DASHES[i % DASHES.length], pointRadius: 3 },
      { label: `Ik1min → ${p.leaf}`, data: p.points.map(q => ({ x: q.distanceM, y: q.ik1kA })), showLine: true, borderColor: P.seriesColors[3], backgroundColor: P.seriesColors[3], borderDash: DASHES[i % DASHES.length], pointRadius: 3, pointStyle: 'triangle' }
    ]);
    return { paths, data: { datasets }, options: { animation: false, plugins: { legend: { labels: { color: P.legendColor, boxWidth: 18, usePointStyle: true } } }, scales: themedScales(P, { xTitle: 'Distance from the transformer (m)', yTitle: 'Prospective fault current (kA)' }) } };
  }, [faults, d, P]);

  const heatColor = (v) => {
    if (v == null || !heat) return undefined;
    if (v < heat.vLimLow || v > heat.vLimHigh) return 'color-mix(in srgb, var(--bad) 45%, transparent)';
    const span = heat.vLimHigh - heat.vLimLow;
    const near = Math.min(v - heat.vLimLow, heat.vLimHigh - v) < span * 0.1;
    return near ? 'color-mix(in srgb, var(--warn) 35%, transparent)' : 'color-mix(in srgb, var(--good) 18%, transparent)';
  };

  return (
    <div>
      <div className="card">
        <h2>{t('Engineering charts')}</h2>
        <p className="hint">All charts come from one 24-hour scan of the design (re-run automatically when you change the inputs). The hour slider picks the snapshot used by the voltage profile, phasor diagram and VUF chart.</p>
        <div className="grid g3">
          <div className="field"><span>Year</span><YearPicker value={year} onChange={setYear} /></div>
          <label className="field"><span>Hour: <b>{hh(hour)}</b></span><input type="range" min={0} max={23} value={hour} onChange={e => setHour(Number(e.target.value))} aria-valuetext={hh(hour)} /></label>
          <div>
            <div className="slider-row"><span style={{ width: 110, color: 'var(--muted)', fontSize: 12 }}>Load ×</span><input type="range" min={0} max={2} step={0.05} value={loadMult} onChange={e => setLoadMult(Number(e.target.value))} aria-label="Load multiplier" /><span className="val">{loadMult.toFixed(2)}</span></div>
            <div className="slider-row"><span style={{ width: 110, color: 'var(--muted)', fontSize: 12 }}>Solar ×</span><input type="range" min={0} max={1.5} step={0.05} value={solarMult} onChange={e => setSolarMult(Number(e.target.value))} aria-label="Solar multiplier" /><span className="val">{solarMult.toFixed(2)}</span></div>
          </div>
        </div>
        <TaskProgress task={task} />
        {daily && <ConvergenceWarning show={daily.some(r => !r.converged)}>Some hours did not converge — their points may be inaccurate.</ConvergenceWarning>}
      </div>

      {daily && (
        <div className="grid g2" style={{ marginTop: 14, alignItems: 'start' }}>
          <div className="card" style={{ minWidth: 0 }}>
            <h2>Voltage vs distance — {hh(hour)}</h2>
            <label className="field"><span>Feeder</span>
              <select value={feederRoot} onChange={e => setFeederRoot(e.target.value)}>
                <option value="">All feeders</option>
                {roots.map(r => <option key={r.id} value={r.id}>{r.feeder} (from {r.parent}, root {r.id})</option>)}
              </select></label>
            {profile && <ChartCanvas type="scatter" data={profile.data} options={profile.options} height={170} label={`Phase voltage against distance at ${hh(hour)}, with the statutory limits`} />}
            <p className="hint">One line per phase and path (dash pattern = path). Lowest: {(() => { let m = null; profile?.paths.forEach(p => p.points.forEach(q => PHASES.forEach(k => { if (!m || q[k] < m.v) m = { v: q[k], at: `${q.poleId} ${k}` }; }))); return m ? `${m.v.toFixed(1)} V at ${m.at}` : '—'; })()}.</p>
          </div>

          <div className="card" style={{ minWidth: 0 }}>
            <h2>Phasor diagram — {pole} at {hh(hour)}</h2>
            <label className="field"><span>Pole</span>
              <select value={pole} onChange={e => setPole(e.target.value)}>{d.poles.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}</select></label>
            {phasor && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 8 }}>
                  <div style={{ minWidth: 0 }}><ChartCanvas type="scatter" data={phasor.main.data} options={phasor.main.options} height={200} label={`Phasor diagram at ${pole}: phase voltages from the local neutral and the neutral shift from the transformer star point`} /></div>
                  <div style={{ minWidth: 0 }}><ChartCanvas type="scatter" data={phasor.zoom.data} options={phasor.zoom.options} height={200} label="Neutral shift, enlarged" /></div>
                </div>
                <div className="sld-panel" style={{ marginTop: 6 }}>
                  <dl>
                    {PHASES.flatMap(k => [
                      <dt key={k + 'n'}>Phase {k}</dt>,
                      <dd key={k + 'v'}>{phasor.ph.toNeutral[k].mag.toFixed(1)} V ∠{phasor.ph.toNeutral[k].deg.toFixed(1)}° to N′ · {phasor.ph.toStar[k].mag.toFixed(1)} V to star</dd>
                    ])}
                    <dt>Neutral shift</dt><dd>{phasor.ph.neutralShiftV.toFixed(2)} V ∠{phasor.ph.neutralShiftDeg.toFixed(1)}°</dd>
                  </dl>
                </div>
                <p className="hint">Origin O = transformer star point; N′ = the local neutral at {pole}, displaced by the neutral current's voltage drop. Customers see N′→A/B/C. The right-hand chart enlarges the shift.</p>
              </>
            )}
          </div>

          <div className="card" style={{ minWidth: 0 }}>
            <h2>Loading-duration curves</h2>
            {duration && <ChartCanvas type="line" data={duration.data} options={duration.options} height={170} label="Loading duration curves of the transformer and every span over the day" />}
            {duration && <p className="hint">Peak: {duration.ld.transformers.map(t => `${t.name} ${t.values[0].toFixed(0)} %`).join(', ')}; hottest span: {(() => { const s = [...duration.ld.spans].sort((a, b) => b.values[0] - a.values[0])[0]; return s ? `${s.id} ${s.values[0].toFixed(0)} %` : '—'; })()}. Solid = transformers, dashed = spans.</p>}
          </div>

          <div className="card" style={{ minWidth: 0 }}>
            <h2>Voltage unbalance by pole</h2>
            {vuf && <ChartCanvas type="bar" data={vuf.data} options={vuf.options} height={170} label={`Voltage unbalance factor by pole at ${hh(hour)} and over the day`} />}
            {vuf && <p className="hint">{vuf.rows.map(r => `${r.pole} ${r.vuf.toFixed(2)} % (day max ${r.dailyMax.toFixed(2)} %)`).join(' · ')}</p>}
          </div>

          <div className="card" style={{ minWidth: 0 }}>
            <h2>Fault level along the feeder</h2>
            <ChartCanvas type="scatter" data={fault.data} options={fault.options} height={170} label="Prospective fault current against distance: three-phase maximum and single-phase minimum" />
            <p className="hint">Ik3max (circles) and Ik1min (triangles) per path, from the LV bus. Source: {faults.settings.hvFaultMVA ? `${faults.settings.hvFaultMVA} MVA` : 'HV fault level not set — infinite bus'}. Far end: {fault.paths.map(p => `${p.leaf} Ik1min ${p.points[p.points.length - 1].ik1kA.toFixed(2)} kA`).join(', ')}.</p>
          </div>
        </div>
      )}

      {heat && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>24 h voltage heatmap</h2>
          <p className="hint">Each cell is a pole-phase voltage at that hour (V). Red = outside the band ({heat.vLimLow.toFixed(1)}–{heat.vLimHigh.toFixed(1)} V), amber = within 10 % of the band's width from a limit, green = comfortable. The value is printed in every cell.</p>
          <div className="tbl-wrap"><table style={{ fontSize: 10.5 }}>
            <thead><tr><th scope="col">Pole</th>{heat.hours.map(h => <th key={h} scope="col" style={{ padding: '6px 3px' }}>{String(h).padStart(2, '0')}</th>)}</tr></thead>
            <tbody>
              {heat.rows.map(r => (
                <tr key={r.pole + r.phase}>
                  <th scope="row" style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{r.pole} <span className={'phase' + r.phase}>{r.phase}</span></th>
                  {r.values.map((v, h) => <td key={h} style={{ padding: '4px 3px', background: heatColor(v), textAlign: 'center' }}>{v == null ? '—' : v.toFixed(0)}</td>)}
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
