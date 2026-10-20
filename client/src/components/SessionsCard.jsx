import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api.js';

// Sessions (P7.5): where this account is signed in. Each sign-in is a server-side session; logging
// out ends this one, "Log out everywhere" ends all of them at once (a lost laptop, a shared PC).
export default function SessionsCard() {
  const { logoutAll } = useAuth();
  const [sessions, setSessions] = useState(null);
  const [msg, setMsg] = useState('');
  const load = () => api.sessions().then(r => setSessions(r.sessions)).catch(e => setMsg(e.message));
  useEffect(() => { load(); }, []);
  async function everywhere() {
    if (!window.confirm('Sign out on every device, including this one?')) return;
    await logoutAll();
  }
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Sessions</h2>
      <p className="hint">Devices where this account is signed in. Sessions last 7 days unless ended earlier.</p>
      {msg && <p className="hint" role="alert">{msg}</p>}
      {sessions && (
        <div className="tbl-wrap"><table>
          <thead><tr><th scope="col">Signed in</th><th scope="col">Expires</th><th scope="col">Browser</th><th scope="col"></th></tr></thead>
          <tbody>{sessions.map((s, i) => (
            <tr key={i}><td>{new Date(s.createdAt).toLocaleString()}</td><td>{new Date(s.expiresAt).toLocaleString()}</td>
              <td style={{ whiteSpace: 'normal', maxWidth: 360 }}>{s.userAgent || '—'}</td><td>{s.current ? <b>this session</b> : ''}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <button className="mini" style={{ marginTop: 8 }} onClick={load}>Refresh</button>{' '}
      <button className="ghost" style={{ marginTop: 8 }} onClick={everywhere}>Log out everywhere</button>
    </div>
  );
}
