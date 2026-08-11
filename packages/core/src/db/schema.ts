import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";
import { SOURCES } from "../schema/normalized.js";

export { SOURCES };

/**
 * `listings` — one row per source listing, keyed by `${source}:${sourceListingId}`.
 * `source` is constrained via a CHECK constraint (the installed drizzle-orm version's
 * sqlite-core `check()` table-builder is used here) to the three demo sources; SQLite
 * can't `ALTER TABLE ... ADD CHECK`, so adding a fourth source later means a table
 * rebuild (see plan.md's Risk areas — an accepted tradeoff for a fixed 3-source demo).
 */
export const listings = sqliteTable(
  "listings",
  {
    id: text("id").primaryKey(), // `${source}:${sourceListingId}`
    source: text("source", { enum: SOURCES }).notNull(),
    sourceListingId: text("source_listing_id").notNull(),
    title: text("title").notNull(),
    priceCents: integer("price_cents").notNull(),
    category: text("category"),
    imagePath: text("image_path").notNull(), // fixture-relative path
    sourceUrl: text("source_url").notNull(),
    postedAt: text("posted_at").notNull(), // ISO 8601
    description: text("description"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    // Required by the score stage's upsert: `ON CONFLICT (source, source_listing_id) DO UPDATE`.
    unique("listings_source_source_listing_id_unique").on(
      table.source,
      table.sourceListingId,
    ),
    index("idx_listings_source").on(table.source),
    // Keep this literal in sync with SOURCES (imported above) — sql`` template
    // interpolation isn't safe for raw identifier/enum-list SQL text like a CHECK body.
    check(
      "listings_source_check",
      sql`${table.source} IN ('thriftly','secondlook','reloop')`,
    ),
  ],
);

export const scores = sqliteTable(
  "scores",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id),
    imagePath: text("image_path").notNull(), // the image_path that was scored
    score: real("score").notNull(),
    // JSON blob of the vision endpoint reply; DB-internal debugging only,
    // never returned by any dashboard API response.
    rawResponse: text("raw_response"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("idx_scores_listing_id").on(table.listingId),
    check(
      "scores_score_check",
      sql`${table.score} >= 0 AND ${table.score} <= 100`,
    ),
  ],
);

export const alerts = sqliteTable(
  "alerts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    listingId: text("listing_id")
      .notNull()
      .references(() => listings.id),
    payloadJson: text("payload_json").notNull(),
    dryRun: integer("dry_run").notNull(), // 1 = no network call made, 0 = live send attempted
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    // One alert per listing; re-running `alert` is a no-op for listings already
    // alerted (idempotency) — enforced by this UNIQUE constraint.
    unique("alerts_listing_id_unique").on(table.listingId),
    index("idx_alerts_listing_id").on(table.listingId),
  ],
);
