import { readFile } from 'node:fs/promises';
import { ThriftlyRawSchema, type ThriftlyRaw } from '../schema/raw.js';

/**
 * Reads and validates a Thriftly listing JSON file against ThriftlyRawSchema.
 */
export async function parseThriftlyListing(filePath: string): Promise<ThriftlyRaw> {
  const contents = await readFile(filePath, 'utf-8');
  const json = JSON.parse(contents);
  return ThriftlyRawSchema.parse(json);
}
