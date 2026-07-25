#!/usr/bin/env node
/**
 * Materialize a locked Git for Windows runtime for electron-builder.
 *
 * The checked-in lock starts unavailable on purpose. A release owner must
 * commit a reviewed, pinned lock before this script will download or unpack
 * anything. The generated directory is ignored and is the only directory
 * electron-builder may receive through NOVEL_STUDIO_GIT_RUNTIME_DIR.
 */
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { URL } from "node:url";

const root = process.cwd();
const options = parseArguments(process.argv.slice(2));
const lockPath = resolve(root, options.sourceLock);
const outputDirectory = resolve(root, options.outputDirectory);
const outputRoot = resolve(root, ".tmp-agent-tool");
assertOutputDirectory(outputDirectory);
const sourceLock = await readSourceLock(lockPath);

if (sourceLock.status !== "pinned") {
  throw new Error(
    `Git runtime source lock is unavailable. Refusing to prepare an unpinned runtime: ${lockPath}`
  );
}

const archivePath = options.download
  ? await downloadLockedArchive(sourceLock)
  : await requireArchive(options.archive);
await verifyDigest(archivePath, sourceLock.archiveSha256, "Git runtime archive");

const scratchDirectory = await mkdtemp(join(tmpdir(), "novel-studio-git-runtime-"));
const stagingDirectory = join(scratchDirectory, "runtime");
try {
  await mkdir(stagingDirectory, { recursive: true });
  await extractArchive(archivePath, stagingDirectory);
  await verifyExtractedTree(stagingDirectory);

  const executablePath = resolve(stagingDirectory, sourceLock.executablePath);
  const licensePath = resolve(stagingDirectory, sourceLock.licensePath);
  assertContainedPath(stagingDirectory, executablePath, "Git executable");
  assertContainedPath(stagingDirectory, licensePath, "Git license");
  await verifyRegularFile(executablePath, "Git executable");
  await verifyRegularFile(licensePath, "Git license");
  if (!(await isPortableExecutable(executablePath))) {
    throw new Error("Git executable must be a Windows PE file.");
  }
  await verifyDigest(licensePath, sourceLock.licenseSha256, "Git license");

  const inventory = await createInventory(stagingDirectory, sourceLock);
  const preparedDirectory = join(scratchDirectory, "prepared");
  await cp(stagingDirectory, preparedDirectory, {
    recursive: true,
    dereference: false,
    filter: (path) => !path.endsWith("manifest.json") && !path.endsWith("runtime-inventory.json")
  });
  await writeFile(
    join(preparedDirectory, "manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0",
        version: sourceLock.version,
        digest: inventory.executableDigest,
        path: `git/${sourceLock.executablePath}`,
        license: "GPL-2.0"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(preparedDirectory, "runtime-inventory.json"),
    `${JSON.stringify(inventory, null, 2)}\n`,
    "utf8"
  );
  await replaceOutputDirectory(preparedDirectory, outputDirectory);
  console.log(`Prepared locked Git runtime: ${outputDirectory}`);
  console.log(`Set NOVEL_STUDIO_GIT_RUNTIME_DIR=${outputDirectory} before packaging.`);
} finally {
  await rm(scratchDirectory, { recursive: true, force: true });
}

function parseArguments(args) {
  const values = {
    sourceLock: "apps/desktop/resources/git/runtime-source.lock.json",
    outputDirectory: ".tmp-agent-tool/git-runtime",
    archive: undefined,
    download: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--download") {
      values.download = true;
      continue;
    }
    if (["--source-lock", "--output", "--archive"].includes(argument)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === "--source-lock") values.sourceLock = value;
      if (argument === "--output") values.outputDirectory = value;
      if (argument === "--archive") values.archive = value;
      index += 1;
      continue;
    }
    throw new Error(`Unsupported prepare-git-runtime argument: ${argument}`);
  }
  if (values.download && values.archive !== undefined) {
    throw new Error("--download and --archive cannot be used together.");
  }
  if (!values.download && values.archive === undefined) {
    throw new Error("Provide --archive <locked-zip> or use --download.");
  }
  return values;
}

async function readSourceLock(path) {
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`Cannot read Git runtime source lock: ${path}`);
  }
  if (!isRecord(value) || value.schemaVersion !== "1.0") {
    throw new Error("Git runtime source lock is malformed.");
  }
  if (value.status === "unavailable") {
    if (
      !hasExactKeys(value, ["schemaVersion", "status", "reason"]) ||
      !isNonEmptyString(value.reason)
    ) {
      throw new Error("Unavailable Git runtime source lock is malformed.");
    }
    return value;
  }
  if (
    value.status !== "pinned" ||
    !hasExactKeys(value, [
      "schemaVersion",
      "status",
      "vendor",
      "version",
      "sourceUrl",
      "archiveSha256",
      "executablePath",
      "licensePath",
      "licenseSha256"
    ]) ||
    value.vendor !== "Git for Windows" ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:\.windows\.[0-9]+)?$/.test(value.version) ||
    !isTrustedGitForWindowsUrl(value.sourceUrl) ||
    !isSha256(value.archiveSha256) ||
    !isSafeRuntimePath(value.executablePath) ||
    !isSafeRuntimePath(value.licensePath) ||
    !isSha256(value.licenseSha256)
  ) {
    throw new Error("Pinned Git runtime source lock is malformed or uses an untrusted source.");
  }
  return value;
}

async function requireArchive(archive) {
  const path = resolve(root, archive);
  if (!path.toLowerCase().endsWith(".zip"))
    throw new Error("Git runtime archive must be a .zip file.");
  await verifyRegularFile(path, "Git runtime archive");
  return path;
}

