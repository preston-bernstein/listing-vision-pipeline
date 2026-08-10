import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// `node:sqlite`-only builtins (no bare, unprefixed alias) trip up this
// project's Vite/vitest version's static-import builtin detection when
// imported the normal way from a source file (not from node_modules, which
// is externalized and unaffected). `process.getBuiltinModule` sidesteps
// module resolution entirely and works reliably under vitest. Same fix as
// packages/core/src/alert/alert.test.ts.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

function resolveDbPath(): string {
  const raw = process.env.DATABASE_URL ?? "./data/app.db";
  return raw.startsWith("file:") ? raw.slice("file:".length) : raw;
}

const dbPath = resolveDbPath();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new DatabaseSync(dbPath);

// SQLite enforces neither by default; both the scores/alerts foreign keys and
// reasonable concurrent-read behavior depend on these being set immediately
// after opening, before anything else touches the connection.
sqlite.exec("PRAGMA foreign_keys = ON");
sqlite.exec("PRAGMA journal_mode = WAL");

export const db = drizzle({ client: sqlite });

// Applies the generated SQL migrations on every startup — idempotent, drizzle
// tracks what's already applied in its own __drizzle_migrations table.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
