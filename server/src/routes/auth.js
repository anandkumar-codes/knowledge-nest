import { Router } from 'express';
import jwt from 'jsonwebtoken';
import {
  checkChosenPassword, findUser, findUserByEmail, setPassword, touchLastLogin, verifyPassword,
} from '../models/users.js';
import { authenticate } from '../middleware/auth.js';
import { signInLimiters } from '../middleware/rateLimits.js';
import { HttpError, toUserDTO } from '../utils/http.js';

const router = Router();

const loginLimiters = signInLimiters((req) => String(req.body?.email ?? '').trim().toLowerCase());

const signToken = (userId, remember) =>
  jwt.sign({ sub: String(userId) }, process.env.JWT_SECRET, { expiresIn: remember ? '7d' : '12h' });

router.post('/login', loginLimiters, async (req, res) => {
  const { email, password, remember } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    throw new HttpError(400, 'Email and password are required.');
  }

  const user = findUserByEmail(email);
  // Same message (and the same time taken) for unknown email and wrong password so accounts can't be enumerated.
  if (!(await verifyPassword(user, password))) {
    throw new HttpError(401, 'Invalid email or password.');
  }
  if (user.status !== 'active') {
    throw new HttpError(403, 'This account has been disabled. Contact your administrator.');
  }

  touchLastLogin(user.id);
  res.json({ token: signToken(user.id, remember), user: toUserDTO(findUser(user.id)) });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: toUserDTO(req.user) });
});

router.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!(await verifyPassword(req.user, currentPassword))) {
    throw new HttpError(400, 'Current password is incorrect.');
  }
  checkChosenPassword(newPassword);
  if (newPassword === currentPassword) {
    throw new HttpError(400, 'Choose a password different from your current one.');
  }
  await setPassword(req.user.id, newPassword, { mustChange: false });
  // Other sessions are now signed out; this device gets a fresh token with the same lifetime as before.
  const remember = (req.auth.exp - req.auth.iat) > 24 * 60 * 60;
  res.json({ token: signToken(req.user.id, remember), user: toUserDTO(findUser(req.user.id)) });
});

export default router;
