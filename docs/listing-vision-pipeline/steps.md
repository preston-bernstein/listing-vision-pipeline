# Steps: listing-vision-pipeline

## Prerequisites
None.

## Implementation steps

### Step 1: Repo scaffold with packages and configuration
**What**: Create root package.json (with npm workspaces), tsconfig.base.json, .gitignore, and .env.example with all configuration placeholders.
**Files**: package.json, tsconfig.base.json, .gitignore, .env.example
**Test**: `npm install` at root completes without error. All four files exist. .env.example lists at minimum: OLLAMA_HOST, DATABASE_URL, ALERT_SCORE_THRESHOLD, ALERT_LIVE_SEND, VISION_API_STYLE, TELEGRAM_BOT_TOKEN, PORT. .gitignore contains `data/`, `alerts-output/`, `node_modules/`, `dist/`, `.env.local`.
**Depends on**: none
**Parallelizable**: No

### Step 2: Create core package structure
**What**: Set up packages/core with package.json (with drizzle-orm, zod, cheerio dependencies; drizzle-kit, tsx, vitest, typescript devDependencies), tsconfig.json, src/ and test/ directories.
**Files**: packages/core/package.json, packages/core/tsconfig.json
**Test**: `npm install -w core` succeeds. `npm run typecheck -w core` succeeds. Verify dependencies include: drizzle-orm, zod, cheerio. Verify devDependencies include: drizzle-kit, tsx, vitest, typescript.
**Depends on**: Step 1
**Parallelizable**: No

### Step 3a: Create Thriftly fixture corpus with images
**What**: Create Thriftly fixture files and images: 4 JSON files (3 valid + 1 invalid for testing rejection) with snake_case fields (id, title, price_cents, category, image_path, source_url, posted_at, description). image_path points to `thriftly/images/listing-NNN.jpg`. Create the placeholder image files in fixtures/thriftly/images/ (one real JPEG per fixture, reused across paths is fine — only that real bytes exist on disk for the score stage to read).
**Files**: fixtures/thriftly/listing-001.json, fixtures/thriftly/listing-002.json, fixtures/thriftly/listing-003.json, fixtures/thriftly/listing-004-invalid.json, fixtures/thriftly/images/listing-001.jpg, fixtures/thriftly/images/listing-002.jpg, fixtures/thriftly/images/listing-003.jpg
**Test**: All 7 files exist. Three valid JSON files parse successfully with `jq .`. listing-004-invalid.json is valid JSON but missing price_cents (for rejection testing). Image files are real JPEG bytes (at least 100 bytes each).
**Depends on**: none
**Parallelizable**: Yes

### Step 3b: Create SecondLook fixture corpus with images
**What**: Create SecondLook fixture files and images: 3 JSON files with fields listingId, name, priceUsd, tags, photoUrl, permalink, listedAt, details. photoUrl points to `secondlook/images/listing-NNN.jpg`. Create the placeholder image files in fixtures/secondlook/images/.
**Files**: fixtures/secondlook/listing-001.json, fixtures/secondlook/listing-002.json, fixtures/secondlook/listing-003.json, fixtures/secondlook/images/listing-001.jpg, fixtures/secondlook/images/listing-002.jpg, fixtures/secondlook/images/listing-003.jpg
**Test**: All 6 files exist. All JSON files parse successfully with `jq .`. Image files are real JPEG bytes.
**Depends on**: none
**Parallelizable**: Yes

### Step 3c: Create Reloop fixture corpus with images
**What**: Create Reloop fixture files and images: 3 HTML files, each with one `<div class="listing">` containing child elements .listing-title, .listing-price, .listing-image, .listing-url, .listing-date, .listing-description. .listing-image element contains a fixture-relative path string (not a URL), pointing to `reloop/images/listing-NNN.jpg`. Create the placeholder image files in fixtures/reloop/images/.
**Files**: fixtures/reloop/listing-001.html, fixtures/reloop/listing-002.html, fixtures/reloop/listing-003.html, fixtures/reloop/images/listing-001.jpg, fixtures/reloop/images/listing-002.jpg, fixtures/reloop/images/listing-003.jpg
**Test**: All 6 files exist. HTML files contain valid HTML with the expected class structure. Image files are real JPEG bytes.
**Depends on**: none
**Parallelizable**: Yes

