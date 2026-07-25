#!/usr/bin/env node
/**
 * Windows black-box qualification for the handle-relative file lifecycle host.
 * A successful build is never enough: these vectors exercise root identity,
 * reparse-point and hard-link rejection against a real Windows executable.
 */
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { arch, platform, release, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

const root = process.cwd();
const protocolVersion = "1.1";
const maxRequestBytes = 32 * 1024 * 1024;
const maxResponseBytes = 1024 * 1024;
const operationTimeoutMs = 30_000;
const testVectorRevision = "tv-file-operations-2026-07-25";
const bundleDirectory = parseBundleDirectory(process.argv.slice(2));
const binaryName = "agent-file-operations-host.exe";

const manifest = await readManifest(bundleDirectory);
const binaryPath = join(bundleDirectory, binaryName);
assertContained(bundleDirectory, binaryPath);
const binaryBytes = await readFile(binaryPath);
assertPortableExecutable(binaryBytes, binaryPath);
const binaryDigest = sha256(binaryBytes);
if (manifest.artifact.digest !== binaryDigest) {
  throw new Error("Staged file operation artifact digest does not match manifest.");
}

const harnessDirectory = await mkdtemp(join(tmpdir(), "agent-file-operations-qualification-"));
const projectRoot = join(harnessDirectory, "project");
const externalRoot = join(harnessDirectory, "external");
const oldProjectRoot = join(harnessDirectory, "project-original");
try {
  await mkdir(projectRoot);
  await mkdir(externalRoot);
  const rootIdentity = await readRootIdentity(projectRoot);

  await invokeExpectOk(createDirectoryRequest(projectRoot, rootIdentity, "safe"));
  await assertDirectory(join(projectRoot, "safe"));

  await runReparseVector(projectRoot, externalRoot, rootIdentity);
  await runHardLinkVector(projectRoot, externalRoot, rootIdentity);
  await runRootIdentityVector(projectRoot, oldProjectRoot, rootIdentity);

  const evidence = {
    schemaVersion: "1.0",
    evidenceId: `file-operations-${randomUUID()}`,
    artifactDigest: binaryDigest,
    protocolVersion,
    testVectorRevision,
    osVersion: `${platform()} ${release()} ${arch()}`,
    generatedAt: new Date().toISOString(),
    capabilities: {
      rootIdentityBinding: "verified",
      reparsePointRejection: "verified",
      hardlinkRejection: "verified",
      handleRelativeMutation: "verified"
    }
  };
  await writeFile(
    join(bundleDirectory, "qualification-evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`
  );
  console.log(`OK: native file operation qualification passed (${evidence.evidenceId}).`);
} finally {
  await rm(harnessDirectory, { recursive: true, force: true });
}

async function runReparseVector(project, external, rootIdentity) {
  const outsideSentinel = join(external, "sentinel.txt");
  const junction = join(project, "reparse");
  await writeFile(outsideSentinel, "must-stay-outside\n", { flag: "wx" });
  await symlink(external, junction, "junction");
  try {
    const response = await invoke(createFileRequest(project, rootIdentity, "reparse/escaped.txt"));
    assertNativeError(response, "REPARSE_POINT_REJECTED", "reparse-point traversal");
    await assertMissing(join(external, "escaped.txt"));
    await assertText(outsideSentinel, "must-stay-outside\n");
  } finally {
    await rm(junction, { recursive: true, force: true });
  }
}

async function runHardLinkVector(project, external, rootIdentity) {
  const outsideFile = join(external, "hardlink-target.txt");
  const hardlink = join(project, "hardlink.txt");
  await writeFile(outsideFile, "outside-hardlink\n", { flag: "wx" });
  await link(outsideFile, hardlink);
  const response = await invoke(
    replaceFileRequest(project, rootIdentity, "hardlink.txt", "inside-replacement\n")
  );
  assertNativeError(response, "HARDLINK_REJECTED", "hard-link mutation");
  await assertText(outsideFile, "outside-hardlink\n");
}

async function runRootIdentityVector(project, oldProject, rootIdentity) {
  await rename(project, oldProject);
  await mkdir(project);
  try {
    const response = await invoke(createDirectoryRequest(project, rootIdentity, "must-not-exist"));
    assertNativeError(response, "ROOT_IDENTITY_MISMATCH", "project-root replacement");
    await assertMissing(join(project, "must-not-exist"));
  } finally {
    await rm(project, { recursive: true, force: true });
    await rename(oldProject, project);
  }
}

function createDirectoryRequest(project, rootIdentity, relativePath) {
  return request(project, rootIdentity, {
    kind: "create_directory",
    relativePath,
    before: [{ kind: "missing", relativePath }],
    after: [{ kind: "directory", relativePath }]
  });
}

function createFileRequest(project, rootIdentity, relativePath) {
  const content = "must-not-escape\n";
  return request(project, rootIdentity, {
    kind: "create_file",
    relativePath,
    content,
    before: [{ kind: "missing", relativePath }],
    after: [{ kind: "file", relativePath, content, checksum: sha256(Buffer.from(content)) }]
  });
}

function replaceFileRequest(project, rootIdentity, relativePath, content) {
  const beforeContent = "outside-hardlink\n";
  return request(project, rootIdentity, {
    kind: "replace_file",
    phase: "apply",
    relativePath,
    content,
    before: [
      {
        kind: "file",
        relativePath,
        content: beforeContent,
        checksum: sha256(Buffer.from(beforeContent))
      }
    ],
    after: [{ kind: "file", relativePath, content, checksum: sha256(Buffer.from(content)) }]
  });
}

function request(project, rootIdentity, operation) {
  return {
    schemaVersion: protocolVersion,
    root: project,
    rootIdentity,
    operation
  };
}

async function invokeExpectOk(requestValue) {
  const response = await invoke(requestValue);
  if (response.exitCode !== 0 || response.document?.ok !== true) {
    throw new Error(
      `Native file operation unexpectedly failed: ${response.document?.code ?? response.stderr}`
    );
  }
}

function assertNativeError(response, expectedCode, label) {
  if (
    response.exitCode === 0 ||
    response.document?.ok !== false ||
    response.document.code !== expectedCode
  ) {
    throw new Error(
      `${label} expected ${expectedCode}, received ${response.document?.code ?? response.stderr}`
    );
  }
}

function invoke(requestValue) {
  const encoded = Buffer.from(JSON.stringify(requestValue), "utf8");
  if (encoded.byteLength > maxRequestBytes)
    throw new Error("Qualification request exceeds its limit.");
  return new Promise((resolveInvoke, reject) => {
    const child = spawn(binaryPath, [], {
      cwd: root,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = Buffer.alloc(0);
    let stderr = "";
    let stderrBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("Native file operation qualification timed out.")));
    }, operationTimeoutMs);
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    child.once("error", (error) => finish(() => reject(error)));
    child.stdout.on("data", (chunk) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.byteLength > maxResponseBytes) {
        child.kill();
        finish(() => reject(new Error("Native file operation response exceeds its limit.")));
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > maxResponseBytes) {
        child.kill();
        finish(() => reject(new Error("Native file operation stderr exceeds its limit.")));
        return;
      }
      stderr += chunk.toString("utf8");
    });
    child.once("close", (exitCode) => {
      let document;
      try {
        document = parseResponse(JSON.parse(stdout.toString("utf8")));
      } catch {
        document = undefined;
      }
      finish(() => resolveInvoke({ exitCode, document, stderr }));
    });
    child.stdin.end(encoded);
  });
}

