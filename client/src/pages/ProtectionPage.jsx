import { useMemo, useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { faultLevels, feederTrees, feederFuseKey, C } from '../lib/loadflow.js';
import TaskProgress from '../components/TaskProgress.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';

// Fault levels (instant, recomputed as the design changes) and the fuse protection check (runs a
// 24 h scan for the load check, so it goes through the engine worker). Results here are never fed
// into the load-flow violations — see protectionCheck in engine/faults.js.

const STATUS = {
  pass: { label: 'PASS', cls: 'ok' },
  fail: { label: 'FAIL', cls: 'bad' },
  missing: { label: 'DATA MISSING', cls: 'warn' }
};
const CHECKS = [
  ['disconnection', 'Disconnection (Ik1min ≥ Ia)'],
  ['breaking', 'Breaking capacity (Ik3max ≤ Icn)'],
  ['load', 'Load (rating ≥ peak current)'],
  ['cable', 'Cable overload (rating ≤ Iz)']
];
const kA = (a) => (a / 1000).toFixed(2);
const numOrNull = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

export function fuseLabel(f) { return f ? `${f.type ? f.type + ' ' : ''}${f.ratingA ?? '?'} A` : '—'; }

function StatusPill({ status, title }) {
  const s = STATUS[status];
  return <span className={'pill ' + s.cls} title={title}>{s.label}</span>;
}

export default function ProtectionPage() {
  const { design, setDesign } = useDesign();
  const fl = useMemo(() => faultLevels(design), [design]);
  const trees = feederTrees(design);
  const fuses = design.fuseLibrary || [];
  const prot = design.protection || { feederFuses: {}, poleFuses: {} };
  const task = useEngineTask();
  const [check, setCheck] = useState(null);

  const setProt = (patch) => setDesign(d => ({ ...d, protection: { ...d.protection, ...patch } }));
  const setFuses = (list) => setDesign(d => ({ ...d, fuseLibrary: list }));
  function updateFuse(id, field, value) {
    setFuses(fuses.map(f => f.id === id ? { ...f, [field]: field === 'type' || field === 'source' ? value : numOrNull(value) } : f));
  }
  function addFuse() {
    setFuses([...fuses, { id: 'FUSE' + Date.now(), ratingA: null, type: '', ia5sA: null, ia04sA: null, breakingKA: null, source: '' }]);
  }
  function removeFuse(id) {
    setDesign(d => ({
      ...d,
      fuseLibrary: d.fuseLibrary.filter(f => f.id !== id),
      protection: {
        feederFuses: Object.fromEntries(Object.entries(d.protection.feederFuses).filter(([, v]) => v !== id)),
        poleFuses: Object.fromEntries(Object.entries(d.protection.poleFuses).filter(([, v]) => v !== id))
      }
    }));
  }
  function setFeederFuse(key, fuseId) {
    const next = { ...prot.feederFuses };
    if (fuseId) next[key] = fuseId; else delete next[key];
    setProt({ feederFuses: next });
  }
  function setPoleFuse(poleId, fuseId) {
    const next = { ...prot.poleFuses };
    if (fuseId) next[poleId] = fuseId; else delete next[poleId];
    setProt({ poleFuses: next });
  }
  async function runCheck() {
    const r = await task.run('protection', { design }, 'Checking protection');
    if (r.ok) setCheck(r.result);
  }

  const s = fl.settings;
  const fuseOptions = (
    <>
      <option value="">— none —</option>
      {fuses.map(f => <option key={f.id} value={f.id}>{fuseLabel(f)}</option>)}
    </>
  );

  return (
    <div>
      <div className="card">
        <h2>Fault levels</h2>
        <p className="hint">
          Maximum three-phase (Ik3max, conductors at 20 °C, c = {s.cMax}) and minimum phase–neutral (Ik1min, conductors at {s.condTempC} °C, c = {s.cMin}) fault currents —
          IEC 60909-style, source {s.hvFaultMVA ? `${s.hvFaultMVA} MVA (X/R ${s.hvXR})` : 'infinite (no HV fault level entered)'}. Inputs are on the Setup page.
          Ik1min uses the phase + neutral loop impedance |Zloop| = |Zq + Ztx + Σ(Zph + Zn)|.
        </p>
        <div className="tbl-wrap"><table>
          <thead><tr><th>Location</th><th>Distance (m)</th><th>Ik3max (kA)</th><th>Ik1min (kA)</th><th>|Zloop| (Ω)</th></tr></thead>
          <tbody>
            {fl.transformers.map(t => (
              <tr key={t.id}><td>{t.id} LV terminals</td><td>0</td><td>{kA(t.ik3MaxA)}</td><td>{kA(t.ik1MinA)}</td><td>{C.abs(C.add(t.zSource, t.zTx)).toFixed(4)}</td></tr>
            ))}
            {fl.poles.map(p => (
              <tr key={p.id}><td>{p.id} <span style={{ color: 'var(--muted)' }}>({p.txId})</span></td><td>{p.distanceM}</td><td>{kA(p.ik3MaxA)}</td><td>{kA(p.ik1MinA)}</td><td>{C.abs(p.zLoop).toFixed(4)}</td></tr>
            ))}
          </tbody>
        </table></div>
      </div>

      <div className="section-title">Fuse library</div>
      <div className="card">
        {fuses.length === 0 && (
          <div className="note" role="status" style={{ borderColor: 'var(--warn)', marginTop: 0 }}>
            <b>No fuse data.</b> Add the fuses you use, with values from the manufacturer's time-current curves: the current that operates the fuse within 5 s and within 0.4 s (Ia), and its rated breaking capacity. Nothing is pre-filled — until a value is entered, every check that needs it shows "data missing".
          </div>
        )}
        {fuses.length > 0 && (
          <div className="tbl-wrap"><table>
            <thead><tr><th>Type / label</th><th>Rating In (A)</th><th>Ia 5 s (A)</th><th>Ia 0.4 s (A)</th><th>Breaking capacity (kA)</th><th>Source / notes</th><th></th></tr></thead>
            <tbody>
              {fuses.map(f => (
                <tr key={f.id}>
                  <td><input type="text" aria-label="Fuse type" value={f.type ?? ''} placeholder="e.g. gG NH00" onChange={e => updateFuse(f.id, 'type', e.target.value)} /></td>
                  <td><input type="number" aria-label="Rating (A)" style={{ width: 90 }} value={f.ratingA ?? ''} onChange={e => updateFuse(f.id, 'ratingA', e.target.value)} /></td>
                  <td><input type="number" aria-label="Ia for 5 s (A)" style={{ width: 90 }} value={f.ia5sA ?? ''} onChange={e => updateFuse(f.id, 'ia5sA', e.target.value)} /></td>
                  <td><input type="number" aria-label="Ia for 0.4 s (A)" style={{ width: 90 }} value={f.ia04sA ?? ''} onChange={e => updateFuse(f.id, 'ia04sA', e.target.value)} /></td>
                  <td><input type="number" aria-label="Breaking capacity (kA)" style={{ width: 90 }} value={f.breakingKA ?? ''} onChange={e => updateFuse(f.id, 'breakingKA', e.target.value)} /></td>
                  <td><input type="text" aria-label="Source" value={f.source ?? ''} placeholder="datasheet / curve reference" onChange={e => updateFuse(f.id, 'source', e.target.value)} /></td>
                  <td><button className="mini" onClick={() => removeFuse(f.id)}>remove</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <button className="ghost" style={{ marginTop: 10 }} onClick={addFuse}>+ Add fuse type</button>
      </div>

      <div className="section-title">Fuse positions</div>
      <div className="card">
        <p className="hint">A feeder's head fuse sits on the transformer LV board. A section fuse "into" a pole sits at the start of the span that feeds that pole and protects it and everything beyond; the fuse upstream then only has to clear faults up to it.</p>
        <div className="grid g2">
          <div>
            <h2 style={{ fontSize: 13 }}>Feeder head fuses</h2>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Feeder</th><th>Fuse</th></tr></thead>
              <tbody>
                {trees.map(t => {
                  const key = feederFuseKey(t.txId, t.feederName);
                  return (
                    <tr key={key}><td>{t.feederName} ({t.txId})</td>
                      <td><select aria-label={`Head fuse for ${t.feederName}`} value={prot.feederFuses[key] || ''} onChange={e => setFeederFuse(key, e.target.value)}>{fuseOptions}</select></td></tr>
                  );
                })}
              </tbody>
            </table></div>
          </div>
          <div>
            <h2 style={{ fontSize: 13 }}>Section fuses (optional)</h2>
            <div className="tbl-wrap"><table>
              <thead><tr><th>Into pole</th><th>Fuse</th></tr></thead>
              <tbody>
                {design.poles.map(p => (
                  <tr key={p.id}><td>{p.id} <span style={{ color: 'var(--muted)' }}>(from {p.parent})</span></td>
                    <td><select aria-label={`Section fuse into ${p.id}`} value={prot.poleFuses[p.id] || ''} onChange={e => setPoleFuse(p.id, e.target.value)}>{fuseOptions}</select></td></tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </div>
      </div>

      <div className="section-title">Protection check</div>
      <div className="card">
        <p className="hint">
          Per protective device: (a) Ik1min at every pole it protects ≥ its Ia for the {design.standards?.disconnectTimeS === 0.4 ? '0.4' : '5'} s disconnection time set on Setup;
          (b) Ik3max where it sits ≤ its breaking capacity; (c) its rating ≥ the peak phase current through it over a 24 h scan (year 0);
          (d) its rating ≤ the current rating Iz of the first span it feeds. These are reported here and in the report only — they don't count as load-flow violations.
        </p>
        <button className="primary" onClick={runCheck} disabled={task.running}>Run protection check</button>
        <TaskProgress task={task} />
        {check && (
          <div className="tbl-wrap" style={{ marginTop: 14 }}><table>
            <thead><tr><th>Device</th><th>Fuse</th><th>Protects</th>{CHECKS.map(([k, l]) => <th key={k}>{l}</th>)}<th>Overall</th></tr></thead>
            <tbody>
              {check.devices.map(dev => (
                <tr key={dev.kind + dev.key}>
                  <td>{dev.label}</td>
                  <td>{dev.fuse ? fuseLabel(dev.fuse) : <span style={{ color: 'var(--muted)' }}>none</span>}</td>
                  <td>{dev.zonePoles.join(', ') || '—'}</td>
                  {CHECKS.map(([k]) => (
                    <td key={k}><StatusPill status={dev.checks[k].status} title={dev.checks[k].detail} /><div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, whiteSpace: 'normal', minWidth: 160 }}>{dev.checks[k].detail}</div></td>
                  ))}
                  <td><StatusPill status={dev.overall} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
