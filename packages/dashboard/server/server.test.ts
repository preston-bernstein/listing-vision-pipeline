import { describe, it, expect, beforeAll } from "vitest";

/**
 * `packages/core/src/db/client.ts` opens its SQLite connection and runs
 * migrations as a top-level side effect the moment it's imported, reading
 * `DATABASE_URL` from the environment at that instant. Static `import`
 * statements are hoisted above all other top-level code, so the only way to
 * make sure our own `DATABASE_URL` is in place *before* that module (or the
 * server's `index.ts`, which imports it) is evaluated is to set the env var
 * first and then reach both modules via a dynamic `import()`.
 *
 * `:memory:` gives this file its own private SQLite database, isolated from
 * any shared `DATABASE_URL` — vitest runs each test file in its own module
 * graph, so this never collides with another test file's database.
 */
process.env.DATABASE_URL = ":memory:";

const { app } = await import("./index.js");
const { db } = await import("../../core/src/db/client.js");
const { listings, scores } = await import("../../core/src/db/schema.js");

// Real fixture images (served byte-for-byte by GET /api/images/:listingId,
// which reads off disk relative to the repo's `fixtures/` root — not the DB).
const LISTING_A = {
  id: "thriftly:listing-001",
  source: "thriftly" as const,
  sourceListingId: "listing-001",
  title: "Vintage Oak Bookshelf",
  priceCents: 12500,
  category: "furniture",
  imagePath: "thriftly/images/listing-001.jpg",
  sourceUrl: "https://thriftly.example/listings/listing-001",
  postedAt: "2024-01-15T10:30:00Z",
  description: "A fine bookshelf.",
};

const LISTING_B = {
  id: "secondlook:listing-002",
  source: "secondlook" as const,
  sourceListingId: "listing-002",
  title: "Brass Floor Mirror",
  priceCents: 14500,
  category: "decor",
  imagePath: "secondlook/images/listing-002.jpg",
  sourceUrl: "https://secondlook.example/p/listing-002",
  postedAt: "2024-08-06T16:42:20Z",
  description: "A fine mirror.",
};

const UNKNOWN_ID = "thriftly:does-not-exist";

beforeAll(async () => {
  await db.insert(listings).values([LISTING_A, LISTING_B]);
  await db.insert(scores).values([
    {
      listingId: LISTING_A.id,
      imagePath: LISTING_A.imagePath,
      score: 88,
      // DB-internal debugging column — must never surface in any API response.
      rawResponse: JSON.stringify({ message: { content: "88" } }),
    },
    {
      listingId: LISTING_B.id,
      imagePath: LISTING_B.imagePath,
      score: 72,
    },
  ]);
});

describe("GET /health", () => {
  it("returns 200 { ok: true }", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/listings", () => {
  it("returns 200 with the expected shape and never leaks raw_response", async () => {
    const res = await app.request("/api/listings");
    expect(res.status).toBe(200);

    const rawText = await res.text();
    expect(rawText).not.toContain("raw_response");
    expect(rawText).not.toContain("rawResponse");

    const body = JSON.parse(rawText) as { listings: unknown[] };
    expect(Array.isArray(body.listings)).toBe(true);
    expect(body.listings.length).toBe(2);

    for (const entry of body.listings) {
      expect(entry).toEqual(
        expect.objectContaining({
          rank: expect.any(Number),
          id: expect.any(String),
          source: expect.any(String),
          title: expect.any(String),
          priceCents: expect.any(Number),
          imagePath: expect.any(String),
          score: expect.any(Number),
        }),
      );
    }

    // Ranked by score descending: LISTING_A (88) before LISTING_B (72).
    expect(body.listings[0]).toEqual(
      expect.objectContaining({ id: LISTING_A.id, rank: 1, score: 88 }),
    );
    expect(body.listings[1]).toEqual(
      expect.objectContaining({ id: LISTING_B.id, rank: 2, score: 72 }),
    );
  });

  it("filters by a valid source", async () => {
    const res = await app.request("/api/listings?source=secondlook");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listings: Array<{ id: string }> };
    expect(body.listings).toHaveLength(1);
    expect(body.listings[0]?.id).toBe(LISTING_B.id);
  });

  it("returns 400 for an out-of-range limit", async () => {
    const res = await app.request("/api/listings?limit=0");
    expect(res.status).toBe(400);

    const resTooHigh = await app.request("/api/listings?limit=1001");
    expect(resTooHigh.status).toBe(400);
  });

  it("returns 400 for an unknown source", async () => {
    const res = await app.request("/api/listings?source=not-a-real-source");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/listings/:id", () => {
  it("returns 200 with the listing and its score history for a seeded id", async () => {
    const res = await app.request(`/api/listings/${encodeURIComponent(LISTING_A.id)}`);
    expect(res.status).toBe(200);

    const rawText = await res.text();
    expect(rawText).not.toContain("raw_response");
    expect(rawText).not.toContain("rawResponse");

    const body = JSON.parse(rawText) as {
      listing: { id: string; title: string };
      scores: Array<{ imagePath: string; score: number; createdAt: string }>;
    };
    expect(body.listing.id).toBe(LISTING_A.id);
    expect(body.listing.title).toBe(LISTING_A.title);
    expect(body.scores).toHaveLength(1);
    expect(body.scores[0]).toEqual(
      expect.objectContaining({ imagePath: LISTING_A.imagePath, score: 88 }),
    );
  });

  it("returns 404 for an unknown id", async () => {
    const res = await app.request(`/api/listings/${encodeURIComponent(UNKNOWN_ID)}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/images/:listingId", () => {
  it("returns the fixture image bytes for a seeded listing", async () => {
    const res = await app.request(`/api/images/${encodeURIComponent(LISTING_A.id)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
    // JPEG magic bytes (0xFF 0xD8).
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  it("returns 404 for an unknown listing id", async () => {
    const res = await app.request(`/api/images/${encodeURIComponent(UNKNOWN_ID)}`);
    expect(res.status).toBe(404);
  });
});

// The dashboard is read-only end to end: no mutation route is registered
// anywhere in the app. Hono's fallback handler returns 404 for any
// unregistered method/path combination, which is exactly what proves it.
describe("no mutation routes exist anywhere in the app", () => {
  const mutationMethods = ["POST", "PUT", "PATCH", "DELETE"] as const;
  const paths = [
    "/api/listings",
    `/api/listings/${encodeURIComponent(LISTING_A.id)}`,
    `/api/images/${encodeURIComponent(LISTING_A.id)}`,
  ];

  for (const targetPath of paths) {
    for (const method of mutationMethods) {
      it(`${method} ${targetPath} returns 404`, async () => {
        const res = await app.request(targetPath, { method });
        expect(res.status).toBe(404);
      });
    }
  }
});