### Step 4: Create dashboard package structure
**What**: Set up packages/dashboard with package.json (with react, react-dom dependencies; vite, @vitejs/plugin-react, vitest, typescript devDependencies; hono and @hono/node-server dependencies), tsconfig.json, vite.config.ts, and src/ directory structure for server and client.
**Files**: packages/dashboard/package.json, packages/dashboard/tsconfig.json, packages/dashboard/vite.config.ts
**Test**: `npm install -w dashboard` succeeds. `npm run typecheck -w dashboard` succeeds. Verify dependencies include: react, react-dom, hono, @hono/node-server. Verify devDependencies include: vite, @vitejs/plugin-react, vitest, typescript. vite.config.ts exists and configures dev proxy to `http://localhost:3000` for `/api`.
**Depends on**: Step 1
**Parallelizable**: No

### Step 5: Write Zod schemas for raw listings (3 sources)
**What**: Create packages/core/src/schema/raw.ts with ThriftlyRawSchema (id, title, price_cents, category, image_path, source_url, posted_at, description), SecondLookRawSchema (listingId, name, priceUsd, tags, photoUrl, permalink, listedAt, details), and ReloopRawSchema (title, price, imageUrl, sourceUrl, postedAt, description — to be parsed from HTML).
**Files**: packages/core/src/schema/raw.ts
**Test**: `npm run typecheck -w core` succeeds. Manual test: parse a sample fixture from each source using its parser (requires fixture files), verify schema accepts valid fields and rejects missing required fields.
**Depends on**: Step 2, Step 3a, Step 3b, Step 3c
**Parallelizable**: No

### Step 6: Write normalized listing schema
**What**: Create packages/core/src/schema/normalized.ts with NormalizedListingSchema (id: `${source}:${sourceId}`, source, sourceListingId, title, priceCents, category, imagePath, sourceUrl, postedAt, description) and type export. imagePath is a fixture-relative path (e.g., "thriftly/images/listing-001.jpg"), not a URL.
**Files**: packages/core/src/schema/normalized.ts
**Test**: `npm run typecheck -w core` succeeds. Schema enforces id format, all fields are non-optional except category and description.
**Depends on**: Step 2
**Parallelizable**: No

### Step 7: Write per-source ingest parsers
**What**: Create packages/core/src/ingest/thriftly.ts (JSON.parse, map to raw schema), packages/core/src/ingest/secondlook.ts (JSON.parse, map to raw schema), packages/core/src/ingest/reloop.ts (cheerio HTML parse, extract .listing-* classes, map to raw schema).
**Files**: packages/core/src/ingest/thriftly.ts, packages/core/src/ingest/secondlook.ts, packages/core/src/ingest/reloop.ts
**Test**: `npm run typecheck -w core` succeeds. Manual test each parser against a fixture file from its source, verify output matches raw schema shape.
**Depends on**: Step 5, Step 3a, Step 3b, Step 3c
**Parallelizable**: No

### Step 8: Write normalize function
**What**: Create packages/core/src/normalize/normalize.ts that accepts a RawListing (union of three source variants), validates against the normalized schema, and returns NormalizedListing. Maps Thriftly `price_cents` → `priceCents`, SecondLook `priceUsd` → `priceCents` (multiply by 100), Reloop string price → `priceCents` (parse and multiply by 100). Maps image_path/photoUrl to imagePath (all fixture-relative paths, not URLs). Maps source-specific field names to normalized names.
**Files**: packages/core/src/normalize/normalize.ts
**Test**: `npm run typecheck -w core` succeeds. Manual test: pass raw records from each source, verify output schema matches NormalizedListingSchema, verify price conversions are correct (USD to cents), verify imagePath is correct for all three sources.
**Depends on**: Step 5, Step 6
**Parallelizable**: No

