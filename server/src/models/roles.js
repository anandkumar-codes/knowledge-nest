import { db, now } from '../db.js';
import { PERMISSION_KEYS } from '../config/permissions.js';
import { HttpError } from '../utils/http.js';

const toRole = (row) =>
  row && {
    id: row.id,
    name: row.name,
    description: row.description,
    permissions: JSON.parse(row.permissions),
    memberCount: row.member_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

function clean({ name, description, permissions }, existing = {}) {
  const out = {
    name: name === undefined ? existing.name : String(name ?? '').trim(),
    description: description === undefined ? existing.description : String(description ?? '').trim(),
    permissions: permissions === undefined ? existing.permissions : permissions,
  };
  if (!out.name) throw new HttpError(400, 'Give the role a name.');
  if (out.name.length > 40) throw new HttpError(400, 'Role name must be 40 characters or fewer.');
  if (out.description.length > 200) throw new HttpError(400, 'Description must be 200 characters or fewer.');
  if (!Array.isArray(out.permissions)) throw new HttpError(400, 'Permissions must be a list.');
  if (out.permissions.some((p) => !PERMISSION_KEYS.includes(p))) {
    throw new HttpError(400, 'Unknown permission in list.');
  }
  out.permissions = [...new Set(out.permissions)];
  return out;
}

const SELECT = `
  SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS member_count
  FROM roles r`;

export const listRoles = () => db.prepare(`${SELECT} ORDER BY r.id`).all().map(toRole);

export const findRole = (id) => toRole(db.prepare(`${SELECT} WHERE r.id = ?`).get(id));

export const roleExists = (name) =>
  !!db.prepare('SELECT 1 FROM roles WHERE name_key = ?').get(String(name).trim().toLowerCase());

export function createRole(input, createdBy = null) {
  const r = clean(input, { description: '', permissions: [] });
  const ts = now();
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO roles (name, name_key, description, permissions, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(r.name, r.name.toLowerCase(), r.description, JSON.stringify(r.permissions), createdBy, ts, ts);
  return findRole(Number(lastInsertRowid));
}

export function updateRole(id, input) {
  const existing = findRole(id);
  const r = clean(input, existing);
  db.prepare(
    `UPDATE roles SET name = ?, name_key = ?, description = ?, permissions = ?, updated_at = ? WHERE id = ?`
  ).run(r.name, r.name.toLowerCase(), r.description, JSON.stringify(r.permissions), now(), id);
  return findRole(id);
}

export const deleteRole = (id) => db.prepare('DELETE FROM roles WHERE id = ?').run(id);
