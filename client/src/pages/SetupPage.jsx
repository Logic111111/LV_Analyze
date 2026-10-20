import { useDesign } from '../context/DesignContext.jsx';
import { secondaryLNVoltage, txImpedance, nextTransformerId, transformerRatings, getTransformerType } from '../lib/loadflow.js';
import CurveEditor from '../components/CurveEditor.jsx';
import TapAdvisorCard from '../components/TapAdvisorCard.jsx';
import ConductorLibraryEditor from '../components/ConductorLibraryEditor.jsx';
import StandardsCard from '../components/StandardsCard.jsx';
import InverterCard from '../components/InverterCard.jsx';

export default function SetupPage() {
  const { design, setDesign } = useDesign();
  const set = (patch) => setDesign(d => ({ ...d, ...patch }));
  const num = (v) => Number(v);

  function updateTx(id, patch) {
    setDesign(d => ({ ...d, transformers: d.transformers.map(t => t.id === id ? { ...t, ...patch } : t) }));
  }
  function addTransformer() {
    const id = nextTransformerId(design);
    setDesign(d => ({ ...d, transformers: [...d.transformers, { id, name: id, txRating: 250, tap: 2, hvActual: 11000, txXR: 3, txGroundOhms: 7.5 }] }));
  }
  function removeTransformer(id) {
    if (design.poles.some(p => p.parent === id)) {
      alert('This transformer still feeds one or more poles — reparent or remove them on the Network page first.');
      return;
    }
    setDesign(d => ({ ...d, transformers: d.transformers.filter(t => t.id !== id) }));
  }

  return (
    <div>
      <div className="card" style={{ padding: '12px 18px', marginBottom: 14 }}>
        <label className="field" style={{ marginBottom: 0 }}><span>Design name (this network)</span>
          <input type="text" value={design.name} onChange={e => set({ name: e.target.value || 'Untitled Island' })} />
        </label>
      </div>

      <div className="section-title">Transformers <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 5, padding: '1px 6px', marginLeft: 6 }}>DYn11</span></div>
      <p className="hint">11000V delta / 415V star-neutral, 4.0% impedance, off-load tap changer with 4 positions. Add a second transformer to split an existing feeder — reparent a pole to it on the Network page to break the feeder there. The star point is permanently earthed through its own ground resistance — this only affects results once a pole downstream is also grounded (Network page), since a single ground point elsewhere in the network doesn't shift any phase-to-neutral reading on its own.</p>
      <div className="grid g3">
        {design.transformers.map(tx => {
          const v0 = secondaryLNVoltage(tx);
          const tz = txImpedance(tx, design);
          return (
            <div className="card" key={tx.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <input type="text" style={{ fontWeight: 600 }} value={tx.name} onChange={e => updateTx(tx.id, { name: e.target.value || tx.id })} />
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="pill ok" style={{ fontSize: 10 }}>{tx.id}</span>
                  {design.transformers.length > 1 && <button className="mini" onClick={() => removeTransformer(tx.id)}>remove</button>}
                </span>
              </div>
              <label className="field"><span>Rated capacity</span>
                <select value={tx.txRating} onChange={e => updateTx(tx.id, { txRating: num(e.target.value) })}>
                  {transformerRatings(design).map(k => <option key={k} value={k}>{k} kVA</option>)}
                </select>
              </label>
              <label className="field"><span>Tap position</span>
                <select value={tx.tap} onChange={e => updateTx(tx.id, { tap: num(e.target.value) })}>
                  <option value={1}>Tap 1 — 11275 : 415</option>
                  <option value={2}>Tap 2 — 11000 : 415 (nominal)</option>
                  <option value={3}>Tap 3 — 10725 : 415</option>
                  <option value={4}>Tap 4 — 10450 : 415</option>
                </select>
              </label>
              <label className="field"><span>Assumed constant HV supply</span>
                <input type="number" value={tx.hvActual} step={10} onChange={e => updateTx(tx.id, { hvActual: num(e.target.value) })} />
              </label>
              <label className="field"><span>Transformer X/R ratio</span>
                <input type="number" value={tx.txXR} step={0.1} min={0.5} onChange={e => updateTx(tx.id, { txXR: num(e.target.value) })} />
              </label>
              <label className="field"><span>Star point ground resistance (Ω)</span>
                <input type="number" value={tx.txGroundOhms ?? 7.5} step={0.5} min={0.1} onChange={e => updateTx(tx.id, { txGroundOhms: num(e.target.value) })} />
              </label>
              <p className="hint" style={{ marginTop: -4 }}>No-load secondary phase-neutral voltage at this tap: {v0.toFixed(1)} V ({(v0 * Math.sqrt(3)).toFixed(0)} V line-line).</p>
              <p className="hint" style={{ marginTop: -4 }}>Series impedance referred to LV, per phase: R={tz.r.toFixed(4)} Ω, X={tz.x.toFixed(4)} Ω (|Z|={tz.z.toFixed(4)} Ω from {(getTransformerType(design, tx.txRating).z * 100).toFixed(1)}% on nameplate rating).</p>
            </div>
          );
        })}
        <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button className="primary" onClick={addTransformer}>+ Add transformer</button>
        </div>
      </div>

      <div style={{ marginTop: 18 }}><TapAdvisorCard /></div>

      <div className="section-title">Transformer no-load loss by rating</div>
      <div className="card" style={{ padding: '8px 12px' }}>
        <p className="hint" style={{ marginTop: 0 }}>No-load (core/iron) loss — constant, drawn whenever a transformer is energised regardless of loading. Applied per transformer above by its rating, and added to total system losses. Editable per rating (shared across every transformer of that rating):</p>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Rating</th><th>No-load loss (W)</th></tr></thead>
          <tbody>
            {transformerRatings(design).map(k => (
              <tr key={k}>
                <td>{k} kVA</td>
                <td>
                  <input
                    type="number" step={5} min={0} style={{ width: 90 }}
                    value={design.txNoLoadW?.[k] ?? getTransformerType(design, k).noLoadW}
                    onChange={e => set({ txNoLoadW: { ...design.txNoLoadW, [k]: num(e.target.value) } })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <div className="grid g3" style={{ marginTop: 18 }}>
        <div className="card">
          <h2>Customer load assumptions</h2>
          <p className="hint">Applied to every general connection unless overridden per-connection. ADMD represents the night peak (18:30–22:30).</p>
          <label className="field"><span>General connection ADMD (kVA)</span>
            <input type="number" value={design.admd} step={0.1} onChange={e => set({ admd: num(e.target.value) })} /></label>
          <label className="field"><span>Power factor (general + EV)</span>
            <input type="number" value={design.pf} step={0.01} min={0.5} max={1} onChange={e => set({ pf: num(e.target.value) })} /></label>
          <label className="field"><span>Annual load growth, general &amp; EV (%/yr)</span>
            <input type="number" value={design.growth} step={0.5} onChange={e => set({ growth: num(e.target.value) })} /></label>
          <label className="chk"><input type="checkbox" checked={design.includeGeneral} onChange={e => set({ includeGeneral: e.target.checked })} /> Include general connections</label>
          <label className="chk"><input type="checkbox" checked={design.includeEV} onChange={e => set({ includeEV: e.target.checked })} /> Include EV connections</label>
          <label className="chk"><input type="checkbox" checked={design.includeEVCS} onChange={e => set({ includeEVCS: e.target.checked })} /> Include EVCS (public/workplace EV charging) connections</label>
          <label className="chk"><input type="checkbox" checked={design.includeShop} onChange={e => set({ includeShop: e.target.checked })} /> Include commercial shop connections</label>
          <label className="chk"><input type="checkbox" checked={design.includeSolar} onChange={e => set({ includeSolar: e.target.checked })} /> Include rooftop solar PV</label>
          <label className="chk"><input type="checkbox" checked={design.includeBess} onChange={e => set({ includeBess: e.target.checked })} /> Include battery storage (BESS)</label>
        </div>

        <div className="card">
          <h2>Load voltage-dependence (ZIP model)</h2>
          <p className="hint">Real feeders draw a mix of constant-impedance (Z — resistive heaters, incandescent lighting), constant-current (I), and constant-power (P — LEDs, inverter appliances, EV chargers) demand: P(V) = P₀·[a_Z(V/V₀)² + a_I(V/V₀) + a_P], with the same ratio applied to Q. Older, more resistive feeders skew toward Z; modern LED/inverter/EV-heavy feeders skew toward P, which is why voltage margins matter more on them. Applies to general/EV/shop connections only — rooftop PV and BESS always stay constant-power.</p>
          <label className="field"><span>Model</span>
            <select value={design.loadModel} onChange={e => set({ loadModel: e.target.value })}>
              <option value="constant">Constant power (P) — legacy default</option>
              <option value="zip">ZIP (voltage-dependent)</option>
            </select>
          </label>
          {design.loadModel === 'zip' && (
            <>
              <div className="grid g3">
                <label className="field"><span>a_Z (constant impedance)</span>
                  <input type="number" value={design.zipZ} step={0.05} min={0} max={1} onChange={e => set({ zipZ: num(e.target.value) })} /></label>
                <label className="field"><span>a_I (constant current)</span>
                  <input type="number" value={design.zipI} step={0.05} min={0} max={1} onChange={e => set({ zipI: num(e.target.value) })} /></label>
                <label className="field"><span>a_P (constant power)</span>
                  <input type="number" value={design.zipP} step={0.05} min={0} max={1} onChange={e => set({ zipP: num(e.target.value) })} /></label>
              </div>
              <p className="hint" style={{ marginTop: -4 }}>
                a_Z + a_I + a_P = {(Number(design.zipZ) + Number(design.zipI) + Number(design.zipP)).toFixed(2)}
                {Math.abs(Number(design.zipZ) + Number(design.zipI) + Number(design.zipP) - 1) > 0.01
                  ? <span style={{ color: 'var(--bad)' }}> — should add up to 1</span>
                  : ' ✓'}
              </p>
            </>
          )}
        </div>

        <div>
          <StandardsCard />
          <div className="card" style={{ marginTop: 18 }}>
          <h2>Connection caps</h2>
          <label className="field"><span>Max single-phase PV per connection (kW)</span>
            <input type="number" value={design.maxpv} step={0.5} onChange={e => set({ maxpv: num(e.target.value) })} /></label>
          <label className="field"><span>Max single-phase BESS per connection (kW)</span>
            <input type="number" value={design.maxbess} step={0.5} onChange={e => set({ maxbess: num(e.target.value) })} /></label>
          <div className="note">All rooftop PV is grid-tied and exports at unity power factor whenever site generation exceeds site demand. Reverse power flow through the transformer and every feeder span is fully modelled. <b>No export limit is applied at the transformer / grid connection</b> — transformer loading is only ever treated as a limitation on import. Feeder voltage levels rise naturally under reverse flow, and the statutory band still applies in both directions.</div>
        </div>
        </div>

        <div className="card">
          <h2>BESS charge / discharge assumptions</h2>
          <p className="hint">By default a BESS connection is a fixed-power schedule: it draws its rated kVA from the grid during the charge window and injects it at unity power factor during the discharge window, with no state-of-charge tracking. Individual units can instead use a state-of-charge mode (Network page, needs the battery's kWh), which uses these windows but respects its SOC limits. Windows snap to whole clock hours since the load flow solves one snapshot per hour, so 18:30–22:30 is approximated as whole hours below (same rounding the app already uses for ADMD's night peak).</p>
          <label className="field"><span>Round-trip efficiency</span>
            <input type="number" value={design.bessRte} step={0.01} min={0.5} max={1} onChange={e => set({ bessRte: num(e.target.value) })} /></label>
          <p className="hint" style={{ marginTop: -4 }}>Default 0.90 for Lithium Iron (LFP). In the fixed schedule the round-trip loss is applied as a derate on discharge output only; the state-of-charge modes split it as √RTE on charge and √RTE on discharge (unless set per unit).</p>
          <div className="grid g2">
            <label className="field"><span>Charge window start (grid-charging)</span>
              <select value={design.bessChargeStartHour} onChange={e => set({ bessChargeStartHour: num(e.target.value) })}>
                {[...Array(24).keys()].map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
            <label className="field"><span>Charge window end (exclusive)</span>
              <select value={design.bessChargeEndHour} onChange={e => set({ bessChargeEndHour: num(e.target.value) })}>
                {[...Array(24).keys()].map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
            <label className="field"><span>Discharge window start (peak support)</span>
              <select value={design.bessDischargeStartHour} onChange={e => set({ bessDischargeStartHour: num(e.target.value) })}>
                {[...Array(24).keys()].map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
            <label className="field"><span>Discharge window end (exclusive)</span>
              <select value={design.bessDischargeEndHour} onChange={e => set({ bessDischargeEndHour: num(e.target.value) })}>
                {[...Array(24).keys()].map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </label>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}><InverterCard /></div>

      <div className="section-title">Fault level &amp; protection settings</div>
      <div className="card">
        <p className="hint">Used by the Protection page (IEC 60909-style fault levels). Leave the HV fault level blank for an infinite source. The voltage factors default to IEC 60909-0's LV values for a +6 % tolerance band; the minimum fault is taken with conductors at the temperature below (R scaled by 1 + 0.00403·(θ − 20) for aluminium).</p>
        <div className="grid g3">
          <label className="field"><span>HV fault level S″k (MVA, blank = infinite)</span>
            <input type="number" min={0} step={1} value={design.fault.hvFaultMVA ?? ''} onChange={e => set({ fault: { ...design.fault, hvFaultMVA: e.target.value === '' ? null : num(e.target.value) } })} /></label>
          <label className="field"><span>HV network X/R</span>
            <input type="number" min={0} step={0.5} value={design.fault.hvXR} onChange={e => set({ fault: { ...design.fault, hvXR: num(e.target.value) } })} /></label>
          <label className="field"><span>Conductor temperature for Ik1min (°C)</span>
            <input type="number" step={5} value={design.fault.condTempC} onChange={e => set({ fault: { ...design.fault, condTempC: num(e.target.value) } })} /></label>
          <label className="field"><span>Voltage factor cmax (maximum fault)</span>
            <input type="number" step={0.01} value={design.fault.cMax} onChange={e => set({ fault: { ...design.fault, cMax: num(e.target.value) } })} /></label>
          <label className="field"><span>Voltage factor cmin (minimum fault)</span>
            <input type="number" step={0.01} value={design.fault.cMin} onChange={e => set({ fault: { ...design.fault, cMin: num(e.target.value) } })} /></label>
        </div>
      </div>

      <div className="section-title">Conductor library</div>
      <ConductorLibraryEditor />

      <div className="grid g4" style={{ marginTop: 18 }}>
        <div className="card">
          <h2>General load daily curve</h2>
          <p className="hint">Multiplier of ADMD by hour. Drag bars to reshape.</p>
          <CurveEditor values={design.loadCurve} onChange={(v) => set({ loadCurve: v })} max={1.2} colorVar="--accent-2" />
        </div>
        <div className="card">
          <h2>EV charging daily curve</h2>
          <p className="hint">Multiplier of EV connection kVA by hour.</p>
          <CurveEditor values={design.evCurve} onChange={(v) => set({ evCurve: v })} max={1.2} colorVar="--accent-2" />
        </div>
        <div className="card">
          <h2>Commercial shop daily curve</h2>
          <p className="hint">Multiplier of connection kVA by hour — cooling/refrigeration load outside trading hours, ramping up over 08:00–20:00 opening hours.</p>
          <CurveEditor values={design.shopCurve} onChange={(v) => set({ shopCurve: v })} max={1.2} colorVar="--accent-2" />
        </div>
        <div className="card">
          <h2>EVCS daily curve</h2>
          <p className="hint">Multiplier of EVCS connection kVA by hour — public/workplace charging, weighted through the day rather than evening/overnight like home EV charging.</p>
          <CurveEditor values={design.evcsCurve} onChange={(v) => set({ evcsCurve: v })} max={1.2} colorVar="--accent-2" />
        </div>
        <div className="card">
          <h2>Solar irradiance daily curve</h2>
          <p className="hint">Multiplier of installed PV kVA by hour (pf = 1).</p>
          <CurveEditor values={design.solarCurve} onChange={(v) => set({ solarCurve: v })} max={1.1} colorVar="--warn" />
        </div>
      </div>
    </div>
  );
}
