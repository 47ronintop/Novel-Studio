#!/usr/bin/env node
/**
 * Windows CI black-box qualification. The probe is deliberately launched by
 * the host, so Job/AppContainer checks observe the same process boundary used
 * for real tasks. Passing this test is CI evidence only, never a release
 * attestation or a manifest status change.
 */
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";

const root = process.cwd();
const PROCESS_TIMEOUT_MS = 35_000;
const MAX_PROCESS_OUTPUT_BYTES = 1_048_576;
const bundleDirectory = parseBundleDirectory(process.argv.slice(2));
const manifest = await readManifest(bundleDirectory);
const hostPath = join(bundleDirectory, "agent-task-sandbox-host.exe");
const probePath = join(bundleDirectory, "agent-task-sandbox-probe.exe");
const hostDigest = await digestFile(hostPath);
const probeDigest = await digestFile(probePath);
const artifacts = new Map(manifest.artifacts.map((artifact) => [artifact.kind, artifact]));

if (
  artifacts.get("host")?.digest !== hostDigest ||
  artifacts.get("probe")?.digest !== probeDigest
) {
  throw new Error("Staged sandbox artifact digest does not match manifest.");
}

const harnessDirectory = await mkdtemp(join(tmpdir(), "agent-sandbox-qualification-"));
const projectionDirectory = join(harnessDirectory, "projection");
const sentinelPath = join(harnessDirectory, "outside-projection-canary.txt");
const sentinelContents = Buffer.from("must-not-be-readable-by-appcontainer\n", "utf8");
const sentinelDigest = sha256(sentinelContents);
await mkdir(projectionDirectory);
await writeFile(sentinelPath, sentinelContents);

let listenerConnectionCount = 0;
const listener = createServer((socket) => {
  listenerConnectionCount += 1;
  socket.destroy();
});
try {
  const address = await listen(listener);
  const probeEnvironment = qualificationProbeEnvironment({
    manifest,
    hostDigest,
    probeDigest,
    sentinelPath,
    listenerAddress: `127.0.0.1:${address.port}`
  });
  const negativeControl = await runProcess(
    probePath,
    ["--mode", "qualification"],
    { cwd: projectionDirectory, env: probeEnvironment },
    "Direct sandbox probe negative control"
  );
  verifyNegativeControl(negativeControl);
  await waitForListenerConnection(() => listenerConnectionCount);
  if (listenerConnectionCount !== 1) {
    throw new Error("Direct sandbox probe did not reach exactly one qualification listener.");
  }
  const sentinelAfterNegativeControl = await readFile(sentinelPath);
  if (sha256(sentinelAfterNegativeControl) !== sentinelDigest) {
    throw new Error("Direct sandbox probe modified the external file-isolation canary.");
  }
  const negativeControlConnectionCount = listenerConnectionCount;

  const output = await runHost(hostPath, [
    "--mode",
    "qualification",
    "--task-id",
    "ci-qualification",
    "--attestation-id",
    "qualification-bootstrap",
    "--execution-snapshot-id",
    "sandbox-qualification-v1",
    "--qualification-probe",
    probePath,
    "--workspace-projection",
    projectionDirectory,
    "--probe-host-digest",
    hostDigest,
    "--probe-digest",
    probeDigest,
    "--probe-policy-revision",
    manifest.policyRevision,
    "--probe-test-vector-revision",
    manifest.testVectorRevision,
    "--probe-external-sentinel-path",
    sentinelPath,
    "--probe-network-listener-addr",
    `127.0.0.1:${address.port}`,
    "--max-wall-clock-ms",
    "30000",
    "--max-processes",
    "1",
    "--max-memory-bytes",
    "134217728",
    "--max-cpu-time-ms",
    "10000",
    "--max-scratch-bytes",
    "16777216",
    "--",
    "--protocol-version",
    "1.0",
    "--mode",
    "qualification"
  ]);
  const evidence = parseEvidence(output);
  verifyEvidence(evidence, manifest, hostDigest, probeDigest);
  const sentinelAfterProbe = await readFile(sentinelPath);
  if (sha256(sentinelAfterProbe) !== sentinelDigest) {
    throw new Error("Sandbox probe modified the external file-isolation canary.");
  }
  if (listenerConnectionCount !== negativeControlConnectionCount) {
    throw new Error("Sandbox probe connected to the external network-isolation listener.");
  }
  console.log(`OK: native host/probe qualification passed (${evidence.evidenceId}).`);
} finally {
  await close(listener);
  await rm(harnessDirectory, { recursive: true, force: true });
}

function parseBundleDirectory(args) {
  if (args.length === 0) return resolve(root, "release", "agent-task-sandbox");
  if (args.length === 2 && args[0] === "--bundle-dir" && args[1]) return resolve(args[1]);
  throw new Error("Usage: node scripts/qualify-agent-sandbox.mjs [--bundle-dir <directory>]");
}