async function downloadLockedArchive(lock) {
  const cacheDirectory = join(resolve(root, ".tmp-agent-tool"), "downloads");
  await mkdir(cacheDirectory, { recursive: true });
  const archivePath = join(cacheDirectory, `${lock.archiveSha256}.zip`);
  // GitHub release URLs redirect to a short-lived release-asset URL. The
  // archive's pinned digest remains the authority after that redirect.
  const response = await globalThis.fetch(lock.sourceUrl, { redirect: "follow" });
  if (!response.ok || response.body === null) {
    throw new Error(`Unable to download locked Git runtime: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(archivePath, bytes, { mode: 0o600 });
  return archivePath;
}

async function extractArchive(archivePath, destination) {
  // Windows supplies bsdtar. The archive digest is checked before extraction;
  // extraction occurs only in an isolated temp directory.
  await run("tar", ["-xf", archivePath, "-C", destination]);
}

async function verifyExtractedTree(directory) {
  const stack = [directory];
  let fileCount = 0;
  let byteCount = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const archivePath = relative(directory, join(current, entry.name)).replaceAll("\\", "/");
      if (!isSafeRuntimePath(archivePath)) {
        throw new Error(`Git runtime archive has an unsafe path: ${entry.name}`);
      }
      if (archivePath === "manifest.json" || archivePath === "runtime-inventory.json") {
        throw new Error(`Git runtime archive reserves the generated path: ${archivePath}`);
      }
      const path = join(current, entry.name);
      const details = await lstat(path);
      if (details.isSymbolicLink() || (!details.isFile() && !details.isDirectory())) {
        throw new Error(`Git runtime archive contains an unsupported entry: ${entry.name}`);
      }
      if (details.isDirectory()) {
        stack.push(path);
      } else {
        fileCount += 1;
        byteCount += details.size;
      }
    }
  }
  if (fileCount === 0 || fileCount > 20_000 || byteCount > 1_073_741_824) {
    throw new Error("Git runtime archive exceeds the allowed extracted file or size budget.");
  }
}

async function createInventory(directory, lock) {
  const files = [];
  const stack = [directory];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else {
        const filePath = relative(directory, path).replaceAll("\\", "/");
        const file = await readFile(path);
        files.push({ path: filePath, size: file.length, digest: sha256(file) });
      }
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const executable = files.find((file) => file.path === lock.executablePath);
  if (executable === undefined)
    throw new Error("Git executable is missing from runtime inventory.");
  const canonical = files.map((file) => `${file.path}\0${file.size}\0${file.digest}\n`).join("");
  return {
    schemaVersion: "1.0",
    vendor: lock.vendor,
    version: lock.version,
    sourceUrl: lock.sourceUrl,
    archiveSha256: lock.archiveSha256,
    licensePath: lock.licensePath,
    licenseSha256: lock.licenseSha256,
    executablePath: lock.executablePath,
    executableDigest: executable.digest,
    runtimeDigest: sha256(Buffer.from(canonical, "utf8")),
    files
  };
}

async function replaceOutputDirectory(source, destination) {
  assertOutputDirectory(destination);
  const replacement = `${destination}.next`;
  await rm(replacement, { recursive: true, force: true });
  await cp(source, replacement, { recursive: true, dereference: false });
  await rm(destination, { recursive: true, force: true });
  await mkdir(join(destination, ".."), { recursive: true });
  await rename(replacement, destination);
}

function assertOutputDirectory(destination) {
  const outputRelative = relative(outputRoot, destination);
  if (
    outputRelative === "" ||
    outputRelative === ".." ||
    outputRelative.startsWith(`..${sep}`) ||
    isAbsolute(outputRelative)
  ) {
    throw new Error("Git runtime output must stay below .tmp-agent-tool.");
  }
}

async function verifyRegularFile(path, label) {
  let details;
  try {
    details = await lstat(path);
  } catch {
    throw new Error(`${label} is missing: ${path}`);
  }
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file: ${path}`);
  }
}

async function verifyDigest(path, expected, label) {
  const actual = sha256(await readFile(path));
  if (actual !== expected.toLowerCase()) {
    throw new Error(`${label} SHA-256 mismatch. expected=${expected} actual=${actual}`);
  }
}

async function isPortableExecutable(path) {
  const bytes = await readFile(path);
  if (bytes.length < 0x40) return false;
  const peOffset = bytes.readUInt32LE(0x3c);
  return (
    bytes[0] === 0x4d &&
    bytes[1] === 0x5a &&
    peOffset >= 0x40 &&
    peOffset + 4 <= bytes.length &&
    bytes.subarray(peOffset, peOffset + 4).equals(Buffer.from("PE\0\0"))
  );
}

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, shell: false, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

function assertContainedPath(base, candidate, label) {
  const candidateRelative = relative(base, candidate);
  if (
    candidateRelative === "" ||
    candidateRelative === ".." ||
    candidateRelative.startsWith(`..${sep}`) ||
    isAbsolute(candidateRelative)
  ) {
    throw new Error(`${label} escapes the extracted Git runtime.`);
  }
}

function isTrustedGitForWindowsUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      /^\/git-for-windows\/git\/releases\/download\/v[0-9.]+\.windows\.[0-9]+\/.+\.zip$/.test(
        url.pathname
      )
    );
  } catch {
    return false;
  }
}

function isSafeRuntimePath(value) {
  return (
    isNonEmptyString(value) &&
    !value.includes("\0") &&
    !value.includes("\\") &&
    !isAbsolute(value) &&
    !/^[a-zA-Z]:/.test(value) &&
    !value.startsWith("\\\\") &&
    posix.normalize(value) === value &&
    value
      .split("/")
      .every((part) => part && part !== "." && part !== ".." && !part.includes(":"))
  );
}

function hasExactKeys(value, keys) {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
