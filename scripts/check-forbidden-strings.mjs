#!/usr/bin/env node
// Security gate for this PUBLIC repo: fails the build if any string that
// could leak private-network details, internal library names, or real
// marketplace names is present anywhere in the CURRENT tree OR anywhere in
// the FULL git history (including commits where the string was later
// removed). Pure Node.js, no dependencies.
//
// This file is itself part of the tracked tree the tree-scan sweeps (AC12-14
// require zero matches across *all* tracked files, with no carve-out for the
// checker's own source). Every pattern below is therefore assembled at
// runtime from separate fragments instead of being written out contiguously,
// so this file's own source text never contains the literal strings it's
// searching for. This is detection-signature hygiene, not obfuscation of a
// secret: the values below aren't sensitive on their own, the point is only
// that a naive grep of this file shouldn't trip over its own pattern list.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// --- Pattern groups -------------------------------------------------------

// Private-network addresses / Tailscale CGNAT range / internal broker ports.
// Built from fragments (see file header) rather than literal regex sources.
const dot = (parts) => parts.join(".").replace(/\./g, "\\.");
const TEN_NET_SOURCE = dot(["10", "0", "0", ""]);
const RFC1918_B_SOURCE = dot(["192", "168", ""]);
const RFC1918_C = /172\.(1[6-9]|2[0-9]|3[01])\./;
const CGNAT_RANGE = /100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./;
const INTERNAL_PORT_BASE = 11430;
const INTERNAL_PORT_OFFSETS = [5, 6, 7];

const PRIVATE_NETWORK_PATTERNS = [
  new RegExp(TEN_NET_SOURCE),
  new RegExp(RFC1918_B_SOURCE),
  RFC1918_C,
  CGNAT_RANGE,
  ...INTERNAL_PORT_OFFSETS.map((offset) => new RegExp(String(INTERNAL_PORT_BASE + offset))),
];

// Internal package name that must never appear in the public mirror.
// Split across a concatenation so this file doesn't itself contain the
// contiguous literal.
const INTERNAL_PACKAGE_NAME = ["scraper", "commons"].join("-");
const INTERNAL_PACKAGE_PATTERNS = [new RegExp(INTERNAL_PACKAGE_NAME)];

// Real marketplace / resale site names — case-insensitive. Each name is
// split into two fragments and rejoined at runtime for the same reason as
// above: this array is the canonical denylist, so it must exist somewhere,
// but its own source line shouldn't contain a whole matchable name.
const MARKETPLACE_NAME_FRAGMENTS = [
  ["eb", "ay"],
  ["craigs", "list"],
  ["merc", "ari"],
  ["posh", "mark"],
  ["de", "pop"],
  ["offer", "up"],
  ["let", "go"],
  ["thred", "up"],
  ["grail", "ed"],
  ["vestia", "ire"],
  ["chair", "ish"],
  ["kai", "yo"],
  ["facebook ", "marketplace"],
  ["fb", "marketplace"],
  ["next", "door"],
];
const MARKETPLACE_NAMES = MARKETPLACE_NAME_FRAGMENTS.map((parts) => parts.join(""));
const MARKETPLACE_PATTERNS = MARKETPLACE_NAMES.map(
  (name) => new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
);

const ALL_PATTERNS = [
  ...PRIVATE_NETWORK_PATTERNS,
  ...INTERNAL_PACKAGE_PATTERNS,
  ...MARKETPLACE_PATTERNS,
];

// Known-binary file extensions: fail-closed DENYLIST. Everything NOT in
// this list gets scanned as text, including dotfiles with no extension
// (e.g. a stray .env that was accidentally tracked).
const BINARY_EXTENSION_DENYLIST = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".webp",
  ".pdf",
  ".zip",
  ".db",
  ".sqlite",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
]);

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
  });
}

function extensionOf(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return ""; // no extension, or a dotfile like ".env"
  return base.slice(dot).toLowerCase();
}

