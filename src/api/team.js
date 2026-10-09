import { api } from './client.js';

export const listUsers = () => api('/users').then((d) => d.users);
export const createUser = (body) => api('/users', { method: 'POST', body });
export const updateUser = (id, body) => api(`/users/${id}`, { method: 'PATCH', body }).then((d) => d.user);
export const resetUserPassword = (id) => api(`/users/${id}/reset-password`, { method: 'POST' });
export const deleteUser = (id) => api(`/users/${id}`, { method: 'DELETE' });

export const listRoles = () => api('/roles').then((d) => d.roles);
export const listPermissions = () => api('/roles/permissions').then((d) => d.permissions);
export const createRole = (body) => api('/roles', { method: 'POST', body }).then((d) => d.role);
export const updateRole = (id, body) => api(`/roles/${id}`, { method: 'PATCH', body }).then((d) => d.role);
export const deleteRole = (id) => api(`/roles/${id}`, { method: 'DELETE' });

// Mirrors the server rule: you may only hand out access you hold yourself.
export const canGrant = (user, permissions) =>
  user.isSuperAdmin || permissions.every((p) => user.permissions.includes(p));

export function timeAgo(date) {
  if (!date) return 'Never';
  const s = Math.round((Date.now() - new Date(date)) / 1000);
  if (s < 60) return 'Just now';
  const units = [['minute', 60], ['hour', 3600], ['day', 86400], ['month', 2592000], ['year', 31536000]];
  let label = 'minute', size = 60;
  for (const [l, n] of units) if (s >= n) [label, size] = [l, n];
  const v = Math.floor(s / size);
  return `${v} ${label}${v > 1 ? 's' : ''} ago`;
}
