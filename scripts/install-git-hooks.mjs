#!/usr/bin/env node

import { execSync } from "node:child_process";
import { cpSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);

try {
  // Find the .git directory robustly (handles worktrees where .git is a file)
  const gitDir = execSync("git rev-parse --git-dir", {
    encoding: "utf8",
    cwd: repoRoot,
  })
    .trim();

  // Resolve relative git dir to absolute path
  const gitDirAbsolute = gitDir.startsWith("/") ? gitDir : join(repoRoot, gitDir);
  const hooksDir = join(gitDirAbsolute, "hooks");

  // Source and destination paths
  const source = join(repoRoot, "scripts", "hooks", "pre-push");
  const dest = join(hooksDir, "pre-push");

  // Copy the hook file
  cpSync(source, dest, { force: true });

  // Make it executable
  chmodSync(dest, 0o755);

  console.log(`installed pre-push hook to ${dest}`);
} catch {
  // Not in a git repo or git command failed — warn and exit cleanly
  console.warn(
    "warning: not in a git repository, skipping pre-push hook installation"
  );
  process.exit(0);
}
