# Plan: listing-vision-pipeline

## Approach
Build a small npm-workspaces monorepo with two packages: `core` (ingest, normalize, score+store, rank, alert) and `dashboard` (a read-only Hono API served by `@hono/node-server` on `PORT`, plus a Vite/React client). Each pipeline stage is a standalone CLI entry point, run via `tsx` (plain Node can't execute TypeScript files directly), that reads and writes SQLite through Drizzle ORM on top of Node's built-in `node:sqlite` driver, so a reviewer can run `ingest`, `score`, `rank`, and `alert` one at a time and inspect output between steps. Fixtures replace live scraping: three fake source identifiers (Thriftly, SecondLook, Reloop), each with genuinely different raw field names (Thriftly is now snake_case, SecondLook and Reloop were already different) and one in HTML, plus a bundled placeholder image file per fixture listing so the score stage has real bytes to send to the vision endpoint — no external or non-resolving URLs anywhere in the fixture corpus. A grep-based security check, run as an npm script, a CI step, and a pre-push hook, sweeps both the current tracked tree and the full git history for private-network strings, an internal library name, and a documented denylist of real marketplace names (exact patterns live only in scripts/check-forbidden-strings.mjs) before anything reaches the public remote.

## Architecture
```
fixtures/{thriftly,secondlook,reloop}/*.json|*.html
fixtures/{thriftly,secondlook,reloop}/images/*.jpg
        |
        v
  [ingest]  per-source parser -> RawListing (source-specific shape)
        |
        v
  [normalize] Zod-validated RawListing -> NormalizedListing (common shape; imagePath is fixture-relative)
        |
        v
  [score]  read NormalizedListing.imagePath off disk -> base64-encode
           -> POST OLLAMA_HOST
              (Ollama: /api/chat, images: [base64], stream: false)
              (OpenAI-compat: /v1/chat/completions, data:image/jpeg;base64,... URL)
           -> vision score (0-100)
           -> Drizzle/SQLite: upsert listings row (ON CONFLICT (source, source_listing_id)
              DO UPDATE), insert scores row  [score owns writing both tables; no separate
              store CLI command exists]
        |
        v
  [rank]  SELECT l.*, MAX(s.score) AS score FROM listings l
          JOIN scores s ON s.listing_id = l.id
          GROUP BY l.id ORDER BY score DESC   (query, not a stored table)
        |
        +---------------------------------------------+
        v                                              v
  [alert] threshold check                    [dashboard server] GET /api/listings,
        |                                     GET /api/listings/:id,
        v                                     GET /api/images/:listingId (streams
  Telegram-shaped payload                     the fixture image file), GET /health
  (dry-run file, sanitized filename,                   |
   or live send)                                       v
                                              [dashboard client] React table +
                                              thumbnails via <img src="/api/images/{id}">
```
Each stage is a separate CLI script in `packages/core/src/cli/`, executed via `tsx`. The dashboard server imports the same `core` package to query the database, so there is one source of truth for the data shape.

## Data model
SQLite via Drizzle, opened through Node's built-in `node:sqlite` driver. `db/client.ts` sets `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL` before anything else touches the connection — SQLite enforces neither by default, and both the `scores`/`alerts` foreign keys and reasonable concurrent-read behavior depend on it. Two tables plus one log table.

```sql
CREATE TABLE listings (
  id            TEXT PRIMARY KEY,     -- `${source}:${sourceListingId}`
  source        TEXT NOT NULL CHECK (source IN ('thriftly','secondlook','reloop')),
  source_listing_id TEXT NOT NULL,
  title         TEXT NOT NULL,
  price_cents   INTEGER NOT NULL,
  category      TEXT,
  image_path    TEXT NOT NULL,        -- fixture-relative path, e.g. "thriftly/images/listing-001.jpg"
  source_url    TEXT NOT NULL,
  posted_at     TEXT NOT NULL,        -- ISO 8601
  description   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, source_listing_id)
);
CREATE INDEX idx_listings_source ON listings(source);

CREATE TABLE scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  TEXT NOT NULL REFERENCES listings(id),
  image_path  TEXT NOT NULL,          -- the image_path that was scored
  score       REAL NOT NULL CHECK (score >= 0 AND score <= 100),
  raw_response TEXT,                  -- JSON blob of the vision endpoint reply; DB-internal
                                       -- debugging only, never returned by the API
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_scores_listing_id ON scores(listing_id);

CREATE TABLE alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  TEXT NOT NULL REFERENCES listings(id),
  payload_json TEXT NOT NULL,
  dry_run     INTEGER NOT NULL,       -- 1 = no network call made, 0 = live send attempted
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (listing_id)                 -- one alert per listing; re-running `alert` is a
                                       -- no-op for listings already alerted (idempotency)
);
CREATE INDEX idx_alerts_listing_id ON alerts(listing_id);
```
Rank is a query, not a column: `SELECT l.*, MAX(s.score) AS score FROM listings l JOIN scores s ON s.listing_id = l.id GROUP BY l.id ORDER BY score DESC`. Grouping by listing and taking `MAX(score)` means a listing that accumulates more than one `scores` row across re-runs still ranks by its best score, not an arbitrary join row.

**Accepted tradeoff:** the `source` CHECK constraint hardcodes the three demo sources. SQLite can't `ALTER TABLE ... ADD CHECK`, so adding a fourth source later means a table rebuild/migration that recreates `listings`. Fine for a fixed 3-source demo — noted explicitly rather than left implicit (see Risk areas).

## API / interface contract
**Dashboard server (Hono, listening via `@hono/node-server` on `PORT`), all routes GET-only, no mutation route exists anywhere in the app:**
- `GET /api/listings?limit=&source=` → `200 { listings: [{ rank, id, source, title, priceCents, imagePath, score }] }`, sorted by score descending. `limit` is Zod-validated as an integer `1..1000`, default `50`; out-of-range or non-integer values are rejected with `400`. `source` is Zod-validated against the enum `['thriftly','secondlook','reloop']`; unknown values are rejected with `400` rather than passed into the query.
- `GET /api/listings/:id` → `200 { listing: {...}, scores: [{ imagePath, score, createdAt }] }`, or `404 { error: "not found" }`. Never includes `raw_response` — that field is DB-internal/debugging-only and is excluded from every dashboard API response.
- `GET /api/images/:listingId` → streams the fixture image file backing that listing (`fixtures/<source>/images/<file>.jpg`) with the appropriate `Content-Type`, so the React client can render real thumbnails via `<img src="/api/images/{id}">`. GET-only, no mutation; `404` if the listing id or its backing file doesn't resolve.
- `GET /health` → `200 { ok: true }`.
- Any other method on any path (POST/PUT/PATCH/DELETE) returns Hono's default `404`, because no handler for it is ever registered. A dashboard test asserts this for at least one path.

**Security/validation rules (apply across CLI and dashboard):**
- `OLLAMA_HOST` is validated at process startup as a well-formed `http://` or `https://` URL; any other scheme causes the process to exit with an error before any request is attempted — mitigates SSRF via a malformed or malicious env value.
- All database access goes through Drizzle's parameterized query builder; no raw string interpolation into SQL anywhere in the codebase.
- `scores.raw_response` is never serialized into any dashboard API response.
- Alert logging writes only the listing id and the threshold decision; the full Telegram request body and the bot token are never logged.

**CLI (packages/core/src/cli/, run via `npm run <stage> -w core`, each script executed as `tsx src/cli/<stage>.ts`):**
- `ingest` — reads `fixtures/`, writes normalized records to stdout (or `--out <file>`), reports Zod validation errors to stderr with exit code 1 if any record fails, exit 0 otherwise. Makes zero HTTP requests.
- `score` — reads normalized records; for each, reads the file at `imagePath` from `fixtures/` on disk and base64-encodes it, then sends a vision request to `OLLAMA_HOST` (`${OLLAMA_HOST}/api/chat` with `images: [base64]` and `stream: false` for `VISION_API_STYLE=ollama`; `${OLLAMA_HOST}/v1/chat/completions` with a `data:image/jpeg;base64,...` URL for `VISION_API_STYLE=openai`); upserts the listing into `listings` (`INSERT INTO listings (...) VALUES (...) ON CONFLICT (source, source_listing_id) DO UPDATE SET ...`) and inserts the resulting row into `scores`. `score` is the sole owner of writing `listings` rows — no separate `store` CLI command exists — so a second run against the same fixtures updates in place instead of throwing a UNIQUE constraint violation.
- `rank` — runs `SELECT l.*, MAX(s.score) AS score FROM listings l JOIN scores s ON s.listing_id = l.id GROUP BY l.id ORDER BY score DESC`, prints the ordered table to stdout.
- `alert` — runs the rank query, filters by `ALERT_SCORE_THRESHOLD`, builds a Telegram `sendMessage`-shaped payload (`{ chat_id, text, parse_mode }`) per matching listing not already alerted (`alerts.UNIQUE(listing_id)` makes a second run a no-op for listings already recorded). Writes each payload to `alerts-output/<sanitized-listing-id>.json`, where the listing id's `:` is replaced with `__` (e.g. `thriftly__listing-001.json`) since `:` is a reserved character on Windows/NTFS, and logs only the listing id and the threshold decision — never the full Telegram request body or token. Unless `ALERT_LIVE_SEND=true`, in which case it also POSTs to `https://api.telegram.org/bot<token>/sendMessage` (mocked in every test; never a real call in CI).

**Errors:** ingest/normalize failures are collected and reported per-record (id + missing field), not thrown as a single fatal error, so one bad fixture doesn't block the rest.

## Integration points
- `package.json` (root) — npm workspaces config (`packages/*`), shared scripts: `lint`, `typecheck`, `test`, `check:secrets`, `prepare` (installs the pre-push hook).
- `tsconfig.base.json` — shared strict TS config extended by both packages.
- `.env.example` — every env var the pipeline reads, generic placeholders only: `DATABASE_URL`, `OLLAMA_HOST`, `VISION_API_STYLE`, `ALERT_SCORE_THRESHOLD`, `ALERT_LIVE_SEND`, `TELEGRAM_BOT_TOKEN`, `PORT` (default `3000`).
- `.gitignore` — excludes `data/*.db`, `alerts-output/`, `node_modules`, `dist`, and `.env` / `.env.*` (except `.env.example`, which stays tracked) — a real `.env` was never excluded before this fix and is the single most likely leak vector for this repo.
- `packages/core/package.json` — dependencies: `drizzle-orm`, `zod`, `cheerio`; devDependencies: `drizzle-kit`, `tsx`, `vitest`, `typescript`.
- `packages/dashboard/package.json` — dependencies: `hono`, `@hono/node-server`, `react`, `react-dom`; devDependencies: `vite`, `vitest`, `typescript`.
- `packages/core/drizzle.config.ts` — points `drizzle-kit generate` at `src/db/schema.ts` and the SQLite dialect/`DATABASE_URL`, so migration generation has a real target to run against.
- `packages/core/src/schema/raw.ts` — three Zod schemas (`ThriftlyRawSchema`, `SecondLookRawSchema`, `ReloopRawSchema`) matching each fixture source's raw field names; Thriftly's fields are now snake_case (`price_cents`, `image_path`, `source_url`, `posted_at`) so all three sources — not just SecondLook — require real remapping in `normalize.ts`.
- `packages/core/src/schema/normalized.ts` — one Zod schema (`NormalizedListingSchema`, field `imagePath: string` — a fixture-relative path, not a URL) that all sources map into; this is what satisfies FR2 and FR3.
- `packages/core/src/ingest/{thriftly,secondlook,reloop}.ts` — per-source parsers; `reloop.ts` uses `cheerio` to read HTML, the other two `JSON.parse` fixture files.
- `packages/core/src/ingest/index.ts` — walks `fixtures/`, dispatches by source directory name, collects Zod errors instead of throwing.
- `packages/core/src/ingest/ingest.test.ts` — ingest stage tests (valid fixtures pass, invalid rejected, normalization shape verified).
- `packages/core/src/normalize/normalize.ts` — maps each `RawListing` variant to `NormalizedListing`, including all three sources' distinct field names.
- `packages/core/src/normalize/normalize.test.ts` — normalize stage tests (each source maps correctly, price conversions verified).
- `packages/core/src/score/visionClient.ts` — reads the image file at `imagePath` from disk and base64-encodes it; builds the request to `OLLAMA_HOST` per `VISION_API_STYLE` (Ollama: `/api/chat`, `images: [...]`, `stream: false`; OpenAI-compatible: `/v1/chat/completions`, `data:image/jpeg;base64,...` URL); parses the response with a Zod schema for the expected score shape.
- `packages/core/src/score/score.ts` — orchestrates: normalized listing in, image read+encode, vision request, upsert `listings` row, insert `scores` row out.
- `packages/core/src/score/score.test.ts` — score stage tests (mocked vision client, listing upsert + score row persisted, no real network calls, second run against same fixture updates rather than errors).
- `packages/core/src/db/schema.ts` — Drizzle table definitions for `listings`, `scores`, `alerts`, including the `source`/`score` CHECK constraints, the `alerts.listing_id` UNIQUE constraint, and the `idx_listings_source` / `idx_alerts_listing_id` indexes.
- `packages/core/src/db/client.ts` — opens the SQLite file at `DATABASE_URL` via Node's built-in `node:sqlite` driver, sets `PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL`, runs migrations on startup.
- `packages/core/src/rank/rank.ts` — the rank query (with `GROUP BY`/`MAX(score)`), used by both the CLI and the dashboard server.
- `packages/core/src/rank/rank.test.ts` — rank stage tests (listings ordered by score DESC, ties and multiple score rows per listing handled via `MAX`).
- `packages/core/src/alert/buildAlert.ts` — threshold rule + Telegram payload shape + already-alerted skip logic.
- `packages/core/src/alert/sendAlert.ts` — dry-run file write (sanitized filename) vs. live `fetch` to Telegram, gated on `ALERT_LIVE_SEND`; logs only listing id + threshold decision.
- `packages/core/src/alert/alert.test.ts` — alert stage tests (threshold filtering, dry-run writes sanitized-filename file, re-run is a no-op for already-alerted listings, live-send mocked).
- `packages/core/src/cli/{ingest,score,rank,alert}.ts` — the four CLI entry points, invoked via `tsx`.
- `packages/dashboard/server/index.ts` — Hono app; registers the GET routes above (`/api/listings`, `/api/listings/:id`, `/api/images/:listingId`, `/health`); started via `@hono/node-server`'s `serve()` listening on `PORT` (default `3000`) through the `start`/`dev:server` npm scripts — this is the process the Vite dev proxy (`/api` → `localhost:3000`) actually proxies to.
- `packages/dashboard/server/server.test.ts` — Hono route tests (GET routes return 200 with valid schema, `/api/images/:listingId` streams a file, POST/PUT/DELETE return 404, `raw_response` never appears in a response body).
- `packages/dashboard/client/src/App.tsx` — fetches `/api/listings`, renders a table with thumbnails via `<img src="/api/images/{id}">`.
- `packages/dashboard/client/src/main.tsx` — React entry point / Vite bootstrap.
- `packages/dashboard/client/index.html` — Vite HTML shell.
- `packages/dashboard/client/src/App.test.tsx` — React component tests (fetches listings, renders table and thumbnails, no mutation logic).
- `fixtures/{thriftly,secondlook,reloop}/*` — the fake corpus (listed below).
- `fixtures/{thriftly,secondlook,reloop}/images/*.jpg` — bundled placeholder image files (real bytes, fabricated/generated content, reused across paths) that `imagePath`/`image_path`/`photoUrl`/`.listing-image` fields point at; the `score` stage reads these from disk.
- `scripts/check-forbidden-strings.mjs` — the grep-based security check (design below), now also sweeping full git history.
- `scripts/hooks/pre-push` + `scripts/install-git-hooks.mjs` — installs the same check as a pre-push hook via the `prepare` npm lifecycle script.
- `.github/workflows/ci.yml` — lint, typecheck, test, and security-check as separate jobs.
- `README.md`, `LICENSE` — written per the house `readme` skill convention during the build step, not authored by this plan.

**Test isolation:** every Vitest test file that touches the database (`ingest.test.ts`, `normalize.test.ts`, `score.test.ts`, `rank.test.ts`, `alert.test.ts`, `server.test.ts`) opens its own temp-file or `:memory:` SQLite database rather than sharing `DATABASE_URL` — Vitest runs test files in parallel by default, and a shared database file would race on migrations and locking.

## Fixture corpus (fake, fabricated fresh for this repo)
Three fake sources, each with genuinely different raw field names, so normalize has real mapping work for all three, not just SecondLook:

**Thriftly** (JSON, snake_case fields: `id, title, price_cents, category, image_path, source_url, posted_at, description`)
- `fixtures/thriftly/listing-001.json` — "Vintage Oak Bookshelf", category `furniture`, `image_path: "thriftly/images/listing-001.jpg"`.
- `fixtures/thriftly/listing-002.json` — "Mid-Century Table Lamp", category `lighting`, `image_path: "thriftly/images/listing-002.jpg"`.
- `fixtures/thriftly/listing-003.json` — "Ceramic Vase Set", category `decor`, `image_path: "thriftly/images/listing-003.jpg"`.
- `fixtures/thriftly/listing-004-invalid.json` — same shape but missing `price_cents`, used by the normalize test to prove FR2/AC2 (rejected, not silently dropped).

**SecondLook** (JSON, fields: `listingId, name, priceUsd, tags, photoUrl, permalink, listedAt, details` — deliberately different names from Thriftly)
- `fixtures/secondlook/listing-001.json` — "Leather Armchair", tags `["furniture","seating"]`, `photoUrl: "secondlook/images/listing-001.jpg"`.
- `fixtures/secondlook/listing-002.json` — "Wool Area Rug", tags `["decor","textile"]`, `photoUrl: "secondlook/images/listing-002.jpg"`.
- `fixtures/secondlook/listing-003.json` — "Brass Floor Mirror", tags `["decor","mirror"]`, `photoUrl: "secondlook/images/listing-003.jpg"`.

**Reloop** (HTML, one `<div class="listing">` per file with child elements `.listing-title`, `.listing-price`, `.listing-image`, `.listing-url`, `.listing-date`, `.listing-description`, parsed with `cheerio`; `.listing-image` holds a fixture-relative path string, not a URL)
- `fixtures/reloop/listing-001.html` — "Reclaimed Wood Dining Table", `.listing-image` = `reloop/images/listing-001.jpg`.
- `fixtures/reloop/listing-002.html` — "Industrial Bar Stool Pair", `.listing-image` = `reloop/images/listing-002.jpg`.
- `fixtures/reloop/listing-003.html` — "Antique Writing Desk", `.listing-image` = `reloop/images/listing-003.jpg`.

10 fixture data files total, 3 sources, covering valid JSON, invalid JSON (rejection path), and HTML. `fixtures/{thriftly,secondlook,reloop}/images/` bundles real placeholder image files — reusing a small handful of generated/simple images repeated across the 10 fixture paths is fine, since this is a demo and content doesn't matter, only that real bytes exist on disk for the `score` stage to read and base64-encode. No `imagePath`/`image_path`/`photoUrl`/`.listing-image` value anywhere in the fixture corpus is an external or non-resolving URL.

## Grep-based security check
One script, three call sites, matching FR16 and AC12-14. Now sweeps both the tracked tree and full git history, per the repo owner's non-negotiable instruction.

**Script:** `scripts/check-forbidden-strings.mjs` (Node, no dependencies beyond `child_process` and `fs`).
1. Runs `git ls-files` to get every currently tracked file (this naturally skips `.gitignore`d files like the local SQLite DB and any real `.env`).
2. Separately runs `git rev-list --all` and, for each commit, greps its diff (equivalent to `git log --all -p`) against the same three pattern groups below — catches a string that was committed and later removed from the tree, which the tree scan alone would miss.
3. For the tree scan, reads each file as text, skipping known-binary file types by an extension **denylist** (`.png .jpg .jpeg .gif .ico .webp .pdf .zip .db .sqlite .woff .woff2 .ttf .eot`) rather than an allowlist — everything else, including dotfiles like a stray `.env`, is scanned. An allowlist fails open (an unrecognized extension is silently skipped); a denylist fails closed.
4. Tests file contents (tree scan) and commit diffs (history scan) against three pattern groups, printing `file:line: pattern` (tree) or `commit:file: pattern` (history) for every hit:
   - **Private-network patterns** (AC12): RFC1918/CGNAT IP-range prefixes and the internal inference-broker ports, exact patterns in scripts/check-forbidden-strings.mjs.
   - **Internal package name** (AC13): the private shared-scraping-library name, exact string in scripts/check-forbidden-strings.mjs.
   - **Real marketplace/resale site names** (AC14 backstop): a 15-entry denylist of real resale/marketplace site name fragments, case-insensitive, defined in scripts/check-forbidden-strings.mjs (not repeated here). This list is my starting default, not the private repo's actual target list (I don't have it) — flag it for Preston to review and extend before the first push, per requirements.md's own [TBD] note on AC14.
