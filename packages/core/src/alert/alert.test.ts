import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts, listings } from '../db/schema.js';
import { buildAlert, type AlertListing } from './buildAlert.js';
import { sendAlert, type Db } from './sendAlert.js';

// Wrap `node:fs`'s `writeFileSync` in a spy that still calls through to the
// real implementation, so `sendAlert`'s actual writes (which this suite reads
// back and cleans up) keep working while call counts are observable. Node's
// ESM namespace bindings for `node:fs` are non-configurable, so `vi.spyOn`
// directly on an imported `* as fs` namespace throws ("Cannot redefine
// property"); replacing the whole module via `vi.mock` sidesteps that.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});

const fs = await import('node:fs');

// `node:sqlite`-only builtins (no bare, unprefixed alias) trip up this
// project's Vite/vitest version's static-import builtin detection when
// imported the normal way from a source file (not from node_modules, which
// is externalized and unaffected). `process.getBuiltinModule` sidesteps
// module resolution entirely and works reliably under vitest.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../drizzle');
const ALERTS_OUTPUT_DIR = path.resolve('alerts-output');

/** Builds a fresh, isolated in-memory SQLite database with migrations applied. */
function createTestDb(): Db {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle({ client: sqlite });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as Db;
}

async function seedListing(db: Db, id: string, sourceListingId: string): Promise<void> {
  await db.insert(listings).values({
    id,
    source: 'thriftly',
    sourceListingId,
    title: 'Vintage lamp',
    priceCents: 2500,
    imagePath: 'thriftly/images/listing-001.jpg',
    sourceUrl: 'https://example.com/listing/1',
    postedAt: '2026-01-01T00:00:00.000Z',
  });
}

function buildTestListing(overrides: Partial<AlertListing> = {}): AlertListing {
  return {
    id: 'thriftly:abc123',
    title: 'Vintage lamp',
    priceCents: 2500,
    score: 90,
    sourceUrl: 'https://example.com/listing/1',
    ...overrides,
  };
}

// Files this test suite creates on disk (`sendAlert` hardcodes `alerts-output/`
// as its write directory, so we track and clean up whatever we create rather
// than redirecting the path).
const createdFiles: string[] = [];

describe('buildAlert', () => {
  it('returns null when the score is below threshold', () => {
    const listing = buildTestListing({ score: 50 });
    expect(buildAlert(listing, 80, 'chat-123')).toBeNull();
  });

  it('returns a valid Telegram payload shape at threshold', () => {
    const listing = buildTestListing({ score: 80 });
    const payload = buildAlert(listing, 80, 'chat-123');

    expect(payload).not.toBeNull();
    expect(payload).toMatchObject({
      chat_id: 'chat-123',
      parse_mode: 'HTML',
    });
    expect(typeof payload!.text).toBe('string');
    expect(payload!.text).toContain('Vintage lamp');
    expect(payload!.text).toContain('Score: 80');
    expect(payload!.text).toContain('https://example.com/listing/1');
  });

  it('returns a valid Telegram payload shape above threshold', () => {
    const listing = buildTestListing({ score: 95 });
    const payload = buildAlert(listing, 80, 'chat-123');

    expect(payload).not.toBeNull();
    expect(payload!.chat_id).toBe('chat-123');
    expect(payload!.parse_mode).toBe('HTML');
  });

  it('builds the exact text body: escaped title, formatted price, score, and link, joined by newlines', () => {
    const listing = buildTestListing({
      title: 'Vintage lamp',
      priceCents: 2500,
      score: 88,
      sourceUrl: 'https://example.com/listing/1',
    });
    const payload = buildAlert(listing, 80, 'chat-123');

    expect(payload!.text).toBe(
      [
        '<b>Vintage lamp</b>',
        'Price: $25.00',
        'Score: 88',
        '<a href="https://example.com/listing/1">View listing</a>',
      ].join('\n'),
    );
  });

  it('HTML-escapes &, <, and > in the title and source URL, in order', () => {
    const listing = buildTestListing({
      title: 'Chair & Ottoman <Set>',
      sourceUrl: 'https://example.com/q?a=1&b=2',
    });
    const payload = buildAlert(listing, 80, 'chat-123');

    expect(payload!.text).toContain('<b>Chair &amp; Ottoman &lt;Set&gt;</b>');
    expect(payload!.text).toContain(
      '<a href="https://example.com/q?a=1&amp;b=2">View listing</a>',
    );
    // & must be escaped before < and > are appended, or a literal "&lt;"
    // produced by escaping "<" would itself get re-escaped into "&amp;lt;".
    expect(payload!.text).not.toContain('&amp;lt;');
    expect(payload!.text).not.toContain('&amp;gt;');
  });

  it('formats priceCents as whole-dollar USD currency, not raw cents', () => {
    const listing = buildTestListing({ priceCents: 999 });
    const payload = buildAlert(listing, 0, 'chat-123');
    expect(payload!.text).toContain('Price: $9.99');
  });
});

