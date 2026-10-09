// Recovery for a forgotten super admin password (the app can't reset it, by design).
//   npm run reset-admin
// Prints a one-time password; the owner chooses a new one at the next sign-in, and every
// existing super admin session is signed out. Needs access to the server, so it can't be misused from the web.
import crypto from 'node:crypto';
import { findSuperAdmin, setPassword } from './models/users.js';

const admin = findSuperAdmin();
if (!admin) {
  console.error('There is no super admin yet. Run `npm run seed` to create one.');
  process.exitCode = 1;
} else {
  const tempPassword = crypto.randomBytes(9).toString('base64url');
  await setPassword(admin.id, tempPassword, { mustChange: true });
  console.log(`Super admin: ${admin.email}`);
  console.log(`One-time password: ${tempPassword}`);
  console.log('Sign in with it at /admin/login; you will be asked to choose a new password.');
}
