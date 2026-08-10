import { readFile } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { ReloopRawSchema, type ReloopRaw } from '../schema/raw.js';

/**
 * Reads and validates a Reloop listing HTML file against ReloopRawSchema.
 * Reloop listings are scraped from server-rendered HTML rather than JSON.
 */
export async function parseReloopListing(filePath: string): Promise<ReloopRaw> {
  const contents = await readFile(filePath, 'utf-8');
  const $ = cheerio.load(contents);
  const listing = $('.listing').first();

  const raw = {
    title: listing.find('.listing-title').first().text().trim(),
    price: listing.find('.listing-price').first().text().trim(),
    imageUrl: listing.find('.listing-image').first().text().trim(),
    sourceUrl: listing.find('.listing-url').first().text().trim(),
    postedAt: listing.find('.listing-date').first().text().trim(),
    description: listing.find('.listing-description').first().text().trim() || undefined,
  };

  return ReloopRawSchema.parse(raw);
}
