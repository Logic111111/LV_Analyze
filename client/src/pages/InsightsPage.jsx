import { useMemo, useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { api } from '../api.js';
import { applyPatch, describePatch, runSnapshotAt } from '../lib/loadflow.js';
import SldPreview from '../components/SldPreview.jsx';
import { ConvergenceWarning } from '../components/Convergence.jsx';

// AI Insights (P7.7): the server runs a tool loop — the model asks for load flows, scans and
// advisors, which the server runs on this design with the same engine — and writes a brief from
// those results. Every tool it ran is listed. Changes it suggests come back as proposals that open
// in the usual before/after preview; nothing is applied or saved unless the engineer does it.
const TOOL_LABEL = {
  run_snapshot: 'Load flow (one hour)', run_daily_scan: '24 h scan', propose_phase_balance: 'Phase balance',
  tap_advisor: 'Tap advisor', reconductor_advisor: 'Reconductor advisor', fault_levels: 'Fault levels', hosting_capacity: 'PV hosting capacity'
};
const inputText = (input) => Object.entries(input || {}).map(([k, v]) => `${k} ${v}`).join(', ');

export default function InsightsPage() {
  const { design } = useDesign();
  const [question, setQuestion] = useState('');
  const [out, setOut] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null); // { proposal, design }

  async function getInsights() {
    setBusy(true); setError(''); setOut(null); setPreview(null);
    try { setOut(await api.aiInsights({ design, question: question.trim() || undefined })); }
    catch (e) { setError('AI request failed: ' + e.message); }
    finally { setBusy(false); }
  }
  const previewSnapshot = useMemo(() => (preview ? runSnapshotAt(preview.design, { year: 0, hour: 20, loadMult: 1, solarMult: 1 }) : null), [preview]);

  return (
    <div className="card">
      <h2>AI engineering insights</h2>
      <p className="hint">Claude reviews this design using the app's own engine: it runs load flows, the 24 h scan and the advisors on the server, and writes a brief from those results. The tools it ran are listed under the brief. Suggested changes open as previews — nothing is applied or saved.</p>
      <label className="field"><span>Question (optional)</span>
        <textarea rows={2} value={question} maxLength={1000} onChange={e => setQuestion(e.target.value)} placeholder="e.g. Why is P3 low in the evening, and what is the cheapest fix?" style={{ width: '100%', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }} /></label>
      <button className="primary" onClick={getInsights} disabled={busy}>Get AI insights</button>
      {busy && <span className="loading" role="status" style={{ marginLeft: 12 }}><span className="spinner"></span> running tools and thinking — this can take a minute…</span>}
      {error && <p className="hint" role="alert">{error}</p>}
      {!out && !busy && !error && <div className="note" style={{ marginTop: 16 }}>No insights generated yet.</div>}
      {out && (
        <>
          <div className="note" style={{ marginTop: 16, whiteSpace: 'pre-wrap' }}>{out.text}</div>
          {out.stopReason === 'max_rounds' && <p className="hint">The model used its 8 rounds of tool calls before finishing.</p>}
          <div className="section-title">Tools run ({(out.toolsRun || []).length})</div>
          {!(out.toolsRun || []).length ? <p className="hint">None — the brief above is not based on any computed result.</p> : (
            <div className="tbl-wrap"><table>
              <thead><tr><th scope="col">#</th><th scope="col">Tool</th><th scope="col">Input</th><th scope="col">Time</th><th scope="col">Result</th></tr></thead>
              <tbody>{(out.toolsRun || []).map((t, i) => (
                <tr key={i}><td>{i + 1}</td><td>{TOOL_LABEL[t.name] || t.name}</td><td>{inputText(t.input) || '—'}</td><td>{(t.ms / 1000).toFixed(1)} s</td>
                  <td style={{ whiteSpace: 'normal' }}>{t.ok ? (t.proposalId ? <>ok · proposal <b>{t.proposalId}</b></> : 'ok') : <span className="pill bad">{t.error}</span>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          {(out.proposals || []).length > 0 && (
            <>
              <div className="section-title">Proposals</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {out.proposals.map(p => (
                  <li key={p.id} style={{ marginBottom: 8 }}>
                    <b>{p.id}</b> {p.title} <span className="hint">— {p.summary} ({describePatch(p.patch)})</span>{' '}
                    <button className="mini" onClick={() => setPreview({ proposal: p, design: applyPatch(design, p.patch) })} aria-label={`Preview proposal ${p.id} in the app`}>Preview in app</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="hint">Model: {out.model} · {out.rounds} round{out.rounds === 1 ? '' : 's'} of tool calls.</p>
        </>
      )}
      {preview && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0 }}>Preview — {preview.proposal.id}: {preview.proposal.title}</h2>
            <button className="mini" onClick={() => setPreview(null)}>Discard preview</button>
          </div>
          {previewSnapshot && <p><span className={'pill ' + (previewSnapshot.violations.length ? 'bad' : 'ok')}>{previewSnapshot.violations.length} violation{previewSnapshot.violations.length === 1 ? '' : 's'} at 20:00</span></p>}
          <ConvergenceWarning show={!!previewSnapshot && !previewSnapshot.converged}>The preview load flow at 20:00 did not converge — the diagram may be inaccurate.</ConvergenceWarning>
          {previewSnapshot && <SldPreview design={preview.design} before={design} res={previewSnapshot} label={`AI proposal ${preview.proposal.id}`} />}
        </div>
      )}
    </div>
  );
}
