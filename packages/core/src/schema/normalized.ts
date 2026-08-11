import { z } from 'zod';

/**
 * The three demo listing sources. Canonical declaration — every other module that needs
 * this list (the DB `source` column enum/CHECK, the ingest orchestrator's per-source loop,
 * `normalize()`'s `Source` type) imports it from here rather than re-declaring it.
 */
export const SOURCES = ['thriftly', 'secondlook', 'reloop'] as const;

/**
 * Normalized listing schema.
 *
 * Represents a standardized listing across different sources (thriftly, secondlook, reloop).
 * The id field is formatted as `${source}:${sourceListingId}` to ensure global uniqueness.
 */
export const NormalizedListingSchema = z.object({
  // Unique identifier with format: source:sourceListingId
  id: z
    .string()
    .min(1, 'id must not be empty')
    .refine((val) => val.includes(':'), {
      message: 'id must contain a colon separator (format: source:sourceListingId)',
    }),

  // Source platform identifier
  source: z.enum(SOURCES),

  // Listing ID from the source platform
  sourceListingId: z.string().min(1, 'sourceListingId must not be empty'),

  // Listing title
  title: z.string().min(1, 'title must not be empty'),

  // Price in cents (non-negative integer)
  priceCents: z.number().int().nonnegative(),

  // Product category (optional)
  category: z.string().optional(),

  // Fixture-relative path to the listing image
  imagePath: z
    .string()
    .min(1, 'imagePath must not be empty'),

  // URL to the original listing on the source platform
  sourceUrl: z
    .string()
    .url('sourceUrl must be a valid URL')
    .min(1, 'sourceUrl must not be empty'),

  // ISO 8601 date string when the listing was posted
  postedAt: z
    .string()
    .datetime({ message: 'postedAt must be a valid ISO 8601 date string' }),

  // Listing description (optional)
  description: z.string().optional(),
});

/**
 * TypeScript type inferred from NormalizedListingSchema.
 * Use this for type annotations throughout the codebase.
 */
export type NormalizedListing = z.infer<typeof NormalizedListingSchema>;
