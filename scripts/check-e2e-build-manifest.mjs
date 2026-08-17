import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { sourceStateChecksum } from "./source-state-checksum.mjs";

const root = process.cwd();
const manifestPath = join(root, "apps", "desktop", "dist", "build-manifest.json");
let sourceRevision;
try {
  sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8"
  }).trim();
} catch {
  fail("Unable to resolve the current Git revision for Electron E2E.");
}

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {
  fail("Electron E2E build manifest is missing or invalid.");
}

let currentSourceState;
try {
  currentSourceState = await sourceStateChecksum(root);
} catch {
  fail("Unable to fingerprint the current source state for Electron E2E.");
}

if (
  manifest?.schemaVersion !== "1.0" ||
  typeof manifest.sourceRevision !== "string" ||
  manifest.sourceRevision !== sourceRevision ||
  typeof manifest.sourceStateChecksum !== "string" ||
  manifest.sourceStateChecksum !== currentSourceState
) {
  fail(
    `Electron E2E build is stale (expected revision ${sourceRevision} and current source state).`
  );
}

function fail(message) {
  console.error(`${message} Run \`npm run build\` before \`npm run test:e2e:built\`.`);
  process.exit(1);
}
