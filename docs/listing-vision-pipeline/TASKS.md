# Tasks: listing-vision-pipeline

Generated from: docs/listing-vision-pipeline/ on 2026-08-10

## Status legend
- [ ] pending
- [>] in progress
- [x] done
- [!] blocked

## Tasks

### Task 1: Repo scaffold with packages and configuration
**Status**: [x] done
**Files**: package.json, tsconfig.base.json, .gitignore, .env.example
**Test**: `npm install` at root completes without error. All four files exist. .env.example lists at minimum: OLLAMA_HOST, DATABASE_URL, ALERT_SCORE_THRESHOLD, ALERT_LIVE_SEND, VISION_API_STYLE, TELEGRAM_BOT_TOKEN, PORT. .gitignore contains `data/`, `alerts-output/`, `node_modules/`, `dist/`, `.env.local`, `.env`.
**Depends on**: none
**Parallelizable**: No
**Notes**:

### Task 2: Create core package structure
**Status**: [x] done
**Files**: packages/core/package.json, packages/core/tsconfig.json
**Test**: `npm install -w core` succeeds. `npm run typecheck -w core` succeeds. Verify dependencies include: drizzle-orm, zod, cheerio. Verify devDependencies include: drizzle-kit, tsx, vitest, typescript.
**Depends on**: Task 1
**Parallelizable**: No
**Notes**:

### Task 3a: Create Thriftly fixture corpus with images
**Status**: [x] done
**Files**: fixtures/thriftly/listing-001.json, fixtures/thriftly/listing-002.json, fixtures/thriftly/listing-003.json, fixtures/thriftly/listing-004-invalid.json, fixtures/thriftly/images/listing-001.jpg, fixtures/thriftly/images/listing-002.jpg, fixtures/thriftly/images/listing-003.jpg
**Test**: All 7 files exist. Three valid JSON files parse with `jq .`. listing-004-invalid.json is valid JSON but missing price_cents. Image files are real JPEG bytes (≥100 bytes each).
**Depends on**: none
**Parallelizable**: Yes
**Notes**:

### Task 3b: Create SecondLook fixture corpus with images
**Status**: [x] done
**Files**: fixtures/secondlook/listing-001.json, fixtures/secondlook/listing-002.json, fixtures/secondlook/listing-003.json, fixtures/secondlook/images/listing-001.jpg, fixtures/secondlook/images/listing-002.jpg, fixtures/secondlook/images/listing-003.jpg
**Test**: All 6 files exist. All JSON files parse with `jq .`. Image files are real JPEG bytes.
**Depends on**: none
**Parallelizable**: Yes
**Notes**:

### Task 3c: Create Reloop fixture corpus with images
**Status**: [x] done
**Files**: fixtures/reloop/listing-001.html, fixtures/reloop/listing-002.html, fixtures/reloop/listing-003.html, fixtures/reloop/images/listing-001.jpg, fixtures/reloop/images/listing-002.jpg, fixtures/reloop/images/listing-003.jpg
**Test**: All 6 files exist. HTML files contain valid HTML with the expected class structure. Image files are real JPEG bytes.
**Depends on**: none
**Parallelizable**: Yes
**Notes**:

### Task 4: Create dashboard package structure
**Status**: [x] done
**Files**: packages/dashboard/package.json, packages/dashboard/tsconfig.json, packages/dashboard/vite.config.ts
**Test**: `npm install -w dashboard` succeeds. `npm run typecheck -w dashboard` succeeds. Verify dependencies include: react, react-dom, hono, @hono/node-server. Verify devDependencies include: vite, @vitejs/plugin-react, vitest, typescript. vite.config.ts configures dev proxy to `http://localhost:3000` for `/api`.
**Depends on**: Task 1
**Parallelizable**: No
**Notes**:

### Task 5: Write Zod schemas for raw listings (3 sources)
**Status**: [x] done
**Files**: packages/core/src/schema/raw.ts
**Test**: `npm run typecheck -w core` succeeds. Schema accepts valid fields and rejects missing required fields for all three sources.
**Depends on**: Task 2, Task 3a, Task 3b, Task 3c
**Parallelizable**: No
**Notes**:

### Task 6: Write normalized listing schema
**Status**: [x] done
**Files**: packages/core/src/schema/normalized.ts
**Test**: `npm run typecheck -w core` succeeds. Schema enforces id format, all fields non-optional except category and description.
**Depends on**: Task 2
**Parallelizable**: No
**Notes**:

