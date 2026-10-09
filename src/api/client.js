// Same-origin on the website; the Android app is built with the server's address (VITE_API_BASE).
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * A session-aware API client. Staff and members each get their own client with a separate
 * stored token, so one browser can hold both sessions without mixing them up.
 */
export function createClient({ storageKey, unauthorizedEvent, loginPath }) {
  const getToken = () => {
    try {
      return localStorage.getItem(storageKey) ?? sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  };
  const clearToken = () => {
    try {
      localStorage.removeItem(storageKey);
      sessionStorage.removeItem(storageKey);
    } catch {
      /* storage blocked: nothing stored */
    }
  };
  const setToken = (token, remember) => {
    clearToken();
    try {
      (remember ? localStorage : sessionStorage).setItem(storageKey, token);
    } catch {
      /* storage blocked: the session lasts until the page closes */
    }
  };
  // Swap in a new token (e.g. after a password change), keeping the "keep me signed in" choice.
  const replaceToken = (token) => {
    if (!token) return;
    let remembered = false;
    try {
      remembered = localStorage.getItem(storageKey) !== null;
    } catch {
      /* storage blocked */
    }
    setToken(token, remembered);
  };

  async function api(path, { method = 'GET', body } = {}) {
    const token = getToken();
    let res;
    try {
      res = await fetch(`${API_BASE}/api${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, "Can't reach the server. Check that the API is running.");
    }

    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401 && token && path !== loginPath) {
        window.dispatchEvent(new Event(unauthorizedEvent));
      }
      const fallback = res.status >= 500 || !data ? "Can't reach the server. Check that the API is running." : 'Request failed.';
      throw new ApiError(res.status, data?.error ?? fallback);
    }
    return data;
  }

  return { api, getToken, setToken, replaceToken, clearToken };
}

// Fired when the server rejects our token so the app can drop back to the login screen.
export const UNAUTHORIZED_EVENT = 'kn:unauthorized';

const staff = createClient({ storageKey: 'kn_admin_session', unauthorizedEvent: UNAUTHORIZED_EVENT, loginPath: '/auth/login' });
export const { api, getToken, setToken, replaceToken, clearToken } = staff;
