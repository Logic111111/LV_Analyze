import { useDesign } from '../context/DesignContext.jsx';
import { IEEE1547_CAT_B } from '../lib/loadflow.js';

// Smart-inverter PV settings (P3.1). The seed curves are IEEE 1547-2018 Category B defaults —
// labelled as such and meant to be replaced with the local grid code's values.
export const INVERTER_MODE_LABELS = {
  unity: 'Unity power factor (no voltage response)',
  voltVar: 'Volt-var',
  voltWatt: 'Volt-watt',
  voltVarWatt: 'Volt-var + volt-watt'
};

function CurveTable({ label, yLabel, curve, onChange }) {
  const set = (i, j, v) => onChange(curve.map((p, k) => (k === i ? (j === 0 ? [Number(v), p[1]] : [p[0], Number(v)]) : p)));
  return (
    <div>
      <b style={{ fontSize: 12 }}>{label}</b>
      <div className="tbl-wrap"><table>
        <thead><tr><th>V (pu of nominal)</th><th>{yLabel}</th><th></th></tr></thead>
        <tbody>
          {curve.map((p, i) => (
            <tr key={i}>
              <td><input type="number" step={0.01} aria-label={`${label} point ${i + 1} voltage`} value={p[0]} onChange={e => set(i, 0, e.target.value)} /></td>
              <td><input type="number" step={0.01} aria-label={`${label} point ${i + 1} ${yLabel}`} value={p[1]} onChange={e => set(i, 1, e.target.value)} /></td>
              <td><button className="mini" disabled={curve.length <= 2} onClick={() => onChange(curve.filter((_, k) => k !== i))}>remove</button></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <button className="mini" style={{ marginTop: 6 }} onClick={() => onChange([...curve, [...curve[curve.length - 1]]])}>+ point</button>
    </div>
  );
}

export default function InverterCard() {
  const { design, setDesign } = useDesign();
  const inv = design.inverter;
  const set = (patch) => setDesign(d => ({ ...d, inverter: { ...d.inverter, ...patch } }));
  const isSeed = JSON.stringify(inv.voltVarCurve) === JSON.stringify(IEEE1547_CAT_B.voltVarCurve) && JSON.stringify(inv.voltWattCurve) === JSON.stringify(IEEE1547_CAT_B.voltWattCurve);
  return (
    <div className="card">
      <h2>Smart-inverter PV</h2>
      <p className="hint">How rooftop PV inverters respond to the voltage at their connection point. Unity (the default) is the app's historical behaviour. In the smart modes P and Q are solved together with the voltages; apparent power is limited to the rating with reactive-power priority. Individual PV systems can override the mode on the Network page.</p>
      <label className="field"><span>Mode for all PV</span>
        <select value={inv.mode} onChange={e => set({ mode: e.target.value })}>
          {Object.entries(INVERTER_MODE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select></label>
      <label className="field"><span>Export limit per PV system (kW, blank = none)</span>
        <input type="number" min={0} step={0.5} value={inv.exportLimitKw ?? ''} onChange={e => set({ exportLimitKw: e.target.value === '' ? null : Number(e.target.value) })} /></label>
      {isSeed && <div className="note" role="note" style={{ borderColor: 'var(--warn)' }}>The curves below are the <b>IEEE 1547-2018 Category B defaults</b> (volt-var Table 8, volt-watt Table 10) — a placeholder. Replace them with your grid code's settings.</div>}
      <div className="grid g2" style={{ marginTop: 10 }}>
        <CurveTable label="Volt-var" yLabel="Q (pu of rating, + = inject)" curve={inv.voltVarCurve} onChange={c => set({ voltVarCurve: c })} />
        <CurveTable label="Volt-watt" yLabel="P limit (pu of rating)" curve={inv.voltWattCurve} onChange={c => set({ voltWattCurve: c })} />
      </div>
      {!isSeed && <button className="mini" style={{ marginTop: 8 }} onClick={() => set({ voltVarCurve: IEEE1547_CAT_B.voltVarCurve.map(p => [...p]), voltWattCurve: IEEE1547_CAT_B.voltWattCurve.map(p => [...p]) })}>Reset to IEEE 1547 Cat B defaults</button>}
    </div>
  );
}
