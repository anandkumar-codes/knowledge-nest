import { Router } from 'express';
import { PERMISSIONS } from '../config/permissions.js';
import { createRole, deleteRole, findRole, listRoles, updateRole } from '../models/roles.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { HttpError, parseId, toRoleDTO } from '../utils/http.js';

const router = Router();
router.use(authenticate);

// A non-super-admin may only create/edit roles whose permissions they hold themselves,
// so nobody can grant (or strip) more access than they have.
export function assertCanGrant(req, permissions) {
  if (req.user.isSuperAdmin) return;
  const missing = permissions.filter((p) => !req.permissions.has(p));
  if (missing.length) {
    throw new HttpError(403, `You can't grant permissions you don't have: ${missing.join(', ')}.`);
  }
}

async function loadRole(idParam) {
  const id = parseId(idParam);
  const role = id && (await findRole(id));
  if (!role) throw new HttpError(404, 'Role not found.');
  return role;
}

router.get('/permissions', (_req, res) => {
  res.json({ permissions: PERMISSIONS });
});

router.get('/', requirePermission('team.view', 'team.manage', 'roles.manage'), async (_req, res) => {
  res.json({ roles: (await listRoles()).map(toRoleDTO) });
});

router.post('/', requirePermission('roles.manage'), async (req, res) => {
  const { name, description = '', permissions = [] } = req.body ?? {};
  if (!Array.isArray(permissions)) throw new HttpError(400, 'Permissions must be a list.');
  assertCanGrant(req, permissions);
  res.status(201).json({ role: toRoleDTO(await createRole({ name, description, permissions }, req.user.id)) });
});

router.patch('/:id', requirePermission('roles.manage'), async (req, res) => {
  const role = await loadRole(req.params.id);
  assertCanGrant(req, role.permissions);

  const { name, description, permissions } = req.body ?? {};
  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) throw new HttpError(400, 'Permissions must be a list.');
    assertCanGrant(req, permissions);
  }
  res.json({ role: toRoleDTO(await updateRole(role.id, { name, description, permissions })) });
});

router.delete('/:id', requirePermission('roles.manage'), async (req, res) => {
  const role = await loadRole(req.params.id);
  assertCanGrant(req, role.permissions);
  if (role.memberCount) {
    throw new HttpError(409, `${role.memberCount} team member(s) still have this role. Reassign them first.`);
  }
  await deleteRole(role.id);
  res.status(204).end();
});

export default router;
