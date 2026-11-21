import { beforeEach, describe, expect, it } from 'vitest';
import { listings, scores } from '../db/schema.js';
import { getRankedListings } from './rank.js';
import { createTestDb } from '../db/testDb.js';
import type { AppDb } from '../db/types.js';

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

async function seedListing(db: AppDb, listing: SeedListing): Promise<void> {
  await db.insert(listings).values(listing);
}

async function seedScore(db: AppDb, listingId: string, score: number): Promise<void> {
  await db.insert(scores).values({
    listingId,
    imagePath: 'fixture.jpg',
    score,
  });
}

interface RankFixture {
  source: SeedListing['source'];
  key: string;
  title: string;
  priceCents: number;
  postedAt: string;
  scores: number[];
}

// l1: single low score. l2: several scores, the best (max) must win, not the average or latest.
// l3: single mid score.
const RANK_FIXTURES: RankFixture[] = [
  { source: 'thriftly', key: 'l1', title: 'Low score item', priceCents: 1000, postedAt: '2026-01-01T00:00:00.000Z', scores: [50] },
  { source: 'secondlook', key: 'l2', title: 'Multi-scored item', priceCents: 2000, postedAt: '2026-01-02T00:00:00.000Z', scores: [40, 95] },
  { source: 'reloop', key: 'l3', title: 'Mid score item', priceCents: 3000, postedAt: '2026-01-03T00:00:00.000Z', scores: [70] },
];

async function seedRankFixture(db: AppDb): Promise<void> {
  for (const fixture of RANK_FIXTURES) {
    const id = `${fixture.source}:${fixture.key}`;
    await seedListing(db, {
      id,
      source: fixture.source,
      title: fixture.title,
      priceCents: fixture.priceCents,
      imagePath: `${fixture.source}/${fixture.key}.jpg`,
      sourceListingId: fixture.key,
      sourceUrl: `https://example.com/${fixture.key}`,
      postedAt: fixture.postedAt,
    });
    for (const score of fixture.scores) {
      await seedScore(db, id, score);
    }
  }
}

describe('getRankedListings', () => {
  let db: AppDb;

  beforeEach(async () => {
    db = createTestDb();
    await seedRankFixture(db);
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
