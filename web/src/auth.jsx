import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const refresh = useCallback(() => api('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null)), []);
  useEffect(() => { refresh(); }, [refresh]);
  const logout = async () => { await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {}); setUser(null); };
  return <Ctx.Provider value={{ user, refresh, logout }}>{children}</Ctx.Provider>;
}
