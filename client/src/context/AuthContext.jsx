import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';

const AuthContext = createContext(null);

// Offline start (P7.8): the field survey has to open with no network. The signed-in user (id and
// email only — no token; the session cookie stays httpOnly) is remembered in this browser, and when
// the server can't be reached at all (no HTTP status — not a 401) the app opens as that user,
// marked offline. The server still checks the real session on every request once back online.
const USER_KEY = 'fi.user';
const remember = (u) => { try { if (u) localStorage.setItem(USER_KEY, JSON.stringify({ id: u.id, email: u.email })); else localStorage.removeItem(USER_KEY); } catch { /* storage unavailable */ } };
const remembered = () => { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);

  const signedIn = useCallback((u) => { setUser(u); setOffline(false); remember(u); }, []);
  useEffect(() => {
    api.me().then(d => signedIn(d.user)).catch((e) => {
      const cached = e && e.status === undefined ? remembered() : null;
      if (cached) { setUser(cached); setOffline(true); } else { setUser(null); if (e && e.status === 401) remember(null); }
    }).finally(() => setLoading(false));
  }, [signedIn]);
  // Back online after an offline start: confirm the session with the server (a 401 then signs out
  // properly; unsynced field records stay on the device).
  useEffect(() => {
    if (!offline) return undefined;
    const recheck = () => api.me().then(d => signedIn(d.user)).catch((e) => { if (e && e.status === 401) { setUser(null); setOffline(false); remember(null); } });
    window.addEventListener('online', recheck);
    return () => window.removeEventListener('online', recheck);
  }, [offline, signedIn]);

  const login = useCallback(async (email, password) => {
    const d = await api.login(email, password);
    signedIn(d.user);
  }, [signedIn]);
  const register = useCallback(async (email, password) => {
    const d = await api.register(email, password);
    signedIn(d.user);
  }, [signedIn]);
  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null); remember(null);
  }, []);
  // "Log out everywhere" (P7.5): revokes every session of this account, this one included.
  const logoutAll = useCallback(async () => {
    await api.logoutAll().catch(() => {});
    setUser(null); remember(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, offline, loading, login, register, logout, logoutAll }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
