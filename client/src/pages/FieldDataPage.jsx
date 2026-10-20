import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import TaskProgress from '../components/TaskProgress.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import { parseAmiCsv, amiAnalysis, applyAmiSuggestions, AMI_TYPES, parseFieldCsv, FLAG_V } from '../lib/loadflow.js';
import CsvButton from '../components/CsvButton.jsx';

// Field data (P6.3, P6.4): smart-meter import (suggested curves and ADMD, applied only on
// confirmation) and measured vs simulated voltages with the phase-label check.
const TYPE_LABEL = { general: 'General', ev: 'EV', shop: 'Commercial shop', evcs: 'EV charging station' };
const textareaStyle = { width: '100%', fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, padding: 8 };

function AmiCard() {
  const { design, setDesign } = useDesign();
  const [csv, setCsv] = useState('');
  const [intervalMin, setIntervalMin] = useState(30);
  const [split, setSplit] = useState(false);
  const [res, setRes] = useState(null);
  const [pick, setPick] = useState({ curves: {}, admd: false });
  const [msg, setMsg] = useState('');
  const mappedLoads = design.loads.filter(l => l.meterId).length;

  function analyse(text = csv) {
    const { readings, errors } = parseAmiCsv(text);
    setRes({ a: amiAnalysis(design, readings, { intervalMin, split }), errors, n: readings.length });
    setPick({ curves: {}, admd: false }); setMsg('');
  }
  function apply() {
    const parts = [...Object.keys(pick.curves).map(t => `${TYPE_LABEL[t]} curve (${pick.curves[t]})`), ...(pick.admd ? ['ADMD'] : [])];
    if (!parts.length) return;
    if (!window.confirm(`Replace ${parts.join(', ')} in the design with the values from the meter data?`)) return;
    setDesign(d => applyAmiSuggestions(d, res.a, pick));
    setMsg(`Applied: ${parts.join(', ')}.`);
  }
  const a = res && res.a;
  return (
    <div className="card">
      <h2>Smart-meter (AMI) data</h2>
      <p className="hint">CSV of interval energy: meter id, timestamp (YYYY-MM-DD HH:MM, local time), kWh. Meters are matched to connections by the "Meter id" column on the Network page ({mappedLoads} connection{mappedLoads === 1 ? ' has' : 's have'} one). Nothing changes until you tick suggestions and apply them.</p>
      <div className="grid g3">
        <label className="field"><span>Interval (minutes)</span><input type="number" min={1} max={60} value={intervalMin} onChange={e => setIntervalMin(Number(e.target.value) || 30)} /></label>
        <label className="chk" style={{ alignSelf: 'end' }}><input type="checkbox" checked={split} onChange={e => setSplit(e.target.checked)} /> Separate weekday / weekend curves</label>
      </div>
      <label className="field"><span>CSV</span><textarea rows={5} style={textareaStyle} value={csv} onChange={e => setCsv(e.target.value)} placeholder={'meter_id,timestamp,kwh\nM1,2026-10-15 19:00,0.85'} /></label>
      <input type="file" accept=".csv,text/csv,text/plain" aria-label="Load a meter-data CSV file" onChange={e => { const f = e.target.files && e.target.files[0]; if (f) f.text().then(t => { setCsv(t); analyse(t); }); }} />{' '}
      <button className="ghost" onClick={() => analyse()}>Analyse</button>
      {res && (
        <div style={{ marginTop: 12 }}>
          <p className="hint">{res.n} readings · {a.meters} meters ({a.mappedMeters} matched to connections) · {a.days} day{a.days === 1 ? '' : 's'}.{a.unmapped.length ? ` Not in the design: ${a.unmapped.slice(0, 8).join(', ')}${a.unmapped.length > 8 ? '…' : ''}.` : ''}{a.withoutData.length ? ` Connections with a meter id but no data: ${a.withoutData.join(', ')}.` : ''}</p>
          {res.errors.length > 0 && <p className="hint" style={{ color: 'var(--warn)' }}>{res.errors.length} line(s) could not be read, e.g. {res.errors[0]}</p>}
          {Object.keys(a.curves).length === 0 ? <p className="hint">No matched meter data to analyse.</p> : (
            <>
              <div className="tbl-wrap"><table>
                <thead><tr><th scope="col">Type / days</th>{[...Array(24).keys()].map(h => <th key={h} scope="col" style={{ padding: '6px 3px' }}>{String(h).padStart(2, '0')}</th>)}<th scope="col">Use</th></tr></thead>
                <tbody>
                  {AMI_TYPES.filter(t => a.curves[t]).flatMap(t => Object.entries(a.curves[t]).map(([cls, c]) => (
                    <tr key={t + cls}>
                      <th scope="row" style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>{TYPE_LABEL[t]} — {cls}</th>
                      {c ? c.curve.map((x, h) => <td key={h} style={{ padding: '4px 3px' }}>{x == null ? '—' : x.toFixed(2)}</td>) : <td colSpan={24}>no data</td>}
                      <td>{c && c.hoursMissing === 0
                        ? <input type="radio" name={'use-' + t} aria-label={`Use the ${cls} curve for ${TYPE_LABEL[t]}`} checked={pick.curves[t] === cls} onChange={() => setPick(p => ({ ...p, curves: { ...p.curves, [t]: cls } }))} />
                        : <span className="hint">{c ? `${c.hoursMissing} h missing` : ''}</span>}</td>
                    </tr>
                  )))}
                </tbody>
              </table></div>
              {a.admd.general && (
                <p style={{ fontSize: 13 }}>
                  <label className="chk"><input type="checkbox" checked={pick.admd} onChange={e => setPick(p => ({ ...p, admd: e.target.checked }))} /> Use the measured ADMD: <b>{a.admd.general.admdKva.toFixed(2)} kVA</b></label>
                  {' '}(coincident peak {a.admd.general.coincidentPeakKw.toFixed(2)} kW at {a.admd.general.at} over {a.admd.general.customers} general customers, ÷ pf {design.pf}; the design uses {design.admd} kVA)
                </p>
              )}
              <details><summary>Per-customer peaks ({a.perCustomer.length})</summary>
                <div className="tbl-wrap"><table><thead><tr><th scope="col">Meter</th><th scope="col">Connection</th><th scope="col">Type</th><th scope="col">Peak kW</th></tr></thead>
                  <tbody>{a.perCustomer.map(p => <tr key={p.meterId}><td>{p.meterId}</td><td>{p.loadId}</td><td>{TYPE_LABEL[p.type]}</td><td>{p.peakKw.toFixed(2)}</td></tr>)}</tbody></table></div>
              </details>
              <button className="primary" style={{ marginTop: 10 }} onClick={apply} disabled={!Object.keys(pick.curves).length && !pick.admd}>Apply selected…</button>
              {msg && <span className="hint" role="status" style={{ marginLeft: 8 }}>{msg}</span>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MeasuredCard() {
  const { design } = useDesign();
  const [csv, setCsv] = useState('');
  const [year, setYear] = useState(0);
  const [res, setRes] = useState(null);
  const [errors, setErrors] = useState([]);
  const task = useEngineTask();
  async function run(text = csv) {
    const { readings, errors: errs } = parseFieldCsv(text);
    setErrors(errs);
    const r = await task.run('compareMeasured', { design, readings, year }, 'Solving the reading hours');
    if (r.ok) setRes(r.result);
  }
  const s = res && res.stats;
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Measured vs simulated</h2>
      <p className="hint">CSV of field readings: pole, phase (A/B/C), hour (0–23), volts, and optionally amps on the span into that pole. Readings off by more than {FLAG_V} V are flagged. If another phase's simulated voltage explains a flagged reading much better (its error at most a third, and at least 2 V smaller), it is marked as a likely phase-record error — a prompt for a site check, not a conclusion.</p>
      <div className="grid g3"><label className="field"><span>Study year of the readings</span><input type="number" min={0} max={30} value={year} onChange={e => setYear(Number(e.target.value) || 0)} /></label></div>
      <label className="field"><span>CSV</span><textarea rows={5} style={textareaStyle} value={csv} onChange={e => setCsv(e.target.value)} placeholder={'pole,phase,hour,V,A\nP3,A,20,213.4,'} /></label>
      <input type="file" accept=".csv,text/csv,text/plain" aria-label="Load a field-readings CSV file" onChange={e => { const f = e.target.files && e.target.files[0]; if (f) f.text().then(t => { setCsv(t); run(t); }); }} />{' '}
      <button className="ghost" onClick={() => run()} disabled={task.running}>Compare</button>
      <TaskProgress task={task} />
      {errors.length > 0 && <p className="hint" style={{ color: 'var(--warn)' }}>{errors.length} line(s) could not be read, e.g. {errors[0]}</p>}
      {res && (
        <div style={{ marginTop: 10 }}>
          {s ? <div className="grid g4">
            <div className="stat"><div className="v">{s.n}</div><div className="l">Readings</div></div>
            <div className="stat"><div className="v">{(s.biasV >= 0 ? '+' : '') + s.biasV.toFixed(2)} V</div><div className="l">Bias (measured − simulated)</div></div>
            <div className="stat"><div className="v">{s.rmseV.toFixed(2)} V</div><div className="l">RMSE (MAE {s.maeV.toFixed(2)} V)</div></div>
            <div className={'stat ' + (s.flagged ? 'bad' : 'ok')}><div className="v">{s.flagged} / {s.likelyPhaseErrors}</div><div className="l">Flagged / likely phase errors</div></div>
          </div> : <p className="hint">No readings matched poles in the design.</p>}
          {res.unknown.length > 0 && <p className="hint">Readings at poles not in the design: {res.unknown.map(u => u.pole).join(', ')}.</p>}
          {res.rows.length > 0 && <CsvButton name="Measured vs simulated" columns={['Pole', 'Phase', 'Hour', 'Measured V', 'Simulated V', 'Error V', 'Measured A', 'Simulated A', 'Likely phase']} rows={res.rows.map(r => [r.pole, r.phase, r.hour, r.v, r.simulatedV, r.error, r.amps ?? '', r.simulatedA, r.likelyPhase || ''])} />}
          {res.rows.length > 0 && <div className="tbl-wrap" style={{ marginTop: 10 }}><table>
            <thead><tr><th scope="col">Pole</th><th scope="col">Phase</th><th scope="col">Hour</th><th scope="col">Measured V</th><th scope="col">Simulated V</th><th scope="col">Error V</th><th scope="col">Current: measured / simulated A</th><th scope="col">Check</th></tr></thead>
            <tbody>{res.rows.map((r, i) => (
              <tr key={i}>
                <td>{r.pole}</td><td className={'phase' + r.phase}>{r.phase}</td><td>{String(r.hour).padStart(2, '0')}:00</td>
                <td>{r.v.toFixed(1)}</td><td>{r.simulatedV.toFixed(1)}</td>
                <td style={{ fontWeight: r.flagged ? 700 : 400 }}>{(r.error >= 0 ? '+' : '') + r.error.toFixed(2)}{r.flagged ? ' ⚠' : ''}</td>
                <td>{r.amps != null ? `${r.amps.toFixed(1)} / ${r.simulatedA.toFixed(1)}` : '—'}</td>
                <td>{r.likelyPhase ? <b>Likely recorded on phase {r.likelyPhase}</b> : r.flagged ? 'Check the reading and the model' : 'OK'}</td>
              </tr>
            ))}</tbody>
          </table></div>}
        </div>
      )}
    </div>
  );
}

export default function FieldDataPage() {
  return <div><AmiCard /><MeasuredCard /></div>;
}
