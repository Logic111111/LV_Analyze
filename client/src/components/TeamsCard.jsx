import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

// Teams (P7.4): your organisations and role in each; an admin adds members (by the email they
// registered with), sets roles, removes members and reads the audit log. Roles: designer (edits,
// submits), reviewer (can reject), approver (approves or rejects — not their own submission),
// admin (all of that plus members and the audit log).
const ROLES = ['designer', 'reviewer', 'approver', 'admin'];

export default function TeamsCard({ onOrgsChange }) {
  const [orgs, setOrgs] = useState(null);
  const [sel, setSel] = useState(null);
  const [members, setMembers] = useState(null);
  const [audit, setAudit] = useState(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('designer');
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    try { const r = await api.listOrgs(); setOrgs(r.orgs); if (onOrgsChange) onOrgsChange(r.orgs); return r.orgs; }
    catch (e) { setMsg(e.message); return []; }
  }, [onOrgsChange]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    setMembers(null); setAudit(null);
    if (sel) api.listMembers(sel.id).then(r => setMembers(r.members)).catch(e => setMsg(e.message));
  }, [sel]);

  const run = async (fn, ok) => { setMsg(''); try { await fn(); setMsg(ok); } catch (e) { setMsg(e.message); } };
  async function create() {
    await run(async () => { const o = await api.createOrg(name.trim()); const list = await refresh(); setSel(list.find(x => x.id === o.id) || null); setName(''); }, `Created "${name.trim()}" — you are its admin.`);
  }
  async function addMember() {
    await run(async () => { await api.setMember(sel.id, email.trim(), role); setMembers((await api.listMembers(sel.id)).members); setEmail(''); }, `${email.trim()} is now ${role}.`);
  }
  async function remove(m) {
    if (!window.confirm(`Remove ${m.email} from ${sel.name}?`)) return;
    await run(async () => { await api.removeMember(sel.id, m.userId); setMembers((await api.listMembers(sel.id)).members); }, `Removed ${m.email}.`);
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Teams</h2>
      <p className="hint">Share a design with an organisation for review and approval. Designers edit and submit; reviewers can reject; approvers approve or reject (not their own submission); admins manage members and see the audit log.</p>
      {msg && <p className="hint" role="status">{msg}</p>}
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div style={{ minWidth: 0 }}>
          {!orgs ? <p className="hint">Loading…</p> : !orgs.length ? <p className="hint">You are not in any organisation yet.</p> : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {orgs.map(o => (
                <li key={o.id} style={{ marginBottom: 4 }}>
                  <button className={'mini' + (sel && sel.id === o.id ? ' on' : '')} aria-pressed={!!sel && sel.id === o.id} onClick={() => setSel(o)}>{o.name}</button> <span className="hint">{o.role}</span>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: 1, marginBottom: 0 }}><span>New organisation</span><input value={name} onChange={e => setName(e.target.value)} maxLength={255} /></label>
            <button className="ghost" onClick={create} disabled={!name.trim()}>Create organisation</button>
          </div>
        </div>
        {sel && (
          <div style={{ minWidth: 0 }}>
            <div className="section-title" style={{ marginTop: 0 }}>{sel.name} — members</div>
            {members && <div className="tbl-wrap"><table>
              <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col"></th></tr></thead>
              <tbody>{members.map(m => <tr key={m.userId}><td>{m.email}</td><td>{m.role}</td><td>{sel.role === 'admin' && <button className="mini" onClick={() => remove(m)} aria-label={`Remove ${m.email}`}>remove</button>}</td></tr>)}</tbody>
            </table></div>}
            {sel.role === 'admin' && (
              <>
                <div className="grid g2" style={{ marginTop: 8 }}>
                  <label className="field"><span>Member email</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
                  <label className="field"><span>Role</span><select value={role} onChange={e => setRole(e.target.value)}>{ROLES.map(r => <option key={r} value={r}>{r}</option>)}</select></label>
                </div>
                <button className="ghost" onClick={addMember} disabled={!email.trim()}>Add / change member</button>{' '}
                <button className="mini" onClick={() => run(async () => setAudit((await api.audit(sel.id)).audit), '')}>Audit log</button>
              </>
            )}
            {audit && (
              <div className="tbl-wrap" style={{ marginTop: 10 }}><table>
                <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Design / version</th><th scope="col">Detail</th></tr></thead>
                <tbody>{audit.map(x => <tr key={x.id}><td>{new Date(x.createdAt).toLocaleString()}</td><td>{x.by || '—'}</td><td>{x.action}</td><td>{x.designId ? `#${x.designId} v${x.version ?? '—'}` : '—'}</td><td style={{ whiteSpace: 'normal' }}>{x.detail ? JSON.stringify(x.detail) : ''}</td></tr>)}</tbody>
              </table></div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
