import { useEffect, useMemo, useRef, useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { faultLevels } from '../lib/loadflow.js';
import { buildDiagramSVG } from '../lib/diagram.js';
import { buildSldScene } from '../lib/sld/scene.js';
import { sceneToSvg } from '../lib/sld/svg.js';
import { sceneToDxf } from '../lib/sld/dxf.js';
import { downloadText, downloadBlob, svgToPng, printSvg, safeName } from '../lib/sld/export.js';
import YearPicker from '../components/YearPicker.jsx';
import TaskProgress from '../components/TaskProgress.jsx';
import SingleLineDiagram from '../components/SingleLineDiagram.jsx';
import SldDetails from '../components/SldDetails.jsx';
import { SolveStatusWarning } from '../components/Convergence.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';

// Diagram page (P5.1): the single-line diagram, with the original drawing kept as "Simple view".
// The hour slider and multipliers re-solve live (debounced) in the engine worker.
const OVERLAYS = [
  ['voltage', 'Voltage status'], ['loading', 'Loading %'], ['flow', 'Power-flow direction'],
  ['vuf', 'VUF'], ['fault', 'Fault level'], ['protection', 'Protection status']
];
const SOLVE_DEBOUNCE_MS = 250;

export default function DiagramPage() {
  const { design, setDesign } = useDesign();
  const { theme } = useTheme();
  const [view, setView] = useState('sld');
  const [year, setYear] = useState(0);
  const [hour, setHour] = useState(20);
  const [loadMult, setLoadMult] = useState(1);
  const [solarMult, setSolarMult] = useState(1);
  const [res, setRes] = useState(null);
  const [overlays, setOverlays] = useState({ voltage: true, loading: true, flow: true, vuf: false, fault: false, protection: false });
  const [protection, setProtection] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const solve = useEngineTask();
  const prot = useEngineTask();
  const solvedFor = useRef(null);

  // Live solve: every change of design / hour / year / multipliers, debounced, in the worker.
  useEffect(() => {
    const t = setTimeout(async () => {
      const key = { design, year, hour, loadMult, solarMult };
      const r = await solve.run('snapshotAt', key, `Solving ${String(hour).padStart(2, '0')}:00`);
      if (r.ok) { solvedFor.current = key; setRes(r.result); }
    }, SOLVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [design, year, hour, loadMult, solarMult]); // eslint-disable-line react-hooks/exhaustive-deps

  // The protection overlay needs the 24 h scan (load check): run it in the worker when switched on.
  useEffect(() => {
    if (!overlays.protection) { setProtection(null); return; }
    (async () => { const r = await prot.run('protection', { design }, 'Protection check (24 h scan)'); if (r.ok) setProtection(r.result); })();
  }, [overlays.protection, design]); // eslint-disable-line react-hooks/exhaustive-deps

  const faults = useMemo(() => (overlays.fault || selectedId ? faultLevels(design) : null), [design, overlays.fault, selectedId]);
  // The scene must describe the design the result was solved for, so it waits for the solve.
  const sceneDesign = solvedFor.current ? solvedFor.current.design : design;
  const scene = useMemo(() => (res ? buildSldScene(sceneDesign, res, { overlays, faults: overlays.fault ? faults : null, protection: overlays.protection ? protection : null }) : null),
    [sceneDesign, res, overlays, faults, protection]);
  const selected = scene && selectedId ? scene.elements.find(e => e.id === selectedId) : null;

  function applyPreset(preset) {
    if (preset === 'night') { setHour(20); setSolarMult(0); }
    if (preset === 'solar') { setHour(12); setSolarMult(1); }
  }

  const snapshotText = `year ${year}, ${String(hour).padStart(2, '0')}:00, load ×${loadMult.toFixed(2)}, solar ×${solarMult.toFixed(2)}`;
  const signOff = design.signOff || {};
  const titleBlock = () => ({
    name: design.name, date: new Date().toISOString().slice(0, 10), snapshot: snapshotText,
    prepared: [signOff.prepared, signOff.preparedDate].filter(Boolean).join(' '),
    checked: [signOff.checked, signOff.checkedDate].filter(Boolean).join(' '),
    approved: [signOff.approved, signOff.approvedDate].filter(Boolean).join(' ')
  });
  const fileBase = `${safeName(design.name)}_SLD_y${year}_${String(hour).padStart(2, '0')}h`;
  const exportSvg = () => downloadText(sceneToSvg(scene, { titleBlock: titleBlock() }), fileBase + '.svg', 'image/svg+xml');
  const exportPng = async () => downloadBlob(await svgToPng(sceneToSvg(scene, { titleBlock: titleBlock() }), 2), fileBase + '.png');
  const exportPdf = () => printSvg(sceneToSvg(scene, { titleBlock: titleBlock() }), `${design.name} — single-line diagram`);
  const exportDxf = () => downloadText(sceneToDxf(scene), fileBase + '.dxf', 'application/dxf');
  const setSign = (k, v) => setDesign(d => ({ ...d, signOff: { ...(d.signOff || {}), [k]: v } }));

  const exportingTx = res ? res.transformers.filter(t => t.flowDirection === 'export') : [];

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Network diagram — {design.name}</h2>
          <div role="radiogroup" aria-label="Diagram view" style={{ display: 'flex', gap: 12 }}>
            <label className="chk"><input type="radio" name="dgView" checked={view === 'sld'} onChange={() => setView('sld')} /> Single-line diagram</label>
            <label className="chk"><input type="radio" name="dgView" checked={view === 'simple'} onChange={() => setView('simple')} /> Simple view</label>
          </div>
        </div>
        <div className="grid g3" style={{ marginTop: 10 }}>
          <div className="field"><span>Year</span><YearPicker value={year} onChange={setYear} /></div>
          <label className="field"><span>Hour of day: <b>{String(hour).padStart(2, '0')}:00</b> (re-solves as you move it)</span>
            <input type="range" min={0} max={23} value={hour} onChange={e => setHour(Number(e.target.value))} aria-valuetext={`${hour}:00`} /></label>
          <label className="field"><span>Quick snapshot</span>
            <select onChange={e => applyPreset(e.target.value)} defaultValue="">
              <option value="">— custom hour —</option>
              <option value="night">Night peak (20:00, no solar)</option>
              <option value="solar">Solar peak (12:00, full solar)</option>
            </select>
          </label>
        </div>
        <div className="slider-row"><span style={{ width: 140, color: 'var(--muted)', fontSize: 12 }}>Load multiplier</span>
          <input type="range" min={0} max={2} step={0.05} value={loadMult} onChange={e => setLoadMult(Number(e.target.value))} aria-label="Load multiplier" />
          <span className="val">{loadMult.toFixed(2)}×</span></div>
        <div className="slider-row"><span style={{ width: 140, color: 'var(--muted)', fontSize: 12 }}>Solar multiplier</span>
          <input type="range" min={0} max={1.5} step={0.05} value={solarMult} onChange={e => setSolarMult(Number(e.target.value))} aria-label="Solar multiplier" />
          <span className="val">{solarMult.toFixed(2)}×</span></div>
        {view === 'sld' && (
          <fieldset className="overlay-toggles" style={{ border: 0, padding: 0, margin: '6px 0 0' }}>
            <legend className="hint" style={{ padding: 0, marginBottom: 4 }}>Overlays</legend>
            {OVERLAYS.map(([k, label]) => (
              <label key={k} className="chk"><input type="checkbox" checked={overlays[k]} onChange={e => setOverlays(o => ({ ...o, [k]: e.target.checked }))} /> {label}</label>
            ))}
          </fieldset>
        )}
        {solve.running && <p className="hint" role="status" style={{ marginBottom: 0 }}><span className="spinner"></span> solving…</p>}
        {solve.error && <TaskProgress task={solve} />}
        <TaskProgress task={prot} />
      </div>

      {res && (
        <div style={{ marginTop: 14 }}>
          <SolveStatusWarning res={res} what="the voltages and flows drawn below" />
          {view === 'simple' ? (
            <div className="card"><div className="diagram" dangerouslySetInnerHTML={{ __html: buildDiagramSVG(sceneDesign, res, theme) }} /></div>
          ) : scene && (
            <div className="sld-layout">
              <div className="card" style={{ padding: 12 }}>
                <SingleLineDiagram scene={scene} theme={theme} selectedId={selectedId} onSelect={(e) => setSelectedId(e.id)} label={`Single-line diagram of ${design.name}, ${snapshotText}`} />
                <p className="hint" style={{ marginBottom: 0 }}>
                  Pole outline: <span style={{ color: 'var(--good)' }}>OK</span> / <span style={{ color: 'var(--warn)' }}>within 1 % of a limit</span> / <span style={{ color: 'var(--bad)' }}>outside the band</span>, and a "!" after the phase voltage.
                  Each drop is labelled with its phase (A/B/C, or 3φ); kVA with * = ADMD-substituted. ▲ marker = load (with a bar: EV), square with a diagonal = PV, two plates = BESS.
                  Span text: length · conductor, then loading % · kW; the arrowhead shows the power-flow direction. Dashed line = open point.
                </p>
              </div>
              <div className="card sld-panel" aria-live="polite">
                <SldDetails design={sceneDesign} res={res} faults={faults} protection={protection} element={selected} />
              </div>
            </div>
          )}
          {exportingTx.length > 0 && (
            <div className="note" style={{ marginTop: 14, borderColor: 'var(--warn)' }}>
              {exportingTx.length === 1
                ? `Transformer ${exportingTx[0].name} is exporting ${Math.abs(exportingTx[0].netKW).toFixed(1)} kW to the grid`
                : `${exportingTx.length} transformers (${exportingTx.map(t => t.name).join(', ')}) are exporting to the grid`} — spans' arrowheads point back toward their transformer.
            </div>
          )}
          {view === 'sld' && scene && (
            <div className="card" style={{ marginTop: 14 }}>
              <h2>Export</h2>
              <p className="hint">SVG, PNG and print/PDF carry a title block with the design name, date, snapshot and the sign-off below. DXF (AutoCAD R12) has one layer per element type.</p>
              <div className="grid g3">
                {[['prepared', 'Prepared by'], ['checked', 'Checked by'], ['approved', 'Approved by']].map(([k, label]) => (
                  <div key={k} style={{ display: 'flex', gap: 6 }}>
                    <label className="field" style={{ flex: 2 }}><span>{label}</span><input value={signOff[k] || ''} onChange={e => setSign(k, e.target.value)} /></label>
                    <label className="field" style={{ flex: 1 }}><span>Date</span><input type="date" value={signOff[k + 'Date'] || ''} onChange={e => setSign(k + 'Date', e.target.value)} /></label>
                  </div>
                ))}
              </div>
              <button className="ghost" onClick={exportSvg}>SVG</button>{' '}
              <button className="ghost" onClick={exportPng}>PNG</button>{' '}
              <button className="ghost" onClick={exportPdf}>Print / PDF</button>{' '}
              <button className="ghost" onClick={exportDxf}>DXF (R12)</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
