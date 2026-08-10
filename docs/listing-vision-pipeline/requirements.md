# Requirements: listing-vision-pipeline

## Problem statement
A public GitHub portfolio needs a demo that shows how a resale-listing scoring pipeline works, without exposing or reusing any code from the private production system it's modeled on. Hiring managers and collaborators reviewing the portfolio have no way to see the pipeline's architecture today, because the real implementation is private and contains site-specific scraping logic that cannot be shared. This repo solves that by rebuilding the same pipeline *shape* — ingest, normalize, score, rank, alert, display — from scratch, using fake fixture data instead of live scraping, so the architecture is visible and defensible with zero exposure risk.

## Users / stakeholders
- Repo owner (Preston Bernstein) — builds, maintains, and showcases the repo.
- Portfolio reviewers (recruiters, engineers, collaborators) — read the code and README to evaluate architecture and code quality.
- CI (GitHub Actions) — runs lint, typecheck, and test on every push and pull request.
- Future maintainers/forkers — clone the repo and run the pipeline locally against bundled fixtures.

## Functional requirements
1. The system shall ingest listing data only from a bundled fixtures directory of fake HTML/JSON files, making zero network requests during ingest to any live site — defined as any HTTP(S) host other than the address configured in `OLLAMA_HOST`.
2. The system shall validate each raw fixture record against a Zod schema during normalization, and shall reject any record missing a required field instead of silently dropping or passing it through, reporting the rejection by writing one structured line per failed record to stderr containing the record's id and the missing/invalid field name(s).
3. The system shall produce a normalized listing record as the output of the normalize stage, validated against a single NormalizedListingSchema so every normalized record has the same field names and types regardless of source.
4. The system shall send each normalized listing's image reference to a vision-scoring endpoint whose address is read from the `OLLAMA_HOST` environment variable, using the request style selected by the `VISION_API_STYLE` environment variable (`"ollama"` for an Ollama-style `/api/chat` request, or `"openai"` for an OpenAI-compatible `/chat/completions` request) — exactly one style per run, never both simultaneously.
5. The system shall persist each vision-scoring result (a score — a real number in the range 0-100 — plus listing id and image id) to a local SQLite database via a TypeScript-first ORM.
6. The system shall compute a rank order over stored listings by aggregate score — defined as MAX(score) across all scored images for a listing, with ties broken by most recent score — and shall make that rank order retrievable by the dashboard and by direct query.
7. The system shall generate an alert payload as a JSON object matching Telegram Bot API's `sendMessage` body shape (`{ chat_id: string, text: string, parse_mode: "HTML" }`) for listings whose aggregate score is greater than or equal to the value of `ALERT_SCORE_THRESHOLD` (an environment variable).
8. The system shall default to dry-run mode for alerts: the alert payload is generated and logged/written to disk, and zero outbound network calls are made to Telegram, unless an explicit environment variable or flag enables live send.
9. The system shall expose a read-only web dashboard that lists ranked results (rank, score, listing metadata) and shall expose no route or endpoint that creates, updates, or deletes data.
10. The system shall include a bundled corpus of fake listing fixtures (HTML and/or JSON) authored fresh for this repo, containing no verbatim content, structure, or branding copied from any real site.
11. The system shall include an automated test suite (Vitest) with at least one passing automated test for each pipeline stage: ingest, normalize, score, rank/store, alert stub, and dashboard.
12. The system shall include a `README.md` at the repo root following the house README convention (referenced at `~/.claude/commands/readme.md`, not duplicated here).
13. The system shall include an MIT `LICENSE` file at the repo root.
14. The system shall include a GitHub Actions CI workflow that runs lint, typecheck, and test on every push and pull request against the default branch.
15. The system shall include an `.env.example` file listing every configuration variable the pipeline reads, each set to a generic placeholder value.
16. The system shall include an automated grep-based check (runnable in CI and/or as a pre-push hook) that scans all tracked files for the prohibited patterns defined in the Non-functional requirements section and fails when any match is found.
17. The fixture corpus shall include small fabricated placeholder image files bundled in the repo (not external URLs), because the vision-scoring stage must read real image bytes to produce a real score, and the dashboard must be able to render real thumbnails — an external non-resolving URL satisfies neither.
18. The system shall expose the bundled fixture images to the dashboard client via a GET-only route (no mutation), so the browser can render them.
19. The alert stage shall be idempotent: running it twice against the same data shall not produce two alerts for the same listing.
20. The security check (grep sweep) shall scan the full git commit history, not only the current working tree, so a prohibited string that was committed and later removed would still be caught.

