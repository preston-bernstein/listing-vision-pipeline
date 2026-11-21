import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runIngest } from './index.js';
import { NormalizedListingSchema } from '../schema/normalized.js';
import { DEFAULT_FIXTURES_ROOT } from '../fixturesRoot.js';

type IngestResult = Awaited<ReturnType<typeof runIngest>>;

function expectAllFixturesIngested(
  succeeded: IngestResult['succeeded'],
  failed: IngestResult['failed'],
): void {
  // 3 sources x 3 valid fixtures each = 9 successes.
  expect(succeeded).toHaveLength(9);

  const bySource = {
    thriftly: succeeded.filter((l) => l.source === 'thriftly'),
    secondlook: succeeded.filter((l) => l.source === 'secondlook'),
    reloop: succeeded.filter((l) => l.source === 'reloop'),
  };
  expect(bySource.thriftly).toHaveLength(3);
  expect(bySource.secondlook).toHaveLength(3);
  expect(bySource.reloop).toHaveLength(3);

  // The invalid Thriftly fixture (missing price_cents) must be rejected, naming the field.
  expect(failed).toHaveLength(1);
  const failure = failed[0];
  expect(failure?.file).toBe('thriftly/listing-004-invalid.json');
  expect(failure?.error).toContain('price_cents');

  // Every successful record must validate against the shared normalized schema.
  for (const listing of succeeded) {
    expect(() => NormalizedListingSchema.parse(listing)).not.toThrow();
  }
}

async function createScratchRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'ingest-test-'));
  for (const source of ['thriftly', 'secondlook', 'reloop']) {
    await mkdir(path.join(root, source), { recursive: true });
  }
  return root;
}

async function expectNothingIngested(root: string): Promise<void> {
  const { succeeded, failed } = await runIngest(root);
  expect(succeeded).toHaveLength(0);
  expect(failed).toHaveLength(0);
}

describe('runIngest', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    // Explicit proof that ingest never touches the network: if anything under runIngest()
    // called global.fetch, this spy would record it and the assertion below would fail.
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it('ingests all valid fixtures across all three sources and rejects the invalid one', async () => {
    const { succeeded, failed } = await runIngest(DEFAULT_FIXTURES_ROOT);

    expectAllFixturesIngested(succeeded, failed);

    // Zero network calls anywhere during the run — ingest reads fixtures from local disk only.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('produces globally unique, correctly formatted ids', async () => {
    const { succeeded } = await runIngest(DEFAULT_FIXTURES_ROOT);

    const ids = succeeded.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const listing of succeeded) {
      expect(listing.id).toBe(`${listing.source}:${listing.sourceListingId}`);
    }
  });
});

describe('runIngest error and file-filtering edge cases', () => {
  let scratchRoot: string;

  beforeEach(async () => {
    scratchRoot = await createScratchRoot();
  });

  afterEach(async () => {
    await rm(scratchRoot, { recursive: true, force: true });
  });

  it('reports a "(root)" path when the JSON value fails validation at the top level', async () => {
    // A bare JSON array (not an object) fails ThriftlyRawSchema at the root — Zod's issue.path
    // is empty in that case, exercising the describeZodError "(root)" fallback branch.
    await writeFile(path.join(scratchRoot, 'thriftly', 'root-mismatch.json'), '[]', 'utf-8');

    const { failed } = await runIngest(scratchRoot);

    expect(failed).toHaveLength(1);
    expect(failed[0]?.file).toBe('thriftly/root-mismatch.json');
    expect(failed[0]?.error).toContain('(root)');
  });

  it('reports the raw parse error message for a file that is not valid JSON', async () => {
    await writeFile(path.join(scratchRoot, 'thriftly', 'malformed.json'), '{not valid json', 'utf-8');

    const { failed } = await runIngest(scratchRoot);

    expect(failed).toHaveLength(1);
    expect(failed[0]?.file).toBe('thriftly/malformed.json');
    // Not a Zod error — describeError falls through to the plain `err.message` branch.
    expect(failed[0]?.error).not.toContain('(root)');
    expect(failed[0]?.error.length).toBeGreaterThan(0);
  });

  it('skips a directory even when its name ends in .json or .html', async () => {
    // A directory named like a listing file must never be treated as one — only entries where
    // entry.isFile() is true are eligible, regardless of name.
    await mkdir(path.join(scratchRoot, 'thriftly', 'decoy.json'), { recursive: true });

    await expectNothingIngested(scratchRoot);
  });

  it('ignores files whose extension is neither .json nor .html', async () => {
    await writeFile(path.join(scratchRoot, 'thriftly', 'notes.txt'), 'not a listing', 'utf-8');

    await expectNothingIngested(scratchRoot);
  });
});
