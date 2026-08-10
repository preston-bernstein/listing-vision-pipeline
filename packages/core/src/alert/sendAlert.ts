import * as fs from "node:fs";
import * as path from "node:path";
import { eq } from "drizzle-orm";
import type { db as DbClient } from "../db/client.js";
import { alerts } from "../db/schema.js";
import type { AlertListing, TelegramAlertPayload } from "./buildAlert.js";

export type Db = typeof DbClient;

export interface SendAlertOptions {
  liveSend: boolean;
  telegramBotToken?: string;
}

const ALERTS_OUTPUT_DIR = "alerts-output";

/**
 * Sanitizes a listing id (e.g. `thriftly:abc123`) for safe use as a filename by
 * replacing path-hostile `:` characters.
 */
function sanitizeIdForFilename(id: string): string {
  return id.replace(/:/g, "__");
}

/**
 * Sends (or dry-run-records) a Telegram alert for a listing.
 *
 * Idempotent on `listing.id` via the `alerts.listing_id` UNIQUE constraint: if a
 * row already exists for this listing, the call is a no-op. Otherwise it writes
 * the payload to `alerts-output/<sanitized-id>.json`, inserts an `alerts` row,
 * and — only when `opts.liveSend` is true — POSTs to the Telegram Bot API.
 *
 * Never logs the full Telegram request body or the bot token; only the listing
 * id and the dry-run/live-send decision are logged.
 */
export async function sendAlert(
  db: Db,
  listing: Pick<AlertListing, "id">,
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

  const sanitizedId = sanitizeIdForFilename(listing.id);
  const outputDir = path.resolve(ALERTS_OUTPUT_DIR);
  fs.mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${sanitizedId}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

  await db.insert(alerts).values({
    listingId: listing.id,
    payloadJson: JSON.stringify(payload),
    dryRun: opts.liveSend ? 0 : 1,
  });

  console.error(`alert: ${listing.id} (${opts.liveSend ? "live-send" : "dry-run"})`);

  if (opts.liveSend) {
    await fetch(
      `https://api.telegram.org/bot${opts.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  }
}