## Non-functional requirements
- Security: the repo shall contain zero live-site scraping code, and zero anti-bot, stealth, proxy, or egress-evasion logic, in any file.
- Security: the repo shall contain zero references to any real target-site name or domain, in code, comments, tests, fixtures, or docs.
- Security: the repo shall contain zero dependency on, or textual reference to, the private internal shared-scraping-library package named in `scripts/check-forbidden-strings.mjs`.
- Security: the repo shall contain zero internal hostnames, private-range/CGNAT IP address examples, the specific internal inference-broker ports, service-user names, or credential values, in code, docs, comments, config, or `.env.example`. The exact forbidden patterns live only in `scripts/check-forbidden-strings.mjs` (constructed from fragments there, not written contiguously) — not repeated verbatim in this doc. Generic placeholders only (`localhost`, `example.com`, `YOUR_TOKEN_HERE`).
- Security: the repo shall be clean of the above patterns from its first commit onward — no commit in the repo's history introduces and later removes a prohibited string.
- Commit hygiene: every commit shall be authored as `Preston Bernstein <77080227+preston-bernstein@users.noreply.github.com>`, never a personal gmail address.
- Commit hygiene: no commit message shall contain AI-tool attribution text.
- Portability: the vision-scoring endpoint address shall be fully configurable via the `OLLAMA_HOST` environment variable, with no hardcoded endpoint in application code.
- Offline reproducibility: the full pipeline (ingest through dashboard) shall run end-to-end against bundled fixtures with no external network access other than the configured vision-scoring endpoint.
- Runtime: the repo targets Node.js 22 or later.

## Constraints
- Language/runtime: TypeScript on Node.js.
- Web framework: a lightweight framework [TBD: specific package] — new choice, not copied from any private repo.
- Database: SQLite, accessed through a TypeScript-first ORM [TBD: specific package].
- Validation: Zod for all schema validation (fixture ingest and, where applicable, API boundaries).
- Testing: Vitest for the full test suite.
- Dashboard: React with Vite.
- CI: GitHub Actions.
- All code is written fresh for this repo. No file, function, or config is copied from any private repo, including the resale-automation pipeline this demo is modeled on.
- The repo is public from creation; every commit and file is visible to the public the moment it's pushed.

## Out of scope
- Scraping any real, live website.
- Any anti-bot, stealth-browser, proxy, or egress-evasion logic.
- Real site names, domains, or captured HTML/JSON from an actual site.
- Live Telegram message delivery in default configuration (dry-run only unless explicitly enabled by the operator).
- User authentication, multi-user accounts, or any dashboard write/mutate capability.
- Production deployment or hosting infrastructure (the repo ships code and CI, not a live deployment).
- Integration with any specific private inference broker, its ports, health checks, or load-balancing behavior.
- Any code, config, or content copied from the private resale-automation pipeline or any other private repo.

## Acceptance criteria
1. Running the ingest stage against the bundled fixtures directory produces normalized listing records and makes zero HTTP requests to any host.
2. A fixture record missing a required field is rejected by the Zod schema, and the ingest stage reports the error by writing one structured line to stderr containing the record's id and the missing/invalid field name(s), instead of producing a record for it.
3. Running the score stage against a mocked vision endpoint persists one score row per listing image in the SQLite database, with each score a real number in the range 0-100.
4. Querying the database after a full pipeline run returns listings ordered by descending score.
5. Running the alert stage with no override produces a written/logged Telegram-shaped payload and makes zero outbound network calls to any Telegram host.
6. Running the alert stage with the live-send override enabled attempts a send, verified in tests against a mock/test double — never a real network call in CI.
7. Every dashboard test exercises only GET requests; no test or code path performs a create, update, or delete through the dashboard.
8. The full Vitest suite runs and passes in CI, with at least one test covering each of: ingest, normalize, score, rank/store, alert stub, dashboard.
9. Lint and typecheck commands both exit zero in CI.
10. `git log --format='%an <%ae>'` shows only `Preston Bernstein <77080227+preston-bernstein@users.noreply.github.com>` for every commit in the repo's history.
11. No commit message in the repo's history contains an AI-tool attribution string (e.g. "Claude", "Generated with", "Co-Authored-By: Claude").
12. A grep sweep of all tracked files for the private-network/CGNAT IP-range and internal-broker-port patterns defined in `scripts/check-forbidden-strings.mjs` returns zero matches.
13. A grep sweep of all tracked files for the internal package name defined in `scripts/check-forbidden-strings.mjs` returns zero matches.
14. A grep sweep of all tracked files for real site domains/names against a documented denylist of real marketplace/resale site name fragments (see plan.md's Technology choices section for the current list), extensible before first push, returns zero matches.
15. `.env.example` contains only generic placeholder values (`localhost`, `example.com`, `YOUR_TOKEN_HERE`, or equivalent) for every variable it lists.
16. `README.md`, `LICENSE`, and at least one workflow file under `.github/workflows/` exist at their expected paths, and the CI workflow runs lint, typecheck, and test as separate steps or jobs.
17. Every file under the fixtures directory is checked by the automated real-site-name denylist grep (AC14) and by a one-time author sign-off noting the corpus is fabricated, both completed before the first push.
