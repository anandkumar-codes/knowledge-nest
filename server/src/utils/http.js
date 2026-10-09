import { PERMISSION_KEYS } from '../config/permissions.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Route params arrive as strings; returns a positive integer id or null.
export function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export const permissionsOf = (user) =>
  user.isSuperAdmin ? [...PERMISSION_KEYS] : (user.role?.permissions ?? []);

// Shape returned to the client. Ids are sent as strings so they compare cleanly with form values.
export function toUserDTO(user) {
  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
    isSuperAdmin: user.isSuperAdmin,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    role: user.role ? { id: String(user.role.id), name: user.role.name } : null,
    permissions: permissionsOf(user),
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

export function toRoleDTO(role) {
  return {
    id: String(role.id),
    name: role.name,
    description: role.description,
    permissions: role.permissions,
    memberCount: role.memberCount,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

// Booking (seat allocation) as sent to the client.
export const allocationDTO = (a) => ({
  ...a,
  id: String(a.id),
  seatId: String(a.seatId),
  memberId: a.memberId ? String(a.memberId) : null,
});
