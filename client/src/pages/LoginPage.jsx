import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      await login(email, password);
      nav('/app/setup');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="authwrap">
      <div className="brand" style={{ marginBottom: 24, justifyContent: 'center' }}>
        <div className="mark"></div>
        <h1 style={{ fontSize: 18 }}>Feeder Island</h1>
      </div>
      <div className="card">
        <h2>Sign in</h2>
        {error && <div className="error-banner">{error}</div>}
        <form onSubmit={onSubmit}>
          <label className="field"><span>Email</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </label>
          <label className="field"><span>Password</span>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </label>
          <button className="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="hint" style={{ marginTop: 14 }}>
          No account yet? <Link to="/register">Create one</Link>
        </p>
      </div>
    </div>
  );
}