### Task 7: Write per-source ingest parsers
**Status**: [x] done
**Files**: packages/core/src/ingest/thriftly.ts, packages/core/src/ingest/secondlook.ts, packages/core/src/ingest/reloop.ts
**Test**: `npm run typecheck -w core` succeeds. Each parser run against a fixture file from its source produces output matching the raw schema shape.
**Depends on**: Task 5, Task 3a, Task 3b, Task 3c
**Parallelizable**: No
**Notes**:

### Task 8: Write normalize function
**Status**: [x] done
**Files**: packages/core/src/normalize/normalize.ts
**Test**: `npm run typecheck -w core` succeeds. Output schema matches NormalizedListingSchema, price conversions correct (USD to cents), imagePath correct for all three sources.
**Depends on**: Task 5, Task 6
**Parallelizable**: No
**Notes**:

### Task 9: Write ingest orchestrator
**Status**: [x] done
**Files**: packages/core/src/ingest/index.ts
**Test**: `npm run typecheck -w core` succeeds. Running against fixtures/ produces 9 normalized records (excluding listing-004-invalid.json), which is rejected with a logged validation error. Zero HTTP requests made.
**Depends on**: Task 7, Task 8, Task 3a, Task 3b, Task 3c
**Parallelizable**: No
**Notes**:

