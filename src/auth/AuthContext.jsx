import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { UNAUTHORIZED_EVENT } from '../api/client.js';
import * as authService from './authService.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setUser(await authService.fetchCurrentUser());
      setBootError('');
    } catch (err) {
      setBootError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => {
      authService.logout();
      setUser(null);
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refresh]);

  const value = useMemo(() => {
    const perms = new Set(user?.permissions ?? []);
    return {
      user,
      loading,
      bootError,
      refresh,
      // Replace the cached user, e.g. after changing your password.
      setCurrentUser: setUser,
      can: (...keys) => !!user && (user.isSuperAdmin || keys.some((k) => perms.has(k))),
      login: async (credentials) => {
        const u = await authService.login(credentials);
        setUser(u);
        return u;
      },
      logout: () => {
        authService.logout();
        setUser(null);
      },
    };
  }, [user, loading, bootError, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