describe('sendAlert', () => {
  let db: Db;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = createTestDb();
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    vi.mocked(fs.writeFileSync).mockClear();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    for (const file of createdFiles) {
      fs.rmSync(file, { force: true });
    }
    createdFiles.length = 0;
    // Only remove the directory if it's now empty, to avoid clobbering
    // anything unrelated that might already live there.
    if (fs.existsSync(ALERTS_OUTPUT_DIR) && fs.readdirSync(ALERTS_OUTPUT_DIR).length === 0) {
      fs.rmdirSync(ALERTS_OUTPUT_DIR);
    }
  });

  it('dry-run writes a sanitized-filename JSON file and inserts one alerts row', async () => {
    const listingId = 'thriftly:dry-run-1';
    await seedListing(db, listingId, 'dry-run-1');
    const payload = buildAlert(buildTestListing({ id: listingId, score: 90 }), 80, 'chat-123')!;

    await sendAlert(db, { id: listingId }, payload, { liveSend: false });

    const outputPath = path.join(ALERTS_OUTPUT_DIR, 'thriftly__dry-run-1.json');
    createdFiles.push(outputPath);

    expect(fs.existsSync(outputPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    expect(written).toEqual(payload);

    const rows = await db.select().from(alerts).where(eq(alerts.listingId, listingId));
    expect(rows).toHaveLength(1);
    expect(rows[0].dryRun).toBe(1);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is idempotent: a second call for the same listing inserts no extra row and writes no extra file', async () => {
    const listingId = 'thriftly:idempotent-1';
    await seedListing(db, listingId, 'idempotent-1');
    const payload = buildAlert(buildTestListing({ id: listingId, score: 90 }), 80, 'chat-123')!;

    const outputPath = path.join(ALERTS_OUTPUT_DIR, 'thriftly__idempotent-1.json');
    createdFiles.push(outputPath);

    await sendAlert(db, { id: listingId }, payload, { liveSend: false });
    await sendAlert(db, { id: listingId }, payload, { liveSend: false });

    const rows = await db.select().from(alerts).where(eq(alerts.listingId, listingId));
    expect(rows).toHaveLength(1);

    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('with liveSend true, calls fetch against the Telegram API URL shape and never a real network target', async () => {
    const listingId = 'thriftly:live-send-1';
    await seedListing(db, listingId, 'live-send-1');
    const payload = buildAlert(buildTestListing({ id: listingId, score: 90 }), 80, 'chat-123')!;

    const outputPath = path.join(ALERTS_OUTPUT_DIR, 'thriftly__live-send-1.json');
    createdFiles.push(outputPath);

    await sendAlert(db, { id: listingId }, payload, {
      liveSend: true,
      telegramBotToken: 'test-token',
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://api.telegram.org/bottest-token/sendMessage');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(payload);

    const rows = await db.select().from(alerts).where(eq(alerts.listingId, listingId));
    expect(rows[0].dryRun).toBe(0);
  });
});
