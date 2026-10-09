import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Where the data lives:
 *   - TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN): a Turso cloud database (used when hosted, e.g. on Render);
 *   - otherwise DATABASE_PATH: a local SQLite file, resolved relative to the server folder
 *     (default ./data/knowledge-nest.db).
 * Both run the same SQL through the libSQL client.
 */
const remoteUrl = process.env.TURSO_DATABASE_URL?.trim();
let url;
let label;
if (remoteUrl) {
  url = remoteUrl;
  label = remoteUrl.split('?')[0];
} else {
  const file = path.resolve(SERVER_ROOT, process.env.DATABASE_PATH ?? './data/knowledge-nest.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // libSQL wants one slash before an absolute path, also on Windows (file:/C:/...).
  const forward = file.split(path.sep).join('/');
  url = `file:${forward.startsWith('/') ? '' : '/'}${forward}`;
  label = file;
}

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined });
export const dbFile = label;
export const isRemoteDb = !!remoteUrl;

// Inside transaction(), queries go to the open transaction instead of the shared connection.
const txStore = new AsyncLocalStorage();

// Rows as plain objects ({ column: value }), like the old node:sqlite API.
const plain = (rs) => rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]])));

function execute(sql, args) {
  return (txStore.getStore() ?? client).execute({ sql, args: args.map((a) => (a === undefined ? null : a)) });
}

/**
 * The same shape as before (db.prepare(sql).get/all/run), but every call returns a promise:
 *   await db.prepare('SELECT ...').get(...args)   -> first row, or undefined
 *   await db.prepare('SELECT ...').all(...args)   -> array of rows
 *   await db.prepare('INSERT ...').run(...args)   -> { lastInsertRowid, changes }
 */
export const db = {
  prepare(sql) {
    return {
      get: async (...args) => plain(await execute(sql, args))[0],
      all: async (...args) => plain(await execute(sql, args)),
      run: async (...args) => {
        const rs = await execute(sql, args);
        return { lastInsertRowid: rs.lastInsertRowid === undefined ? 0 : Number(rs.lastInsertRowid), changes: rs.rowsAffected };
      },
    };
  },
  exec: (sql) => (txStore.getStore() ?? client).executeMultiple(sql),
};

// Runs fn as one all-or-nothing unit: everything it writes is saved together, or nothing is.
export async function transaction(fn) {
  if (txStore.getStore()) return fn(); // already inside one
  const tx = await client.transaction('write');
  try {
    const result = await txStore.run(tx, fn);
    await tx.commit();
    return result;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  } finally {
    tx.close();
  }
}

export const closeDb = () => client.close();

