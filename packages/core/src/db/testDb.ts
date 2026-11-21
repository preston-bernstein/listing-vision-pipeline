import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import type { AppDb } from './types.js';

// `node:sqlite`-only builtins (no bare, unprefixed alias) trip up this
// project's Vite/vitest version's static-import builtin detection when
// imported the normal way from a source file (not from node_modules, which
// is externalized and unaffected). `process.getBuiltinModule` sidesteps
// module resolution entirely and works reliably under vitest.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/** Builds a fresh, isolated in-memory SQLite database with migrations applied. */
export function createTestDb(): AppDb {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle({ client: sqlite });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as AppDb;
}
