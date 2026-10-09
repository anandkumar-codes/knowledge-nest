import bcrypt from 'bcryptjs';
import { db, now } from '../db.js';
import { HttpError } from '../utils/http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Every query joins the role so callers always get `user.role.permissions`.
const SELECT = `
  SELECT u.*, r.name AS role_name, r.permissions AS role_permissions
  FROM users u LEFT JOIN roles r ON r.id = u.role_id`;

const toUser = (row) =>
  row && {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    isSuperAdmin: !!row.is_super_admin,
    status: row.status,
    mustChangePassword: !!row.must_change_password,
    passwordChangedAt: row.password_changed_at ?? null,
    role: row.role_id ? { id: row.role_id, name: row.role_name, permissions: JSON.parse(row.role_permissions) } : null,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };

function cleanName(name) {
  const n = String(name ?? '').trim();
  if (!n) throw new HttpError(400, 'Enter a name.');
  if (n.length > 80) throw new HttpError(400, 'Name must be 80 characters or fewer.');
  return n;
}

function checkPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'Password must be at least 8 characters.');
  }
  // bcrypt only uses the first 72 bytes, so anything longer would silently be cut.
  if (Buffer.byteLength(password) > 72) throw new HttpError(400, 'Password must be 72 characters or fewer.');
}

// Rule for passwords a person types (not generated ones): 8+ characters with a letter and a number.
export function checkChosenPassword(password, message = 'Use at least 8 characters, including a letter and a number.') {
  if (typeof password !== 'string' || password.length < 8 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
    throw new HttpError(400, message);
  }
}

// Unix seconds, the unit JWT `iat` uses.
export const nowSeconds = () => Math.floor(Date.now() / 1000);

export const findUser = (id) => toUser(db.prepare(`${SELECT} WHERE u.id = ?`).get(id));

export const findUserByEmail = (email) =>
  toUser(db.prepare(`${SELECT} WHERE u.email = ?`).get(String(email).trim().toLowerCase()));

export const findSuperAdmin = () => toUser(db.prepare(`${SELECT} WHERE u.is_super_admin = 1`).get());

export const listUsers = () =>
  db.prepare(`${SELECT} ORDER BY u.is_super_admin DESC, u.id`).all().map(toUser);

export async function createUser({
  name, email, password, roleId = null, isSuperAdmin = false, createdBy = null, mustChangePassword = false,
}) {
  const cleanEmail = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(cleanEmail)) throw new HttpError(400, 'Invalid email address.');
  checkPassword(password);
  const ts = now();
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO users (name, email, password_hash, is_super_admin, role_id, created_by, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      cleanName(name), cleanEmail, await bcrypt.hash(password, 12), isSuperAdmin ? 1 : 0, roleId, createdBy,
      mustChangePassword ? 1 : 0, ts, ts
    );
  return findUser(Number(lastInsertRowid));
}

export function updateUser(id, { name, roleId, status }) {
  const u = findUser(id);
  const next = {
    name: name === undefined ? u.name : cleanName(name),
    roleId: roleId === undefined ? (u.role?.id ?? null) : roleId,
    status: status === undefined ? u.status : status,
  };
  if (!['active', 'disabled'].includes(next.status)) throw new HttpError(400, 'Invalid status.');
  db.prepare('UPDATE users SET name = ?, role_id = ?, status = ?, updated_at = ? WHERE id = ?').run(
    next.name, next.roleId, next.status, now(), id
  );
  return findUser(id);
}

// `mustChange` is true when an admin sets the password, false when the user picks their own.
export async function setPassword(id, password, { mustChange }) {
  checkPassword(password);
  // Recording the change time signs out every session that was opened with the old password.
  db.prepare(
    'UPDATE users SET password_hash = ?, must_change_password = ?, password_changed_at = ?, updated_at = ? WHERE id = ?'
  ).run(await bcrypt.hash(password, 12), mustChange ? 1 : 0, nowSeconds(), now(), id);
}

// Compared against even when the account doesn't exist, so a wrong email takes as long as a wrong password.
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

export async function verifyPassword(user, plain) {
  const ok = await bcrypt.compare(String(plain ?? ''), user?.passwordHash ?? DUMMY_HASH);
  return !!user && ok;
}

export const touchLastLogin = (id) =>
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), id);

export const deleteUser = (id) => db.prepare('DELETE FROM users WHERE id = ?').run(id);
