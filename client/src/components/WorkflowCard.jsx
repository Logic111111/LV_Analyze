import { useEffect, useState } from 'react';
import { useDesign } from '../context/DesignContext.jsx';
import { api } from '../api.js';

// Sharing and the approval workflow for the loaded design (P7.4): draft → submitted → approved or
// rejected, every step with a mandatory comment. The buttons shown follow the user's role and the
// design's status; the server checks the same rules (src/access.js) on every request.
const STATUS_PILL = { draft: '', submitted: 'warn', approved: 'ok', rejected: 'bad' };

export default function WorkflowCard({ orgs }) {
  const { designId, designMeta, setDesignMeta } = useDesign();
  const [comment, setComment] = useState('');
  const [reviews, setReviews] = useState([]);
  const [shareTo, setShareTo] = useState('');
  const [msg, setMsg] = useState('');

  const reload = async () => {
    const d = await api.getDesign(designId);
    setDesignMeta(d.meta || null);
    setReviews((await api.reviews(designId)).reviews);
  };
  useEffect(() => {
    setReviews([]); setMsg('');
    if (designId) api.reviews(designId).then(r => setReviews(r.reviews)).catch(() => {});
  }, [designId]);
  useEffect(() => { setShareTo(designMeta && designMeta.orgId ? String(designMeta.orgId) : ''); }, [designMeta]);

  if (!designId || !designMeta) return null;
  const m = designMeta;
  const role = m.role;
  const act = async (action, label) => {
    setMsg('');
    try { await api.workflow(designId, action, comment); setComment(''); await reload(); setMsg(label); }
    catch (e) { setMsg(e.message); }
  };
  const share = async () => {
    setMsg('');
    try { await api.shareDesign(designId, shareTo ? Number(shareTo) : null); await reload(); setMsg(shareTo ? `Shared with ${(orgs || []).find(o => String(o.id) === shareTo)?.name || 'the organisation'}.` : 'No longer shared.'); }
    catch (e) { setMsg(e.message); }
  };
  const canSubmit = m.canEdit && !!m.orgId && ['draft', 'rejected'].includes(m.status);
  const canReject = m.status === 'submitted' && ['reviewer', 'approver', 'admin'].includes(role);
  const canApprove = m.status === 'submitted' && ['approver', 'admin'].includes(role);

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Review and approval</h2>
      <p>Status: <span className={'pill ' + STATUS_PILL[m.status]}>{m.status}</span>
        {m.lockedVersion ? <> · approved version <b>{m.lockedVersion}</b> is locked{m.currentVersion !== m.lockedVersion ? ` (you are on draft version ${m.currentVersion})` : ''}</> : null}
        {' '}· {m.own ? 'your design' : `owned by ${m.ownerEmail}`}{m.orgName ? ` · Shared with ${m.orgName}` : ' · not shared'}{role ? ` · your role: ${role}` : ''}</p>
      {m.own && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="field" style={{ marginBottom: 0 }}><span>Share with</span>
            <select value={shareTo} onChange={e => setShareTo(e.target.value)}>
              <option value="">Not shared</option>
              {(orgs || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select></label>
          <button className="ghost" onClick={share} disabled={shareTo === (m.orgId ? String(m.orgId) : '')}>Share</button>
        </div>
      )}
      {(canSubmit || canReject || canApprove) && (
        <>
          <label className="field" style={{ marginTop: 10 }}><span>Comment (required)</span>
            <textarea rows={2} value={comment} maxLength={2000} onChange={e => setComment(e.target.value)} style={{ width: '100%', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line)', borderRadius: 8, padding: 8 }} /></label>
          {canSubmit && <button className="primary" onClick={() => act('submit', 'Submitted for review.')} disabled={!comment.trim()}>Submit for review</button>}{' '}
          {canApprove && <button className="primary" onClick={() => act('approve', 'Approved — this version is now locked.')} disabled={!comment.trim()}>Approve</button>}{' '}
          {canReject && <button className="ghost" onClick={() => act('reject', 'Rejected — the designer can revise and resubmit.')} disabled={!comment.trim()}>Reject</button>}
        </>
      )}
      {m.status === 'submitted' && !canReject && <p className="hint">Under review — the design can't be changed until it is approved or rejected.</p>}
      {!m.orgId && m.own && <p className="hint">Share the design with an organisation to submit it for review.</p>}
      {msg && <p className="hint" role="status">{msg}</p>}
      {reviews.length > 0 && (
        <div className="tbl-wrap" style={{ marginTop: 10 }}><table>
          <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Version</th><th scope="col">Comment</th></tr></thead>
          <tbody>{reviews.map((r, i) => <tr key={i}><td>{new Date(r.createdAt).toLocaleString()}</td><td>{r.by || '—'}</td><td>{r.action}</td><td>{r.version}</td><td style={{ whiteSpace: 'normal' }}>{r.comment}</td></tr>)}</tbody>
        </table></div>
      )}
    </div>
  );
}
