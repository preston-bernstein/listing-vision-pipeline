import { listings, scores } from '../db/schema.js';
import type { AppDb } from '../db/types.js';
import type { NormalizedListing } from '../schema/normalized.js';
import { scoreImage } from './visionClient.js';

/**
 * Scores a single normalized listing's image via the vision client, then
 * persists the result:
 *   - upserts the listing into `listings` (insert on first sighting, update
 *     on every re-run — `score` is the sole owner of writing `listings` rows)
 *   - inserts a new row into `scores` for this scoring pass
 *
 * `fixturesRoot` is forwarded to `scoreImage`; omit it to use visionClient's
 * own default (`<repo root>/fixtures`, derived from its own module location).
 */
export async function scoreListing(
  db: AppDb,
  listing: NormalizedListing,
  fixturesRoot?: string,
): Promise<void> {
  const score = await scoreImage(listing.imagePath, fixturesRoot);
  // visionClient only returns the parsed numeric score, not the raw endpoint
  // reply text, so raw_response is a small JSON blob of what we actually have.
  const rawResponse = JSON.stringify({ score });

  const listingValues = {
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
  };

  await db
    .insert(listings)
    .values(listingValues)
    .onConflictDoUpdate({
      target: [listings.source, listings.sourceListingId],
      set: {
        title: listingValues.title,
        priceCents: listingValues.priceCents,
        category: listingValues.category,
        imagePath: listingValues.imagePath,
        sourceUrl: listingValues.sourceUrl,
        postedAt: listingValues.postedAt,
        description: listingValues.description,
      },
    });

  await db.insert(scores).values({
    listingId: listing.id,
    imagePath: listing.imagePath,
    score,
    rawResponse,
  });

  console.error(`scored ${listing.id}: ${score}`);
}
