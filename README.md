# listing-vision-pipeline

listing-vision-pipeline is a TypeScript demo that scores resale-listing photos with a vision model, ranks the listings, and alerts on the top scorers. It shows the shape of a real scoring pipeline (ingest, normalize, score, rank, alert, display) and runs offline on fake data.

[![CI](https://github.com/preston-bernstein/listing-vision-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/preston-bernstein/listing-vision-pipeline/actions/workflows/ci.yml)

This is a portfolio demo, not a scraper. Every listing comes from the fixtures in `fixtures/`. The only network call is to a vision endpoint you configure. It reuses no private code.

## Each stage is a separate script

```
fixtures/{thriftly,secondlook,reloop}
   ingest     parse each source into a RawListing
   normalize  validate with Zod into one NormalizedListing shape
   score      send the image to a vision endpoint, store a 0-100 score
   rank       SQL query: top score per listing, highest first
   alert      write a Telegram-shaped payload (dry run by default)
   dashboard  read-only Hono API and React UI
```

You can run `ingest`, `score`, `rank` and `alert` one at a time and inspect the SQLite database between steps. The dashboard uses the same `core` package, so the CLI and the UI share one data shape.

## Run it

You need Node.js 22 or newer. Only `score` needs a vision endpoint: an Ollama server, or any OpenAI-compatible chat endpoint, at `OLLAMA_HOST`.

1. Install and test:

   ```bash
   npm install
   cp .env.example .env
   npm test
   ```

2. Export the variables. Nothing in the repo loads `.env` for you:

   ```bash
   set -a; source .env; set +a
   ```

3. Run the stages in order. Each reads what the last one wrote:

   ```bash
   npm run ingest -w core   # parse and validate the fixtures
   npm run score -w core    # score each image through OLLAMA_HOST
   npm run rank -w core     # print listings by descending score
   npm run alert -w core    # write alerts for listings at or above the threshold
   ```

`alert` writes one JSON file per listing to `alerts-output/`. It sends nothing unless `ALERT_LIVE_SEND=true`. It skips a listing it already alerted.

## Start the dashboard

Run these in two terminals:

```bash
npm run dev:server -w dashboard   # Hono API on PORT (default 3000)
npm run dev -w dashboard          # Vite dev server, proxies /api to the API
```

The routes are `GET /api/listings`, `GET /api/listings/:id`, `GET /api/images/:listingId` and `GET /health`. Every other method or path returns 404.

## Configuration

Settings live in `.env`. See `.env.example`.

| Variable | Default | Use |
|---|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` | Vision endpoint for `score`. Must be a valid `http` or `https` URL. |
| `DATABASE_URL` | `file:./data/app.db` | SQLite file. The `score`, `rank` and `alert` stages fail if it is unset. |
| `VISION_API_STYLE` | `ollama` | `ollama` calls `/api/chat`. `openai` calls `/v1/chat/completions`. |
| `ALERT_SCORE_THRESHOLD` | `70` | Minimum score (0-100) that triggers an alert. |
| `ALERT_LIVE_SEND` | `false` | `true` also sends to the Telegram Bot API. |
| `TELEGRAM_BOT_TOKEN` | placeholder | Used only when `ALERT_LIVE_SEND=true`. |
| `PORT` | `3000` | Dashboard API port. |

## A script keeps private strings out of the repo

The demo copies a private system's design, so `scripts/check-forbidden-strings.mjs` blocks private network prefixes, an internal library name and real marketplace names. It scans every tracked file and every commit in the git history. It runs as `npm run check:secrets`, as a CI job, and as a pre-push hook that `npm install` sets up. The patterns live only in the script.

## Layout

- `fixtures/`: fake sources thriftly, secondlook and reloop.
- `packages/core/`: ingest, normalize, score, rank, alert and the CLI.
- `packages/dashboard/`: Hono API server and React/Vite client.
- `scripts/`: the string check and the hook installer.
- `docs/listing-vision-pipeline/`: the spec.

The stack is npm workspaces, Zod, SQLite (`node:sqlite`) with Drizzle, Hono, React, Vite, tsx and Vitest.

## License

MIT. See [LICENSE](LICENSE).
