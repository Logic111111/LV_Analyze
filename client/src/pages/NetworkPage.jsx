import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { feederRoots, poleById, isTransformerId, transformerOfPole, PHASES, conductorCodes } from '../lib/loadflow.js';
import { INVERTER_MODE_LABELS } from '../components/InverterCard.jsx';

export default function NetworkPage() {
  const { design, setDesign } = useDesign();
  const poleIds = design.poles.map(p => p.id);

  const [np, setNp] = useState({ id: '', feeder: 'F1', parent: design.transformers[0]?.id || 'TX', spanM: 30, cond: '70ABC' });
  const [nl, setNl] = useState({ pole: poleIds[0] || '', type: 'general', phase: 'A', kva: '' });
  const [bulk, setBulk] = useState({ pole: poleIds[0] || '', type: 'general', qty: 5, phase: 'distribute', kva: '' });
  const [npv, setNpv] = useState({ pole: poleIds[0] || '', phase: 'A', kva: 5 });
  const [nbess, setNbess] = useState({ pole: poleIds[0] || '', phase: 'A', kva: 5 });
  const [nop, setNop] = useState({ poleA: poleIds[0] || '', poleB: poleIds[1] || poleIds[0] || '', spanM: 20, cond: '70ABC' });

  function addPole() {
    if (!np.id.trim()) { alert('Enter a pole id'); return; }
    if (design.poles.some(p => p.id === np.id)) { alert('That pole id is already used.'); return; }
    setDesign(d => ({ ...d, poles: [...d.poles, { ...np, spanM: Number(np.spanM) || 30 }] }));
    setNp({ ...np, id: '' });
  }
  function removePole(id) {
    setDesign(d => ({
      ...d,
      poles: d.poles.filter(p => p.id !== id),
      loads: d.loads.filter(l => l.pole !== id),
      pv: d.pv.filter(p => p.pole !== id),
      bess: d.bess.filter(b => b.pole !== id)
    }));
  }
  // Walks up the parent chain from `fromId` looking for `targetId` — used to stop a pole being
  // reparented under its own descendant, which would otherwise silently drop it from the solve.
  function wouldCreateCycle(targetId, fromId) {
    let cur = fromId;
    while (!isTransformerId(design, cur)) {
      if (cur === targetId) return true;
      const p = poleById(design, cur);
      if (!p) return false;
      cur = p.parent;
    }
    return false;
  }
  // Editing a pole's parent is literally "break the feeder here and feed it from a new
  // transformer" — the whole downstream subtree follows automatically since each descendant
  // still references its own parent pole, unchanged.
  function setPoleField(id, field, value) {
    if (field === 'parent' && wouldCreateCycle(id, value)) {
      alert("Can't set that as the parent — it would make the pole its own ancestor.");
      return;
    }
    setDesign(d => ({ ...d, poles: d.poles.map(p => p.id === id ? { ...p, [field]: (field === 'spanM' || field === 'groundOhms') ? (Number(value) || 0) : value } : p) }));
  }
  // A pole saved before this feature existed has no groundOhms at all — default it to 20Ω the
  // first time grounding is turned on, rather than leaving it blank/NaN.
  function toggleGrounded(id, checked) {
    setDesign(d => ({
      ...d,
      poles: d.poles.map(p => p.id === id ? { ...p, grounded: checked, groundOhms: p.groundOhms ?? 20 } : p)
    }));
  }
  function addLoad() {
    if (!nl.pole) return;
    setDesign(d => ({ ...d, loads: [...d.loads, { id: 'L' + Date.now(), pole: nl.pole, type: nl.type, phase: nl.phase, kva: nl.kva === '' ? null : Number(nl.kva) }] }));
    setNl({ ...nl, kva: '' });
  }
  function removeLoad(id) { setDesign(d => ({ ...d, loads: d.loads.filter(l => l.id !== id) })); }
  function addBulk() {
    if (!bulk.pole) return;
    const qty = Math.max(1, Math.floor(Number(bulk.qty)) || 1);
    const kva = bulk.kva === '' ? null : Number(bulk.kva);
    const newLoads = [];
    for (let i = 0; i < qty; i++) {
      const phase = bulk.phase === 'distribute' ? PHASES[i % 3] : bulk.phase;
      newLoads.push({ id: 'L' + Date.now() + '-' + i, pole: bulk.pole, type: bulk.type, phase, kva });
    }
    setDesign(d => ({ ...d, loads: [...d.loads, ...newLoads] }));
    setBulk({ ...bulk, kva: '' });
  }
  function addPv() {
    if (!npv.pole) return;
    setDesign(d => ({ ...d, pv: [...d.pv, { id: 'S' + Date.now(), pole: npv.pole, phase: npv.phase, kva: Number(npv.kva) || 5 }] }));
  }
  function removePv(id) { setDesign(d => ({ ...d, pv: d.pv.filter(p => p.id !== id) })); }
  function addBess() {
    if (!nbess.pole) return;
    setDesign(d => ({ ...d, bess: [...d.bess, { id: 'BE' + Date.now(), pole: nbess.pole, phase: nbess.phase, kva: Number(nbess.kva) || 5 }] }));
  }
  function removeBess(id) { setDesign(d => ({ ...d, bess: d.bess.filter(b => b.id !== id) })); }
  function setBessField(id, field, value) { setDesign(d => ({ ...d, bess: d.bess.map(b => (b.id === id ? { ...b, [field]: value } : b)) })); }
  function addOpenPoint() {
    if (!nop.poleA || !nop.poleB) return;
    if (nop.poleA === nop.poleB) { alert('Pick two different poles.'); return; }
    const feederA = poleById(design, nop.poleA).feeder, feederB = poleById(design, nop.poleB).feeder;
    if (transformerOfPole(design, nop.poleA) === transformerOfPole(design, nop.poleB) && feederA === feederB) {
      alert('Those two poles are on the same feeder — a common open point is a tie between two different feeders (whether they come from the same transformer or two different ones).');
      return;
    }
    setDesign(d => ({ ...d, openPoints: [...d.openPoints, { id: 'OP' + Date.now(), poleA: nop.poleA, poleB: nop.poleB, spanM: Number(nop.spanM) || 0, cond: nop.cond }] }));
  }
  function removeOpenPoint(id) { setDesign(d => ({ ...d, openPoints: d.openPoints.filter(o => o.id !== id) })); }

  return (
    <div>
      <div className="card" style={{ padding: '12px 18px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div><span style={{ fontFamily: 'var(--disp)', fontWeight: 600, fontSize: 15 }}>{design.name}</span>
            <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 10 }}>{feederRoots(design).length} feeder(s) · {design.poles.length} pole(s)</span></div>
          <span className="pill ok" style={{ fontSize: 11 }}>{design.transformers.length} transformer{design.transformers.length === 1 ? '' : 's'} · {design.transformers.reduce((s, t) => s + t.txRating, 0)} kVA total</span>
        </div>
      </div>

      <div className="note">Build the network as a forest of trees: each feeder starts at a transformer bus. Every pole references a parent (a transformer or another pole), a span length and the conductor used on that span. Loads, EV connections and PV are attached to poles by phase. Add transformers on the Setup page.</div>

      <div className="section-title">Poles &amp; spans</div>
      <div className="card">
        <div className="tbl-wrap"><table>
          <thead><tr><th>Pole ID</th><th>Feeder</th><th>Parent</th><th>Span (m)</th><th>Conductor</th><th>Grounded</th><th>Rg (Ω)</th><th>Role</th><th></th></tr></thead>
          <tbody>
            {design.poles.map(p => (
              <tr key={p.id}>
                <td>{p.id}</td><td>{p.feeder}</td>
                <td>
                  <select aria-label={`Parent of ${p.id}`} value={p.parent} onChange={e => setPoleField(p.id, 'parent', e.target.value)}>
                    {design.transformers.map(t => <option key={t.id} value={t.id}>{t.name || t.id} ({t.id})</option>)}
                    {poleIds.filter(id => id !== p.id).map(id => <option key={id} value={id}>{id}</option>)}
                  </select>
                </td>
                <td><input type="number" style={{ width: 70 }} aria-label={`Span into ${p.id} (m)`} value={p.spanM} onChange={e => setPoleField(p.id, 'spanM', e.target.value)} /></td>
                <td>
                  <select aria-label={`Conductor into ${p.id}`} value={p.cond} onChange={e => setPoleField(p.id, 'cond', e.target.value)}>
                    {conductorCodes(design).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td><input type="checkbox" aria-label={`Earth electrode at ${p.id}`} checked={!!p.grounded} onChange={e => toggleGrounded(p.id, e.target.checked)} /></td>
                <td><input type="number" style={{ width: 70 }} step={0.5} min={0.01} disabled={!p.grounded} aria-label={`Earth resistance at ${p.id} (Ω)`} value={p.groundOhms ?? 20} onChange={e => setPoleField(p.id, 'groundOhms', e.target.value)} /></td>
                <td>{isTransformerId(design, p.parent) ? <span className="pill ok">feeder root</span> : ''}</td>
                <td><button className="mini" onClick={() => removePole(p.id)}>remove</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="hint" style={{ marginTop: 10 }}>To break a feeder at a pole and feed everything downstream from a different (or new) transformer, change that pole's Parent above — add the new transformer first on the Setup page. A pole marked <b>Grounded</b> has an earth electrode of resistance <b>Rg</b> bonding its neutral to true earth — a second, parallel return path alongside the metallic neutral conductor, which reduces the "neutral point displacement" an unbalanced load otherwise causes on the phases with no load of their own. Matches real MEN (multiple earthed neutral) practice, e.g. grounding the last pole of a feeder.</p>
        <div className="addrow">
          <input type="text" aria-label="pole id e.g. P5" placeholder="pole id e.g. P5" value={np.id} onChange={e => setNp({ ...np, id: e.target.value })} />
          <input type="text" aria-label="feeder e.g. F1" placeholder="feeder e.g. F1" value={np.feeder} onChange={e => setNp({ ...np, feeder: e.target.value })} />
          <select aria-label="New pole: fed from" value={np.parent} onChange={e => setNp({ ...np, parent: e.target.value })}>
            {design.transformers.map(t => <option key={t.id} value={t.id}>{t.name || t.id} ({t.id})</option>)}
            {poleIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <input type="number" aria-label="span (m)" placeholder="span (m)" value={np.spanM} onChange={e => setNp({ ...np, spanM: e.target.value })} />
          <select aria-label="New pole: conductor" value={np.cond} onChange={e => setNp({ ...np, cond: e.target.value })}>
            {conductorCodes(design).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="primary" onClick={addPole}>+ Add pole</button>
        </div>
      </div>

      <div className="section-title">Common open points</div>
      <div className="card">
        <p className="hint">A common open point is where two feeders come close to each other — another transformer's feeder, or a second feeder off this same transformer — joined by a normally-open tie kept open in everyday operation, but a known real-world reference point for siting a new transformer later (see the Feeder Split page). Purely informational here: it carries no current and doesn't affect any load-flow result.</p>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Pole A</th><th>Fed from</th><th>Pole B</th><th>Fed from</th><th>Tie length (m)</th><th>Conductor</th><th></th></tr></thead>
          <tbody>
            {design.openPoints.map(o => (
              <tr key={o.id}>
                <td>{o.poleA}</td><td>{transformerOfPole(design, o.poleA)}</td>
                <td>{o.poleB}</td><td>{transformerOfPole(design, o.poleB)}</td>
                <td>{o.spanM}</td><td>{o.cond}</td>
                <td><button className="mini" onClick={() => removeOpenPoint(o.id)}>remove</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="addrow">
          <select aria-label="Open point: pole A" value={nop.poleA} onChange={e => setNop({ ...nop, poleA: e.target.value })}>
            {poleIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <select aria-label="Open point: pole B" value={nop.poleB} onChange={e => setNop({ ...nop, poleB: e.target.value })}>
            {poleIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <input type="number" aria-label="tie length (m)" placeholder="tie length (m)" value={nop.spanM} onChange={e => setNop({ ...nop, spanM: e.target.value })} />
          <select aria-label="Open point: conductor" value={nop.cond} onChange={e => setNop({ ...nop, cond: e.target.value })}>
            {conductorCodes(design).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="primary" onClick={addOpenPoint}>+ Add open point</button>
        </div>
      </div>

      <div className="section-title">General, EV, EVCS &amp; Commercial Shop connections</div>
      <div className="card">
        <div className="tbl-wrap"><table>
          <thead><tr><th>Pole</th><th>Type</th><th>Phase</th><th>kVA</th><th>Annual kWh</th><th>Meter id</th><th></th></tr></thead>
          <tbody>
            {design.loads.map(l => (
              <tr key={l.id}>
                <td>{l.pole}</td><td>{l.type === 'ev' ? 'EV' : l.type === 'evcs' ? 'EVCS' : l.type === 'shop' ? 'Commercial Shop' : 'General'}</td>
                <td className={l.phase !== 'ABC' ? 'phase' + l.phase : ''}>{l.phase}</td>
                <td>{l.kva == null ? (l.type === 'general' && design.velander?.enabled && l.annualKWh ? 'Velander' : 'ADMD') : l.kva}</td>
                {/* Billing data (P6.2) and smart-meter id (P6.3): optional per connection. */}
                <td>{l.type === 'general' ? <input type="number" min={0} step={10} style={{ width: 90 }} aria-label={`Annual kWh of ${l.id}`} value={l.annualKWh ?? ''} onChange={e => setDesign(d => ({ ...d, loads: d.loads.map(x => (x.id === l.id ? { ...x, annualKWh: e.target.value === '' ? null : Number(e.target.value) } : x)) }))} /> : '—'}</td>
                <td><input type="text" style={{ width: 100 }} aria-label={`Meter id of ${l.id}`} value={l.meterId ?? ''} onChange={e => setDesign(d => ({ ...d, loads: d.loads.map(x => (x.id === l.id ? { ...x, meterId: e.target.value || undefined } : x)) }))} /></td>
                <td><button className="mini" onClick={() => removeLoad(l.id)}>remove</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="addrow">
          <select aria-label="New connection: pole" value={nl.pole} onChange={e => setNl({ ...nl, pole: e.target.value })}>
            {poleIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <select aria-label="New connection: type" value={nl.type} onChange={e => setNl({ ...nl, type: e.target.value })}>
            <option value="general">General</option><option value="ev">EV</option><option value="evcs">EVCS</option><option value="shop">Commercial Shop</option>
          </select>
          <select aria-label="New connection: phase" value={nl.phase} onChange={e => setNl({ ...nl, phase: e.target.value })}>
            <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="ABC">3-phase (ABC)</option>
          </select>
          <input type="number" aria-label="kVA (blank = ADMD)" placeholder="kVA (blank = ADMD)" step={0.1} value={nl.kva} onChange={e => setNl({ ...nl, kva: e.target.value })} />
          <button className="primary" onClick={addLoad}>+ Add connection</button>
        </div>

        <p className="hint" style={{ marginTop: 14, marginBottom: 6 }}>Bulk add — add several customers of the same category at once, e.g. "10 general connections on P3", instead of one at a time.</p>
        <div className="addrow">
          <select aria-label="Bulk add: pole" value={bulk.pole} onChange={e => setBulk({ ...bulk, pole: e.target.value })}>
            {poleIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <select aria-label="Bulk add: type" value={bulk.type} onChange={e => setBulk({ ...bulk, type: e.target.value })}>
            <option value="general">General</option><option value="ev">EV</option><option value="evcs">EVCS</option><option value="shop">Commercial Shop</option>
          </select>
          <input type="number" aria-label="quantity" placeholder="quantity" min={1} step={1} value={bulk.qty} onChange={e => setBulk({ ...bulk, qty: e.target.value })} />
          <select aria-label="Bulk add: phase" value={bulk.phase} onChange={e => setBulk({ ...bulk, phase: e.target.value })}>
            <option value="distribute">Distribute evenly A/B/C</option>
            <option value="A">All on A</option><option value="B">All on B</option><option value="C">All on C</option><option value="ABC">All 3-phase (ABC)</option>
          </select>
          <input type="number" aria-label="kVA each (blank = ADMD)" placeholder="kVA each (blank = ADMD)" step={0.1} value={bulk.kva} onChange={e => setBulk({ ...bulk, kva: e.target.value })} />
          <button className="primary" onClick={addBulk}>+ Add {bulk.qty || 1} connections</button>
        </div>
      </div>

      <div className="section-title">Rooftop solar PV</div>
      <div className="card">
        <div className="tbl-wrap"><table>
          <thead><tr><th>Pole</th><th>Phase</th><th>kVA</th><th>Inverter</th><th></th></tr></thead>
          <tbody>
            {design.pv.map(p => (
              <tr key={p.id}>
                <td>{p.pole}</td><td className={p.phase !== 'ABC' ? 'phase' + p.phase : ''}>{p.phase}</td><td>{p.kva}</td>
                <td><select aria-label={`Inverter mode for ${p.id}`} value={p.inverterMode || ''} onChange={e => setDesign(d => ({ ...d, pv: d.pv.map(x => (x.id === p.id ? { ...x, inverterMode: e.target.value || undefined } : x)) }))}>
                  <option value="">Design setting ({INVERTER_MODE_LABELS[design.inverter.mode]})</option>
                  {Object.entries(INVERTER_MODE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></td>
                <td><button className="mini" onClick={() => removePv(p.id)}>remove</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="addrow">
          <select aria-label="New PV: pole" value={npv.pole} onChange={e => setNpv({ ...npv, pole: e.target.value })}>
            {poleIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <select aria-label="New PV: phase" value={npv.phase} onChange={e => setNpv({ ...npv, phase: e.target.value })}>
            <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="ABC">3-phase (ABC)</option>
          </select>
          <input type="number" step={0.1} aria-label="New PV: kVA" value={npv.kva} onChange={e => setNpv({ ...npv, kva: e.target.value })} />
          <button className="primary" onClick={addPv}>+ Add PV</button>
        </div>
      </div>

      <div className="section-title">Battery storage (BESS)</div>
      <div className="card">
        <p className="hint">Each connection's kVA is its rated charge/discharge power. <b>Fixed schedule</b> (the default) charges from the grid in the charge window and discharges in the discharge window (Setup page) with no energy limit. The <b>state-of-charge</b> modes need the battery's usable energy (kWh, from its datasheet): <i>SOC schedule</i> uses the same windows but stops at the SOC limits; <i>solar-following</i> charges when its transformer exports or local PV exceeds local load, and discharges in the evening window. Efficiencies left blank default to √(round-trip efficiency) each.</p>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Pole</th><th>Phase</th><th>kVA</th><th>Mode</th><th>kWh</th><th>SOC start</th><th>SOC min</th><th>SOC max</th><th>η charge</th><th>η discharge</th><th></th></tr></thead>
          <tbody>
            {design.bess.map(b => (
              <tr key={b.id}>
                <td>{b.pole}</td><td className={b.phase !== 'ABC' ? 'phase' + b.phase : ''}>{b.phase}</td><td>{b.kva}</td>
                <td><select aria-label={`Mode for ${b.id}`} value={b.mode || 'schedule'} onChange={e => setBessField(b.id, 'mode', e.target.value)}>
                  <option value="schedule">Fixed schedule</option><option value="socSchedule">SOC schedule</option><option value="solarFollowing">Solar-following</option>
                </select></td>
                {['kWh', 'socInitial', 'socMin', 'socMax', 'etaCharge', 'etaDischarge'].map(f => (
                  <td key={f}><input type="number" style={{ width: 72 }} step={f === 'kWh' ? 1 : 0.05} min={0} aria-label={`${f} for ${b.id}`}
                    disabled={(b.mode || 'schedule') === 'schedule'}
                    placeholder={f === 'kWh' ? (b.mode && b.mode !== 'schedule' ? 'required' : '') : f === 'socInitial' ? '0.5' : f === 'socMin' ? '0' : f === 'socMax' ? '1' : '√RTE'}
                    value={b[f] ?? ''} onChange={e => setBessField(b.id, f, e.target.value === '' ? null : Number(e.target.value))} /></td>
                ))}
                <td><button className="mini" onClick={() => removeBess(b.id)}>remove</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="addrow">
          <select aria-label="New BESS: pole" value={nbess.pole} onChange={e => setNbess({ ...nbess, pole: e.target.value })}>
            {poleIds.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          <select aria-label="New BESS: phase" value={nbess.phase} onChange={e => setNbess({ ...nbess, phase: e.target.value })}>
            <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="ABC">3-phase (ABC)</option>
          </select>
          <input type="number" step={0.1} aria-label="New BESS: kVA" value={nbess.kva} onChange={e => setNbess({ ...nbess, kva: e.target.value })} />
          <button className="primary" onClick={addBess}>+ Add BESS</button>
        </div>
      </div>
    </div>
  );
}
