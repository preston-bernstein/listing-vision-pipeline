import { inArray } from 'drizzle-orm';
import { getRankedListings } from '../rank/rank.js';
import { buildAlert } from '../alert/buildAlert.js';
import type { AlertListing } from '../alert/buildAlert.js';
import { sendAlert } from '../alert/sendAlert.js';
import { listings, alerts } from '../db/schema.js';
import type { AppDb } from '../db/types.js';

/**
 * CLI entry point for the `alert` stage. Run via `tsx src/cli/alert.ts`.
 *
 * Env vars:
 *   - DATABASE_URL          SQLite file to read ranked listings from / write alert rows to.
 *   - ALERT_SCORE_THRESHOLD Minimum score (inclusive) for a listing to be alerted. Defaults to 70.
 *   - ALERT_LIVE_SEND       'true' to actually POST to the Telegram Bot API; anything else is dry-run
 *                           (payload written to alerts-output/, no network call).
 *   - TELEGRAM_BOT_TOKEN    Bot token used only when ALERT_LIVE_SEND=true.
 *   - TELEGRAM_CHAT_ID      Chat to address alerts to. Falls back to a placeholder when unset, per
 *                           buildAlert's documented contract for not-yet-configured deployments.
 *
 * Idempotent: `sendAlert` no-ops for listings that already have an `alerts` row (UNIQUE on
 * listing_id), so re-running only alerts newly-qualifying listings.
 */

function parseThreshold(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return 70;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 70;
}

function parseLiveSend(raw: string | undefined): boolean {
  return raw === 'true';
}

/**
 * Env-derived config for a single alert run, or exits the process if DATABASE_URL is missing.
 * `main()` gets the actual DB handle from a separate dynamic `import('../db/client.js')` (which
 * reads DATABASE_URL itself) — this function only checks the var is set before that import
 * runs, so the value itself isn't part of the returned config.
 */
function readAlertConfig() {
  if (!process.env.DATABASE_URL) {
    console.error('alert: DATABASE_URL environment variable is not set');
    return process.exit(1);
  }
  return {
    threshold: parseThreshold(process.env.ALERT_SCORE_THRESHOLD),
    liveSend: parseLiveSend(process.env.ALERT_LIVE_SEND),
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID ?? 'CHAT_ID_PLACEHOLDER',
  };
}

/** Bulk-fetches each candidate's source URL and whether it's already been alerted. */
async function fetchCandidateLookups(
  db: AppDb,
  candidateIds: string[],
) {
  const [sourceUrlRows, alreadyAlertedRows] = await Promise.all([
    db
      .select({ id: listings.id, sourceUrl: listings.sourceUrl })
      .from(listings)
      .where(inArray(listings.id, candidateIds)),
    db
      .select({ listingId: alerts.listingId })
      .from(alerts)
      .where(inArray(alerts.listingId, candidateIds)),
  ]);

  return {
    sourceUrlById: new Map(sourceUrlRows.map((row) => [row.id, row.sourceUrl])),
    alreadyAlertedIds: new Set(alreadyAlertedRows.map((row) => row.listingId)),
  };
}

type Candidate = Awaited<ReturnType<typeof getRankedListings>>[number];
type AlertConfig = ReturnType<typeof readAlertConfig>;
type CandidateLookups = Awaited<ReturnType<typeof fetchCandidateLookups>>;

/** Builds and sends (or skips) an alert for one candidate; reports which. */
async function processOneCandidate(
  db: AppDb,
  listing: Candidate,
  config: AlertConfig,
  lookups: CandidateLookups,
): Promise<'sent' | 'skipped' | 'failed'> {
  if (lookups.alreadyAlertedIds.has(listing.id)) {
    return 'skipped';
  }

  const alertListing: AlertListing = {
    id: listing.id,
    title: listing.title,
    priceCents: listing.priceCents,
    score: listing.score,
    sourceUrl: lookups.sourceUrlById.get(listing.id) ?? '',
  };

  const payload = buildAlert(alertListing, config.threshold, config.chatId);
  if (payload === null) {
    return 'skipped';
  }

  try {
    await sendAlert(db, listing, payload, {
      liveSend: config.liveSend,
      telegramBotToken: config.telegramBotToken,
    });
    return 'sent';
  } catch (err) {
    // One failed send (e.g. a Telegram API error) shouldn't abort the whole run —
    // sendAlert only persists on success, so this listing stays eligible on the
    // next run. Mirrors runIngest's per-item resilience pattern.
    console.error(`alert: failed to send for ${listing.id}: ${(err as Error).message}`);
    return 'failed';
  }
}

/** Builds and sends (or skips) an alert for each candidate; returns sent/skipped/failed counts. */
async function processCandidates(
  db: AppDb,
  candidates: Candidate[],
  config: AlertConfig,
  lookups: CandidateLookups,
): Promise<{ sent: number; skipped: number; failed: number }> {
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const listing of candidates) {
    const outcome = await processOneCandidate(db, listing, config, lookups);
    if (outcome === 'sent') sent += 1;
    else if (outcome === 'skipped') skipped += 1;
    else failed += 1;
  }

  return { sent, skipped, failed };
}

async function main(): Promise<void> {
  const config = readAlertConfig();

  // Imported dynamically so the env check above runs — and can fail fast — before
  // db/client.js's module-load side effect of opening/creating the SQLite file at
  // DATABASE_URL.
  const { db } = await import('../db/client.js');

  const ranked = await getRankedListings(db, { limit: 1000 });
  const candidates = ranked.filter((listing) => listing.score >= config.threshold);
  const belowThreshold = ranked.length - candidates.length;

  if (candidates.length === 0) {
    console.error(
      `alert: done — 0 alert(s) sent, ${belowThreshold} skipped (below threshold ${config.threshold})`,
    );
    return;
  }

  const candidateIds = candidates.map((listing) => listing.id);
  const lookups = await fetchCandidateLookups(db, candidateIds);
  const { sent, skipped, failed } = await processCandidates(db, candidates, config, lookups);

  console.error(
    `alert: done — ${sent} alert(s) sent, ${belowThreshold + skipped} skipped (already alerted or below threshold ${config.threshold})` +
      (failed > 0 ? `, ${failed} failed` : ''),
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('alert: fatal error:', err);
  process.exitCode = 1;
});
