import { describe, it, expect } from 'vitest';

import { normalize } from './normalize.js';
import { NormalizedListingSchema } from '../schema/normalized.js';
import type { ThriftlyRaw, SecondLookRaw, ReloopRaw } from '../schema/raw.js';

const thriftlyRaw: ThriftlyRaw = {
  id: 'listing-100',
  title: 'Vintage Oak Bookshelf',
  price_cents: 12500,
  category: 'furniture',
  image_path: 'thriftly/images/listing-100.jpg',
  source_url: 'https://thriftly.example/listings/listing-100',
  posted_at: '2024-01-15T10:30:00Z',
  description: 'A fine bookshelf.',
};

const secondLookRaw: SecondLookRaw = {
  listingId: 'listing-003',
  name: 'Brass Floor Mirror',
  priceUsd: 145.0,
  tags: ['decor', 'mirror', 'brass'],
  photoUrl: 'https://secondlook.example/images/secondlook/images/listing-003.jpg',
  permalink: 'https://secondlook.example/p/listing-003',
  listedAt: '2024-08-06T16:42:20Z',
  details: 'A fine mirror.',
};

const reloopRaw: ReloopRaw = {
  title: 'Reclaimed Wood Dining Table',
  price: '$450.00',
  imageUrl: 'reloop/images/listing-001.jpg',
  sourceUrl: 'https://reloop.example/listings/listing-001',
  postedAt: '2026-08-05',
  description: 'A fine table.',
};

function thriftlyCases(): void {
  it('normalizes to a schema-valid record', () => {
    const result = normalize('thriftly', thriftlyRaw);
    expect(() => NormalizedListingSchema.parse(result)).not.toThrow();
  });

  it('formats id as source:sourceListingId', () => {
    const result = normalize('thriftly', thriftlyRaw);
    expect(result.id).toBe('thriftly:listing-100');
    expect(result.source).toBe('thriftly');
    expect(result.sourceListingId).toBe('listing-100');
  });

  it('passes price_cents through unchanged (already in cents)', () => {
    const result = normalize('thriftly', thriftlyRaw);
    expect(result.priceCents).toBe(12500);
  });

  it('carries imagePath through unchanged, not treated as an external URL', () => {
    const result = normalize('thriftly', thriftlyRaw);
    expect(result.imagePath).toBe('thriftly/images/listing-100.jpg');
  });
}

function secondLookCases(): void {
  it('normalizes to a schema-valid record', () => {
    const result = normalize('secondlook', secondLookRaw);
    expect(() => NormalizedListingSchema.parse(result)).not.toThrow();
  });

  it('formats id as source:sourceListingId', () => {
    const result = normalize('secondlook', secondLookRaw);
    expect(result.id).toBe('secondlook:listing-003');
    expect(result.source).toBe('secondlook');
    expect(result.sourceListingId).toBe('listing-003');
  });

  it('converts the dollar-float price to cents correctly', () => {
    const result = normalize('secondlook', secondLookRaw);
    expect(result.priceCents).toBe(14500);
  });

  it('converts a dollar amount with cents correctly', () => {
    const result = normalize('secondlook', { ...secondLookRaw, priceUsd: 285.5 });
    expect(result.priceCents).toBe(28550);
  });

  it('carries photoUrl through as imagePath, unchanged and unrenamed to an external URL', () => {
    const result = normalize('secondlook', secondLookRaw);
    expect(result.imagePath).toBe(secondLookRaw.photoUrl);
  });

  it('joins tags into category', () => {
    const result = normalize('secondlook', secondLookRaw);
    expect(result.category).toBe('decor, mirror, brass');
  });

  it('leaves category undefined when tags is empty', () => {
    const result = normalize('secondlook', { ...secondLookRaw, tags: [] });
    expect(result.category).toBeUndefined();
  });
}

function reloopCoreCases(): void {
  it('normalizes to a schema-valid record', () => {
    const result = normalize('reloop', reloopRaw);
    expect(() => NormalizedListingSchema.parse(result)).not.toThrow();
  });

  it('formats id as source:sourceListingId, deriving the id from sourceUrl', () => {
    const result = normalize('reloop', reloopRaw);
    expect(result.id).toBe('reloop:listing-001');
    expect(result.source).toBe('reloop');
    expect(result.sourceListingId).toBe('listing-001');
  });

  it('converts the string price to cents correctly', () => {
    const result = normalize('reloop', reloopRaw);
    expect(result.priceCents).toBe(45000);
  });

  it('converts a comma-formatted string price to cents correctly', () => {
    const result = normalize('reloop', { ...reloopRaw, price: '$1,200.00' });
    expect(result.priceCents).toBe(120000);
  });

  it('carries imageUrl through as imagePath, unchanged and unrenamed to an external URL', () => {
    const result = normalize('reloop', reloopRaw);
    expect(result.imagePath).toBe(reloopRaw.imageUrl);
  });
}

function reloopEdgeCases(): void {
  it('widens a bare date to a full ISO datetime', () => {
    const result = normalize('reloop', reloopRaw);
    expect(result.postedAt).toBe('2026-08-05T00:00:00Z');
  });

  it('leaves an already-full ISO datetime unchanged (does not double-widen)', () => {
    const result = normalize('reloop', { ...reloopRaw, postedAt: '2024-01-15T10:30:00Z' });
    expect(result.postedAt).toBe('2024-01-15T10:30:00Z');
  });

  it('trims whitespace around the price before parsing', () => {
    const result = normalize('reloop', { ...reloopRaw, price: '  $450.00  ' });
    expect(result.priceCents).toBe(45000);
  });

  it('throws when the price string has no parseable number', () => {
    expect(() => normalize('reloop', { ...reloopRaw, price: 'free' })).toThrow(
      /unable to parse Reloop price/,
    );
  });

  it('ignores a trailing slash on sourceUrl when deriving sourceListingId', () => {
    const result = normalize('reloop', {
      ...reloopRaw,
      sourceUrl: 'https://reloop.example/listings/listing-001/',
    });
    expect(result.sourceListingId).toBe('listing-001');
    expect(result.id).toBe('reloop:listing-001');
  });

  it('throws when sourceUrl has no derivable last segment', () => {
    expect(() => normalize('reloop', { ...reloopRaw, sourceUrl: '///' })).toThrow(
      /unable to derive Reloop sourceListingId/,
    );
  });
}

describe('normalize', () => {
  describe('thriftly', thriftlyCases);
  describe('secondlook', secondLookCases);
  describe('reloop', () => {
    reloopCoreCases();
    reloopEdgeCases();
  });
});
