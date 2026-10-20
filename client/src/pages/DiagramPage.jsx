import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { runSnapshotAt } from '../lib/loadflow.js';
import { buildDiagramSVG } from '../lib/diagram.js';
import YearPicker from '../components/YearPicker.jsx';
import { SolveStatusWarning } from '../components/Convergence.jsx';

export default function DiagramPage() {
  const { design } = useDesign();
  const { theme } = useTheme();
  const [year, setYear] = useState(0);
  const [hour, setHour] = useState(20);
  const [loadMult, setLoadMult] = useState(1);
  const [solarMult, setSolarMult] = useState(1);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  function applyPreset(preset) {
    if (preset === 'night') { setHour(20); setSolarMult(0); }
    if (preset === 'solar') { setHour(12); setSolarMult(1); }
  }
  function draw() {
    setBusy(true);
    setTimeout(() => { setRes(runSnapshotAt(design, { year, hour, loadMult, solarMult })); setBusy(false); }, 10);
  }

  const svg = res ? buildDiagramSVG(design, res, theme) : null;
  const exportingTx = res ? res.transformers.filter(t => t.flowDirection === 'export') : [];
  const exporting = exportingTx.length > 0;

  return (
    <div>
      <div className="card" style={{ padding: '12px 18px', marginBottom: 14 }}>
        <span style={{ fontFamily: 'var(--disp)', fontWeight: 600, fontSize: 15 }}>{design.name}</span>
      </div>
      <div className="card">
        <h2>Network diagram</h2>
        <p className="hint">A schematic single-line view of the transformer island: circles are poles, colour shows their worst voltage status, and arrows show which way real power is flowing through each span for the chosen snapshot.</p>
        <div className="grid g3">
          <label className="field"><span>Year</span><YearPicker value={year} onChange={setYear} /></label>
          <label className="field"><span>Hour of day: <b>{String(hour).padStart(2, '0')}:00</b></span>
            <input type="range" min={0} max={23} value={hour} onChange={e => setHour(Number(e.target.value))} /></label>
          <label className="field"><span>Quick snapshot</span>
            <select onChange={e => applyPreset(e.target.value)} defaultValue="">
              <option value="">— custom hour —</option>
              <option value="night">Night peak (max load, no solar)</option>
              <option value="solar">Solar peak (min load, max PV)</option>
            </select>
          </label>
        </div>
        <div className="slider-row"><span style={{ width: 140, color: 'var(--muted)', fontSize: 12 }}>Load multiplier</span>
          <input type="range" min={0} max={2} step={0.05} value={loadMult} onChange={e => setLoadMult(Number(e.target.value))} />
          <span className="val">{loadMult.toFixed(2)}×</span></div>
        <div className="slider-row"><span style={{ width: 140, color: 'var(--muted)', fontSize: 12 }}>Solar multiplier</span>
          <input type="range" min={0} max={1.5} step={0.05} value={solarMult} onChange={e => setSolarMult(Number(e.target.value))} />
          <span className="val">{solarMult.toFixed(2)}×</span></div>
        <button className="primary" onClick={draw} disabled={busy}>Draw diagram</button>
        {busy && <span className="loading" style={{ marginLeft: 12 }}><span className="spinner"></span> solving…</span>}
      </div>

      {svg && (
        <div style={{ marginTop: 18 }}>
          <div className="card">
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 14, fontSize: 11.5, color: 'var(--muted)' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#16A34A', marginRight: 6 }}></span>Voltage OK</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#D97706', marginRight: 6 }}></span>Near limit</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#DC2626', marginRight: 6 }}></span>Violation</span>
              <span><span style={{ display: 'inline-block', width: 18, height: 2.5, background: '#0D9488', marginRight: 6, verticalAlign: 'middle' }}></span>Span &lt;85% loaded</span>
              <span><span style={{ display: 'inline-block', width: 18, height: 2.5, background: '#D97706', marginRight: 6, verticalAlign: 'middle' }}></span>85–100% loaded</span>
              <span><span style={{ display: 'inline-block', width: 18, height: 2.5, background: '#DC2626', marginRight: 6, verticalAlign: 'middle' }}></span>&gt;100% (thermal violation)</span>
              <span>Arrow direction = real power flow (reverses automatically under export)</span>
              <span><span className="phaseA" style={{ fontWeight: 700 }}>A</span> / <span className="phaseB" style={{ fontWeight: 700 }}>B</span> / <span className="phaseC" style={{ fontWeight: 700 }}>C</span> beside each pole = that phase's voltage (bold if outside the statutory band)</span>
              <span>⏚ mark right of a pole = neutral grounded there (see Rg on the Network page)</span>
              <span>Two labels on each feeder's first span = that feeder's total connected load, and its installed solar PV (nameplate), per phase (kVA, ADMD-substituted where unspecified)</span>
              <span><span style={{ display: 'inline-block', width: 18, height: 0, borderTop: '1.5px dashed var(--muted)', marginRight: 6, verticalAlign: 'middle' }}></span>Dashed line = a common open point (see the Network page) — no current flows, shown for reference only</span>
            </div>
            <SolveStatusWarning res={res} what="the voltages and flows drawn below" />
            <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
          {exporting && (
            <div className="note" style={{ marginTop: 14, borderColor: 'var(--warn)' }}>
              {exportingTx.length === 1
                ? `Transformer ${exportingTx[0].name} is exporting ${Math.abs(exportingTx[0].netKW).toFixed(1)} kW to the grid`
                : `${exportingTx.length} transformers (${exportingTx.map(t => t.name).join(', ')}) are exporting to the grid`} — arrows on exporting spans point back toward their transformer, and pole colour reflects the resulting voltage rise, not a transformer capacity limit.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
