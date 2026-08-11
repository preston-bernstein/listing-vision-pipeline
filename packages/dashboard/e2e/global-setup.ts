import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { rmSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const E2E_DB_PATH = resolve(__dirname, ".tmp/e2e.db");

/**
 * Seeds a real SQLite database with a handful of scored listings before the
 * Playwright run starts, so the dashboard has real data to render — this
 * drives the actual ingest → score → rank → dashboard path, minus the live
 * network call to a vision endpoint (out of scope for a UI test; the score
 * stage itself is covered by score.test.ts).
 *
 * Called directly from playwright.config.ts via top-level await, NOT wired
 * as Playwright's `globalSetup` option — Playwright does not guarantee
 * globalSetup completes before `webServer` opens its own SQLite connection,
 * and a server process that opens the db file before this function deletes
 * and recreates it ends up reading a stale, orphaned, empty handle forever
 * (SQLite doesn't reconnect a live file descriptor to a new inode at the
 * same path). Running this at config-module-evaluation time guarantees it
 * finishes before Playwright spawns the webServer child process at all.
 */
export async function seedDatabase(): Promise<void> {
  rmSync(E2E_DB_PATH, { force: true });
  rmSync(`${E2E_DB_PATH}-journal`, { force: true });
  rmSync(`${E2E_DB_PATH}-wal`, { force: true });
  rmSync(`${E2E_DB_PATH}-shm`, { force: true });

  process.env.DATABASE_URL = `file:${E2E_DB_PATH}`;

  // Dynamic import so DATABASE_URL is set before db/client.ts's module-load
  // side effect (opening the file + running migrations) fires.
  const { db } = await import("../../core/src/db/client.js");
  const { listings, scores } = await import("../../core/src/db/schema.js");
  const { runIngest } = await import("../../core/src/ingest/index.js");

  // No fixturesRoot arg needed — runIngest's own default (DEFAULT_FIXTURES_ROOT,
  // derived from core/src/fixturesRoot.ts's own location) already resolves to
  // <repo root>/fixtures regardless of which package imports it.
  const { succeeded } = await runIngest();

  const fakeScores = [82, 91, 67, 74, 58, 95, 63, 88, 70];
  for (let i = 0; i < succeeded.length; i++) {
    const listing = succeeded[i];
    const score = fakeScores[i % fakeScores.length];
    await db.insert(listings).values({
      id: listing.id,
      source: listing.source,
      sourceListingId: listing.sourceListingId,
      title: listing.title,
      priceCents: listing.priceCents,
      category: listing.category ?? null,
      imagePath: listing.imagePath,
      sourceUrl: listing.sourceUrl,
      postedAt: listing.postedAt,
      description: listing.description ?? null,
    });
    await db.insert(scores).values({
      listingId: listing.id,
      imagePath: listing.imagePath,
      score,
      rawResponse: JSON.stringify({ score }),
    });
  }
}
