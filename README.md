# listing-vision-pipeline

Ingests fake resale-listing fixtures, scores each listing's photo with a
vision model, ranks the results, and alerts on the highest scorers — a
clean-room rebuild of a resale-listing scoring pipeline's architecture,
using fabricated data so it runs fully offline.

[![CI](https://github.com/preston-bernstein/listing-vision-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/preston-bernstein/listing-vision-pipeline/actions/workflows/ci.yml)  [![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6)](https://www.typescriptlang.org/)  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

This is a portfolio demo, not a production scraper. It is not connected to
any live site: every listing comes from a bundled fixture corpus, and the
pipeline makes no network calls except to a locally configured vision
endpoint. It exists to show the pipeline *shape* — ingest, normalize,
score, rank, alert, display — that a real system of this kind uses,
without exposing or reusing any private code.

## How it works

```
fixtures/{thriftly,secondlook,reloop}/
        |
        v
  ingest      per-source parser -> RawListing
        |
        v
  normalize   Zod validation -> NormalizedListing (common shape)
        |
        v
  score       read image bytes, POST to a vision endpoint,
              store the listing + its score (0-100)
        |
        v
  rank        SQL query: MAX(score) per listing, ordered DESC
        |
        +-----------------------+
        v                       v
  alert                   dashboard
  Telegram-shaped         Hono API + React UI,
  payload, dry-run        read-only GET routes
  by default
```

Each stage is a standalone CLI script, so you can run `ingest`, `score`,
`rank`, and `alert` one at a time and inspect the database between steps.
The dashboard reads from the same database through the same `core`
package, so there's one definition of the data shape for both the CLI
and the UI.

### Security model

The pipeline models a private production system's architecture, so
keeping the repo safe to publish is a real design constraint, not an
afterthought. `scripts/check-forbidden-strings.mjs` handles it:

1. It scans every currently tracked file for three pattern groups:
   private-network / CGNAT IP-range prefixes, an internal library name, and
   a denylist of real resale-marketplace names (see
   [`scripts/check-forbidden-strings.mjs`](scripts/check-forbidden-strings.mjs)
   for the exact patterns — deliberately not repeated here, so this file
   doesn't duplicate the same literal strings the checker exists to keep out
   of the tree).
2. It then walks the full git history (`git rev-list --all`) and greps
   every commit's diff against the same patterns — catching a string
   that was committed once and later removed, which a tree-only scan
   would miss.
3. It reads files by a binary-extension denylist rather than a text
   allowlist, so an unrecognized file type is scanned by default
   instead of silently skipped.

The check runs in three places: as the `check:secrets` npm script, as a
separate job in CI, and as a pre-push git hook installed automatically
by `npm install` (via the `prepare` lifecycle script). Any one of the
three failing blocks the string from reaching the public remote.

## Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js 22+, TypeScript |
| Monorepo | npm workspaces |
| Validation | Zod |
| Database | SQLite (`node:sqlite`) + Drizzle ORM |
| API | Hono + `@hono/node-server` |
| Frontend | React + Vite |
| CLI execution | tsx |
| Testing | Vitest |
| CI | GitHub Actions |

## Project layout

```
listing-vision-pipeline/
├── fixtures/         fake sources: thriftly, secondlook, reloop
├── packages/
│   ├── core/          ingest, normalize, score, rank, alert, CLI
│   └── dashboard/     Hono API server + React/Vite client
├── scripts/           security check + git hook installer
└── .github/workflows/ CI: lint, typecheck, test, security-check
```

## Quick start

### Prerequisites

- Node.js 22+
- A running Ollama server, or any OpenAI-compatible chat endpoint,
  reachable at `OLLAMA_HOST` — needed only for the `score` stage.
  `ingest`, `rank`, `alert`, and the dashboard work without one.

```bash
git clone https://github.com/preston-bernstein/listing-vision-pipeline.git
cd listing-vision-pipeline
npm install
cp .env.example .env
npm test
```

## Configuration

All config lives in `.env`. See [`.env.example`](.env.example).

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Base URL of the vision-scoring endpoint the `score` stage calls. Validated at startup as a well-formed `http://` or `https://` URL. |
| `DATABASE_URL` | `file:./data/app.db` | Path to the local SQLite database file. |
| `VISION_API_STYLE` | `ollama` | Request shape sent to `OLLAMA_HOST`: `ollama` for `/api/chat`, `openai` for `/v1/chat/completions`. |
| `ALERT_SCORE_THRESHOLD` | `70` | Minimum aggregate score (0-100) a listing needs to trigger an alert. |
| `ALERT_LIVE_SEND` | `false` | When `true`, the `alert` stage also sends the payload to the Telegram Bot API. Defaults to dry-run: payload written to disk, zero network calls. |
| `TELEGRAM_BOT_TOKEN` | `YOUR_TELEGRAM_BOT_TOKEN` | Bot token used only when `ALERT_LIVE_SEND=true`. |
| `PORT` | `3000` | Port the dashboard's Hono server listens on. |

## Running the pipeline

Each stage is a CLI script under `packages/core/src/cli/`, executed with
`tsx` through an npm workspace command. Run them in order — each reads
what the previous stage wrote to the database.

```bash
npm run ingest -w core   # parse fixtures/, validate with Zod, print normalized records
npm run score -w core    # read each listing's image, score it via OLLAMA_HOST, store the result
npm run rank -w core     # print listings ordered by descending score
npm run alert -w core    # build alert payloads for listings at or above ALERT_SCORE_THRESHOLD
```

`ingest` makes no network calls. `score` is the only stage that needs a
reachable vision endpoint. `alert` writes one JSON file per matching
listing to `alerts-output/` and makes no outbound call unless
`ALERT_LIVE_SEND=true`. Running `alert` twice against the same data
does not produce a second alert for a listing already alerted.

## Dashboard

The dashboard is a read-only view over the same database: a Hono API
plus a React/Vite client. Start both in separate terminals.

```bash
npm run dev:server -w dashboard   # Hono API on PORT (default 3000)
npm run dev -w dashboard          # Vite dev server, proxies /api to the server above
```

Every dashboard route (`GET /api/listings`, `GET /api/listings/:id`,
`GET /api/images/:listingId`, `GET /health`) is GET-only. No route
creates, updates, or deletes anything, and any other HTTP method on any
path returns a 404.

## Tests

```bash
npm test
```

Runs the Vitest suite across both packages — ingest, normalize, score,
rank, alert, and dashboard route tests — each against its own temp-file
or in-memory SQLite database so parallel test runs don't race on
migrations or locking.

## License

MIT — see [LICENSE](LICENSE).
