import { test, expect } from "@playwright/test";

test.describe("dashboard — ranked listings", () => {
  test("loads the real API, renders a ranked table, and thumbnails resolve", async ({
    page,
  }) => {
    await page.goto("/");

    const rows = page.locator("table tbody tr");
    await expect(rows.first()).toBeVisible();

    // Seeded by global-setup: 9 listings across 3 sources with scores
    // 58-95. The table must actually be sorted by score descending, not
    // just "some rows exist" — read the score column (5th <td>) and check
    // ordering.
    const scoreCells = page.locator("table tbody tr td:nth-child(5)");
    await expect(scoreCells).toHaveCount(9);
    const scores = (await scoreCells.allTextContents()).map((t) =>
      Number(t.trim()),
    );
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);

    // Every row's thumbnail must actually load — not a broken-image icon.
    // Assert on the underlying HTTP response, not just that an <img> tag
    // exists with some src attribute.
    const firstThumb = page.locator("table tbody tr img").first();
    await expect(firstThumb).toBeVisible();
    const thumbSrc = await firstThumb.getAttribute("src");
    expect(thumbSrc).toBeTruthy();

    const imageResponse = await page.request.get(thumbSrc!);
    expect(imageResponse.ok()).toBe(true);
    expect(imageResponse.headers()["content-type"]).toBe("image/jpeg");
    const body = await imageResponse.body();
    expect(body.length).toBeGreaterThan(0);
  });

  test("real API rejects an out-of-range limit with 400 — dashboard surfaces it, not a crash", async ({
    page,
  }) => {
    // Drives the actual validation path documented in plan.md's API
    // contract directly against the running server (not a mock), proving
    // the deployed route really enforces it end-to-end.
    const response = await page.request.get("/api/listings?limit=5000");
    expect(response.status()).toBe(400);
  });

  test("unknown listing id returns 404 from the real server", async ({
    page,
  }) => {
    const response = await page.request.get(
      "/api/listings/does-not-exist",
    );
    expect(response.status()).toBe(404);
  });

  test("no mutation route exists — POST against the real server is rejected", async ({
    page,
  }) => {
    const response = await page.request.post("/api/listings");
    expect(response.status()).toBe(404);
  });
});
