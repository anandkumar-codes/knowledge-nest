// Database backups: a complete copy of the database in a single file, taken without stopping the server.
//   npm run backup          take one now
// With a local database the server also takes one a day on its own (see startDailyBackups).
// With Turso, Turso keeps its own restore points; `npm run backup` on your PC downloads a full copy as a file.
// Point BACKUP_DIR at another drive or a synced folder (OneDrive, Google Drive) so a disk failure
// doesn't take the backups with it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closeDb, db, isRemoteDb } from './db.js';
import { copyDatabase, openDatabase } from './copyDatabase.js';
import { today } from './utils/dates.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BACKUP_DIR = path.resolve(SERVER_ROOT, process.env.BACKUP_DIR ?? './data/backups');
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 30);
const PREFIX = 'knowledge-nest-';

const backups = () =>
  fs.existsSync(BACKUP_DIR)
    ? fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith(PREFIX) && f.endsWith('.db')).sort()
    : [];

// Writes data/backups/knowledge-nest-YYYY-MM-DD[-HHMMSS].db and removes the oldest beyond BACKUP_KEEP.
export async function createBackup({ force = false } = {}) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const day = today();
  let file = path.join(BACKUP_DIR, `${PREFIX}${day}.db`);
  if (fs.existsSync(file)) {
    if (!force) return null; // today's backup already exists
    const time = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    file = path.join(BACKUP_DIR, `${PREFIX}${day}-${time}.db`);
  }
  if (isRemoteDb) {
    // Turso: copy every table into a new local file.
    const source = openDatabase(process.env.TURSO_DATABASE_URL.trim());
    const target = openDatabase(file);
    try {
      await copyDatabase(source, target);
    } finally {
      source.close();
      target.close();
    }
  } else {
    await db.prepare('VACUUM INTO ?').run(file);
  }
  for (const old of backups().slice(0, -KEEP)) fs.rmSync(path.join(BACKUP_DIR, old));
  return file;
}

// Local database: checks every hour and takes the day's backup once.
export function startDailyBackups(log = console.log) {
  if (isRemoteDb) {
    log('Database is on Turso: Turso keeps restore points; run `npm run backup` on your PC for a file copy.');
    return;
  }
  const run = async () => {
    try {
      const file = await createBackup();
      if (file) log(`Backed up the database to ${file}`);
    } catch (err) {
      console.error('Database backup failed:', err.message);
    }
  };
  run();
  setInterval(run, 60 * 60 * 1000).unref();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const file = await createBackup({ force: true });
    console.log(`Backup written to ${file}`);
  } catch (err) {
    console.error(`Backup failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
