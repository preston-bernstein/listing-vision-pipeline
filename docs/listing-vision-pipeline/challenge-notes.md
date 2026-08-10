# Spec Challenge Notes

## Agents run
- Requirements Auditor (haiku): 12 issues found, 8 accepted
- Scope & Dependency Auditor (sonnet): 16 issues found, 10 accepted
- Design Devil's Advocate (sonnet): 11 issues found, 9 accepted
- Implementation Realist (sonnet): 5 major findings, 5 accepted
- Steps & Sequencing Critic (sonnet): 16 issues found, 14 accepted
- Data Model Critic (sonnet): 16 issues found, 14 accepted
- Security/Threat Auditor (haiku): 8 issues found, 8 accepted

## Changes made
- **Fixed a ship-blocking design bug**: fixtures pointed vision-scoring image references at a non-resolving fake domain (`https://fixtures.local/...`), which the score stage would POST to a vision endpoint that can't fetch external URLs at all (Ollama's `/api/chat` wants base64 bytes). The pipeline could never have actually scored anything against a real Ollama instance. Fixed by bundling real placeholder image files in the fixture corpus and having the score stage read+base64-encode them from disk; added a `GET /api/images/:listingId` route so the dashboard can render real thumbnails too.
- **Fixed a second ship-blocking bug**: every CLI stage was specified as `node src/cli/X.ts`, but plain Node can't execute TypeScript files without a loader. Added `tsx` as the execution mechanism for every CLI script.
- **Hardened the security check to match the repo owner's explicit, non-negotiable instruction**: the original design only grepped the current tracked tree, which would miss a string that was committed and later removed — exactly the "clean from commit #1, never commit-then-scrub" guarantee the repo owner required. The check now also sweeps full git history (`git rev-list --all` + per-commit diff grep), switched from a fail-open extension allowlist to a fail-closed denylist, and `.env` (previously untracked-but-not-explicitly-ignored) was added to `.gitignore`.
- **Fixed a data-model self-contradiction**: the plan claimed the rank query deduplicated multi-score listings via `MAX(score)`, but the actual SQL shown was a plain JOIN with no `GROUP BY` — a second `score` run would have produced visibly duplicated rows in the dashboard's centerpiece ranked table. Fixed the SQL to match the stated behavior, and added `PRAGMA foreign_keys = ON` / `PRAGMA journal_mode = WAL` (SQLite enforces neither by default) plus an idempotency constraint on `alerts` so re-running `alert` doesn't spam duplicate sends.
- **Resolved an undocumented ownership gap**: the architecture diagram showed a `[store]` stage with no owning CLI command, and `listings` had a UNIQUE constraint with no stated upsert behavior — a second pipeline run would have thrown a constraint violation. Made `score` the explicit owner of the `listings` upsert.
- **Swapped `better-sqlite3` for Node's built-in `node:sqlite`** (Node 22+) — removes a native-compiled-module install step that's the most common source of "works on my machine" friction for a portfolio repo strangers are expected to clone and run.
- **Pinned down every vague/untestable requirement** the auditor flagged (score range, "aggregate score," "report," "consistent shape," "Telegram-shaped," "live site," dual-endpoint handling) with concrete, testable definitions, and resolved the FR7 alert-inclusion `[TBD]` and the AC14 real-site-denylist `[TBD]`.
- **Reordered steps.md** so `normalize` is built before `ingest orchestrator` (the orchestrator's own acceptance test requires normalized output, so the original order was unbuildable as sequenced), split the oversized fixture-corpus and security-check steps, and dropped a step that only re-ran a prior step's own test.

## Critiques rejected
- Swapping the hand-rolled grep script for a third-party secret scanner (gitleaks) — rejected as unnecessary added dependency complexity; the hardened hand-rolled script (now history-aware, fail-closed) meets the repo owner's actual stated requirement without a new tool.
- Adding `npm audit` as a blocking CI gate — rejected as scope creep for a demo repo; noted as an accepted omission rather than silently dropped.
- Renaming `listings.id`'s natural-key strategy to match the surrogate-key event tables — rejected; the mixed strategy is intentional and now has an explanatory comment instead of being changed.
- AC17 (fixture-authenticity review) being flagged as fully "untestable" — rejected outright removal; instead paired the manual review with the existing automated denylist grep (AC14) so the criterion has both an automated and a documented-manual half, rather than being purely subjective.
- Creating a GitHub remote / pushing as a steps.md build step — rejected; that belongs to the outer publish process (repo creation, first push, profile README update), not the in-repo build sequence, which correctly ends at the first local commit.
- Adding `git init` / author-identity setup as a steps.md step — rejected; the repo is already initialized with the correct local git identity before the build sequence starts.

## Open questions requiring human input
- The real-site-name denylist used by the security check (15 real resale/marketplace site names, listed in scripts/check-forbidden-strings.mjs, not repeated here) is a best-effort default, not derived from the private repos' actual target lists (deliberately — this demo shouldn't know or reference real target sites). Worth a quick scan before the first push in case an obvious name was missed, though the check's other two pattern groups (private-network strings, the internal package name) don't have this uncertainty.
- The bundled placeholder images are simple generated/fabricated files with no real content — fine for a demo, but worth a glance before commit to confirm they read as clearly placeholder, not accidentally resembling anything from a real listing photo.

Neither of these is a hard blocker (no security, data-loss, or ADR-contradiction issue) — proceeding to build.
