import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { alerts } from '../db/schema.js';
import type { AppDb } from '../db/types.js';
import type { AlertListing, TelegramAlertPayload } from './buildAlert.js';

export interface SendAlertOptions {
  liveSend: boolean;
  telegramBotToken?: string;
}

const ALERTS_OUTPUT_DIR = 'alerts-output';

/**
 * Sanitizes a listing id (e.g. `thriftly:abc123`) for safe use as a filename by
 * replacing path-hostile `:` characters.
 */
function sanitizeIdForFilename(id: string): string {
  return id.replace(/:/g, '__');
}

/**
 * Sends (or dry-run-records) a Telegram alert for a listing.
 *
 * Idempotent on `listing.id` via the `alerts.listing_id` UNIQUE constraint: if a
 * row already exists for this listing, the call is a no-op. On a live send, the
 * Telegram API call happens FIRST and its response is checked — only on success
 * does this then write the payload to `alerts-output/<sanitized-id>.json` and
 * insert the `alerts` row. This ordering matters for the idempotency check above:
 * if the DB row/output file were written before a failed send, a future retry
 * would see the existing row and skip the listing forever, silently dropping the
 * alert. A failed send throws instead, so the caller can log/retry and this
 * listing remains eligible on the next run.
 *
 * Never logs the full Telegram request body or the bot token; only the listing
 * id and the dry-run/live-send decision are logged.
 */
export async function sendAlert(
  db: AppDb,
  listing: Pick<AlertListing, 'id'>,
  payload: TelegramAlertPayload,
  opts: SendAlertOptions,
): Promise<void> {
  const existing = await db
    .select({ id: alerts.id })
    .from(alerts)
    .where(eq(alerts.listingId, listing.id))
    .limit(1);

  if (existing.length > 0) {
    console.error(`alert: ${listing.id} already alerted, skipping`);
    return;
  }

  if (opts.liveSend) {
    const response = await fetch(
      `https://api.telegram.org/bot${opts.telegramBotToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => '<unreadable response body>');
      throw new Error(
        `alert: Telegram send failed for ${listing.id} with status ${response.status}: ${body}`,
      );
    }
  }

  const sanitizedId = sanitizeIdForFilename(listing.id);
  const outputDir = path.resolve(ALERTS_OUTPUT_DIR);
  const outputPath = path.join(outputDir, `${sanitizedId}.json`);

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

    await db.insert(alerts).values({
      listingId: listing.id,
      payloadJson: JSON.stringify(payload),
      dryRun: opts.liveSend ? 0 : 1,
    });
  } catch (err) {
    if (opts.liveSend) {
      // The reorder above closes the "row written, send lost" gap by sending first —
      // but it opens the inverse one: the Telegram message was already delivered, and
      // a failure here (disk full, DB error) means the alerts row/output file never
      // land, so the idempotency check above won't see this listing as already-sent
      // and a future run WILL re-send it. Loud on purpose: this is a real duplicate-
      // send risk, not a routine retry-safe failure.
      console.error(
        `alert: ${listing.id} was sent to Telegram but failed to persist — a future run WILL RE-SEND it: ${(err as Error).message}`,
      );
    }
    throw err;
  }

  console.error(`alert: ${listing.id} (${opts.liveSend ? 'live-send' : 'dry-run'})`);
}