### Step 9: Write ingest orchestrator
**What**: Create packages/core/src/ingest/index.ts that walks fixtures/ by source (thriftly/, secondlook/, reloop/), dispatches each file to the per-source parser, calls normalize on each parsed record, collects Zod validation errors per record, and outputs normalized records to stdout (or --out file). Exit code 0 on all records valid, 1 if any record failed validation; errors logged to stderr with listing id and missing field.
**Files**: packages/core/src/ingest/index.ts
**Test**: `npm run typecheck -w core` succeeds. Run `npm run ingest -w core` against fixtures/, verify 9 normalized records output (excluding listing-004-invalid.json), verify listing-004-invalid rejected with validation error logged. Verify zero HTTP requests made.
**Depends on**: Step 7, Step 8, Step 3a, Step 3b, Step 3c
**Parallelizable**: No

### Step 10: Write Drizzle ORM schema, migrations, and config
**What**: Create packages/core/src/db/schema.ts with Drizzle table definitions for listings (id, source, source_listing_id, title, price_cents, category, image_path, source_url, posted_at, description, created_at) and scores (id, listing_id, image_path, score, raw_response, created_at) with indexes on listingId and source. Create packages/core/src/db/client.ts that opens/creates the SQLite database at DATABASE_URL via node:sqlite driver, sets PRAGMA foreign_keys and journal_mode, runs migrations, and exports a query interface. Create packages/core/drizzle.config.ts pointing drizzle-kit at src/db/schema.ts and the SQLite dialect.
**Files**: packages/core/src/db/schema.ts, packages/core/src/db/client.ts, packages/core/drizzle.config.ts, drizzle/*.sql (auto-generated)
**Test**: `npm run typecheck -w core` succeeds. Manual test: create a test database, verify tables and indexes are created. Run `npx drizzle-kit generate` and verify SQL files are generated in drizzle/ directory with correct CREATE TABLE statements.
**Depends on**: Step 2
**Parallelizable**: No

### Step 11: Write vision scoring client
**What**: Create packages/core/src/score/visionClient.ts that reads the image file at imagePath from disk, base64-encodes it, POSTs to `${OLLAMA_HOST}${VISION_API_STYLE === 'openai' ? '/v1/chat/completions' : '/api/chat'}` with request body per API style (Ollama: `images: [base64]`, `stream: false`; OpenAI-compat: `data:image/jpeg;base64,...` URL), reads response according to API style (OpenAI: `.choices[0].message.content`, Ollama: `.message.content`), parses score 0-100 via Zod, and returns score.
**Files**: packages/core/src/score/visionClient.ts
**Test**: `npm run typecheck -w core` succeeds. Verify POST request URL construction is correct for both API styles. Zod schema for response shape is defined and rejects malformed responses. Verify imagePath is read from disk and base64-encoded before sending.
**Depends on**: Step 2
**Parallelizable**: No

### Step 12: Write score orchestrator and CLI entry point
**What**: Create packages/core/src/score/score.ts that reads normalized listings (from stdin or --in file), calls visionClient on each imagePath, upserts the listing into listings (`INSERT INTO listings (...) VALUES (...) ON CONFLICT (source, source_listing_id) DO UPDATE SET ...`) and inserts the resulting score row into scores, and outputs progress to stderr. Create packages/core/src/cli/score.ts CLI entry point that reads DATABASE_URL, OLLAMA_HOST, VISION_API_STYLE from env, calls score orchestrator. score is the sole owner of writing listings rows — no separate store CLI command exists — so a second run against the same fixtures updates in place instead of throwing a UNIQUE constraint violation.
**Files**: packages/core/src/score/score.ts, packages/core/src/cli/score.ts
**Test**: `npm run typecheck -w core` succeeds. Manual test with mocked visionClient: run against normalized fixture data, verify scores rows written to database, verify listings row upserted (first run inserts, second run updates), verify zero real network calls to any host other than mocked OLLAMA_HOST. Test file uses its own temp-file or `:memory:` SQLite database, not shared DATABASE_URL.
**Depends on**: Step 11, Step 10, Step 6
**Parallelizable**: No

### Step 13: Write rank query and CLI entry point
**What**: Create packages/core/src/rank/rank.ts with SQL query `SELECT l.*, MAX(s.score) as score FROM listings l LEFT JOIN scores s ON s.listing_id = l.id GROUP BY l.id ORDER BY score DESC` (handles case where a listing has one or multiple scores). Create packages/core/src/cli/rank.ts CLI entry point that reads DATABASE_URL from env, runs rank query via drizzle, formats as a table to stdout.
**Files**: packages/core/src/rank/rank.ts, packages/core/src/cli/rank.ts
**Test**: `npm run typecheck -w core` succeeds. Manual test: insert test data into database, run rank query, verify listings are ordered by score descending. Verify function exported from rank.ts is reused by CLI and dashboard server.
**Depends on**: Step 10
**Parallelizable**: No

### Step 14: Write alert builder and sender
**What**: Create packages/core/src/alert/buildAlert.ts that takes a ranked listing and score, checks if score >= ALERT_SCORE_THRESHOLD, builds a Telegram `sendMessage` payload (`{ chat_id: string, text: string, parse_mode: 'HTML' }`). Create packages/core/src/alert/sendAlert.ts that either writes payload to alerts-output/<listing-id>.json (with `:` replaced by `__` for Windows compatibility) and logs only listing id + threshold decision (dry-run, default), or POSTs to `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage` if ALERT_LIVE_SEND=true (mocked in tests, never real in CI).
**Files**: packages/core/src/alert/buildAlert.ts, packages/core/src/alert/sendAlert.ts
**Test**: `npm run typecheck -w core` succeeds. Manual test: build alert for a test listing, verify Telegram payload shape is valid JSON with required fields. In dry-run, verify alerts-output/ file is created with sanitized name and payload logged. Verify full Telegram body and bot token never logged.
**Depends on**: Step 6
**Parallelizable**: No

### Step 15: Write alert CLI entry point
**What**: Create packages/core/src/cli/alert.ts that reads DATABASE_URL, ALERT_SCORE_THRESHOLD, ALERT_LIVE_SEND, TELEGRAM_BOT_TOKEN from env, runs rank query, calls buildAlert and sendAlert for each ranked listing above threshold. Idempotent: a listing already alerted (via UNIQUE constraint on alerts.listing_id) is silently skipped on re-run.
**Files**: packages/core/src/cli/alert.ts
**Test**: `npm run typecheck -w core` succeeds. Manual test with mock database and dry-run mode: run CLI, verify alerts-output/ is populated with sanitized filenames, verify no real HTTP requests to Telegram. Test file uses its own temp-file or `:memory:` SQLite database.
**Depends on**: Step 13, Step 14
**Parallelizable**: No

### Step 16: Write ingest, score, rank, and alert CLI entry points with npm scripts
**What**: Create packages/core/src/cli/ingest.ts (reads no env vars, fixtures/ is hardcoded). Update packages/core/package.json to add npm scripts: `"ingest": "tsx src/cli/ingest.ts"`, `"score": "tsx src/cli/score.ts"`, `"rank": "tsx src/cli/rank.ts"`, `"alert": "tsx src/cli/alert.ts"` (all executed via tsx, not plain node).
**Files**: packages/core/src/cli/ingest.ts, packages/core/package.json
**Test**: `npm run ingest -w core` succeeds and outputs 9 normalized records. `npm run score -w core` reads normalized input and writes scores. `npm run rank -w core` outputs a ranked table (or message if DB is empty). `npm run alert -w core` processes alerts. All CLI scripts exit cleanly. Verify `tsx` is used, not plain `node`.
**Depends on**: Step 9, Step 12, Step 13, Step 15
**Parallelizable**: No

### Step 17: Write Hono server routes (core GET endpoints)
**What**: Create packages/dashboard/server/index.ts with Hono app registering GET routes: `GET /health` (returns `{ ok: true }`), `GET /api/listings?limit=10&source=` (queries DB via rank query, returns `{ listings: [{rank, id, source, title, priceCents, imagePath, score}] }` sorted by score DESC; limit validated as int 1..1000, source validated against enum; unknown values return 400), `GET /api/listings/:id` (returns `{ listing: {...}, scores: [...scores rows...] }` with imagePath and score, or 404). Never includes raw_response field in any response. No POST/PUT/PATCH/DELETE routes registered anywhere; Hono's default 404 handles any other method.
**Files**: packages/dashboard/server/index.ts
**Test**: `npm run typecheck -w dashboard` succeeds. Test routes in Vitest with Hono's test client; verify GET /api/listings returns valid schema, verify limit/source query params are validated, verify GET /api/listings/:id returns 404 for unknown id, verify POST/PUT/DELETE to any route returns 404, verify raw_response never appears in response bodies.
**Depends on**: Step 4, Step 10, Step 13
**Parallelizable**: No

### Step 18: Write Hono server route for streaming image files
**What**: Add to packages/dashboard/server/index.ts a GET route `GET /api/images/:listingId` that reads the fixture image file backing that listing (from imagePath stored in DB: `fixtures/<source>/images/<file>.jpg`), streams it with the appropriate `Content-Type: image/jpeg`, so the React client can render real thumbnails via `<img src="/api/images/{id}">`. GET-only, no mutation; 404 if the listing id doesn't resolve or its backing file doesn't exist on disk.
**Files**: packages/dashboard/server/index.ts
**Test**: `npm run typecheck -w dashboard` succeeds. Test route in Vitest; verify image file is read from disk, streamed with correct Content-Type, verified 404 for unknown listing id or missing file, verify GET-only (POST returns 404).
**Depends on**: Step 17, Step 10
**Parallelizable**: No

### Step 19: Write React dashboard client
**What**: Create packages/dashboard/client/src/App.tsx that fetches `/api/listings`, renders a table with columns: rank, id, source, title, price (formatted USD), score, image thumbnail (via `<img src="/api/images/{id}">`). Include error handling for fetch failures and loading state. Create packages/dashboard/client/src/main.tsx (entry point), packages/dashboard/client/index.html (Vite HTML shell).
**Files**: packages/dashboard/client/src/App.tsx, packages/dashboard/client/src/main.tsx, packages/dashboard/client/index.html
**Test**: `npm run typecheck -w dashboard` succeeds. Manual test with dev server: `npm run dev -w dashboard`, verify Vite proxy redirects `/api/*` to localhost:3000, verify table renders with real data from fetch or mock data, verify error handling for fetch failures, verify thumbnails load via image stream route.
**Depends on**: Step 4
**Parallelizable**: No

### Step 20: Write dashboard tests
**What**: Create packages/dashboard/server/server.test.ts (Hono routes: GET requests return 200 with valid schema, GET /api/images/:listingId streams a file, POST/PUT/DELETE return 404, raw_response never appears) and packages/dashboard/client/src/App.test.tsx (App renders with mocked fetch, displays listings in table, handles fetch errors gracefully). Verify no mutation routes exist anywhere in the app.
**Files**: packages/dashboard/server/server.test.ts, packages/dashboard/client/src/App.test.tsx
**Test**: `npm run test -w dashboard` passes all tests. Server tests verify no mutation routes exist, client tests verify no POST/PUT/PATCH/DELETE logic anywhere. Test file uses its own temp-file or `:memory:` SQLite database, not shared DATABASE_URL.
**Depends on**: Step 17, Step 18, Step 19
**Parallelizable**: No
**Rollback**: Reversible via `git restore`, no external side effects.

### Step 21: Write ingest and normalize tests
**What**: Create packages/core/src/ingest/ingest.test.ts (valid fixtures pass, invalid fixture listing-004-invalid.json is rejected with error logged, normalized records have correct shapes). Create packages/core/src/normalize/normalize.test.ts (raw records from each source map to normalized schema, price conversions (USD → cents, string → cents) are correct, imagePath is correct for all three sources).
**Files**: packages/core/src/ingest/ingest.test.ts, packages/core/src/normalize/normalize.test.ts
**Test**: `npm run test -w core` passes both test files. Coverage includes all three source types and the rejection path. Test files use temp-file or `:memory:` SQLite databases, not shared DATABASE_URL.
**Depends on**: Step 9, Step 8
**Parallelizable**: No

### Step 22: Write score, rank, and alert tests
**What**: Create packages/core/src/score/score.test.ts (mocked visionClient returns 0-100 score, listings upserted and scores rows written to database, no real network calls). Create packages/core/src/rank/rank.test.ts (rank query returns listings sorted by score DESC, handles ties and missing scores via MAX(score)). Create packages/core/src/alert/alert.test.ts (buildAlert filters by threshold, sendAlert dry-run writes sanitized-filename file and logs only listing id + decision, sendAlert with ALERT_LIVE_SEND=true mocks Telegram POST, never makes real call in CI, re-run is a no-op for already-alerted listings).
**Files**: packages/core/src/score/score.test.ts, packages/core/src/rank/rank.test.ts, packages/core/src/alert/alert.test.ts
**Test**: `npm run test -w core` passes all three test files. No real HTTP requests to OLLAMA_HOST or Telegram in any test. Test files use temp-file or `:memory:` SQLite databases, not shared DATABASE_URL.
**Depends on**: Step 12, Step 13, Step 15
**Parallelizable**: No

### Step 23: Write security check script (tree and git history)
**What**: Create scripts/check-forbidden-strings.mjs (Node script with no external dependencies) that runs two scans: (1) `git ls-files` to get tracked files, read each as text (skip binaries by extension denylist: .png .jpg .jpeg .gif .ico .webp .pdf .zip .db .sqlite .woff .woff2 .ttf .eot), test against three regex groups; (2) `git rev-list --all` and for each commit, grep its diff against the same three pattern groups — catches strings committed and later removed. Test file contents and commit diffs against three groups (exact patterns defined only in the script itself, built from fragments so the script does not self-match its own tree scan): private-network/CGNAT IP-range prefixes and internal broker ports; an internal package name; a 15-entry case-insensitive real-marketplace-name denylist. Exit 1 if any pattern matched, 0 otherwise. Output all matches as `file:line: pattern` (tree) or `commit:file: pattern` (history) and one summary line. Add to root package.json: `"check:secrets": "node scripts/check-forbidden-strings.mjs"`.
**Files**: scripts/check-forbidden-strings.mjs, package.json (modified)
**Test**: `npm run check:secrets` exits 0 and outputs "no forbidden strings found" on clean repo. Inject a test pattern matching one of the checker's own patterns in a comment, run again, verify it fails with exit 1 and pattern is reported with correct commit hash or file:line format. Flag for Preston: the real-site denylist (15 names above) is a starting default — review and extend before first push per plan.md's risk areas.
**Depends on**: Step 1
**Parallelizable**: No

### Step 24: Install git pre-push hook
**What**: Create scripts/install-git-hooks.mjs that creates .git/hooks/pre-push (two lines: `#!/bin/sh` + `npm run check:secrets`) and makes it executable. Wire to npm `prepare` lifecycle script in root package.json: `"prepare": "node scripts/install-git-hooks.mjs"` so `npm install` sets it up automatically. Note: .git/hooks/pre-push is untracked (it's in .gitignore — git doesn't commit hooks); rollback is manual deletion (`rm .git/hooks/pre-push`) or reinstall.
**Files**: scripts/install-git-hooks.mjs, scripts/hooks/pre-push, package.json (modified)
**Test**: `npm install` creates .git/hooks/pre-push and it's executable (`ls -la .git/hooks/pre-push` shows `x` bit). Manual test: try to push with a forbidden string in a commit, verify pre-push hook blocks with `npm run check:secrets` failure (if VISION_API_STYLE or other env var accidentally staged).
**Depends on**: Step 23
**Parallelizable**: No
**Rollback**: Manually delete .git/hooks/pre-push; reinstate with `npm run prepare` if needed.

### Step 25: Write GitHub Actions CI workflow
**What**: Create .github/workflows/ci.yml with four separate jobs (lint, typecheck, test, security-check), each running on push to main and pull requests. Lint job runs `npm run lint`. Typecheck job runs `npm run typecheck`. Test job runs `npm run test`. Security-check job runs `npm run check:secrets`. All jobs must pass for a build to be green. This workflow file is part of the same first commit as everything else (not committed separately beforehand).
**Files**: .github/workflows/ci.yml
**Test**: Commit the workflow file as part of Step 27 (first commit), verify it parses as valid YAML, verify job names and script commands match package.json scripts.
**Depends on**: Step 23
**Parallelizable**: No
**Rollback**: Reversible via `git restore` on uncommitted changes, or `git reset --hard` if already committed to a local branch not yet pushed.

### Step 26: Write README and LICENSE
**What**: Create README.md following the house convention (referenced at ~/.claude/commands/readme.md, not duplicated here). Include project overview, architecture diagram (from plan), setup instructions, usage of each CLI command (ingest, score, rank, alert via `npm run <stage> -w core`), dashboard walkthrough, test instructions, security model, and tech stack. Create MIT LICENSE file at repo root with copyright year and Preston Bernstein.
**Files**: README.md, LICENSE
**Test**: Both files exist. README includes setup, CLI usage (showing `npm run`), test commands, security notes on fixture images and denylist review. LICENSE is valid MIT text.
**Depends on**: none (can write anytime)
**Parallelizable**: Yes
**Rollback**: Reversible via `git restore`, no external side effects.

### Step 27: Make initial commit and verify hygiene
**What**: Stage all files, create first commit with message "Initial commit: listing-vision-pipeline full build" (no AI-attribution text), authored as Preston Bernstein <77080227+preston-bernstein@users.noreply.github.com>. This single commit includes everything: repo scaffold, packages, fixtures, parsers, database schema, CLI stages, dashboard server/client, tests, CI workflow, security check, and documentation. Verify security check passes post-commit.
**Files**: all (nothing new, just commit)
**Test**: `git log` shows one commit. `git log --format='%an <%ae>'` shows "Preston Bernstein <77080227+preston-bernstein@users.noreply.github.com>". `git show --name-status HEAD` lists all files. No commit message contains "Claude", "Generated with", "Co-Authored-By", or any AI-tool attribution. Run `npm run check:secrets` and it exits 0 (security check passes on full repo, including git history, which is now one commit). Verify no fixture images, SQLite DB files, or real .env leaked into the commit.
**Depends on**: Step 16, Step 18, Step 21, Step 22, Step 24, Step 25, Step 26
**Parallelizable**: No

## Rollback plan

**For Steps 1-2 (repo scaffold and packages):** Delete created directories and files, start over.

**For Steps 3a-3c (fixtures and images):** Delete fixture directories, start over.

**For Steps 4-18 (pipeline stages and dashboard):** Run `git reset --hard HEAD~1` to undo the last commit (if already committed) or `git restore --staged .` and `git restore .` to discard uncommitted changes. Fixture files and database remain on disk (rerun Step 3a/3b/3c if needed).

**For Steps 20-24 (tests, security checks, git hooks):** Run `git restore` to discard uncommitted test and config files. For installed hooks: manually delete `.git/hooks/pre-push` or reinstall via `npm run prepare`.

**For Step 25 (CI workflow):** Run `git restore .github/workflows/ci.yml` (uncommitted) or `git reset --hard HEAD~1` (committed but not pushed).

**For Step 26-27 (README, LICENSE, first commit):** Before pushing anywhere, `git reset --hard HEAD~1` will undo the commit. After pushing to a public remote, contact GitHub support for history rewrite (not reversible without force-push).

**General rule:** All steps up to Step 27 are reversible via `git restore` (uncommitted) or `git reset --hard` (committed but not pushed). Once pushed to GitHub, commit history cannot be unwritten without a force-push (use with caution on a public portfolio repo).
