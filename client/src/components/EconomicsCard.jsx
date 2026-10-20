import { useDesign } from '../context/DesignContext.jsx';
import { transformerRatings } from '../lib/loadflow.js';

// Economics inputs (P6.1). All user-entered; a blank field means "not set" and every figure that
// needs it shows "not set" rather than a guess. Conductor costs per metre live in the conductor
// library (one per conductor type).
const FIELDS = [
  ['lossCostLkrPerKwh', 'Energy cost of losses (LKR/kWh)', 0.01],
  ['discountRatePct', 'Discount rate (%/yr)', 0.1],
  ['studyYears', 'Study period (years)', 1],
  ['rewirePerMoveLkr', 'Rewiring cost per connection move (LKR)', 100],
  ['tapChangeLkr', 'Tap change / outage cost (LKR)', 100]
];

export default function EconomicsCard() {
  const { design, setDesign } = useDesign();
  const e = design.economics || {};
  const set = (k, v) => setDesign(d => ({ ...d, economics: { ...(d.economics || {}), [k]: v === '' ? null : Number(v) } }));
  const setTx = (rating, v) => setDesign(d => {
    const tx = { ...((d.economics || {}).transformerCostLkr || {}) };
    if (v === '') delete tx[rating]; else tx[rating] = Number(v);
    return { ...d, economics: { ...(d.economics || {}), transformerCostLkr: tx } };
  });
  return (
    <div className="card">
      <h2>Economics</h2>
      <p className="hint">Used for LKR/yr savings, capex, payback and NPV in the fix-it ladder, scenarios and the report. Nothing is assumed: leave a field blank and figures that need it show "not set". Annual loss = the daily figure × 365 (one representative day). Conductor costs per metre are entered in the conductor library.</p>
      <div className="grid g3">
        {FIELDS.map(([k, label, step]) => (
          <label key={k} className="field"><span>{label}</span>
            <input type="number" min={0} step={step} placeholder="not set" value={e[k] ?? ''} onChange={ev => set(k, ev.target.value)} /></label>
        ))}
      </div>
      <div className="section-title">New transformer cost by rating (LKR)</div>
      <div className="grid g4">
        {transformerRatings(design).map(r => (
          <label key={r} className="field"><span>{r} kVA</span>
            <input type="number" min={0} step={1000} placeholder="not set" value={(e.transformerCostLkr || {})[r] ?? ''} onChange={ev => setTx(r, ev.target.value)} /></label>
        ))}
      </div>
    </div>
  );
}
