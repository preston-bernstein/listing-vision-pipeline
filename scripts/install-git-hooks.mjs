#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  // The hooks live in .githooks so they are version controlled.
  execSync('git config core.hooksPath .githooks', { cwd: repoRoot, stdio: 'ignore' });
  console.log('git hooks path set to .githooks');
} catch {
  // Not in a git repo or git command failed — warn and exit cleanly
  console.warn(
    'warning: not in a git repository, skipping git hooks setup'
  );
  process.exit(0);
}
