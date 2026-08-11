/**
 * Builds a Telegram `sendMessage`-shaped payload for a listing that has cleared
 * the alert score threshold. Returns `null` when the listing's score is below
 * `threshold`, meaning no alert should be sent.
 *
 * `chatId` is accepted as a parameter (never hardcoded) — callers should read it
 * from an env var (e.g. `TELEGRAM_CHAT_ID`) or pass a placeholder such as
 * `"CHAT_ID_PLACEHOLDER"` when not yet configured.
 */

export interface AlertListing {
  id: string;
  title: string;
  priceCents: number;
  score: number;
  sourceUrl: string;
}

export interface TelegramAlertPayload {
  chat_id: string;
  text: string;
  parse_mode: "HTML";
}

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatPriceCents(priceCents: number): string {
  return usdFormatter.format(priceCents / 100);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildAlert(
  listing: AlertListing,
  threshold: number,
  chatId: string,
): TelegramAlertPayload | null {
  if (listing.score < threshold) {
    return null;
  }

  const text = [
    `<b>${escapeHtml(listing.title)}</b>`,
    `Price: ${formatPriceCents(listing.priceCents)}`,
    `Score: ${listing.score}`,
    `<a href="${escapeHtml(listing.sourceUrl)}">View listing</a>`,
  ].join("\n");

  return {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };
}
