import { writeFile } from 'node:fs/promises';
import { runIngest } from '../ingest/index.js';

/**
 * CLI entry point for the `ingest` stage. Run via `npm run ingest -w core` or `tsx src/cli/ingest.ts`.
 *
 * Walks the bundled fixtures/ directory, parses each listing file using the appropriate
 * per-source parser, normalizes the result, and outputs a JSON array of normalized records
 * to stdout, or to a file via `--out <path>`. Parse failures are logged to stderr and cause
 * a non-zero exit.
 *
 * Output: A JSON array of normalized listing records (NormalizedListing[]).
 * Exit code: 0 if all records succeeded, 1 if any failed.
 *
 * Example: `npm run ingest -w core | npm run score -w core`
 */

function parseOutPath(): string | undefined {
  const outIndex = process.argv.indexOf('--out');
  return outIndex !== -1 ? process.argv[outIndex + 1] : undefined;
}

async function main(): Promise<void> {
  const { succeeded, failed } = await runIngest();
  const json = JSON.stringify(succeeded, null, 2);

  const outPath = parseOutPath();
  if (outPath) {
    await writeFile(outPath, `${json}\n`, 'utf-8');
  } else {
    console.log(json);
  }

  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error('ingest: fatal error:', err);
  process.exitCode = 1;
});
