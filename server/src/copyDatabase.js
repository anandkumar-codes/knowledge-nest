// Copies a whole Knowledge Nest database (every table and index) from one place to another:
// a local SQLite file or a Turso database (libsql://...). Used to move the data to Turso, and to back
// Turso up to a file.
//
//   node src/copyDatabase.js --from ./data/knowledge-nest.db --to libsql://your-db.turso.io
//   node src/copyDatabase.js --from libsql://your-db.turso.io --to ./data/turso-copy.db
//
// Turso addresses use TURSO_AUTH_TOKEN for access. The target must be empty: nothing is ever overwritten.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A libsql:// / https:// address, or a file path (relative to the server folder).
export function openDatabase(location) {
  if (/^(libsql|https?|wss?):\/\//.test(location)) {
    return createClient({ url: location, authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined });
  }
  const forward = path.resolve(SERVER_ROOT, location).split(path.sep).join('/');
  return createClient({ url: `file:${forward.startsWith('/') ? '' : '/'}${forward}` });
}

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

export async function copyDatabase(source, target, log = () => {}) {
  const objects = (await source.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE 'libsql_%' ORDER BY type DESC"
  )).rows.map((r) => ({ type: r.type, name: r.name, sql: r.sql }));
  const tables = objects.filter((o) => o.type === 'table');
  const indexes = objects.filter((o) => o.type === 'index');

  // Refuse to copy over existing data.
  const existing = (await target.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).rows.map((r) => r.name);
  for (const t of tables.filter((x) => existing.includes(x.name))) {
    const { n } = (await target.execute(`SELECT COUNT(*) AS n FROM ${quote(t.name)}`)).rows[0];
    if (n > 0) throw new Error(`The target already has data (${n} rows in "${t.name}"). Nothing was copied.`);
  }

  for (const t of tables) {
    if (!existing.includes(t.name)) await target.execute(t.sql);
  }
  let total = 0;
  for (const t of tables) {
    const rs = await source.execute(`SELECT * FROM ${quote(t.name)}`);
    const columns = rs.columns;
    const insert = `INSERT INTO ${quote(t.name)} (${columns.map(quote).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
    for (let i = 0; i < rs.rows.length; i += 100) {
      const chunk = rs.rows.slice(i, i + 100).map((row) => ({ sql: insert, args: columns.map((_, c) => row[c]) }));
      await target.batch(chunk, 'write');
    }
    total += rs.rows.length;
    log(`  ${t.name}: ${rs.rows.length} rows`);
  }
  for (const ix of indexes) {
    await target.execute(ix.sql.replace(/^CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/i, 'CREATE $1INDEX IF NOT EXISTS '));
  }
  return { tables: tables.length, rows: total };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const from = arg('from');
  const to = arg('to');
  if (!from || !to) {
    console.error('Usage: node src/copyDatabase.js --from <file or libsql://...> --to <file or libsql://...>');
    process.exit(1);
  }
  const source = openDatabase(from);
  const target = openDatabase(to);
  try {
    console.log(`Copying ${from}  ->  ${to}`);
    const { tables, rows } = await copyDatabase(source, target, console.log);
    console.log(`Done: ${rows} rows in ${tables} tables.`);
  } catch (err) {
    console.error(`Copy failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    source.close();
    target.close();
  }
}
