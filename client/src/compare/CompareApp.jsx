import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useTheme } from '../context/ThemeContext.jsx';
import { runSnapshotAt, withDefaults } from '../lib/loadflow.js';
import { buildSldScene } from '../lib/sld/scene.js';
import SingleLineDiagram from '../components/SingleLineDiagram.jsx';
import ChartCanvas from '../components/ChartCanvas.jsx';
import { SolveStatusWarning } from '../components/Convergence.jsx';
import { CHART_PALETTES, themedScales } from '../lib/chartTheme.js';
import { withVoltages, headline, tableRows } from './compareData.js';

// The OpenDSS comparison app (compare.html, spec docs/superpowers/specs/2026-11-09-opendss-compare-app-design.md):
// one hour of a saved island, solved by the server in both Feeder Island and OpenDSS, side by side for a
// presentation. Every number on screen comes from the server's answer.
const OVERLAYS = { voltage: true, loading: false, flow: false };
const hh = (h) => String(h).padStart(2, '0') + ':00';
const num = (v, digits) => (v == null ? '—' : v.toFixed(digits));
// A difference to `digits` places, without the "-0.00" a tiny negative rounds to.
const diffText = (v, digits) => { const s = v.toFixed(digits); return /^-0\.?0*$/.test(s) ? s.slice(1) : s; };

export default function CompareApp() {
  const { theme } = useTheme();
  const [session, setSession] = useState('loading'); // loading | signedOut | ok
  const [designs, setDesigns] = useState([]);
  const [selected, setSelected] = useState('');
  const [hour, setHour] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { design, res, check, ms }
  const runId = useRef(0);

  useEffect(() => {
    (async () => {
      try { await api.me(); } catch (e) {
        if (e.status === 401) { setSession('signedOut'); return; }
        setError(e.message); setSession('ok'); return;
      }
      try {
        const list = (await api.listDesigns()).designs;
        const wanted = new URLSearchParams(window.location.search).get('design');
        setDesigns(list);
        setSelected(String((list.find(d => String(d.id) === wanted) || list[0] || {}).id ?? ''));
      } catch (e) { setError(e.message); }
      setSession('ok');
    })();
  }, []);

  async function compare() {
    const id = ++runId.current;
    setBusy(true); setError('');
    try {
      const design = withDefaults((await api.getDesign(selected)).design);
      const opts = { year: 0, hour, loadMult: 1, solarMult: 1 };
      const res = runSnapshotAt(design, opts);
      const t0 = performance.now();
      const check = await api.opendssCheck({ ...design, logo: undefined }, opts, true);
      if (id !== runId.current) return;
      if (check.ok === false) throw new Error(check.error || 'OpenDSS did not solve this snapshot.');
      setResult({ design, res, check, ms: performance.now() - t0 });
    } catch (e) {
      if (id === runId.current) { setError(e.message); setResult(null); }
    } finally {
      if (id === runId.current) setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', padding: 16 }}>
      <h1 style={{ margin: '4px 0 12px' }}>Feeder Island vs OpenDSS</h1>
      {session === 'loading' && <span className="loading"><span className="spinner"></span> Loading…</span>}
      {session === 'signedOut' && <div className="card">Sign in to Feeder Island first. <a href="/login">Sign in</a></div>}
      {session === 'ok' && (
        <>
          <Controls designs={designs} selected={selected} setSelected={setSelected} hour={hour} setHour={setHour} busy={busy} onCompare={compare} />
          {error && (
            <div className="note" role="alert" style={{ borderColor: 'var(--bad)', marginTop: 12 }}>
              {error} {designs.length > 0 && <button className="ghost" onClick={compare} disabled={busy}>Try again</button>}
            </div>
          )}
          {result && <Results result={result} theme={theme} />}
        </>
      )}
    </div>
  );
}

function Controls({ designs, selected, setSelected, hour, setHour, busy, onCompare }) {
  if (!designs.length) return <div className="card">Save an island in Feeder Island first.</div>;
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ margin: 0, minWidth: 220 }}><span>Saved island</span>
          <select value={selected} onChange={e => setSelected(e.target.value)}>
            {designs.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
          </select>
        </label>
        <label className="field" style={{ margin: 0 }}><span>Hour</span>
          <select value={hour} onChange={e => setHour(Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hh(h)}</option>)}
          </select>
        </label>
        <button className="ghost" onClick={() => setHour(20)}>Evening peak 20:00</button>
        <button className="ghost" onClick={() => setHour(12)}>Solar noon 12:00</button>
        <button className="primary" onClick={onCompare} disabled={busy || !selected}>{busy ? 'Comparing…' : 'Compare'}</button>
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>Compares the last saved version of the island.</p>
    </div>
  );
}

