import { desc, eq, sql } from "drizzle-orm";
import { listings, scores, SOURCES } from "../db/schema.js";
import type { AppDb } from "../db/types.js";
import { z } from "zod";

const rankOptionsSchema = z.object({
  limit: z.number().int().min(1).max(1000).default(50),
  source: z.enum(SOURCES).optional(),
});

export type RankOptions = z.input<typeof rankOptionsSchema>;

export interface RankedListing {
  rank: number;
  id: string;
  source: (typeof SOURCES)[number];
  title: string;
  priceCents: number;
  imagePath: string;
  score: number;
}

/**
 * Returns listings joined with their best (MAX) score, ordered by score
 * descending. Reused by both the demo CLI (`cli/rank.ts`) and the dashboard
 * server, which is why `limit` clamping (1-1000, default 50) and `source`
 * validation happen here — once, for both callers — rather than at each
 * call site.
 */
export async function getRankedListings(
  db: AppDb,
  opts?: RankOptions,
): Promise<RankedListing[]> {
  const { limit, source } = rankOptionsSchema.parse(opts ?? {});

  const maxScore = sql<number>`MAX(${scores.score})`;

  const rows = await db
    .select({
      id: listings.id,
      source: listings.source,
      title: listings.title,
      priceCents: listings.priceCents,
      imagePath: listings.imagePath,
      score: maxScore.as("score"),
    })
    .from(listings)
    .innerJoin(scores, eq(scores.listingId, listings.id))
    .where(source ? eq(listings.source, source) : undefined)
    .groupBy(listings.id)
    .orderBy(desc(maxScore))
    .limit(limit);

  return rows.map((row, index) => ({
    rank: index + 1,
    id: row.id,
    source: row.source,
    title: row.title,
    priceCents: row.priceCents,
    imagePath: row.imagePath,
    score: row.score,
  }));
}
