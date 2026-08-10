import { readFile } from 'node:fs/promises';
import { SecondLookRawSchema, type SecondLookRaw } from '../schema/raw.js';

/**
 * Reads and validates a SecondLook listing JSON file against SecondLookRawSchema.
 */
export async function parseSecondLookListing(filePath: string): Promise<SecondLookRaw> {
  const contents = await readFile(filePath, 'utf-8');
  const json = JSON.parse(contents);
  return SecondLookRawSchema.parse(json);
}
