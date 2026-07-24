#!/usr/bin/env node
/**
 * verify-packaged-agent-sandbox.mjs
 * Checks that sandbox binaries are present and have correct checksums in the packaged app.
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const BASE = resolve(process.argv[2] ?? "dist");

async function checkFile(filePath, expectedDigest) {
  try {
    await stat(filePath);
  } catch {
    console.error(`MISSING: ${filePath}`);
    return false;
  }
  if (expectedDigest === "placeholder") {
    console.warn(`WARN: ${filePath} has placeholder digest — not production-qualified`);
    return true; // Not a hard failure in development
  }
  const buf = await readFile(filePath);
  const actual = createHash("sha256").update(buf).digest("hex");
  if (actual !== expectedDigest) {
    console.error(`DIGEST MISMATCH: ${filePath}`);
    console.error(`  expected: ${expectedDigest}`);
    console.error(`  actual:   ${actual}`);
    return false;
  }
  console.log(`OK: ${filePath}`);
  return true;
}

const manifestPath = join(BASE, "resources", "native", "agent-task-sandbox", "manifest.json");
if (!existsSync(manifestPath)) {
  console.warn(`Sandbox manifest not found at ${manifestPath} — skipping (development build)`);
  process.exit(0);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  console.error(`Cannot parse sandbox manifest: ${manifestPath}`);
  process.exit(1);
}

let allOk = true;
for (const artifact of (manifest.artifacts ?? [])) {
  const ok = await checkFile(join(BASE, artifact.path), artifact.digest);
  if (!ok) allOk = false;
}

process.exit(allOk ? 0 : 1);