### Task 10: Write Drizzle ORM schema, migrations, and config
**Status**: [x] done
**Files**: packages/core/src/db/schema.ts, packages/core/src/db/client.ts, packages/core/drizzle.config.ts, drizzle/*.sql (auto-generated)
**Test**: `npm run typecheck -w core` succeeds. Tables and indexes created. `npx drizzle-kit generate` produces SQL files in drizzle/ with correct CREATE TABLE statements.
**Depends on**: Task 2
**Parallelizable**: No
**Notes**:

### Task 11: Write vision scoring client
**Status**: [x] done
**Files**: packages/core/src/score/visionClient.ts
**Test**: `npm run typecheck -w core` succeeds. POST request URL correct for both API styles. Zod schema for response shape rejects malformed responses. imagePath read from disk and base64-encoded before sending.
**Depends on**: Task 2
**Parallelizable**: No
**Notes**:

### Task 12: Write score orchestrator and CLI entry point
**Status**: [x] done
**Files**: packages/core/src/score/score.ts, packages/core/src/cli/score.ts
**Test**: `npm run typecheck -w core` succeeds. Mocked visionClient: scores rows written, listings row upserted (insert then update on re-run), zero real network calls other than mocked OLLAMA_HOST.
**Depends on**: Task 11, Task 10, Task 6
**Parallelizable**: No
**Notes**:

### Task 13: Write rank query and CLI entry point
**Status**: [x] done
**Files**: packages/core/src/rank/rank.ts, packages/core/src/cli/rank.ts
**Test**: `npm run typecheck -w core` succeeds. Rank query returns listings ordered by score DESC. Function exported from rank.ts is reused by CLI and dashboard server.
**Depends on**: Task 10
**Parallelizable**: No
**Notes**:

### Task 14: Write alert builder and sender
**Status**: [x] done
**Files**: packages/core/src/alert/buildAlert.ts, packages/core/src/alert/sendAlert.ts
**Test**: `npm run typecheck -w core` succeeds. Telegram payload shape valid. Dry-run writes sanitized-filename file, logs only listing id + decision. Full Telegram body/token never logged.
**Depends on**: Task 6
**Parallelizable**: No
**Notes**:

### Task 15: Write alert CLI entry point
**Status**: [x] done
**Files**: packages/core/src/cli/alert.ts
**Test**: `npm run typecheck -w core` succeeds. Dry-run mode: alerts-output/ populated with sanitized filenames, no real HTTP requests to Telegram. Idempotent — re-run skips already-alerted listings.
**Depends on**: Task 13, Task 14
**Parallelizable**: No
**Notes**:

### Task 16: Write ingest CLI entry point and wire npm scripts
**Status**: [x] done
**Files**: packages/core/src/cli/ingest.ts, packages/core/package.json
**Test**: `npm run ingest -w core` outputs 9 normalized records. `npm run score -w core`, `npm run rank -w core`, `npm run alert -w core` all exit cleanly. All CLI scripts run via `tsx`, not plain `node`.
**Depends on**: Task 9, Task 12, Task 13, Task 15
**Parallelizable**: No
**Notes**:

### Task 17: Write Hono server routes (core GET endpoints)
**Status**: [x] done
**Files**: packages/dashboard/server/index.ts
**Test**: `npm run typecheck -w dashboard` succeeds. GET /api/listings validates limit/source params, returns valid schema. GET /api/listings/:id returns 404 for unknown id. POST/PUT/DELETE return 404. raw_response never appears in responses.
**Depends on**: Task 4, Task 10, Task 13
**Parallelizable**: No
**Notes**:

### Task 18: Write Hono server route for streaming image files
**Status**: [x] done
**Files**: packages/dashboard/server/index.ts
**Test**: `npm run typecheck -w dashboard` succeeds. GET /api/images/:listingId streams the correct file with Content-Type: image/jpeg. 404 for unknown listing id or missing file. GET-only (POST returns 404).
**Depends on**: Task 17, Task 10
**Parallelizable**: No
**Notes**:

### Task 19: Write React dashboard client
**Status**: [x] done
**Files**: packages/dashboard/client/src/App.tsx, packages/dashboard/client/src/main.tsx, packages/dashboard/client/index.html
**Test**: `npm run typecheck -w dashboard` succeeds. Table renders with data, error handling for fetch failures, thumbnails load via image stream route.
**Depends on**: Task 4
**Parallelizable**: No
**Notes**:

### Task 20: Write dashboard tests
**Status**: [x] done
**Files**: packages/dashboard/server/server.test.ts, packages/dashboard/client/src/App.test.tsx
**Test**: `npm run test -w dashboard` passes. No mutation routes exist anywhere. Test files use temp-file or `:memory:` SQLite DB.
**Depends on**: Task 17, Task 18, Task 19
**Parallelizable**: No
**Notes**:

### Task 21: Write ingest and normalize tests
**Status**: [x] done
**Files**: packages/core/src/ingest/ingest.test.ts, packages/core/src/normalize/normalize.test.ts
**Test**: `npm run test -w core` passes both files. Coverage includes all three source types and the rejection path.
**Depends on**: Task 9, Task 8
**Parallelizable**: No
**Notes**:

### Task 22: Write score, rank, and alert tests
**Status**: [x] done
**Files**: packages/core/src/score/score.test.ts, packages/core/src/rank/rank.test.ts, packages/core/src/alert/alert.test.ts
**Test**: `npm run test -w core` passes all three files. No real HTTP requests to OLLAMA_HOST or Telegram in any test. Temp-file or `:memory:` SQLite DBs used.
**Depends on**: Task 12, Task 13, Task 15
**Parallelizable**: No
**Notes**:

### Task 23: Write security check script (tree and git history)
**Status**: [x] done
**Files**: scripts/check-forbidden-strings.mjs, package.json (modified)
**Test**: `npm run check:secrets` exits 0 clean. Injecting a forbidden pattern makes it fail with exit 1 and correct file:line or commit:file format.
**Depends on**: Task 1
**Parallelizable**: No
**Notes**:

### Task 24: Install git pre-push hook
**Status**: [x] done
**Files**: scripts/install-git-hooks.mjs, scripts/hooks/pre-push, package.json (modified)
**Test**: `npm install` creates .git/hooks/pre-push, executable.
**Depends on**: Task 23
**Parallelizable**: No
**Notes**:

### Task 25: Write GitHub Actions CI workflow
**Status**: [x] done
**Files**: .github/workflows/ci.yml
**Test**: Valid YAML, job names/commands match package.json scripts.
**Depends on**: Task 23
**Parallelizable**: No
**Notes**:

### Task 26: Write README and LICENSE
**Status**: [x] done
**Files**: README.md, LICENSE
**Test**: Both exist. README includes setup, CLI usage, test commands, security notes. LICENSE is valid MIT text.
**Depends on**: none
**Parallelizable**: Yes
**Notes**:

### Task 27: Make initial commit and verify hygiene
**Status**: [ ] pending
**Files**: all (nothing new, just commit)
**Test**: One commit, correct author, no AI-attribution text, `npm run check:secrets` exits 0.
**Depends on**: Task 16, Task 18, Task 21, Task 22, Task 24, Task 25, Task 26
**Parallelizable**: No
**Notes**:

## Blocked / open
(populated during implementation)