if (!remoteUrl) {
  // Local file: write-ahead logging (fast and safe), and wait rather than fail when the file is busy.
  await client.executeMultiple('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
}

await client.executeMultiple(`
  CREATE TABLE IF NOT EXISTS roles (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL,
    name_key     TEXT    NOT NULL UNIQUE,          -- lower-cased name, blocks "Manager" vs "manager"
    description  TEXT    NOT NULL DEFAULT '',
    permissions  TEXT    NOT NULL DEFAULT '[]',    -- JSON array of permission keys
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT    NOT NULL,
    updated_at   TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY,
    name           TEXT    NOT NULL,
    email          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash  TEXT    NOT NULL,
    is_super_admin INTEGER NOT NULL DEFAULT 0,
    role_id        INTEGER REFERENCES roles(id) ON DELETE RESTRICT,
    status         TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0, -- set when an admin chose the password
    last_login_at  TEXT,
    created_at     TEXT    NOT NULL,
    updated_at     TEXT    NOT NULL,
    CHECK (is_super_admin = 1 OR role_id IS NOT NULL)
  );

  -- Small app-wide settings stored as JSON (e.g. shift timings).
  CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS members (
    id              INTEGER PRIMARY KEY,
    name            TEXT    NOT NULL,
    phone           TEXT    NOT NULL,
    phone_key       TEXT    NOT NULL UNIQUE,        -- last 10 digits, so "+91 98765 43210" = "9876543210"
    email           TEXT    NOT NULL DEFAULT '',
    gender          TEXT    NOT NULL DEFAULT '' CHECK (gender IN ('', 'female', 'male', 'other')),
    guardian_phone  TEXT    NOT NULL DEFAULT '',    -- emergency contact
    address         TEXT    NOT NULL DEFAULT '',
    preparing_for   TEXT    NOT NULL DEFAULT '',    -- exam / course, e.g. "UPSC CSE"
    notes           TEXT    NOT NULL DEFAULT '',
    joined_on       TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS seats (
    id          INTEGER PRIMARY KEY,
    label       TEXT    NOT NULL UNIQUE,            -- e.g. "C7"
    row_label   TEXT    NOT NULL,
    position    INTEGER NOT NULL,                   -- 1-based position within the row
    status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'maintenance')),
    notes       TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
  );

  -- A booking of one seat for one shift over a date range (YYYY-MM-DD, inclusive).
  -- member_name/member_phone are a snapshot taken at booking time; the live values come from members.
  CREATE TABLE IF NOT EXISTS seat_allocations (
    id            INTEGER PRIMARY KEY,
    seat_id       INTEGER NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
    member_id     INTEGER REFERENCES members(id),
    member_name   TEXT    NOT NULL,
    member_phone  TEXT    NOT NULL DEFAULT '',
    shift         TEXT    NOT NULL CHECK (shift IN ('morning', 'evening', 'full')),
    start_date    TEXT    NOT NULL,
    end_date      TEXT    NOT NULL,
    notes         TEXT    NOT NULL DEFAULT '',
    fee           INTEGER NOT NULL DEFAULT 0,         -- total amount owed for this booking, whole rupees
    moved_from    INTEGER REFERENCES seat_allocations(id), -- set on the second half of a mid-plan seat change
    kind          TEXT    NOT NULL DEFAULT 'plan' CHECK (kind IN ('plan', 'day')), -- 'day' = one-day pass (whole day, no shift choice)
    created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT    NOT NULL,
    released_at   TEXT,
    released_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    CHECK (end_date >= start_date)
  );
  CREATE INDEX IF NOT EXISTS seat_allocations_seat ON seat_allocations(seat_id, end_date);
  CREATE INDEX IF NOT EXISTS seat_allocations_member ON seat_allocations(member_id);

  -- Money received against a booking (or refunded). Never deleted: mistakes are voided with a reason.
  CREATE TABLE IF NOT EXISTS payments (
    id             INTEGER PRIMARY KEY,
    allocation_id  INTEGER NOT NULL REFERENCES seat_allocations(id),
    member_id      INTEGER REFERENCES members(id),
    kind           TEXT    NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'refund')),
    amount         INTEGER NOT NULL CHECK (amount > 0),      -- whole rupees
    method         TEXT    NOT NULL CHECK (method IN ('cash', 'upi', 'card', 'bank')),
    reference      TEXT    NOT NULL DEFAULT '',              -- UPI / transaction id
    paid_on        TEXT    NOT NULL,                         -- YYYY-MM-DD
    notes          TEXT    NOT NULL DEFAULT '',
    received_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at     TEXT    NOT NULL,
    voided_at      TEXT,
    voided_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    void_reason    TEXT    NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS payments_allocation ON payments(allocation_id);
  CREATE INDEX IF NOT EXISTS payments_paid_on ON payments(paid_on);

  -- A payment a member says they made online (UPI). Staff approve it (creating a real payment) or reject it.
  CREATE TABLE IF NOT EXISTS payment_claims (
    id             INTEGER PRIMARY KEY,
    allocation_id  INTEGER NOT NULL REFERENCES seat_allocations(id),
    member_id      INTEGER NOT NULL REFERENCES members(id),
    amount         INTEGER NOT NULL CHECK (amount > 0),
    utr            TEXT    NOT NULL,                 -- UPI transaction reference
    note           TEXT    NOT NULL DEFAULT '',
    status         TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    submitted_at   TEXT    NOT NULL,
    reviewed_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at    TEXT,
    review_note    TEXT    NOT NULL DEFAULT '',
    payment_id     INTEGER REFERENCES payments(id)
  );
  CREATE INDEX IF NOT EXISTS payment_claims_status ON payment_claims(status);

  CREATE INDEX IF NOT EXISTS payments_member ON payments(member_id);
  CREATE INDEX IF NOT EXISTS payment_claims_member ON payment_claims(member_id);
  CREATE INDEX IF NOT EXISTS payment_claims_allocation ON payment_claims(allocation_id);

  -- Who changed what: one row per staff write request (no request bodies, so no passwords).
  CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_name   TEXT    NOT NULL,
    method      TEXT    NOT NULL,
    path        TEXT    NOT NULL,
    status      INTEGER NOT NULL,
    ip          TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log(created_at);

  CREATE INDEX IF NOT EXISTS users_role_id ON users(role_id);
  -- At most one super admin.
  CREATE UNIQUE INDEX IF NOT EXISTS users_one_super_admin ON users(is_super_admin) WHERE is_super_admin = 1;
`);

// Lightweight migrations for databases created before a column existed.
const columnsOf = async (table) => (await db.prepare(`PRAGMA table_info(${table})`).all()).map((c) => c.name);

const userColumns = await columnsOf('users');
if (!userColumns.includes('must_change_password')) {
  await db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
}
// Unix seconds of the last password change; sessions signed in before it are rejected.
if (!userColumns.includes('password_changed_at')) {
  await db.exec('ALTER TABLE users ADD COLUMN password_changed_at INTEGER');
}
const allocationColumns = await columnsOf('seat_allocations');
if (!allocationColumns.includes('fee')) {
  await db.exec('ALTER TABLE seat_allocations ADD COLUMN fee INTEGER NOT NULL DEFAULT 0');
}
if (!allocationColumns.includes('moved_from')) {
  await db.exec('ALTER TABLE seat_allocations ADD COLUMN moved_from INTEGER REFERENCES seat_allocations(id)');
}
if (!allocationColumns.includes('kind')) {
  await db.exec("ALTER TABLE seat_allocations ADD COLUMN kind TEXT NOT NULL DEFAULT 'plan' CHECK (kind IN ('plan', 'day'))");
}
// Member portal login lives on the member row.
const memberColumns = await columnsOf('members');
for (const [col, def] of [
  ['portal_enabled', 'INTEGER NOT NULL DEFAULT 0'],
  ['portal_password_hash', 'TEXT'],
  ['portal_must_change', 'INTEGER NOT NULL DEFAULT 0'],
  ['portal_last_login', 'TEXT'],
  ['anonymized_at', 'TEXT'], // set when a member's personal details were removed
  ['portal_password_changed_at', 'INTEGER'], // Unix seconds; portal sessions from before it are rejected
]) {
  if (!memberColumns.includes(col)) await db.exec(`ALTER TABLE members ADD COLUMN ${col} ${def}`);
}

export const now = () => new Date().toISOString();
