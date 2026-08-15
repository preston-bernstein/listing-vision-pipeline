import {
  type ThriftlyRaw,
  type SecondLookRaw,
  type ReloopRaw,
} from '../schema/raw.js';
import {
  NormalizedListingSchema,
  type NormalizedListing,
  type Source,
} from '../schema/normalized.js';

/**
 * Parses a Reloop price string (e.g. "$450.00", "450.00", "$1,200.00") into a dollar amount.
 */
function parseReloopPrice(price: string): number {
  const cleaned = price.replace(/[$,]/g, '').trim();
  const dollars = Number.parseFloat(cleaned);
  if (Number.isNaN(dollars)) {
    throw new Error(`normalize: unable to parse Reloop price "${price}" as a number`);
  }
  return dollars;
}

/**
 * Some sources (Reloop) provide a bare date ("2026-08-05") rather than a full ISO 8601
 * datetime string; NormalizedListingSchema.postedAt requires the full datetime form (via Zod's
 * .datetime()), so bare dates are widened to midnight UTC. Already-valid datetime strings
 * (Thriftly, SecondLook) pass through unchanged.
 */
function toIsoDateTime(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
}

/**
 * ReloopRaw has no listing-id field at all (see schema/raw.ts), so sourceListingId is derived
 * from the last path segment of sourceUrl (e.g. "https://reloop.example/listings/listing-001"
 * -> "listing-001") — every Reloop fixture's sourceUrl follows this /listings/{id} shape.
 */
function reloopSourceListingId(sourceUrl: string): string {
  const segments = sourceUrl.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) {
    throw new Error(`normalize: unable to derive Reloop sourceListingId from sourceUrl "${sourceUrl}"`);
  }
  return last;
}

function normalizeThriftly(raw: ThriftlyRaw): NormalizedListing {
  const sourceListingId = raw.id;
  return NormalizedListingSchema.parse({
    id: `thriftly:${sourceListingId}`,
    source: 'thriftly',
    sourceListingId,
    title: raw.title,
    priceCents: raw.price_cents,
    category: raw.category,
    imagePath: raw.image_path,
    sourceUrl: raw.source_url,
    postedAt: raw.posted_at,
    description: raw.description,
  });
}

function normalizeSecondLook(raw: SecondLookRaw): NormalizedListing {
  const sourceListingId = raw.listingId;
  return NormalizedListingSchema.parse({
    id: `secondlook:${sourceListingId}`,
    source: 'secondlook',
    sourceListingId,
    title: raw.name,
    priceCents: Math.round(raw.priceUsd * 100),
    // tags is an array (e.g. ["furniture", "seating", "vintage"]) and NormalizedListing.category
    // is a single optional string; joining preserves all tags for search/display instead of
    // dropping to just the first one.
    category: raw.tags.length > 0 ? raw.tags.join(', ') : undefined,
    imagePath: raw.photoUrl,
    sourceUrl: raw.permalink,
    postedAt: raw.listedAt,
    description: raw.details,
  });
}

function normalizeReloop(raw: ReloopRaw): NormalizedListing {
  const sourceListingId = reloopSourceListingId(raw.sourceUrl);
  return NormalizedListingSchema.parse({
    id: `reloop:${sourceListingId}`,
    source: 'reloop',
    sourceListingId,
    title: raw.title,
    priceCents: Math.round(parseReloopPrice(raw.price) * 100),
    // ReloopRawSchema has no category-equivalent field; left undefined (category is optional
    // on NormalizedListingSchema).
    category: undefined,
    imagePath: raw.imageUrl,
    sourceUrl: raw.sourceUrl,
    postedAt: toIsoDateTime(raw.postedAt),
    description: raw.description,
  });
}

/**
 * Normalizes a raw listing from any of the three fixture sources into the shared
 * NormalizedListingSchema shape. The final object is always run through
 * NormalizedListingSchema.parse(...) so a mapping bug fails loudly with a Zod error
 * instead of silently producing a malformed record.
 */
export function normalize(source: 'thriftly', raw: ThriftlyRaw): NormalizedListing;
export function normalize(source: 'secondlook', raw: SecondLookRaw): NormalizedListing;
export function normalize(source: 'reloop', raw: ReloopRaw): NormalizedListing;
export function normalize(
  source: Source,
  raw: ThriftlyRaw | SecondLookRaw | ReloopRaw,
): NormalizedListing {
  switch (source) {
    case 'thriftly':
      return normalizeThriftly(raw as ThriftlyRaw);
    case 'secondlook':
      return normalizeSecondLook(raw as SecondLookRaw);
    case 'reloop':
      return normalizeReloop(raw as ReloopRaw);
  }
}
