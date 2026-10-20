import { useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { applyPhaseBalance, runSnapshot, DAILY_HOURS } from '../lib/loadflow.js';
import { buildDiagramSVG } from '../lib/diagram.js';
import { ConvergenceWarning } from '../components/Convergence.jsx';
import { txCurrentSummary } from '../lib/format.js';
import TaskProgress from '../components/TaskProgress.jsx';
import { useEngineTask } from '../hooks/useEngineTask.js';

function testOptsFor(testMode) {
  if (testMode === 'solarPeak') return { hours: [12], solarMult: 1, periodLabel: 'at 12:00 (solar peak)' };
  if (testMode === 'nightPeak') return { hours: [20], solarMult: 0, periodLabel: 'at 20:00 (night peak)' };
  return { hours: DAILY_HOURS, solarMult: 1, periodLabel: 'across 24h' };
}

function txSummary(transformers, key, unit, decimals = 0) {
  if (!transformers || !transformers.length) return '—';
  return transformers.map(t => `${t.name || t.id} ${t[key].toFixed(decimals)}${unit}`).join(' / ');
}
function txVoltageBand(transformers) {
  if (!transformers || !transformers.length) return '—';
  return transformers.map(t => `${t.name || t.id} ${t.minVPct.toFixed(0)}–${t.maxVPct.toFixed(0)}V`).join(' / ');
}

const KIND_LABEL = { load: 'load', pv: 'PV', bess: 'BESS' };

export default function LoadBalancePage() {
  const { design, setDesign } = useDesign();
  const { theme } = useTheme();

  const [txId, setTxId] = useState(design.transformers[0]?.id || '');
  const [testMode, setTestMode] = useState('daily');
  const [proposal, setProposal] = useState(null); // { items, before, after, changed, beforeMetrics, afterMetrics, periodLabel, balancedDesign }
  const task = useEngineTask();
  const [preview, setPreview] = useState(null); // { design }
  const [applied, setApplied] = useState(null);

  // The proposal plus its before/after scans run in the engine worker, with progress and Cancel.
  async function runPropose() {
    if (!txId) { alert('Add a transformer first, on the Setup page.'); return; }
    const { hours, solarMult, periodLabel } = testOptsFor(testMode);
    const r = await task.run('phaseBalance', { design, txId, hours, solarMult }, 'Proposing a phase balance');
    if (!r.ok) return;
    setProposal({ ...r.result, periodLabel });
    setPreview(null); setApplied(null);
  }

  function openPreview() { setPreview({ design: proposal.balancedDesign }); }

  function applyBalance() {
    setDesign(d => applyPhaseBalance(d, proposal.changed));
    setApplied(`Rebalanced ${proposal.changed.length} connection${proposal.changed.length === 1 ? '' : 's'} on ${txId}.`);
    setPreview(null);
    setProposal(null);
  }

  const previewSnapshot = preview ? runSnapshot(preview.design, { year: 0, hour: 20, loadMult: 1, solarMult: 1 }) : null;
  const previewSvg = previewSnapshot ? buildDiagramSVG(preview.design, previewSnapshot, theme) : null;

  return (
    <div>
      <div className="card">
        <h2>Load balance advisor</h2>
        <p className="hint">Improves pole-level voltage within one transformer by rebalancing which phase (A/B/C) each single-phase load, PV and BESS connection sits on — no topology change, unlike Feeder Split. Concentrating load or generation onto one phase drives that phase's own peak condition further from nominal; spreading connections more evenly narrows the voltage spread and reduces neutral current.</p>
        <div className="grid g3">
          <label className="field"><span>Transformer</span>
            <select value={txId} onChange={e => setTxId(e.target.value)}>
              {design.transformers.map(t => <option key={t.id} value={t.id}>{t.name || t.id} ({t.id})</option>)}
            </select>
          </label>
        </div>

        <div className="section-title" style={{ marginTop: 14 }}>Test conditions</div>
        <div className="grid g3">
          <label className="chk"><input type="radio" name="lbTestMode" checked={testMode === 'daily'} onChange={() => setTestMode('daily')} /> Full 24-hour scan</label>
          <label className="chk"><input type="radio" name="lbTestMode" checked={testMode === 'solarPeak'} onChange={() => setTestMode('solarPeak')} /> Solar peak only (12:00)</label>
          <label className="chk"><input type="radio" name="lbTestMode" checked={testMode === 'nightPeak'} onChange={() => setTestMode('nightPeak')} /> Night peak only (20:00)</label>
        </div>

        <button className="primary" onClick={runPropose} disabled={task.running} style={{ marginTop: 8 }}>Propose balance</button>
        <TaskProgress task={task} />
      </div>

      {applied && (
        <div className="note" style={{ marginTop: 14 }}>Applied — {applied} Review on Network, Setup or Diagram.</div>
      )}

      {proposal && !preview && (
        <div style={{ marginTop: 18 }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontWeight: 600 }}>Before → after, {proposal.periodLabel}</span>
              <span className={'pill ' + (proposal.afterMetrics.voltageViolationCount < proposal.beforeMetrics.voltageViolationCount ? 'ok' : proposal.afterMetrics.voltageViolationCount > proposal.beforeMetrics.voltageViolationCount ? 'bad' : 'warn')}>
                {proposal.beforeMetrics.voltageViolationCount} → {proposal.afterMetrics.voltageViolationCount} voltage violations
              </span>
            </div>
            <p className="hint" style={{ marginBottom: 4 }}>
              Per-phase connected kVA — before: A {proposal.before.A.toFixed(1)} / B {proposal.before.B.toFixed(1)} / C {proposal.before.C.toFixed(1)} ·
              {' '}after: A {proposal.after.A.toFixed(1)} / B {proposal.after.B.toFixed(1)} / C {proposal.after.C.toFixed(1)}
            </p>
            <p className="hint" style={{ marginBottom: 4 }}>Tx loading — before: {txSummary(proposal.beforeMetrics.transformers, 'peakPct', '%')} · after: {txSummary(proposal.afterMetrics.transformers, 'peakPct', '%')}</p>
            <p className="hint" style={{ marginBottom: 4 }}>Tx max phase current — before: {txCurrentSummary(proposal.beforeMetrics.transformers)} · after: {txCurrentSummary(proposal.afterMetrics.transformers)}</p>
            <p className="hint" style={{ marginBottom: 0 }}>Tx bus voltage — before: {txVoltageBand(proposal.beforeMetrics.transformers)} · after: {txVoltageBand(proposal.afterMetrics.transformers)}</p>
            <ConvergenceWarning show={!proposal.beforeMetrics.converged || !proposal.afterMetrics.converged}>
              One or more scanned hours did not converge ({!proposal.beforeMetrics.converged ? 'before' : ''}{!proposal.beforeMetrics.converged && !proposal.afterMetrics.converged ? ' and ' : ''}{!proposal.afterMetrics.converged ? 'after' : ''} rebalancing) — treat the comparison with caution.
            </ConvergenceWarning>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            {proposal.changed.length === 0 ? (
              <div className="empty">Already balanced — no phase changes proposed for this transformer.</div>
            ) : (
              <>
                <p className="hint">{proposal.changed.length} connection{proposal.changed.length === 1 ? '' : 's'} proposed to move to a different phase.</p>
                <div className="tbl-wrap"><table>
                  <thead><tr><th>Pole</th><th>Connection</th><th>kVA</th><th>Current phase</th><th>Proposed phase</th></tr></thead>
                  <tbody>
                    {proposal.changed.map(c => (
                      <tr key={c.kind + c.id}>
                        <td>{c.pole}</td><td>{KIND_LABEL[c.kind] || c.kind}{c.kind === 'load' ? ` (${c.label})` : ''}</td>
                        <td>{c.kva.toFixed(2)}</td>
                        <td className={'phase' + c.phase}>{c.phase}</td>
                        <td className={'phase' + c.newPhase}>{c.newPhase}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                <button className="mini" onClick={openPreview} style={{ marginTop: 10 }}>Preview</button>
              </>
            )}
          </div>
        </div>
      )}

      {preview && (
        <div className="card" style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>Preview — rebalanced phases</h2>
            <span>
              <button className="primary" onClick={applyBalance}>Apply this design</button>{' '}
              <button className="mini" onClick={() => setPreview(null)}>Discard preview</button>
            </span>
          </div>
          <p className="hint">Shown at night-peak conditions (20:00, nominal load, no solar) — after applying, use the Diagram page for full hour-by-hour and scenario control.</p>
          {previewSnapshot && (
            <p><span className={'pill ' + (previewSnapshot.violations.length ? 'bad' : 'ok')}>{previewSnapshot.violations.length} violation{previewSnapshot.violations.length === 1 ? '' : 's'} at 20:00</span></p>
          )}
          <ConvergenceWarning show={!!previewSnapshot && !previewSnapshot.converged}>
            The preview load flow at 20:00 did not converge ({previewSnapshot?.iterUsed} iterations) — the diagram below may be inaccurate.
          </ConvergenceWarning>
          {previewSvg && <div className="diagram" dangerouslySetInnerHTML={{ __html: previewSvg }} />}
        </div>
      )}
    </div>
  );
}
