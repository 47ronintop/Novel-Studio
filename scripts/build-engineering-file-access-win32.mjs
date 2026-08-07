import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const run = promisify(execFile);
const root = process.cwd();
if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("engineering-file-access-win32 only supports win32-x64 CI builds");
}

const sourceRevision = (
  process.env.SOURCE_REVISION ?? (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout
).trim();
const includeDir = process.env.NODE_API_INCLUDE_DIR;
if (!includeDir)
  throw new Error("NODE_API_INCLUDE_DIR must point to the CI-provided Node-API headers");
const nodeLibrary = process.env.NODE_LIBRARY ?? join(process.execPath, "..", "node.lib");
try {
  await stat(nodeLibrary);
} catch {
  throw new Error("NODE_LIBRARY must point to node.lib from the CI Node runtime");
}
const cmakeVersion = (await run("cmake", ["--version"])).stdout.split(/\r?\n/u)[0].trim();
const buildDir = join(root, "native", "engineering-file-access-win32", ".build", "win32-x64");
const distDir = join(root, "native", "engineering-file-access-win32", "dist", "win32-x64");
await mkdir(distDir, { recursive: true });
// A normal build produces an unsigned development artifact. A stale release signature must
// never make that artifact appear packageable or production-qualified.
await Promise.all([
  rm(join(distDir, "engineering_file_access.manifest.p7s"), { force: true }),
  rm(join(distDir, "engineering_file_access.probe.json"), { force: true })
]);
await run(
  "cmake",
  [
    "-S",
    "native/engineering-file-access-win32",
    "-B",
    buildDir,
    "-G",
    "Visual Studio 17 2022",
    "-A",
    "x64",
    `-DNODE_API_INCLUDE_DIR=${includeDir}`,
    `-DNODE_LIBRARY=${nodeLibrary}`
  ],
  { cwd: root }
);
await run(
  "cmake",
  ["--build", buildDir, "--config", "Release", "--target", "engineering_file_access"],
  { cwd: root }
);
const candidates = [
  join(buildDir, "Release", "engineering_file_access.node"),
  join(buildDir, "engineering_file_access.node")
];
let source;
for (const candidate of candidates) {
  try {
    await readFile(candidate);
    source = candidate;
    break;
  } catch (error) {
    if (!(error instanceof Error) || error.code !== "ENOENT") throw error;
  }
}
if (!source) throw new Error("CMake did not produce engineering_file_access.node");
const artifact = await readFile(source);
const artifactPath = join(distDir, "engineering_file_access.node");
await writeFile(artifactPath, artifact);
const manifest = {
  schemaVersion: "1.0",
  adapterId: "novel_studio_engineering_file_access",
  target: "win32-x64",
  sourceRevision,
  nodeApiVersion: 8,
  toolchain: {
    cmakeVersion,
    generator: "Visual Studio 17 2022",
    architecture: "x64",
    nodeVersion: process.version
  },
  publisherPolicyChecksum: process.env.PUBLISHER_POLICY_CHECKSUM ?? null,
  artifact: {
    path: "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.node",
    sha256: createHash("sha256").update(artifact).digest("hex")
  },
  eligibility: {
    batch: "6",
    access: "unavailable",
    root: "unavailable",
    read: "unavailable",
    index: "unavailable",
    mutation: "unavailable",
    recovery: "unavailable"
  },
  signing: {
    authenticode: "required-for-production",
    detachedCms: "required-for-production",
    developmentUnsigned: true
  },
  qualification: {
    productionQualified: false,
    eligibleCapabilities: [],
    unavailableCapabilities: ["root", "access", "read", "index", "mutation", "recovery"]
  }
};
await writeFile(
  join(distDir, "engineering_file_access.manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);
console.log(`Built ${artifactPath}`);
