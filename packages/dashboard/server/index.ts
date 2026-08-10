import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../core/src/db/client.js";
import { listings, scores, SOURCES } from "../../core/src/db/schema.js";
import { getRankedListings } from "../../core/src/rank/rank.js";

/** Directory this module lives in — used to derive the fixtures root. */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Fixtures root: `<repo root>/fixtures`. This file lives at
 * `packages/dashboard/server/`, so the repo root is three levels up.
 * Matches the convention in packages/core/src/score/visionClient.ts.
 */
const FIXTURES_ROOT = path.resolve(MODULE_DIR, "../../../fixtures");

export const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

// Query-param validation for GET /api/listings. `getRankedListings` (the
// single source of truth for ranking, see core/src/rank/rank.ts) re-validates
// limit/source with its own schema, but we validate here first so we can
// return a proper 400 with a clear error body instead of letting a ZodError
// escape as an uncaught exception.
const listingsQuerySchema = z.object({
  limit: z.coerce
    .number({ invalid_type_error: "limit must be an integer" })
    .int("limit must be an integer")
    .min(1, "limit must be between 1 and 1000")
    .max(1000, "limit must be between 1 and 1000")
    .default(50),
  source: z.enum(SOURCES, {
    errorMap: () => ({
      message: `source must be one of: ${SOURCES.join(", ")}`,
    }),
  }).optional(),
});

app.get("/api/listings", async (c) => {
  const parsed = listingsQuerySchema.safeParse({
    limit: c.req.query("limit"),
    source: c.req.query("source"),
  });

  if (!parsed.success) {
    return c.json(
      {
        error: "invalid query parameters",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const { limit, source } = parsed.data;
  const rankedListings = await getRankedListings(db, { limit, source });
  return c.json({ listings: rankedListings });
});

// GET /api/listings/:id — direct Drizzle access (not `getRankedListings`,
// which only returns the joined/ranked shape) so we can return both the raw
// listing row and its full score history. `raw_response` is a DB-internal
// debugging column (see core/src/db/schema.ts) and is deliberately excluded
// from the mapped score history below.
app.get("/api/listings/:id", async (c) => {
  const id = c.req.param("id");

  const [listing] = await db.select().from(listings).where(eq(listings.id, id));
  if (!listing) {
    return c.json({ error: "not found" }, 404);
  }

  const scoreRows = await db.select().from(scores).where(eq(scores.listingId, id));
  const scoreHistory = scoreRows.map((row) => ({
    imagePath: row.imagePath,
    score: row.score,
    createdAt: row.createdAt,
  }));

  return c.json({ listing, scores: scoreHistory });
});

// GET /api/images/:listingId — streams the listing's backing fixture image
// off disk. Returns 404 in two distinct cases (deliberately not
// distinguished in the response body, per spec): the listing id doesn't
// exist in the DB, or the listing exists but its image file is missing
// from disk (e.g. a bad fixture path or a deleted file).
app.get("/api/images/:listingId", async (c) => {
  const listingId = c.req.param("listingId");

  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) {
    return c.json({ error: "not found" }, 404);
  }

  const fullPath = path.join(FIXTURES_ROOT, listing.imagePath);
  let bytes: Buffer;
  try {
    bytes = await readFile(fullPath);
  } catch {
    return c.json({ error: "not found" }, 404);
  }

  return c.body(new Uint8Array(bytes), 200, { "Content-Type": "image/jpeg" });
});

// No POST/PUT/PATCH/DELETE routes are registered anywhere in this app —
// Hono's default handler returns 404 for any unregistered method/path.

export default app;

// Only start listening when this file is run directly (`npm run start` /
// `npm run dev:server`) — not when `app` is imported for tests or by the
// Playwright global-setup, which construct their own request/response
// cycle without a real network listener.
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`dashboard server listening on http://localhost:${info.port}`);
  });
}
