import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { runSnapshot, getTransformerType, transformerOfPole, isTransformerId, systemLossW } from '../lib/loadflow.js';
import { downloadHtml, reportFileName } from '../lib/report.js';
import TaskProgress from '../components/TaskProgress.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';
import { vufText } from '../lib/format.js';
import YearPicker from '../components/YearPicker.jsx';

function pillClassFor(level) { return level === 2 ? 'bad' : level === 1 ? 'warn' : 'ok'; }

// Groups a flat list by owning transformer once a design has more than one — otherwise
// returns it as a single unlabelled group, matching today's single-transformer layout.
function groupByTx(design, items, txOf) {
  if (design.transformers.length <= 1) return [{ tx: null, items }];
  return design.transformers.map(tx => ({ tx, items: items.filter(it => txOf(it) === tx.id) }));
}
// A violation's `pole` is either a real pole id, or (for a "transformer overload" entry) the
// transformer's own id.
function txOfViolation(design, v) { return isTransformerId(design, v.pole) ? v.pole : transformerOfPole(design, v.pole); }

export default function ReportsPage() {
  const { design, lastResults, setLastResults, lastHosting, lastBessHosting, lastDaily, lastTapAdvice, lastReconductor, lastFixIt } = useDesign();
  const [year, setYear] = useState(0);
  const [hour, setHour] = useState(20);
  const [loadMult, setLoadMult] = useState(1);
  const [solarMult, setSolarMult] = useState(1);
  const [busy, setBusy] = useState(false);
  // The comprehensive report re-runs several 24 h scans (energy loss, 5-year outlook), so it's
  // built in the engine worker; only the download itself happens here.
  const reportTask = useEngineTask();
  async function downloadComprehensiveReport() {
    const extras = { tapAdvice: lastTapAdvice, reconductor: lastReconductor, fixIt: lastFixIt };
    const r = await reportTask.run('report', { design, res: lastResults, hosting: lastHosting, daily: lastDaily, bessHosting: lastBessHosting, extras }, 'Building the report');
    if (r.ok) downloadHtml(r.result, reportFileName(design));
  }

  function applyPreset(preset) {
    if (preset === 'night') { setHour(20); setSolarMult(0); }
    if (preset === 'solar') { setHour(12); setSolarMult(1); }
  }

  function run() {
    setBusy(true);
    setTimeout(() => {
      const res = runSnapshot(design, { year, hour, loadMult, solarMult });
      setLastResults(res);
      setBusy(false);
    }, 10);
  }

  const res = lastResults;

  return (
    <div>
      <div className="card" style={{ padding: '12px 18px', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontFamily: 'var(--disp)', fontWeight: 600, fontSize: 15 }}>{design.name}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {design.transformers.map(t => (
              <span key={t.id} className="pill ok" style={{ fontSize: 11 }}>{t.name}: {t.txRating} kVA · tap {t.tap} · X/R {t.txXR}</span>
            ))}
            <button className="ghost" onClick={downloadComprehensiveReport} disabled={reportTask.running}>Download comprehensive report</button>
          </div>
        </div>
      </div>

      <TaskProgress task={reportTask} />

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Simulation snapshot</h2>
        <div className="grid g3">
          <label className="field"><span>Year</span><YearPicker value={year} onChange={setYear} /></label>
          <label className="field"><span>Hour of day: <b>{String(hour).padStart(2, '0')}:00</b></span>
            <input type="range" min={0} max={23} value={hour} onChange={e => setHour(Number(e.target.value))} />
          </label>
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
        <button className="primary" onClick={run} disabled={busy}>Run load flow</button>
        {busy && <span className="loading" style={{ marginLeft: 12 }}><span className="spinner"></span> solving…</span>}
      </div>

      {res && <Report res={res} design={design} />}
    </div>
  );
}

