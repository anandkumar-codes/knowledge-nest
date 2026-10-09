import { api, clearToken, getToken, replaceToken, setToken } from '../api/client.js';

export async function login({ email, password, remember }) {
  const { token, user } = await api('/auth/login', {
    method: 'POST',
    body: { email: email.trim(), password, remember },
  });
  setToken(token, remember);
  return user;
}

export function logout() {
  clearToken();
}

// Returns the signed-in user, or null if there's no valid session.
export async function fetchCurrentUser() {
  if (!getToken()) return null;
  try {
    const { user } = await api('/auth/me');
    return user;
  } catch (err) {
    if (err.status === 401) clearToken();
    else throw err;
    return null;
  }
}

// Resolves to the updated user (with mustChangePassword cleared). The server signs out other sessions
// and hands this one a fresh token.
export async function changePassword(currentPassword, newPassword) {
  const { token, user } = await api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
  replaceToken(token);
  return user;
}