5. Exits 1 if any pattern matched anywhere (tree or history), 0 otherwise. No output on a clean run beyond "no forbidden strings found".

**Call sites:**
- `package.json`: `"check:secrets": "node scripts/check-forbidden-strings.mjs"`.
- `.github/workflows/ci.yml`: a `security-check` job running `npm run check:secrets`, separate from `lint`/`typecheck`/`test` jobs so a failure here is unambiguous in the Actions UI.
- `scripts/hooks/pre-push`: a two-line shell script (`#!/bin/sh` + `npm run check:secrets`) that blocks the push locally if it fails. Installed by `scripts/install-git-hooks.mjs`, wired to the npm `prepare` lifecycle script so `npm install` sets it up automatically — no extra dependency like husky needed for one hook.

## Technology choices
- **Hono** (web framework, `packages/dashboard` only) — small, TypeScript-first, has a built-in test client for exercising routes in Vitest without spinning up a real HTTP server, and needs no code generation or decorators. Fits a read-only, few-route API better than a heavier framework. Hono itself is just a router; `@hono/node-server`'s `serve()` is the actual process that listens on `PORT` — nothing else in the stack starts an HTTP listener, and the Vite dev proxy's `localhost:3000` target needs something running behind it.
- **Drizzle** (ORM) — TypeScript-first schema-as-code, and its query builder stays close to actual SQL, which suits a portfolio piece meant to show real skill rather than hide it behind magic. `drizzle-kit` (devDependency of `packages/core`, configured via `drizzle.config.ts`) generates the actual SQL migrations from `src/db/schema.ts` — schema-as-code alone doesn't produce runnable migrations without it.
- **node:sqlite** (SQLite driver, used by Drizzle) — Node's built-in SQLite module (stable from Node 22), synchronous API well-suited to a single-writer local demo, and avoids the native-compiled-module install friction that `better-sqlite3` adds for anyone cloning this public portfolio repo. Drizzle supports it natively as a driver.
- **tsx** (devDependency, `packages/core`) — every CLI stage script is run as `tsx src/cli/<stage>.ts`; plain `node` cannot execute `.ts` files directly.
- **cheerio** (HTML parsing, Reloop fixtures only) — the standard lightweight jQuery-like HTML parser for Node; used only to demonstrate the ingest layer normalizing a non-JSON source.
- **npm workspaces** (monorepo tooling) — native to npm, no extra build-orchestration tool (Nx, Turborepo) needed for two packages.
- **Vite + React** — required by constraints; Vite also serves the dev proxy from `/api` to the Hono server (running via `@hono/node-server` on `PORT`) so client and server run together locally without CORS setup.

