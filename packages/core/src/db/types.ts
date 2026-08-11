import type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite';

/**
 * A Drizzle SQLite database handle capable of running this project's queries — the
 * shape shared by the real client (`db/client.ts`'s `db` export) and any in-memory
 * or temp-file test database built the same way
 * (`drizzle({ client: new DatabaseSync(':memory:') })`).
 *
 * Type-only: importing this never triggers `db/client.ts`'s module-load side effect
 * of opening/creating the SQLite file, so it stays safe to reference from code paths
 * (CLI env validation, tests) that must run before that file is touched.
 */
export type AppDb = NodeSQLiteDatabase;
