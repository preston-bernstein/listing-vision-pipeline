import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';

import { parseThriftlyListing } from './thriftly.js';
import { parseSecondLookListing } from './secondlook.js';
import { parseReloopListing } from './reloop.js';
import { normalize } from '../normalize/normalize.js';
import type { NormalizedListing } from '../schema/normalized.js';

/**
 * Ingest orchestrator.
 *
 * Walks the bundled `fixtures/` directory by source subdirectory (thriftly/, secondlook/,
 * reloop/), dispatches each listing file to the matching per-source parser, normalizes the
 * result, and collects successes/failures. Makes zero HTTP requests — every parser reads
 * only from local disk (see thriftly.ts / secondlook.ts / reloop.ts).
 *
 * This module is dual-purpose:
 *  - `runIngest()` is a pure library function: no `process.exit`/`process.exitCode` side
 *    effects, safe to import from a CLI wrapper (Task 16's `cli/ingest.ts`) or a test.
 *  - The `if (import.meta.url === ...)` guard at the bottom makes the file directly
 *    runnable too (e.g. via `tsx src/ingest/index.ts` or `tsx src/ingest/index.ts --out
 *    file.json`), for manual verification without waiting on the CLI task.
 */

type SourceName = 'thriftly' | 'secondlook' | 'reloop';

const SOURCE_NAMES: readonly SourceName[] = ['thriftly', 'secondlook', 'reloop'];

/** Directory this module lives in — used to derive the default fixtures root. */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Default fixtures root: `<repo root>/fixtures`.
 * This file lives at `packages/core/src/ingest/`, so the repo root is four levels up
 * (ingest -> src -> core -> packages -> repo root) — same depth/derivation as
 * `score/visionClient.ts`'s `DEFAULT_FIXTURES_ROOT`.
 */
export const DEFAULT_FIXTURES_ROOT = path.resolve(MODULE_DIR, '../../../../fixtures');

export interface IngestFailure {
  /** Fixtures-root-relative path of the file that failed, e.g. "thriftly/listing-004-invalid.json". */
  file: string;
  /** Human-readable description of what was wrong (Zod field errors when available). */
  error: string;
}

export interface IngestResult {
  succeeded: NormalizedListing[];
  failed: IngestFailure[];
}

/** Renders a ZodError as "path.to.field: message; other.field: message". */
function describeZodError(err: ZodError): string {
  return err.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
}

function describeError(err: unknown): string {
  if (err instanceof ZodError) {
    return describeZodError(err);
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** Dispatches a single listing file to its source's parser, then normalizes the result. */
async function parseAndNormalize(source: SourceName, filePath: string): Promise<NormalizedListing> {
  switch (source) {
    case 'thriftly': {
      const raw = await parseThriftlyListing(filePath);
      return normalize('thriftly', raw);
    }
    case 'secondlook': {
      const raw = await parseSecondLookListing(filePath);
      return normalize('secondlook', raw);
    }
    case 'reloop': {
      const raw = await parseReloopListing(filePath);
      return normalize('reloop', raw);
    }
  }
}

/**
 * Lists listing filenames directly inside a source directory, skipping the `images/`
 * subdirectory (image files, not listing data) and anything that isn't a `.json` or
 * `.html` file. Sorted for deterministic output ordering.
 */
async function listSourceFiles(sourceDir: string): Promise<string[]> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.html')))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Runs the full ingest pass against `fixturesRoot`. Never throws on a per-record
 * validation failure — those are caught, logged to stderr, and collected in
 * `failed` so one bad file doesn't stop the rest of the run. Does not call
 * `process.exit`/set `process.exitCode`; callers decide what to do with the result.
 */
export async function runIngest(fixturesRoot: string = DEFAULT_FIXTURES_ROOT): Promise<IngestResult> {
  const succeeded: NormalizedListing[] = [];
  const failed: IngestFailure[] = [];

  for (const source of SOURCE_NAMES) {
    const sourceDir = path.join(fixturesRoot, source);
    const fileNames = await listSourceFiles(sourceDir);

    for (const fileName of fileNames) {
      const filePath = path.join(sourceDir, fileName);
      const relFile = path.join(source, fileName);

      try {
        const listing = await parseAndNormalize(source, filePath);
        succeeded.push(listing);
      } catch (err) {
        const message = describeError(err);
        failed.push({ file: relFile, error: message });
        // One structured line per failure, so a bad fixture doesn't stop the run but is
        // still clearly attributable to a file + field.
        console.error(JSON.stringify({ file: relFile, error: message }));
      }
    }
  }

  return { succeeded, failed };
}

// --- Directly-runnable entry point -----------------------------------------------------
// Only active when this file is executed directly (e.g. `tsx src/ingest/index.ts`), not
// when imported by another module (the CLI wrapper, tests, etc.).
if (import.meta.url === `file://${process.argv[1]}`) {
  const outIndex = process.argv.indexOf('--out');
  const outPath = outIndex !== -1 ? process.argv[outIndex + 1] : undefined;

  runIngest(DEFAULT_FIXTURES_ROOT)
    .then(async ({ succeeded, failed }) => {
      const json = JSON.stringify(succeeded, null, 2);
      if (outPath) {
        await writeFile(outPath, `${json}\n`, 'utf-8');
      } else {
        console.log(json);
      }
      process.exitCode = failed.length > 0 ? 1 : 0;
    })
    .catch((err) => {
      console.error('ingest failed:', err);
      process.exitCode = 1;
    });
}