function parseResponse(value) {
  if (value?.schemaVersion !== protocolVersion || typeof value.ok !== "boolean") {
    throw new Error("Native response protocol is invalid.");
  }
  if (value.ok === true && Object.keys(value).length === 2) return value;
  if (
    value.ok === false &&
    Object.keys(value).length === 3 &&
    typeof value.code === "string" &&
    /^[A-Z0-9_]{1,80}$/u.test(value.code)
  ) {
    return value;
  }
  throw new Error("Native response shape is invalid.");
}

async function readRootIdentity(directory) {
  const stats = await lstat(directory, { bigint: true });
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Qualification root is not a regular directory.");
  }
  return { device: stats.dev.toString(), inode: stats.ino.toString() };
}

async function assertDirectory(path) {
  const stats = await lstat(path);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error(`Expected directory: ${path}`);
}

async function assertMissing(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Expected path to be missing: ${path}`);
}

async function assertText(path, expected) {
  const actual = await readFile(path, "utf8");
  if (actual !== expected) throw new Error(`Unexpected content in ${path}.`);
}

async function readManifest(directory) {
  let value;
  try {
    value = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  } catch (error) {
    throw new Error(`File operation staging manifest is missing or malformed: ${error.message}`);
  }
  if (
    value?.schemaVersion !== "1.0" ||
    value.status !== "unavailable" ||
    value.protocolVersion !== protocolVersion ||
    value.artifact?.path !== `native/agent-file-operations/${binaryName}` ||
    !/^[a-f0-9]{64}$/iu.test(value.artifact?.digest ?? "")
  ) {
    throw new Error("File operation staging manifest is not a fail-closed digest binding.");
  }
  return value;
}

function assertPortableExecutable(bytes, path) {
  const peOffset = bytes.length >= 0x40 ? bytes.readUInt32LE(0x3c) : 0;
  if (
    bytes.length < 0x40 ||
    bytes[0] !== 0x4d ||
    bytes[1] !== 0x5a ||
    peOffset + 4 > bytes.length ||
    !bytes.subarray(peOffset, peOffset + 4).equals(Buffer.from("PE\0\0"))
  ) {
    throw new Error(`Staged artifact is not a Windows PE executable: ${path}`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseBundleDirectory(args) {
  if (args.length === 0) return resolve(root, "release", "agent-file-operations");
  if (args.length === 2 && args[0] === "--bundle-dir" && args[1]) return resolve(args[1]);
  throw new Error(
    "Usage: node scripts/qualify-agent-file-operations.mjs [--bundle-dir <directory>]"
  );
}

function assertContained(parent, child) {
  const relativePath = relative(resolve(parent), resolve(child));
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${pathSeparator()}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Qualification path escaped its harness root.");
  }
}

function pathSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}
