import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { listings, scores } from '../db/schema.js';
import { getRankedListings, type RankDb } from './rank.js';

// `node:sqlite`-only builtins (no bare, unprefixed alias) trip up this
// project's Vite/vitest version's static-import builtin detection when
// imported the normal way from a source file (not from node_modules, which
// is externalized and unaffected). `process.getBuiltinModule` sidesteps
// module resolution entirely and works reliably under vitest.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle');

/** Builds a fresh, isolated in-memory SQLite database with migrations applied. */
function createTestDb(): RankDb {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle({ client: sqlite });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as RankDb;
}

interface SeedListing {
  id: string;
  source: 'thriftly' | 'secondlook' | 'reloop';
  title: string;
  priceCents: number;
  imagePath: string;
  sourceListingId: string;
  sourceUrl: string;
  postedAt: string;
}

async function seedListing(db: RankDb, listing: SeedListing): Promise<void> {
  await db.insert(listings).values(listing);
}

async function seedScore(db: RankDb, listingId: string, score: number): Promise<void> {
  await db.insert(scores).values({
    listingId,
    imagePath: 'fixture.jpg',
    score,
  });
}

describe('getRankedListings', () => {
  let db: RankDb;

  beforeEach(async () => {
    db = createTestDb();

    // L1: single low score.
    await seedListing(db, {
      id: 'thriftly:l1',
      source: 'thriftly',
      title: 'Low score item',
      priceCents: 1000,
      imagePath: 'thriftly/l1.jpg',
      sourceListingId: 'l1',
      sourceUrl: 'https://example.com/l1',
      postedAt: '2026-01-01T00:00:00.000Z',
    });
    await seedScore(db, 'thriftly:l1', 50);

    // L2: multiple scores — best (max) should win, not the average or latest.
    await seedListing(db, {
      id: 'secondlook:l2',
      source: 'secondlook',
      title: 'Multi-scored item',
      priceCents: 2000,
      imagePath: 'secondlook/l2.jpg',
      sourceListingId: 'l2',
      sourceUrl: 'https://example.com/l2',
      postedAt: '2026-01-02T00:00:00.000Z',
    });
    await seedScore(db, 'secondlook:l2', 40);
    await seedScore(db, 'secondlook:l2', 95);

    // L3: single mid score.
    await seedListing(db, {
      id: 'reloop:l3',
      source: 'reloop',
      title: 'Mid score item',
      priceCents: 3000,
      imagePath: 'reloop/l3.jpg',
      sourceListingId: 'l3',
      sourceUrl: 'https://example.com/l3',
      postedAt: '2026-01-03T00:00:00.000Z',
    });
    await seedScore(db, 'reloop:l3', 70);
  });

  it('orders listings by score descending', async () => {
    const ranked = await getRankedListings(db);

    expect(ranked.map((r) => r.id)).toEqual(['secondlook:l2', 'reloop:l3', 'thriftly:l1']);
    expect(ranked.map((r) => r.score)).toEqual([95, 70, 50]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('ranks a multi-scored listing by its MAX score, not average or latest', async () => {
    const ranked = await getRankedListings(db);
    const l2 = ranked.find((r) => r.id === 'secondlook:l2');

    expect(l2).toBeDefined();
    expect(l2!.score).toBe(95);
    expect(l2!.rank).toBe(1);
  });

  it('respects the limit option', async () => {
    const ranked = await getRankedListings(db, { limit: 2 });

    expect(ranked).toHaveLength(2);
    expect(ranked.map((r) => r.id)).toEqual(['secondlook:l2', 'reloop:l3']);
  });

  it('filters by source', async () => {
    const ranked = await getRankedListings(db, { source: 'thriftly' });

    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe('thriftly:l1');
  });
});
