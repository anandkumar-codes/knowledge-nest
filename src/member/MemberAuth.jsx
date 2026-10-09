import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  MEMBER_UNAUTHORIZED_EVENT, getPortal, hasMemberSession, memberLogin, memberLogout,
} from '../api/memberPortal.js';

const MemberContext = createContext(null);

// Holds the signed-in member plus everything the portal shows (bookings, payments, claims).
export function MemberProvider({ children }) {
  const [portal, setPortal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!hasMemberSession()) {
      setPortal(null);
      setLoading(false);
      return;
    }
    try {
      setPortal(await getPortal());
      setError('');
    } catch (err) {
      if (err.status === 401) {
        memberLogout();
        setPortal(null);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => {
      memberLogout();
      setPortal(null);
    };
    window.addEventListener(MEMBER_UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(MEMBER_UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refresh]);

  const value = useMemo(
    () => ({
      portal,
      member: portal?.member ?? null,
      loading,
      error,
      refresh,
      login: async (credentials) => {
        await memberLogin(credentials);
        setLoading(true);
        await refresh();
      },
      logout: () => {
        memberLogout();
        setPortal(null);
      },
      setMember: (member) => setPortal((p) => (p ? { ...p, member } : p)),
    }),
    [portal, loading, error, refresh]
  );

  return <MemberContext.Provider value={value}>{children}</MemberContext.Provider>;
}

export const useMember = () => useContext(MemberContext);
