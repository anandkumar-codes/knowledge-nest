// Creates the default roles (if missing) and the super admin account (if none exists).
// Safe to run more than once.
import { pathToFileURL } from 'node:url';
import { DEFAULT_ROLES } from './config/permissions.js';
import { createRole, roleExists } from './models/roles.js';
import { ensureSeats } from './models/seats.js';
import { createUser, findSuperAdmin } from './models/users.js';

export async function seed({ name, email, password }, log = console.log) {
  for (const def of DEFAULT_ROLES) {
    if (!(await roleExists(def.name))) {
      await createRole(def);
      log(`  + role "${def.name}"`);
    }
  }

  const seats = await ensureSeats();
  if (seats) log(`  + ${seats} seats`);

  const existing = await findSuperAdmin();
  if (existing) {
    log(`  = super admin already exists (${existing.email})`);
    return existing;
  }
  if (!email || !password || password.length < 8) {
    throw new Error('Set SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD (8+ characters) in server/.env');
  }
  const admin = await createUser({ name: name || 'Super Admin', email, password, isSuperAdmin: true });
  log(`  + super admin ${admin.email}`);
  return admin;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { SUPERADMIN_NAME, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD } = process.env;
  const { dbFile } = await import('./db.js');
  try {
    console.log(`Seeding Knowledge Nest (${dbFile})…`);
    await seed({ name: SUPERADMIN_NAME, email: SUPERADMIN_EMAIL, password: SUPERADMIN_PASSWORD });
    console.log('Done.');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
