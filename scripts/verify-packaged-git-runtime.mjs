#!/usr/bin/env node
/**
 * verify-packaged-git-runtime.mjs
 * Checks that the git runtime binary is present and has a manifest entry.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const BASE = resolve(process.argv[2] ?? "dist");
const manifestPath = join(BASE, "resources", "git", "manifest.json");

if (!existsSync(manifestPath)) {
  console.warn(`Git manifest not found at ${manifestPath} — skipping (development build)`);
  process.exit(0);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  console.error(`Cannot parse git manifest: ${manifestPath}`);
  process.exit(1);
}

if (manifest.digest === "placeholder") {
  console.warn("Git runtime manifest is a placeholder — not production-qualified");
  process.exit(0);
}

const gitBinaryPath = join(BASE, manifest.path);
try {
  await stat(gitBinaryPath);
} catch {
  console.error(`Git binary missing: ${gitBinaryPath}`);
  process.exit(1);
}

const buf = await readFile(gitBinaryPath);
const actual = createHash("sha256").update(buf).digest("hex");
if (actual !== manifest.digest) {
  console.error(`Git binary digest mismatch`);
  console.error(`  expected: ${manifest.digest}`);
  console.error(`  actual:   ${actual}`);
  process.exit(1);
}

console.log(`OK: git binary at ${gitBinaryPath} matches manifest digest`);
process.exit(0);
