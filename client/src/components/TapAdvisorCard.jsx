import { useMemo, useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { runSnapshotAt } from '../lib/loadflow.js';
import SldPreview from './SldPreview.jsx';
import TaskProgress from './TaskProgress.jsx';
import { ConvergenceWarning } from './Convergence.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';

// Tap advisor (P2.4): scans every off-load tap position over the full day for each checked year,
// ranks them, and explains when no position can clear every violation. Runs in the engine worker.
const hh = (h) => String(h).padStart(2, '0') + ':00';
const where = (x) => `${x.value.toFixed(1)} V (${x.pole} ${x.phase}, ${hh(x.hour)}, yr ${x.year})`;

export function tapStatus(result, t) {
  const best = result.ranked[0];
  if (t.tap === result.recommendedTap) return { label: 'Recommended', cls: 'ok' };
  if (t.totalViolations > best.totalViolations) return { label: `Rejected — ${t.totalViolations} violation${t.totalViolations === 1 ? '' : 's'}`, cls: 'bad' };
  return { label: 'Acceptable — smaller margin or more loss', cls: 'warn' };
}

export default function TapAdvisorCard() {
  const { design, setDesign, setLastTapAdvice } = useDesign();
  const [txId, setTxId] = useState(design.transformers[0]?.id || '');
  const [horizon, setHorizon] = useState(5);
  const [result, setResult] = useState(null);
  const [previewTap, setPreviewTap] = useState(null);
  const [applied, setApplied] = useState('');
  const task = useEngineTask();

  async function run() {
    setApplied(''); setPreviewTap(null);
    const r = await task.run('tapAdvisor', { design, txId, horizon: Math.max(0, Math.round(Number(horizon) || 0)) }, 'Scanning tap positions');
    if (!r.ok) return;
    setResult(r.result);
    setLastTapAdvice(r.result);
  }
  function apply(tap) {
    setDesign(d => ({ ...d, transformers: d.transformers.map(t => (t.id === result.txId ? { ...t, tap } : t)) }));
    setApplied(`${result.txId} set to tap ${tap}. This is an off-load change — it needs an outage on site.`);
    setPreviewTap(null);
  }

  const preview = useMemo(() => {
    if (!result || previewTap == null) return null;
    const t = result.byTap.find(x => x.tap === previewTap);
    const d = { ...design, transformers: design.transformers.map(x => (x.id === result.txId ? { ...x, tap: previewTap } : x)) };
    return { t, d, res: runSnapshotAt(d, { year: t.minV.year, hour: t.minV.hour, loadMult: 1, solarMult: 1 }) };
  }, [design, result, previewTap]);

  return (
    <div className="card">
      <h2>Tap advisor</h2>
      <p className="hint">
        Scans every tap position over the full day for each checked year and ranks them: fewest voltage violations, then the widest worst-case margin to the band, then the lowest energy loss.
        <b> These are off-load taps</b> — one position for every hour of every day, and changing it needs an outage — so the chosen position must work at both the evening peak and the midday solar peak.
      </p>
      <div className="grid g3">
        {design.transformers.length > 1 && (
          <label className="field"><span>Transformer</span>
            <select value={txId} onChange={e => setTxId(e.target.value)}>
              {design.transformers.map(t => <option key={t.id} value={t.id}>{t.name || t.id} (tap {t.tap})</option>)}
            </select></label>
        )}
        <label className="field"><span>Check years 0 and … (growth horizon)</span>
          <input type="number" min={0} max={30} step={1} value={horizon} onChange={e => setHorizon(e.target.value)} /></label>
      </div>
      <button className="primary" onClick={run} disabled={task.running || !txId}>Compare tap positions</button>
      <TaskProgress task={task} />
      {applied && <div className="note" style={{ marginTop: 12 }}>{applied}</div>}

      {result && (
        <div style={{ marginTop: 14 }}>
          <ConvergenceWarning show={result.byTap.some(t => !t.converged)}>One or more scanned hours did not converge — treat those taps' figures with caution.</ConvergenceWarning>
          {result.diagnosis && <div className="note" role="status" style={{ borderColor: 'var(--warn)' }}><b>No tap clears every violation.</b> {result.diagnosis.message}</div>}
          <div className="tbl-wrap"><table>
            <thead><tr>
              <th>Tap</th><th>HV winding</th><th>No-load LV</th>
              {result.years.map(y => <th key={y}>Violations yr {y}</th>)}
              <th>Lowest V</th><th>Highest V</th><th>Worst margin</th><th>Loss yr {result.years[0]} (kWh/day)</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {result.byTap.map(t => {
                const st = tapStatus(result, t);
                return (
                  <tr key={t.tap}>
                    <td>{t.tap}{t.tap === result.currentTap ? ' (current)' : ''}</td>
                    <td>{t.hvWindingV} V</td><td>{t.noLoadV.toFixed(1)} V</td>
                    {result.years.map(y => <td key={y}><span className={'pill ' + (t.violationsByYear[y] ? 'bad' : 'ok')}>{t.violationsByYear[y]}</span></td>)}
                    <td>{where(t.minV)}</td><td>{where(t.maxV)}</td>
                    <td style={{ color: t.marginV < 0 ? 'var(--bad)' : undefined }}>{t.marginV.toFixed(2)} V</td>
                    <td>{t.kwhYear0.toFixed(2)}</td>
                    <td><span className={'pill ' + st.cls}>{st.label}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="mini" onClick={() => setPreviewTap(t.tap)}>Preview</button>{' '}
                      {t.tap !== result.currentTap && <button className="mini" onClick={() => apply(t.tap)}>Apply</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          <p className="hint" style={{ marginTop: 8 }}>Band {result.vLow.toFixed(1)}–{result.vHigh.toFixed(1)} V. Margin = the smallest distance to the nearer limit over every pole, phase, hour and checked year (negative means outside the band). Violations count pole-phase-hours outside the band on this transformer.</p>
        </div>
      )}

      {preview && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <b>Preview — tap {preview.t.tap} at its lowest-voltage hour ({hh(preview.t.minV.hour)}, year {preview.t.minV.year})</b>
            <span>
              {preview.t.tap !== result.currentTap && <button className="primary" onClick={() => apply(preview.t.tap)}>Apply tap {preview.t.tap}</button>}{' '}
              <button className="mini" onClick={() => setPreviewTap(null)}>Close preview</button>
            </span>
          </div>
          <p><span className={'pill ' + (preview.res.violations.length ? 'bad' : 'ok')}>{preview.res.violations.length} violation{preview.res.violations.length === 1 ? '' : 's'} at that hour</span></p>
          <ConvergenceWarning show={!preview.res.converged}>The preview load flow did not converge — the diagram may be inaccurate.</ConvergenceWarning>
          <SldPreview design={preview.d} before={design} res={preview.res} label={`Tap ${preview.t.tap} preview`} />
        </div>
      )}
    </div>
  );
}
