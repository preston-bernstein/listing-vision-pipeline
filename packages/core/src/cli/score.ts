import { readFile } from 'node:fs/promises';
import { NormalizedListingSchema } from '../schema/normalized.js';
import { scoreListing } from '../score/score.js';

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

function requireVisionApiStyle(value: string | undefined): 'ollama' | 'openai' {
  if (value !== 'ollama' && value !== 'openai') {
    console.error("score: VISION_API_STYLE environment variable must be 'ollama' or 'openai'");
    return process.exit(1);
  }
  return value;
}

/** Reads and validates the three required env vars, or exits the process. */
function requireEnv(): { databaseUrl: string; ollamaHost: string; visionApiStyle: 'ollama' | 'openai' } {
  return {
    databaseUrl: requireNonEmpty('DATABASE_URL', process.env.DATABASE_URL),
    ollamaHost: requireNonEmpty('OLLAMA_HOST', process.env.OLLAMA_HOST),
    visionApiStyle: requireVisionApiStyle(process.env.VISION_API_STYLE),
  };
}

/** Reads stdin/--in, parses it as JSON, and normalizes it to an array. */
async function parseInputRecords(): Promise<unknown[]> {
  const raw = await readInput();
  if (!raw.trim()) {
    console.error(
      'score: no input received (expected a JSON array of normalized listings on stdin, or via --in <file>)',
    );
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`score: failed to parse input as JSON: ${(err as Error).message}`);
    process.exit(1);
  }

  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Validates and scores each record, tolerating individually invalid ones. */
async function scoreAllRecords(db: Parameters<typeof scoreListing>[0], records: unknown[]): Promise<void> {
  let scoredCount = 0;
  let invalidCount = 0;
  for (const record of records) {
    const result = NormalizedListingSchema.safeParse(record);
    if (!result.success) {
      invalidCount += 1;
      console.error(`score: skipping invalid record: ${result.error.message}`);
      continue;
    }
    await scoreListing(db, result.data);
    scoredCount += 1;
  }
  console.error(`score: done — scored ${scoredCount} listing(s), skipped ${invalidCount} invalid record(s)`);
}

async function main(): Promise<void> {
  requireEnv();
  const records = await parseInputRecords();

  // Imported dynamically so the env checks above run — and can fail fast —
  // before db/client.js's module-load side effect of opening/creating the
  // SQLite file at DATABASE_URL.
  const { db } = await import('../db/client.js');

  await scoreAllRecords(db, records);
}

main().catch((err) => {
  console.error(`score: fatal error: ${(err as Error).message}`);
  process.exit(1);
});
