import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Directory this module lives in — used to derive the default fixtures root. */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Default fixtures root: `<repo root>/fixtures`, derived from this module's own
 * location (`packages/core/src/`, two levels below the repo root) rather than the
 * caller's — every consumer across both packages imports this single constant
 * instead of re-deriving it relative to its own file.
 */
export const DEFAULT_FIXTURES_ROOT = path.resolve(MODULE_DIR, '../../../fixtures');