async function readManifest(directory) {
  let value;
  try {
    value = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  } catch (error) {
    throw new Error(`Sandbox staging manifest is missing or malformed: ${error.message}`);
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== "1.0" ||
    value.status !== "unavailable" ||
    value.protocolVersion !== "1.0" ||
    typeof value.policyRevision !== "string" ||
    typeof value.testVectorRevision !== "string" ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length !== 2
  ) {
    throw new Error("Sandbox staging manifest is not a fail-closed build manifest.");
  }
  const validArtifacts = value.artifacts.every(
    (artifact) =>
      isRecord(artifact) &&
      (artifact.kind === "host" || artifact.kind === "probe") &&
      typeof artifact.digest === "string" &&
      /^[a-f0-9]{64}$/i.test(artifact.digest)
  );
  const kinds = new Set(value.artifacts.map((artifact) => artifact.kind));
  if (!validArtifacts || kinds.size !== 2 || !kinds.has("host") || !kinds.has("probe")) {
    throw new Error("Sandbox staging manifest must bind exactly one host and one probe digest.");
  }
  return value;
}

async function digestFile(path) {
  const bytes = await readFile(path);
  assertPortableExecutable(bytes, path);
  return createHash("sha256").update(bytes).digest("hex");
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
    throw new Error(`Sandbox artifact is not a Windows PE executable: ${path}`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function listen(listener) {
  return new Promise((resolveListen, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      listener.off("error", reject);
      const address = listener.address();
      if (address === null || typeof address === "string") {
        reject(new Error("Qualification listener did not receive a TCP port."));
      } else {
        resolveListen(address);
      }
    });
  });
}

function close(listener) {
  return new Promise((resolveClose) => listener.close(() => resolveClose()));
}

async function runHost(host, args) {
  const result = await runProcess(host, args, {}, "Sandbox qualification host");
  if (result.exitCode === 0) return result.stdout;
  throw new Error(
    `Sandbox qualification host exited ${result.exitCode ?? "unknown"}: ${result.stderr || result.stdout}`
  );
}

function runProcess(executable, args, options, label) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      ...options
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const append = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next, "utf8") > MAX_PROCESS_OUTPUT_BYTES) {
        child.kill();
        finish(() => reject(new Error(`${label} exceeded its output limit.`)));
      }
      return next;
    };
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (error) =>
      finish(() => reject(new Error(`Could not start ${label}: ${error.message}`)))
    );
    child.once("close", (exitCode) =>
      finish(() => resolveRun({ exitCode, stdout, stderr }))
    );
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`${label} timed out.`)));
    }, PROCESS_TIMEOUT_MS);
  });
}

function qualificationProbeEnvironment(input) {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    PROBE_HOST_DIGEST: input.hostDigest,
    PROBE_PROBE_DIGEST: input.probeDigest,
    PROBE_PROTOCOL_VERSION: input.manifest.protocolVersion,
    PROBE_POLICY_REVISION: input.manifest.policyRevision,
    PROBE_TEST_VECTOR_REVISION: input.manifest.testVectorRevision,
    PROBE_EXTERNAL_SENTINEL_PATH: input.sentinelPath,
    PROBE_NETWORK_LISTENER_ADDR: input.listenerAddress
  };
}

function verifyNegativeControl(result) {
  if (result.exitCode === 0) {
    throw new Error("Direct sandbox probe unexpectedly reported qualified isolation.");
  }
  let error;
  try {
    error = JSON.parse(result.stderr.trim());
  } catch {
    throw new Error("Direct sandbox probe did not return its expected file-isolation failure.");
  }
  if (
    !isRecord(error) ||
    error.code !== "FILE_ISOLATION_BREACH" ||
    error.dimension !== "fileIsolation" ||
    typeof error.message !== "string"
  ) {
    throw new Error("Direct sandbox probe did not detect the readable external sentinel.");
  }
}

async function waitForListenerConnection(readCount) {
  const deadline = Date.now() + 1_000;
  while (readCount() === 0 && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

function parseEvidence(output) {
  try {
    return JSON.parse(output.trim());
  } catch {
    throw new Error("Sandbox qualification host did not return a single JSON evidence document.");
  }
}

function verifyEvidence(evidence, manifest, hostDigest, probeDigest) {
  const capabilities = evidence?.capabilities;
  const evidenceKeys = [
    "schemaVersion",
    "evidenceId",
    "hostDigest",
    "probeDigest",
    "protocolVersion",
    "policyRevision",
    "testVectorRevision",
    "osVersion",
    "generatedAt",
    "capabilities"
  ];
  const capabilityKeys = [
    "fileIsolation",
    "networkIsolation",
    "jobObjectKillOnClose",
    "appContainerOrLowBox"
  ];
  const generatedAt = Date.parse(evidence?.generatedAt);
  const now = Date.now();
  if (
    !isRecord(evidence) ||
    !hasExactKeys(evidence, evidenceKeys) ||
    evidence.schemaVersion !== "1.0" ||
    typeof evidence.evidenceId !== "string" ||
    evidence.evidenceId.length === 0 ||
    evidence.hostDigest !== hostDigest ||
    evidence.probeDigest !== probeDigest ||
    evidence.protocolVersion !== manifest.protocolVersion ||
    evidence.policyRevision !== manifest.policyRevision ||
    evidence.testVectorRevision !== manifest.testVectorRevision ||
    typeof evidence.osVersion !== "string" ||
    evidence.osVersion.length === 0 ||
    !Number.isFinite(generatedAt) ||
    generatedAt < now - 5 * 60 * 1000 ||
    generatedAt > now + 30 * 1000 ||
    !isRecord(capabilities) ||
    !hasExactKeys(capabilities, capabilityKeys) ||
    capabilityKeys.some((key) => capabilities[key] !== "verified")
  ) {
    throw new Error(
      "Sandbox qualification evidence is incomplete, stale, or not bound to this bundle."
    );
  }
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
