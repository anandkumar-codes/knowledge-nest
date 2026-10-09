import crypto from 'node:crypto';
import { Router } from 'express';
import { findRole } from '../models/roles.js';
import {
  checkChosenPassword, createUser, deleteUser, findUser, listUsers, setPassword, updateUser,
} from '../models/users.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { HttpError, parseId, toUserDTO } from '../utils/http.js';
import { assertCanGrant } from './roles.js';

const router = Router();
router.use(authenticate);

async function loadRole(idValue) {
  const id = parseId(idValue);
  const role = id && (await findRole(id));
  if (!role) throw new HttpError(400, 'Choose a valid role.');
  return role;
}

// Loads a team member the current user is allowed to change.
async function loadManageableUser(req) {
  const id = parseId(req.params.id);
  const target = id && (await findUser(id));
  if (!target) throw new HttpError(404, 'Team member not found.');
  if (target.isSuperAdmin) throw new HttpError(403, 'The super admin account cannot be changed here.');
  if (target.id === req.user.id) {
    throw new HttpError(400, "You can't change your own role or access. Ask another administrator.");
  }
  // Can't manage someone who has access you don't.
  assertCanGrant(req, target.role?.permissions ?? []);
  return target;
}

const generatePassword = () => crypto.randomBytes(9).toString('base64url');

router.get('/', requirePermission('team.view', 'team.manage'), async (_req, res) => {
  res.json({ users: (await listUsers()).map(toUserDTO) });
});

router.post('/', requirePermission('team.manage'), async (req, res) => {
  const { name, email, password, roleId } = req.body ?? {};
  const role = await loadRole(roleId);
  assertCanGrant(req, role.permissions);

  if (password) checkChosenPassword(password);
  const tempPassword = password || generatePassword();
  const user = await createUser({
    name, email, password: tempPassword, roleId: role.id, createdBy: req.user.id, mustChangePassword: true,
  });

  // Only echo the password back when we generated it, so the admin can share it once.
  res.status(201).json({ user: toUserDTO(user), ...(password ? {} : { tempPassword }) });
});

router.patch('/:id', requirePermission('team.manage'), async (req, res) => {
  const target = await loadManageableUser(req);
  const { name, roleId, status } = req.body ?? {};

  let nextRoleId;
  if (roleId !== undefined) {
    const role = await loadRole(roleId);
    assertCanGrant(req, role.permissions);
    nextRoleId = role.id;
  }
  res.json({ user: toUserDTO(await updateUser(target.id, { name, roleId: nextRoleId, status })) });
});

router.post('/:id/reset-password', requirePermission('team.manage'), async (req, res) => {
  const target = await loadManageableUser(req);
  const tempPassword = generatePassword();
  await setPassword(target.id, tempPassword, { mustChange: true });
  res.json({ tempPassword });
});

router.delete('/:id', requirePermission('team.manage'), async (req, res) => {
  const target = await loadManageableUser(req);
  await deleteUser(target.id);
  res.status(204).end();
});

export default router;
