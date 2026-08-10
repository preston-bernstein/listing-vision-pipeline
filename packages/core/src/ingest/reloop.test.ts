import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseReloopListing } from './reloop.js';

function buildHtml(fields: Record<string, string>): string {
  return `
    <div class="listing">
      <span class="listing-title">${fields.title}</span>
      <span class="listing-price">${fields.price}</span>
      <span class="listing-image">${fields.imageUrl}</span>
      <span class="listing-url">${fields.sourceUrl}</span>
      <span class="listing-date">${fields.postedAt}</span>
      <span class="listing-description">${fields.description}</span>
    </div>
  `;
}

describe('parseReloopListing', () => {
  let scratchRoot: string;

  beforeEach(async () => {
    scratchRoot = await mkdtemp(path.join(tmpdir(), 'reloop-test-'));
  });

  afterEach(async () => {
    await rm(scratchRoot, { recursive: true, force: true });
  });

  it('trims surrounding whitespace from every scraped field', async () => {
    const html = buildHtml({
      title: '  Reclaimed Wood Table  ',
      price: '\n  $450.00\n  ',
      imageUrl: '  reloop/images/listing-001.jpg  ',
      sourceUrl: '  https://reloop.example/listings/listing-001  ',
      postedAt: '  2026-08-05  ',
      description: '  A fine table.  ',
    });
    const filePath = path.join(scratchRoot, 'listing.html');
    await writeFile(filePath, html, 'utf-8');

    const raw = await parseReloopListing(filePath);

    expect(raw.title).toBe('Reclaimed Wood Table');
    expect(raw.price).toBe('$450.00');
    expect(raw.imageUrl).toBe('reloop/images/listing-001.jpg');
    expect(raw.sourceUrl).toBe('https://reloop.example/listings/listing-001');
    expect(raw.postedAt).toBe('2026-08-05');
    expect(raw.description).toBe('A fine table.');
  });

  it('maps a whitespace-only description to undefined rather than an empty string', async () => {
    const html = buildHtml({
      title: 'Reclaimed Wood Table',
      price: '$450.00',
      imageUrl: 'reloop/images/listing-001.jpg',
      sourceUrl: 'https://reloop.example/listings/listing-001',
      postedAt: '2026-08-05',
      description: '   ',
    });
    const filePath = path.join(scratchRoot, 'listing.html');
    await writeFile(filePath, html, 'utf-8');

    const raw = await parseReloopListing(filePath);

    expect(raw.description).toBeUndefined();
  });
});
