import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.me().then(d => setUser(d.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const d = await api.login(email, password);
    setUser(d.user);
  }, []);
  const register = useCallback(async (email, password) => {
    const d = await api.register(email, password);
    setUser(d.user);
  }, []);
  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    setUser(null);
  }, []);
  // "Log out everywhere" (P7.5): revokes every session of this account, this one included.
  const logoutAll = useCallback(async () => {
    await api.logoutAll().catch(() => {});
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, logoutAll }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
