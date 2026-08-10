import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `node:sqlite`-only builtins (no bare, unprefixed alias) trip up this
// project's Vite/vitest version's static-import builtin detection when
// imported the normal way from a source file (not from node_modules, which
// is externalized and unaffected). `process.getBuiltinModule` sidesteps
// module resolution entirely and works reliably under vitest.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
import { listings, scores } from '../db/schema.js';
import type { NormalizedListing } from '../schema/normalized.js';
import type { ScoreDb } from './score.js';

// Mock the vision client module entirely so `scoreListing` never issues a real
// network request to OLLAMA_HOST — no `global.fetch` mocking needed, since the
// whole module boundary is replaced.
vi.mock('./visionClient.js', () => ({
  scoreImage: vi.fn(),
}));

// Imports must come after `vi.mock` so the mocked module is what `score.ts`
// resolves against.
const { scoreImage } = await import('./visionClient.js');
const { scoreListing } = await import('./score.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle');

/** Builds a fresh, isolated in-memory SQLite database with migrations applied. */
function createTestDb(): ScoreDb {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle({ client: sqlite });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as ScoreDb;
}

function buildListing(overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    id: 'thriftly:abc123',
    source: 'thriftly',
    sourceListingId: 'abc123',
    title: 'Vintage lamp',
    priceCents: 2500,
    category: 'home',
    imagePath: 'thriftly/images/listing-001.jpg',
    sourceUrl: 'https://example.com/listing/abc123',
    postedAt: '2026-01-01T00:00:00.000Z',
    description: 'A nice lamp.',
    ...overrides,
  };
}

describe('scoreListing', () => {
  let db: ScoreDb;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = createTestDb();
    vi.mocked(scoreImage).mockReset();
    // Guard against any code path accidentally reaching for a real network
    // call instead of the mocked visionClient export.
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  it('inserts a listings row and a scores row on first call', async () => {
    vi.mocked(scoreImage).mockResolvedValueOnce(75);

    const listing = buildListing();
    await scoreListing(db, listing);

    const listingRows = await db.select().from(listings);
    expect(listingRows).toHaveLength(1);
    expect(listingRows[0]).toMatchObject({
      id: 'thriftly:abc123',
      source: 'thriftly',
      title: 'Vintage lamp',
      priceCents: 2500,
      // A defined category/description must be stored verbatim, not coerced to null —
      // only an absent (undefined) value should ever become a stored null (see the
      // "stores null for optional fields" test below).
      category: 'home',
      description: 'A nice lamp.',
    });

    const scoreRows = await db.select().from(scores);
    expect(scoreRows).toHaveLength(1);
    expect(scoreRows[0]).toMatchObject({
      listingId: 'thriftly:abc123',
      score: 75,
    });
    expect(JSON.parse(scoreRows[0].rawResponse as string)).toEqual({ score: 75 });

    expect(scoreImage).toHaveBeenCalledTimes(1);
    expect(scoreImage).toHaveBeenCalledWith(listing.imagePath, undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stores null for optional category/description fields when the listing omits them', async () => {
    vi.mocked(scoreImage).mockResolvedValueOnce(60);

    const listing = buildListing({ category: undefined, description: undefined });
    await scoreListing(db, listing);

    const [row] = await db.select().from(listings);
    expect(row.category).toBeNull();
    expect(row.description).toBeNull();
  });

  it('upserts listings (still 1 row) and accumulates scores history on a second call', async () => {
    vi.mocked(scoreImage).mockResolvedValueOnce(75);
    const first = buildListing();
    await scoreListing(db, first);

    vi.mocked(scoreImage).mockResolvedValueOnce(90);
    const second = buildListing({ title: 'Vintage lamp (price drop)', priceCents: 2000 });
    await scoreListing(db, second);

    const listingRows = await db.select().from(listings);
    expect(listingRows).toHaveLength(1);
    expect(listingRows[0]).toMatchObject({
      id: 'thriftly:abc123',
      title: 'Vintage lamp (price drop)',
      priceCents: 2000,
    });

    const scoreRows = await db.select().from(scores);
    expect(scoreRows).toHaveLength(2);
    expect(scoreRows.map((r) => r.score).sort()).toEqual([75, 90]);

    expect(scoreImage).toHaveBeenCalledTimes(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