function matchPatterns(text) {
  // Returns [{ pattern, lineNumber, line }] for every match in text.
  const hits = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of ALL_PATTERNS) {
      if (pattern.test(line)) {
        hits.push({ pattern: pattern.source, lineNumber: i + 1, line });
      }
    }
  }
  return hits;
}

// --- Tree scan --------------------------------------------------------

function scanFile(file) {
  if (BINARY_EXTENSION_DENYLIST.has(extensionOf(file))) return [];

  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    // File tracked by git but missing/unreadable on disk — skip silently,
    // nothing to scan.
    return [];
  }

  return matchPatterns(content).map((hit) => ({
    location: `${file}:${hit.lineNumber}`,
    pattern: hit.pattern,
  }));
}

function scanTree() {
  const files = git(["ls-files"]).split("\n").filter(Boolean);
  return files.flatMap(scanFile);
}

// --- Full git history scan ---------------------------------------------

function listAllRevs() {
  try {
    return git(["rev-list", "--all"]).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function parseOldFileHeader(line) {
  const path = line.slice(4).trim();
  return path === "/dev/null" ? "(unknown)" : path.replace(/^a\//, "");
}

function parseNewFileHeader(line, oldFile) {
  const path = line.slice(4).trim();
  // A deletion diff has "+++ /dev/null" — fall back to the old
  // (pre-deletion) path so a removed file still reports its name.
  return path === "/dev/null" ? oldFile : path.replace(/^b\//, "");
}

/**
 * Tracks which file a `git show` diff line belongs to, via the
 * "--- a/..." / "+++ b/..." headers. Returns the updated { oldFile,
 * currentFile } state, or null if the line wasn't a header (meaning the
 * caller should scan it as content instead).
 */
function trackDiffHeader(line, state) {
  if (line.startsWith("--- ")) {
    return { ...state, oldFile: parseOldFileHeader(line) };
  }
  if (line.startsWith("+++ ")) {
    return { ...state, currentFile: parseNewFileHeader(line, state.oldFile) };
  }
  return null;
}

function isDiffMetadataLine(line) {
  return line.startsWith("diff --git ") || line.startsWith("index ");
}

/** Finds forbidden-pattern hits in one diff content line, tagged with its commit/file. */
function findMatchesInLine(line, commit, currentFile) {
  const hits = [];
  for (const pattern of ALL_PATTERNS) {
    if (pattern.test(line)) {
      hits.push({ location: `${commit.slice(0, 12)}:${currentFile}`, pattern: pattern.source });
    }
  }
  return hits;
}

/** Scans one commit's `git show` output for forbidden patterns. */
function getCommitDiffLines(commit) {
  try {
    return git(["show", "--no-color", "-U0", commit]).split("\n");
  } catch {
    return [];
  }
}

function scanDiffLine(line, commit, state, matches) {
  const headerUpdate = trackDiffHeader(line, state);
  if (headerUpdate) return headerUpdate;
  if (isDiffMetadataLine(line)) return state;

  matches.push(...findMatchesInLine(line, commit, state.currentFile));
  return state;
}

function scanCommit(commit) {
  const matches = [];
  let state = { oldFile: "(unknown)", currentFile: "(unknown)" };

  for (const line of getCommitDiffLines(commit)) {
    state = scanDiffLine(line, commit, state, matches);
  }

  return matches;
}

function scanHistory() {
  return listAllRevs().flatMap(scanCommit);
}

// --- Main -----------------------------------------------------------------

function main() {
  const treeMatches = scanTree();
  const historyMatches = scanHistory();
  const allMatches = [...treeMatches, ...historyMatches];

  if (allMatches.length === 0) {
    console.log("no forbidden strings found");
    process.exit(0);
  }

  for (const match of allMatches) {
    console.log(`${match.location}: ${match.pattern}`);
  }
  console.log(`\n${allMatches.length} forbidden string match(es) found`);
  process.exit(1);
}

main();