function Results({ result, theme }) {
  const { design, res, check, ms } = result;
  const P = CHART_PALETTES[theme] || CHART_PALETTES.light;
  const h = useMemo(() => headline(check), [check]);
  const rows = useMemo(() => tableRows(check.points), [check]);
  const scenes = useMemo(() => [2, 3].map(col => buildSldScene(design, withVoltages(res, check.points, col), { overlays: OVERLAYS })), [design, res, check]);
  const parity = useMemo(() => {
    const pts = check.points.map(([, , app, dss]) => ({ x: dss, y: app }));
    const lo = Math.min(...pts.map(p => p.x)), hi = Math.max(...pts.map(p => p.x));
    return {
      data: { datasets: [
        { label: `Every bus and phase (${pts.length})`, data: pts, backgroundColor: P.seriesColors[0], pointRadius: 2 },
        { label: 'Perfect agreement', data: [{ x: lo, y: lo }, { x: hi, y: hi }], showLine: true, borderColor: P.maxColor, borderDash: [6, 4], pointRadius: 0 }
      ] },
      options: { responsive: true, scales: themedScales(P, { xTitle: 'OpenDSS voltage (V, phase to neutral)', yTitle: 'Feeder Island voltage (V)' }), plugins: { legend: { labels: { color: P.legendColor } } } }
    };
  }, [check, P]);

  return (
    <>
      <div className="card mt-4">
        <h2 style={{ marginTop: 0 }}>
          {design.name} at {hh(check.hour)} <span className={'pill ' + (check.pass ? 'ok' : 'bad')}>{check.pass ? 'Pass' : 'Fail'}</span>
        </h2>
        <p className="hint" style={{ marginBottom: 0 }}>
          {check.pass ? 'Every bus voltage agrees' : 'Some bus voltages differ by more than'} within {check.tolerance * 1000} mV.
          {' '}{String(check.opendss).replace(/ revision.*/, '')}, {check.iterations} iterations, answered in {(ms / 1000).toFixed(1)} s.
        </p>
      </div>
      <SolveStatusWarning res={res} what="the Feeder Island results below" />

      <div className="grid mt-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <PairCard title="Total losses" unit="kW" digits={3} pair={h.lossKW} diffScale={1000} diffUnit="W" />
        <PairCard title="Lowest voltage" unit="V" digits={2} pair={h.minV} diffScale={1000} diffUnit="mV" />
        <PairCard title="Highest voltage" unit="V" digits={2} pair={h.maxV} diffScale={1000} diffUnit="mV" />
        {h.transformers.map(t => (
          <PairCard key={t.id} title={h.transformers.length > 1 ? `Transformer ${t.id} loading` : 'Transformer loading'} unit="kVA" digits={2} pair={t} diffScale={1000} diffUnit="VA" />
        ))}
        <PairCard title="Largest neutral current" unit="A" digits={2} pair={h.neutralA} diffScale={1000} diffUnit="mA" />
      </div>

      <div className="grid g2 mt-4">
        {['Feeder Island', 'OpenDSS'].map((name, i) => (
          <div className="card" key={name} style={{ minWidth: 0 }}>
            <h3 style={{ marginTop: 0 }}>{name}</h3>
            <SingleLineDiagram scene={scenes[i]} theme={theme} maxHeight="60vh" label={`${name} single-line diagram, coloured by ${name}'s voltages`} />
          </div>
        ))}
      </div>

      <div className="grid g2 mt-4">
        <div className="card" style={{ minWidth: 0 }}>
          <h3 style={{ marginTop: 0 }}>Feeder Island voltage against OpenDSS voltage</h3>
          <ChartCanvas type="scatter" data={parity.data} options={parity.options} height={220} label="Every bus voltage from Feeder Island plotted against OpenDSS's, on the line of perfect agreement" />
        </div>
        <div className="card" style={{ minWidth: 0 }}>
          <h3 style={{ marginTop: 0 }}>Every bus and phase, largest difference first</h3>
          <div className="tbl-wrap" style={{ maxHeight: '60vh' }}><table>
            <thead><tr><th scope="col">Bus</th><th scope="col">Phase</th><th scope="col">Feeder Island (V)</th><th scope="col">OpenDSS (V)</th><th scope="col">Difference (mV)</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.id + '|' + r.phase}><td>{r.id}</td><td>{r.phase}</td><td>{r.app.toFixed(3)}</td><td>{r.dss.toFixed(3)}</td><td>{diffText(r.diffMV, 2)}</td></tr>)}</tbody>
          </table></div>
        </div>
      </div>
    </>
  );
}

// One headline value from both tools and their difference (in a smaller unit, since it is tiny).
function PairCard({ title, unit, digits, pair, diffScale, diffUnit }) {
  const diff = pair.app != null && pair.dss != null ? diffText((pair.app - pair.dss) * diffScale, 1) + ' ' + diffUnit : '—';
  const row = (k, v) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span className="hint" style={{ margin: 0 }}>{k}</span><span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{v}</span>
    </div>
  );
  return (
    <div className="stat">
      <div className="l" style={{ marginBottom: 6 }}>{title}</div>
      {row('Feeder Island', `${num(pair.app, digits)} ${unit}`)}
      {row('OpenDSS', `${num(pair.dss, digits)} ${unit}`)}
      {row('Difference', diff)}
    </div>
  );
}
