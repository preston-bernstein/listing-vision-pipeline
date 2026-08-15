import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// `node:sqlite`-only builtins (no bare, unprefixed alias) trip up this
// project's Vite/vitest version's static-import builtin detection when
// imported the normal way from a source file (not from node_modules, which
// is externalized and unaffected). `process.getBuiltinModule` sidesteps
// module resolution entirely and works reliably under vitest. Same fix as
// packages/core/src/alert/alert.test.ts.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

// This module's own directory, used below to resolve a relative DATABASE_URL against the
// repo root rather than the caller's cwd. npm workspace scripts run with cwd set to the
// invoked package's directory (e.g. `npm run score -w core` -> packages/core, `npm run
// dev:server -w dashboard` -> packages/dashboard), so a naive relative "./data/app.db"
// resolves to a different, silently-empty database file depending on which command opened
// it first. Same bug class fixturesRoot.ts already solves the same way for the fixtures
// directory.
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, '../../../..');

// node:sqlite's two special, non-path locations (https://nodejs.org/api/sqlite.html) — must be
// passed through byte-for-byte. Resolving either against REPO_ROOT would turn it into an
// ordinary path and silently defeat the in-memory/temporary-file semantics they request.
const SPECIAL_SQLITE_LOCATIONS = new Set([':memory:', '']);

function resolveDbPath(): string {
  const raw = process.env.DATABASE_URL ?? './data/app.db';
  const file = raw.startsWith('file:') ? raw.slice('file:'.length) : raw;
  if (SPECIAL_SQLITE_LOCATIONS.has(file)) {
    return file;
  }
  return path.isAbsolute(file) ? file : path.resolve(REPO_ROOT, file);
}

const dbPath = resolveDbPath();
if (!SPECIAL_SQLITE_LOCATIONS.has(dbPath)) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const sqlite = new DatabaseSync(dbPath);

// SQLite enforces neither by default; both the scores/alerts foreign keys and
// reasonable concurrent-read behavior depend on these being set immediately
// after opening, before anything else touches the connection.
sqlite.exec('PRAGMA foreign_keys = ON');
sqlite.exec('PRAGMA journal_mode = WAL');

export const db = drizzle({ client: sqlite });

// Applies the generated SQL migrations on every startup — idempotent, drizzle
// tracks what's already applied in its own __drizzle_migrations table.
migrate(db, { migrationsFolder: path.resolve(MODULE_DIR, '../../drizzle') });