## Risk areas
- **AC14's real-site denylist is a guess.** I don't have the private repo's actual target-site list, so the 15 names above are my own best-effort default. Preston should review and extend this list before the first public push — a missed real name would defeat the whole point of the check.
- **HTML fixture realism.** The Reloop fixtures need to look like a plausible listing page without echoing any real site's actual class names, layout, or copy. Worth a second look before commit to make sure `.listing-title` style class names read as generic, not lifted.
- **Vision endpoint response shape is assumed, not observed.** The `/api/chat` (Ollama, `stream: false`, `images: [...]`) and `/v1/chat/completions` (OpenAI-compatible) response parsing is built against the public shape of each API style, not a live broker, since NFR forbids referencing the actual inference broker. If a real Ollama/OpenAI-compatible server's response differs in a field name, the Zod parse will fail loudly in that environment — this is the correct behavior (fail, don't guess) but worth a manual smoke test against a real local Ollama instance before calling the score stage "done."
- **Commit hygiene is a process risk, not a code risk.** The requirements demand every commit be authored as a specific identity with no AI-attribution text, from the very first commit. This has to be enforced by the person/process making commits (git config, commit message discipline), not by anything in this plan's code — flagging it so it isn't dropped during the build phase.
- **SQLite file and alert output leaking into git.** `data/*.db` and `alerts-output/` must land in `.gitignore` from the first commit, or a test run before the first `git add` could accidentally commit real-looking (though fake) generated data alongside the fixtures. Alert output filenames are sanitized (`:` → `__`) so they're also safe to generate and inspect on Windows without breaking NTFS.
- **`source` CHECK enum requires a rebuild to extend.** SQLite can't `ALTER TABLE ... ADD CHECK`, so adding a fourth source later means a table rebuild (or a migration that recreates `listings`). Acceptable — even desirable — for a fixed 3-source demo scoped to Thriftly/SecondLook/Reloop; stated here explicitly so it isn't rediscovered as a surprise.
- **The pre-push hook is best-effort, not a guarantee.** It's bypassable with `git push --no-verify` or any non-CLI git client that doesn't run hooks. The CI `security-check` job is a real backstop, but it's a detection net that only fires *after* a push has already reached the public remote — by the time it's red, the string may already be visible on GitHub. The actual guarantee is process discipline (never staging a file that contains a live value) plus these two automated backstops catching a mistake; neither backstop alone is sufficient, and both together still aren't a substitute for not doing it in the first place.
