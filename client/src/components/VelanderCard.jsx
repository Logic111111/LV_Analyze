import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { fitVelander, parseVelanderCsv, velanderSettings } from '../lib/loadflow.js';

// Demand from billing data (P6.2): the Velander option, its constants (entered or fitted from a
// CSV of measured annual kWh / peak kW pairs), and the fit's R² and residuals. No constants are
// assumed; with the option off nothing changes.
export default function VelanderCard() {
  const { design, setDesign } = useDesign();
  const v = velanderSettings(design);
  const [csv, setCsv] = useState('');
  const [fit, setFit] = useState(null);
  const [errors, setErrors] = useState([]);
  const set = (patch) => setDesign(d => ({ ...d, velander: { ...(d.velander || {}), ...patch } }));
  const withKwh = design.loads.filter(l => l.type === 'general' && Number(l.annualKWh) > 0).length;

  function runFit(text) {
    const { pairs, errors: errs } = parseVelanderCsv(text);
    setErrors(errs);
    setFit(fitVelander(pairs));
  }
  return (
    <div className="card">
      <h2>Demand from billing data (Velander)</h2>
      <p className="hint">For a general connection with an annual energy W (kWh) and a blank kVA, the peak becomes (k1·W + k2·√W) / pf instead of the ADMD. k1 and k2 come from you — enter them, or fit them to measured (annual kWh, peak kW) pairs. {withKwh} general connection{withKwh === 1 ? ' has' : 's have'} an annual kWh (Network page).</p>
      <label className="chk"><input type="checkbox" checked={v.enabled} onChange={e => set({ enabled: e.target.checked })} /> Use Velander for connections with annual kWh</label>
      <div className="grid g3" style={{ marginTop: 8 }}>
        <label className="field"><span>k1 (kW per kWh)</span><input type="number" step="any" placeholder="not set" value={v.k1 ?? ''} onChange={e => set({ k1: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        <label className="field"><span>k2 (kW per √kWh)</span><input type="number" step="any" placeholder="not set" value={v.k2 ?? ''} onChange={e => set({ k2: e.target.value === '' ? null : Number(e.target.value) })} /></label>
      </div>
      {v.enabled && (v.k1 === null || v.k2 === null) && <p className="hint" style={{ color: 'var(--warn)' }}>⚠ Velander is on but k1 or k2 is not set — the ADMD is still used.</p>}
      <div className="section-title">Fit k1 and k2 from measurements</div>
      <label className="field"><span>CSV: annual kWh, peak kW (one customer per line; header optional)</span>
        <textarea rows={5} value={csv} onChange={e => setCsv(e.target.value)} placeholder={'annual_kwh,peak_kw\n1200,5.1\n2400,7.2'} style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }} /></label>
      <input type="file" accept=".csv,text/csv,text/plain" aria-label="Load a CSV file" onChange={e => { const f = e.target.files && e.target.files[0]; if (f) f.text().then(t => { setCsv(t); runFit(t); }); }} />{' '}
      <button className="ghost" onClick={() => runFit(csv)}>Fit</button>
      {errors.length > 0 && <ul className="hint" style={{ color: 'var(--warn)' }}>{errors.slice(0, 5).map((x, i) => <li key={i}>{x}</li>)}{errors.length > 5 && <li>… {errors.length - 5} more</li>}</ul>}
      {fit && (fit.error ? <p className="hint" role="alert" style={{ color: 'var(--bad)' }}>{fit.error}</p> : (
        <div style={{ marginTop: 10 }}>
          <p>k1 = <b>{fit.k1.toPrecision(5)}</b>, k2 = <b>{fit.k2.toPrecision(5)}</b> from {fit.n} customers · R² = <b>{fit.r2.toFixed(3)}</b>{fit.r2 < 0.7 ? ' — a weak fit; check the data' : ''}</p>
          <div className="tbl-wrap"><table>
            <thead><tr><th scope="col">Annual kWh</th><th scope="col">Measured peak kW</th><th scope="col">Fitted kW</th><th scope="col">Residual kW</th></tr></thead>
            <tbody>{fit.residuals.map((r, i) => <tr key={i}><td>{r.annualKWh}</td><td>{r.peakKw.toFixed(2)}</td><td>{r.fittedKw.toFixed(2)}</td><td style={{ fontWeight: Math.abs(r.residualKw) > 2 * Math.sqrt(fit.residuals.reduce((s, x) => s + x.residualKw ** 2, 0) / fit.n) ? 700 : 400 }}>{(r.residualKw >= 0 ? '+' : '') + r.residualKw.toFixed(2)}</td></tr>)}</tbody>
          </table></div>
          <button className="primary" style={{ marginTop: 8 }} onClick={() => set({ k1: fit.k1, k2: fit.k2 })}>Use these constants</button>
          <p className="hint">Bold residual = more than twice the RMS residual (possible outlier).</p>
        </div>
      ))}
    </div>
  );
}
