import { describe, it, expect } from 'vitest';

import { normalize } from './normalize.js';
import { NormalizedListingSchema } from '../schema/normalized.js';
import type { ThriftlyRaw, SecondLookRaw, ReloopRaw } from '../schema/raw.js';

describe('normalize', () => {
  describe('thriftly', () => {
    const raw: ThriftlyRaw = {
      id: 'listing-100',
      title: 'Vintage Oak Bookshelf',
      price_cents: 12500,
      category: 'furniture',
      image_path: 'thriftly/images/listing-100.jpg',
      source_url: 'https://thriftly.example/listings/listing-100',
      posted_at: '2024-01-15T10:30:00Z',
      description: 'A fine bookshelf.',
    };

    it('normalizes to a schema-valid record', () => {
      const result = normalize('thriftly', raw);
      expect(() => NormalizedListingSchema.parse(result)).not.toThrow();
    });

    it('formats id as source:sourceListingId', () => {
      const result = normalize('thriftly', raw);
      expect(result.id).toBe('thriftly:listing-100');
      expect(result.source).toBe('thriftly');
      expect(result.sourceListingId).toBe('listing-100');
    });

    it('passes price_cents through unchanged (already in cents)', () => {
      const result = normalize('thriftly', raw);
      expect(result.priceCents).toBe(12500);
    });

    it('carries imagePath through unchanged, not treated as an external URL', () => {
      const result = normalize('thriftly', raw);
      expect(result.imagePath).toBe('thriftly/images/listing-100.jpg');
    });
  });

  describe('secondlook', () => {
    const raw: SecondLookRaw = {
      listingId: 'listing-003',
      name: 'Brass Floor Mirror',
      priceUsd: 145.0,
      tags: ['decor', 'mirror', 'brass'],
      photoUrl: 'https://secondlook.example/images/secondlook/images/listing-003.jpg',
      permalink: 'https://secondlook.example/p/listing-003',
      listedAt: '2024-08-06T16:42:20Z',
      details: 'A fine mirror.',
    };

    it('normalizes to a schema-valid record', () => {
      const result = normalize('secondlook', raw);
      expect(() => NormalizedListingSchema.parse(result)).not.toThrow();
    });

    it('formats id as source:sourceListingId', () => {
      const result = normalize('secondlook', raw);
      expect(result.id).toBe('secondlook:listing-003');
      expect(result.source).toBe('secondlook');
      expect(result.sourceListingId).toBe('listing-003');
    });

    it('converts the dollar-float price to cents correctly', () => {
      const result = normalize('secondlook', raw);
      expect(result.priceCents).toBe(14500);
    });

    it('converts a dollar amount with cents correctly', () => {
      const result = normalize('secondlook', { ...raw, priceUsd: 285.5 });
      expect(result.priceCents).toBe(28550);
    });

    it('carries photoUrl through as imagePath, unchanged and unrenamed to an external URL', () => {
      const result = normalize('secondlook', raw);
      expect(result.imagePath).toBe(raw.photoUrl);
    });

    it('joins tags into category', () => {
      const result = normalize('secondlook', raw);
      expect(result.category).toBe('decor, mirror, brass');
    });

    it('leaves category undefined when tags is empty', () => {
      const result = normalize('secondlook', { ...raw, tags: [] });
      expect(result.category).toBeUndefined();
    });
  });

  describe('reloop', () => {
    const raw: ReloopRaw = {
      title: 'Reclaimed Wood Dining Table',
      price: '$450.00',
      imageUrl: 'reloop/images/listing-001.jpg',
      sourceUrl: 'https://reloop.example/listings/listing-001',
      postedAt: '2026-08-05',
      description: 'A fine table.',
    };

    it('normalizes to a schema-valid record', () => {
      const result = normalize('reloop', raw);
      expect(() => NormalizedListingSchema.parse(result)).not.toThrow();
    });

    it('formats id as source:sourceListingId, deriving the id from sourceUrl', () => {
      const result = normalize('reloop', raw);
      expect(result.id).toBe('reloop:listing-001');
      expect(result.source).toBe('reloop');
      expect(result.sourceListingId).toBe('listing-001');
    });

    it('converts the string price to cents correctly', () => {
      const result = normalize('reloop', raw);
      expect(result.priceCents).toBe(45000);
    });

    it('converts a comma-formatted string price to cents correctly', () => {
      const result = normalize('reloop', { ...raw, price: '$1,200.00' });
      expect(result.priceCents).toBe(120000);
    });

    it('carries imageUrl through as imagePath, unchanged and unrenamed to an external URL', () => {
      const result = normalize('reloop', raw);
      expect(result.imagePath).toBe(raw.imageUrl);
    });

    it('widens a bare date to a full ISO datetime', () => {
      const result = normalize('reloop', raw);
      expect(result.postedAt).toBe('2026-08-05T00:00:00Z');
    });

    it('leaves an already-full ISO datetime unchanged (does not double-widen)', () => {
      const result = normalize('reloop', { ...raw, postedAt: '2024-01-15T10:30:00Z' });
      expect(result.postedAt).toBe('2024-01-15T10:30:00Z');
    });

    it('trims whitespace around the price before parsing', () => {
      const result = normalize('reloop', { ...raw, price: '  $450.00  ' });
      expect(result.priceCents).toBe(45000);
    });

    it('throws when the price string has no parseable number', () => {
      expect(() => normalize('reloop', { ...raw, price: 'free' })).toThrow(
        /unable to parse Reloop price/,
      );
    });

    it('ignores a trailing slash on sourceUrl when deriving sourceListingId', () => {
      const result = normalize('reloop', {
        ...raw,
        sourceUrl: 'https://reloop.example/listings/listing-001/',
      });
      expect(result.sourceListingId).toBe('listing-001');
      expect(result.id).toBe('reloop:listing-001');
    });

    it('throws when sourceUrl has no derivable last segment', () => {
      expect(() => normalize('reloop', { ...raw, sourceUrl: '///' })).toThrow(
        /unable to derive Reloop sourceListingId/,
      );
    });
  });

  describe('single-argument SourceRecord form', () => {
    it('dispatches correctly when called with a single { source, raw } object', () => {
      const raw: ThriftlyRaw = {
        id: 'listing-200',
        title: 'Ceramic Vase',
        price_cents: 3000,
        category: 'decor',
        image_path: 'thriftly/images/listing-200.jpg',
        source_url: 'https://thriftly.example/listings/listing-200',
        posted_at: '2024-02-01T00:00:00Z',
        description: 'A vase.',
      };
      const result = normalize({ source: 'thriftly', raw });
      expect(result.id).toBe('thriftly:listing-200');
      expect(result.priceCents).toBe(3000);
    });
  });
});