function Report({ res, design }) {
  const vBad = res.violations.filter(v => v.type !== 'thermal' && v.type !== 'transformer overload').length;
  const tBad = res.violations.filter(v => v.type === 'thermal').length;
  const anyExporting = res.transformers.some(t => t.flowDirection === 'export');
  const { totalLossW: totalSystemLossW, txLossW, groundLossW } = systemLossW(res);
  const hasGroundLoss = groundLossW > 0.05; // a few tens of mW is float noise, not a real reading
  const totalLabel = 'Total losses (line + transformer' + (hasGroundLoss ? ' + ground' : '') + ')';

  return (
    <div style={{ marginTop: 18 }}>
      {!res.converged && (
        <div className="note" style={{ borderColor: 'var(--bad)', color: 'var(--bad)', marginBottom: 14 }}>
          Load flow did not fully converge after {res.iterUsed} iterations (final mismatch {res.lastDelta.toFixed(3)} V) — results below may be inaccurate.
        </div>
      )}
      <div className="grid g4">
        <div className={'stat ' + (vBad ? 'bad' : 'ok')}><div className="v">{vBad}</div><div className="l">Voltage violations</div></div>
        <div className={'stat ' + (tBad ? 'bad' : 'ok')}><div className="v">{tBad}</div><div className="l">Thermal (conductor) violations</div></div>
        <div className="stat"><div className="v">{(totalSystemLossW / 1000).toFixed(2)} kW</div><div className="l">{totalLabel}</div></div>
        <div className="stat"><div className="v">{(res.totalLossW / 1000).toFixed(2)} kW</div><div className="l">Line (conductor) losses</div></div>
      </div>
      <div className="grid g4" style={{ marginTop: 10 }}>
        <div className="stat"><div className="v">{(txLossW / 1000).toFixed(3)} kW</div><div className="l">Transformer losses (all units, copper + no-load)</div></div>
        {hasGroundLoss && <div className="stat"><div className="v">{(groundLossW / 1000).toFixed(3)} kW</div><div className="l">Ground-electrode losses (grounded poles/star point)</div></div>}
        {res.worstVuf && (
          <div className={'stat ' + (res.worstVuf.value > res.vufLimitPct ? 'warn' : 'ok')}>
            <div className="v">{vufText(res.worstVuf.value)}</div>
            <div className="l">Worst voltage unbalance (VUF, at {res.worstVuf.pole}; limit {res.vufLimitPct} %{design.standards?.vufAsViolation ? ', counted as a violation' : ', reported only'})</div>
          </div>
        )}
      </div>

      {anyExporting && (
        <div className="note" style={{ marginTop: 12, borderColor: 'var(--warn)' }}>
          Reverse power flow: one or more transformers' islands have generation exceeding demand and the surplus is exporting to the main grid. No export limit is applied at any transformer. Feeder voltages naturally rise under this condition; those limits still apply and are not relaxed for export.
        </div>
      )}

      <div className="section-title">Per-transformer summary</div>
      {res.transformers.map(t => {
        const exporting = t.flowDirection === 'export';
        const txClass = exporting ? 'ok' : (t.txPct > 100 ? 'bad' : t.txPct > 85 ? 'warn' : 'ok');
        const txLabel = exporting ? `EXPORT ${t.txPct.toFixed(1)}%` : `IMPORT ${t.txPct.toFixed(1)}%`;
        const dirLabel = exporting ? `⭯ EXPORT ${Math.abs(t.netKW).toFixed(1)} kW to grid` : `IMPORT ${t.netKW.toFixed(1)} kW from grid`;
        const rating = design.transformers.find(dt => dt.id === t.id)?.txRating;
        return (
          <div className="card" key={t.id} style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 13 }}>{t.name}</h2>
            <div className="grid g4">
              <div className={'stat ' + txClass}><div className="v">{txLabel}</div><div className="l">Transformer loading ({t.txKVA.toFixed(1)} / {getTransformerType(design, rating).kVA} kVA){exporting ? ' — no export cap applied' : ''}</div></div>
              <div className="stat ok"><div className="v">{dirLabel}</div><div className="l">Grid direction{exporting ? ' — reverse power flow' : ''}</div></div>
              <div className="stat"><div className="v">{(t.txLossW / 1000).toFixed(3)} kW</div><div className="l">Transformer copper loss</div></div>
              <div className="stat"><div className="v">{(t.txNoLoadW / 1000).toFixed(3)} kW</div><div className="l">Transformer no-load (core) loss</div></div>
            </div>
            <div className="grid g3" style={{ marginTop: 14 }}>
              <div className="stat"><div className="v"><span className="phaseA">{t.busVoltPct.A.toFixed(1)}</span>/<span className="phaseB">{t.busVoltPct.B.toFixed(1)}</span>/<span className="phaseC">{t.busVoltPct.C.toFixed(1)}</span> V</div><div className="l">LV bus voltage A/B/C (post-transformer drop)</div></div>
              <div className="stat"><div className="v">{vufText(t.busVufPct)}</div><div className="l">LV bus voltage unbalance (VUF)</div></div>
            </div>
          </div>
        );
      })}

      <div className="section-title">Pole voltages — Year {res.year} · {String(res.hour).padStart(2, '0')}:00</div>
      {groupByTx(design, res.poleResults, p => transformerOfPole(design, p.id)).map((g, gi) => (
        <div className="card" key={gi}>
          {g.tx && <p style={{ fontWeight: 600, marginTop: 0 }}>{g.tx.name || g.tx.id}</p>}
          <div className="tbl-wrap"><table>
            <thead><tr><th>Pole</th><th>Feeder</th><th className="phaseA">V-A</th><th className="phaseB">V-B</th><th className="phaseC">V-C</th><th title="Voltage unbalance factor |V2|/|V1|">VUF</th><th>Status</th></tr></thead>
            <tbody>
              {g.items.map(p => {
                const stat = (v) => v < res.vLimLow ? 2 : v > res.vLimHigh ? 2 : (v < res.vLimLow * 1.01 || v > res.vLimHigh * 0.99) ? 1 : 0;
                const worst = Math.max(stat(p.volt.A), stat(p.volt.B), stat(p.volt.C));
                return (
                  <tr key={p.id}>
                    <td>{p.id}</td><td>{p.feeder}</td>
                    <td className="phaseA">{p.volt.A.toFixed(1)}</td><td className="phaseB">{p.volt.B.toFixed(1)}</td><td className="phaseC">{p.volt.C.toFixed(1)}</td>
                    <td style={p.vufPct > res.vufLimitPct ? { color: 'var(--warn)', fontWeight: 700 } : undefined}>{vufText(p.vufPct)}</td>
                    <td><span className={'pill ' + pillClassFor(worst)}>{worst === 2 ? 'VIOLATION' : worst === 1 ? 'WATCH' : 'OK'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          <p className="hint" style={{ marginTop: 8 }}>Statutory band: {res.vLimLow.toFixed(1)} – {res.vLimHigh.toFixed(1)} V phase-neutral. VUF = negative- ÷ positive-sequence voltage (limit {res.vufLimitPct} %, EN 50160); values above the limit are shown bold.</p>
        </div>
      ))}

      <div className="section-title">Span currents &amp; loading</div>
      {groupByTx(design, res.poleResults, p => transformerOfPole(design, p.id)).map((g, gi) => (
        <div className="card" key={gi}>
          {g.tx && <p style={{ fontWeight: 600, marginTop: 0 }}>{g.tx.name || g.tx.id}</p>}
          <div className="tbl-wrap"><table>
            <thead><tr><th>Pole</th><th className="phaseA">I-A (A)</th><th className="phaseB">I-B (A)</th><th className="phaseC">I-C (A)</th><th>I-N (A)</th><th>Rating (A)</th><th>Max loading</th></tr></thead>
            <tbody>
              {g.items.map(p => {
                const maxPct = Math.max(p.condPct.A, p.condPct.B, p.condPct.C);
                const cls = maxPct > 100 ? 'bad' : maxPct > 85 ? 'warn' : 'ok';
                return (
                  <tr key={p.id}>
                    <td>{p.id}</td><td className="phaseA">{p.cur.A.toFixed(1)}</td><td className="phaseB">{p.cur.B.toFixed(1)}</td><td className="phaseC">{p.cur.C.toFixed(1)}</td>
                    <td>{p.In.toFixed(1)}</td><td>{p.rating}</td><td><span className={'pill ' + cls}>{maxPct.toFixed(0)}%</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      ))}

      {res.violations.length > 0 && (
        <>
          <div className="section-title">Violations detail</div>
          {groupByTx(design, res.violations, v => txOfViolation(design, v)).map((g, gi) => (
            g.items.length > 0 && (
              <div className="card" key={gi}>
                {g.tx && <p style={{ fontWeight: 600, marginTop: 0 }}>{g.tx.name || g.tx.id}</p>}
                <div className="tbl-wrap"><table>
                  <thead><tr><th>Location</th><th>Phase</th><th>Issue</th><th>Value</th></tr></thead>
                  <tbody>
                    {g.items.map((v, i) => (
                      <tr key={i}><td>{v.pole}</td><td>{v.phase}</td><td>{v.type}</td><td>{v.value.toFixed(1)}</td></tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            )
          ))}
        </>
      )}
    </div>
  );
}
