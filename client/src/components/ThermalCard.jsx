import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';

// Transformer thermal model settings (P3.3, IEC 60076-7). The ambient profile starts flat at the
// IEC 20 °C reference — not climate data; the card says so until the user enters their own.
const PARAMS = [
  ['topOilRiseK', 'Top-oil rise at rated load Δθor (K)', 1],
  ['hotSpotGradientK', 'Hot-spot to top-oil gradient Hgr (K)', 1],
  ['lossRatioR', 'Load-to-no-load loss ratio R', 0.1],
  ['oilExponentX', 'Oil exponent x', 0.1],
  ['windingExponentY', 'Winding exponent y', 0.1],
  ['tauOilMin', 'Oil time constant τo (min)', 5],
  ['tauWindingMin', 'Winding time constant τw (min)', 1],
  ['k11', 'k11', 0.1], ['k21', 'k21', 0.1], ['k22', 'k22', 0.1]
];

export default function ThermalCard() {
  const { design, setDesign } = useDesign();
  const th = design.thermal;
  const [flatValue, setFlatValue] = useState('');
  const set = (patch) => setDesign(d => ({ ...d, thermal: { ...d.thermal, ...patch } }));
  const isReference = th.ambientC.every(v => v === 20);
  return (
    <div className="card">
      <h2>Transformer thermal ageing (IEC 60076-7)</h2>
      <p className="hint">Hot-spot temperature and insulation ageing from each transformer's 24 h loading (shown on the 24h Profile page and in the report). Parameters default to IEC 60076-7's ONAN distribution-transformer values; replace Δθor and Hgr with the unit's heat-run test results where you have them.</p>
      {isReference && <div className="note" role="note" style={{ borderColor: 'var(--warn)' }}>The ambient profile is the flat <b>20 °C IEC reference</b>, not local climate data. Enter your site's hourly ambient temperatures below for a meaningful ageing estimate.</div>}
      <div className="addrow" style={{ marginTop: 8 }}>
        <input type="number" step={1} placeholder="set every hour to … °C" value={flatValue} onChange={e => setFlatValue(e.target.value)} aria-label="Flat ambient temperature" />
        <button className="ghost" onClick={() => { if (flatValue !== '' && Number.isFinite(Number(flatValue))) set({ ambientC: Array(24).fill(Number(flatValue)) }); }}>Apply to all hours</button>
      </div>
      <div className="tbl-wrap" style={{ marginTop: 8 }}><table>
        <thead><tr>{th.ambientC.map((_, h) => <th key={h}>{String(h).padStart(2, '0')}</th>)}</tr></thead>
        <tbody><tr>{th.ambientC.map((v, h) => (
          <td key={h}><input type="number" step={1} style={{ width: 52, padding: '6px 4px' }} aria-label={`Ambient at ${h}:00 (°C)`} value={v}
            onChange={e => set({ ambientC: th.ambientC.map((x, k) => (k === h ? Number(e.target.value) : x)) })} /></td>
        ))}</tr></tbody>
      </table></div>
      <p className="hint" style={{ marginTop: 4 }}>Ambient temperature by hour, °C.</p>
      <div className="grid g4" style={{ marginTop: 8 }}>
        {PARAMS.map(([k, label, step]) => (
          <label className="field" key={k}><span>{label}</span>
            <input type="number" step={step} value={th[k]} onChange={e => set({ [k]: Number(e.target.value) })} /></label>
        ))}
      </div>
    </div>
  );
}
