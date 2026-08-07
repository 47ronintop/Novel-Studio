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

const vsDevCmd = process.env.ENGINEERING_FILE_ACCESS_VSDEVCMD;
const generator = process.env.ENGINEERING_FILE_ACCESS_CMAKE_GENERATOR;
const cmakeMakeProgram = process.env.CMAKE_MAKE_PROGRAM;
if (!vsDevCmd || !generator || !cmakeMakeProgram) {
  throw new Error(
    "the CI-discovered Visual Studio environment, CMake generator, and make program are required"
  );
}
if (generator !== "Ninja") {
  throw new Error(`unsupported CI CMake generator: ${generator}`);
}
for (const [label, path] of [
  ["ENGINEERING_FILE_ACCESS_VSDEVCMD", vsDevCmd],
  ["CMAKE_MAKE_PROGRAM", cmakeMakeProgram]
]) {
  try {
    await stat(path);
  } catch {
    throw new Error(`${label} must point to a CI-provided executable`);
  }
}

const toolchainEnvironment = { ...process.env };
const vsEnvironment = await run(
  "cmd.exe",
  ["/d", "/c", `call "${vsDevCmd}" -no_logo -host_arch=x64 -arch=x64 >nul && set`],
  { cwd: root, env: toolchainEnvironment, maxBuffer: 1024 * 1024 }
);
for (const line of vsEnvironment.stdout.split(/\r?\n/u)) {
  const separator = line.indexOf("=");
  if (separator > 0) {
    toolchainEnvironment[line.slice(0, separator)] = line.slice(separator + 1);
  }
}
if (!toolchainEnvironment.VCToolsVersion || !toolchainEnvironment.VCToolsInstallDir) {
  throw new Error("VsDevCmd did not expose a Visual Studio C++ toolchain");
}
const compilerPath = (
  await run("where.exe", ["cl.exe"], { cwd: root, env: toolchainEnvironment })
).stdout
  .split(/\r?\n/u)
  .find(Boolean);
if (!compilerPath) throw new Error("VsDevCmd did not expose cl.exe");

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
  throw new Error("NODE_LIBRARY must point to the CI-provided Node-API import library");
}
const cmakeCapabilities = JSON.parse(
  (await run("cmake", ["-E", "capabilities"], { cwd: root, env: toolchainEnvironment })).stdout
);
if (!cmakeCapabilities.generators?.some(({ name }) => name === generator)) {
  throw new Error(`the installed CMake does not support the ${generator} generator`);
}
const cmakeVersion = (
  await run("cmake", ["--version"], { cwd: root, env: toolchainEnvironment })
).stdout
  .split(/\r?\n/u)[0]
  .trim();
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
    generator,
    `-DCMAKE_MAKE_PROGRAM=${cmakeMakeProgram}`,
    "-DCMAKE_BUILD_TYPE=Release",
    `-DNODE_API_INCLUDE_DIR=${includeDir}`,
    `-DNODE_LIBRARY=${nodeLibrary}`
  ],
  { cwd: root, env: toolchainEnvironment }
);
await run("cmake", ["--build", buildDir, "--target", "engineering_file_access"], {
  cwd: root,
  env: toolchainEnvironment
});
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
    generator,
    architecture: "x64",
    nodeVersion: process.version,
    visualStudioVersion: process.env.ENGINEERING_FILE_ACCESS_VS_VERSION ?? null,
    vcToolsVersion: toolchainEnvironment.VCToolsVersion,
    compilerPath
  },
  publisherPolicyChecksum: process.env.PUBLISHER_POLICY_CHECKSUM ?? null,
  artifact: {
    path: "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.node",
    sha256: createHash("sha256").update(artifact).digest("hex")
  },
  eligibility: {
    batch: "6",
    // These describe the development ABI that CI must probe. They are not production
    // qualification: the separate qualification block remains fail-closed until a signed,
    // packaged artifact and its evidence have been verified by Main.
    access: "available",
    root: "available",
    read: "available",
    index: "available",
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
