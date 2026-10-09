import jwt from 'jsonwebtoken';
import { findUser } from '../models/users.js';
import { HttpError, parseId, permissionsOf } from '../utils/http.js';

const PASSWORD_CHANGE_ROUTES = new Set(['/api/auth/me', '/api/auth/change-password']);

export async function authenticate(req, _res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Please sign in.');

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Your session has expired. Please sign in again.');
  }

  // Re-read the user each request so role changes and disabling take effect immediately.
  if (payload.kind === 'member') throw new HttpError(401, 'Please sign in.'); // member portal token
  const id = parseId(payload.sub);
  const user = id && (await findUser(id));
  if (!user || user.status !== 'active') {
    throw new HttpError(401, 'Your account is no longer active.');
  }
  // Sessions opened before the latest password change (by the user or an admin reset) no longer count.
  if (user.passwordChangedAt && payload.iat < user.passwordChangedAt) {
    throw new HttpError(401, 'Your password was changed. Please sign in again.');
  }

  // Until someone replaces an admin-issued password, they may only read their profile and change it.
  if (user.mustChangePassword && !PASSWORD_CHANGE_ROUTES.has(req.baseUrl + req.path)) {
    throw new HttpError(403, 'Please choose a new password before continuing.');
  }

  req.user = user;
  req.auth = payload;
  req.permissions = new Set(permissionsOf(user));
  next();
}

// Passes if the user holds ANY of the listed permissions.
export const requirePermission = (...perms) => (req, _res, next) => {
  if (req.user.isSuperAdmin || perms.some((p) => req.permissions.has(p))) return next();
  throw new HttpError(403, "You don't have permission to do that.");
};

export const requireSuperAdmin = (req, _res, next) => {
  if (req.user.isSuperAdmin) return next();
  throw new HttpError(403, 'Only the super admin can do that.');
};
