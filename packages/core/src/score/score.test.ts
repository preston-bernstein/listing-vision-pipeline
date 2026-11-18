import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listings, scores } from '../db/schema.js';
import type { NormalizedListing } from '../schema/normalized.js';
import { createTestDb } from '../db/testDb.js';
import type { AppDb } from '../db/types.js';

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

/** Scores `listing` with the vision client mocked to return `score`. */
async function scoreWith(db: AppDb, score: number, listing: NormalizedListing): Promise<void> {
  vi.mocked(scoreImage).mockResolvedValueOnce(score);
  await scoreListing(db, listing);
}

async function expectOneListing(db: AppDb, expected: Partial<typeof listings.$inferSelect>): Promise<void> {
  const listingRows = await db.select().from(listings);
  expect(listingRows).toHaveLength(1);
  expect(listingRows[0]).toMatchObject(expected);
}

async function expectFirstCallStored(db: AppDb): Promise<void> {
  await expectOneListing(db, {
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
}

async function expectUpsertedWithHistory(db: AppDb): Promise<void> {
  await expectOneListing(db, {
    id: 'thriftly:abc123',
    title: 'Vintage lamp (price drop)',
    priceCents: 2000,
  });

  const scoreRows = await db.select().from(scores);
  expect(scoreRows).toHaveLength(2);
  expect(scoreRows.map((r) => r.score).sort()).toEqual([75, 90]);
}

describe('scoreListing', () => {
  let db: AppDb;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = createTestDb();
    vi.mocked(scoreImage).mockReset();
    // Guard against any code path accidentally reaching for a real network
    // call instead of the mocked visionClient export.
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  it('inserts a listings row and a scores row on first call', async () => {
    const listing = buildListing();
    await scoreWith(db, 75, listing);

    await expectFirstCallStored(db);

    expect(scoreImage).toHaveBeenCalledTimes(1);
    expect(scoreImage).toHaveBeenCalledWith(listing.imagePath, undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stores null for optional category/description fields when the listing omits them', async () => {
    const listing = buildListing({ category: undefined, description: undefined });
    await scoreWith(db, 60, listing);

    const [row] = await db.select().from(listings);
    expect(row.category).toBeNull();
    expect(row.description).toBeNull();
  });

  it('upserts listings (still 1 row) and accumulates scores history on a second call', async () => {
    await scoreWith(db, 75, buildListing());
    await scoreWith(db, 90, buildListing({ title: 'Vintage lamp (price drop)', priceCents: 2000 }));

    await expectUpsertedWithHistory(db);

    expect(scoreImage).toHaveBeenCalledTimes(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
