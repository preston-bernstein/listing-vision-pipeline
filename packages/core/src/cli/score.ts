import { readFile } from 'node:fs/promises';
import { NormalizedListingSchema } from '../schema/normalized.js';
import { scoreListing } from '../score/score.js';
import { validateVisionEnv } from '../score/visionClient.js';
import type { AppDb } from '../db/types.js';

/**
 * CLI entry point for the `score` stage. Run via `tsx src/cli/score.ts`.
 *
 * Env vars (validated up front, before the database is opened):
 *   - DATABASE_URL      SQLite file the listings/scores rows are written to.
 *   - OLLAMA_HOST       base URL of the vision endpoint (read by visionClient).
 *   - VISION_API_STYLE  'ollama' or 'openai' (read by visionClient).
 *
 * Input: a JSON array of normalized listing records (the shape produced by
 * the `ingest` stage), read from stdin by default, or from a file via
 * `--in <path>`. Records that fail NormalizedListingSchema validation are
 * skipped with an error logged to stderr; the run still exits 0 as long as
 * at least the well-formed records were processed successfully.
 *
 * Example: `npm run ingest -w core | npm run score -w core`
 */

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readInput(): Promise<string> {
  const inFlagIndex = process.argv.indexOf('--in');
  const inPath = inFlagIndex !== -1 ? process.argv[inFlagIndex + 1] : undefined;
  if (inPath) {
    return readFile(inPath, 'utf8');
  }
  return readStdin();
}

/** Returns `value` if set, otherwise logs and exits the process. */
function requireNonEmpty(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`score: ${name} environment variable is not set`);
    return process.exit(1);
  }
  return value;
}

/**
 * Validates DATABASE_URL is set, and delegates OLLAMA_HOST/VISION_API_STYLE validation to
 * visionClient's own well-formed-URL check (see validateVisionEnv) rather than re-checking a
 * looser copy of the same rules here — this failed fast with a clear message even before the
 * per-record resilience in scoreAllRecords was added, and delegating keeps it that way instead
 * of degrading to one identical failure per listing.
 */
function validateEnv(): void {
  requireNonEmpty('DATABASE_URL', process.env.DATABASE_URL);
  try {
    validateVisionEnv();
  } catch (err) {
    console.error(`score: ${(err as Error).message}`);
    process.exit(1);
  }
}

/**
 * Reads stdin/--in, parses it as JSON, and normalizes it to an array, or returns `null` and
 * sets a non-zero exit code on empty/malformed input. Uses `process.exitCode` rather than
 * `process.exit()` (unlike the env-validation helpers above, which run before any stdout is
 * written) so buffered output has a chance to flush — this repo's documented primary usage is
 * a pipe (`npm run ingest -w core | npm run score -w core`), where a hard `process.exit()`
 * risks truncating the very stderr message just written.
 */
async function parseInputRecords(): Promise<unknown[] | null> {
  const raw = await readInput();
  if (!raw.trim()) {
    console.error(
      'score: no input received (expected a JSON array of normalized listings on stdin, or via --in <file>)',
    );
    process.exitCode = 1;
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`score: failed to parse input as JSON: ${(err as Error).message}`);
    process.exitCode = 1;
    return null;
  }

  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Validates and scores each record, tolerating individually invalid ones or ones that fail to score. */
async function scoreAllRecords(
  db: AppDb,
  records: unknown[],
): Promise<{ scoredCount: number; invalidCount: number; failedCount: number }> {
  let scoredCount = 0;
  let invalidCount = 0;
  let failedCount = 0;
  for (const record of records) {
    const result = NormalizedListingSchema.safeParse(record);
    if (!result.success) {
      invalidCount += 1;
      console.error(`score: skipping invalid record: ${result.error.message}`);
      continue;
    }
    try {
      await scoreListing(db, result.data);
      scoredCount += 1;
    } catch (err) {
      // One bad vision call (network blip, model timeout) shouldn't abort the
      // whole batch — log it and keep going, mirroring runIngest's per-item
      // resilience pattern. The caller still exits non-zero if failedCount > 0
      // (see main() below), so a total vision-endpoint outage is never reported
      // as a successful run.
      failedCount += 1;
      console.error(`score: failed to score ${result.data.id}: ${(err as Error).message}`);
    }
  }
  console.error(
    `score: done — scored ${scoredCount} listing(s), skipped ${invalidCount} invalid record(s), failed ${failedCount} listing(s)`,
  );
  return { scoredCount, invalidCount, failedCount };
}

async function main(): Promise<void> {
  validateEnv();
  const records = await parseInputRecords();
  if (records === null) {
    return;
  }

  // Imported dynamically so the env checks above run — and can fail fast —
  // before db/client.js's module-load side effect of opening/creating the
  // SQLite file at DATABASE_URL.
  const { db } = await import('../db/client.js');

  const { failedCount } = await scoreAllRecords(db, records);
  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('score: fatal error:', err);
  process.exitCode = 1;
});
