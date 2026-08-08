import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

import {
  ENGINEERING_FILE_NATIVE_ADAPTER_ID,
  ENGINEERING_FILE_NEGATIVE_CONTROLS,
  ENGINEERING_FILE_POSITIVE_PROTECTIONS,
  ENGINEERING_FILE_PROBE_CONTRACT_VERSION,
  ENGINEERING_FILE_PROBE_MAX_LIFETIME_MS,
  engineeringFileProbeReportChecksum,
  type EngineeringFileProbeReportV1
} from "@novel-studio/agent-engine";

const loadInstalledAddon = createRequire(import.meta.url);
const fixtureRelativePath = "docs/ordinary-utf8.txt";
const fixtureText = "B6 fresh probe fixture: 你好, café, 😀\nneedle: fresh-probe\n";
const searchNeedle = "needle: fresh-probe";
const traversalCanaries = [
  "../engineering-file-access-fresh-probe-outside.txt",
  "docs/../../engineering-file-access-fresh-probe-outside.txt",
  "C:\\engineering-file-access-fresh-probe-outside.txt",
  "\\\\server\\share\\engineering-file-access-fresh-probe-outside.txt"
] as const;

export interface EngineeringFileProtectionEvidence {
  readonly positiveProtections: Readonly<
    Record<(typeof ENGINEERING_FILE_POSITIVE_PROTECTIONS)[number], "passed">
  >;
  readonly negativeControls: Readonly<
    Record<(typeof ENGINEERING_FILE_NEGATIVE_CONTROLS)[number], "canary_exposed">
  >;
}

export interface EngineeringFileAccessFreshProbe {
  /**
   * Main composition supplies only the exact installed artifact set it has already authenticated.
   * This observation has no capability-granting authority.
   */
  probe(input: EngineeringFileAccessFreshProbeInput): Promise<EngineeringFileProbeReportV1>;
}

export interface EngineeringFileAccessFreshProbeInput {
  readonly artifactPath: string;
  readonly manifestPath: string;
  readonly signaturePath: string;
  readonly checkedAt: string;
  readonly publisherPolicyChecksum: string;
  readonly protectionEvidence: EngineeringFileProtectionEvidence;
}

interface EngineeringFileAccessAddon {
  readonly adapterInfo?: () => unknown;
  readonly openWorkspaceRoot?: (path: string) => unknown;
  readonly closeWorkspaceRoot?: (rootId: bigint) => unknown;
  readonly readFile?: (rootId: bigint, relativePath: string) => unknown;
  readonly listDirectory?: (rootId: bigint, relativePath: string) => unknown;
  readonly buildIndex?: (rootId: bigint) => unknown;
  readonly searchText?: (rootId: bigint, query: string) => unknown;
}

/**
 * Creates the single Main-owned fresh probe for the installed B6 Node-API addon. The optional
 * loader is a Main/test seam only; it cannot supply paths or bypass evidence validation.
 */
export function createMainOwnedEngineeringFileAccessFreshProbe(options?: {
  readonly loadAddon?: (artifactPath: string) => unknown;
}): EngineeringFileAccessFreshProbe {
  const loadAddon = options?.loadAddon ?? loadInstalledAddon;

  return Object.freeze({
    async probe(
      input: EngineeringFileAccessFreshProbeInput
    ): Promise<EngineeringFileProbeReportV1> {
      assertProbeInput(input);
      const [artifact, manifestBytes, signature] = await Promise.all([
        readRegularFile(input.artifactPath, "artifactPath"),
        readRegularFile(input.manifestPath, "manifestPath"),
        readRegularFile(input.signaturePath, "signaturePath")
      ]);
      const artifactSha256 = sha256(artifact);
      const artifactManifestSha256 = sha256(manifestBytes);
      const artifactManifestSignatureSha256 = sha256(signature);
      const manifest = parseManifest(manifestBytes);

      if (
        manifest.adapterId !== ENGINEERING_FILE_NATIVE_ADAPTER_ID ||
        manifest.target !== "win32-x64" ||
        manifest.artifactSha256 !== artifactSha256 ||
        manifest.publisherPolicyChecksum !== input.publisherPolicyChecksum
      ) {
        throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_DIGEST_MISMATCH");
      }

      const addon = loadAddon(input.artifactPath) as EngineeringFileAccessAddon;
      await probeInstalledAddon(addon);
      await assertArtifactSetUnchanged(input, {
        artifactSha256,
        artifactManifestSha256,
        artifactManifestSignatureSha256
      });

      const generatedAt = input.checkedAt;
      const expiresAt = new Date(
        Date.parse(generatedAt) + ENGINEERING_FILE_PROBE_MAX_LIFETIME_MS
      ).toISOString();
      const unsigned = {
        schemaVersion: ENGINEERING_FILE_PROBE_CONTRACT_VERSION,
        adapterId: ENGINEERING_FILE_NATIVE_ADAPTER_ID,
        target: "win32-x64" as const,
        packageKind: "production" as const,
        artifactSha256,
        artifactManifestSha256,
        artifactManifestSignatureSha256,
        // Signer status is input only after Main has verified the signed manifest and signer pins.
        artifactSignatureVerification: "trusted_publisher" as const,
        manifestSignatureVerification: "trusted_publisher" as const,
        digestVerification: "match" as const,
        publisherPolicyChecksum: input.publisherPolicyChecksum,
        generatedAt,
        expiresAt,
        positiveProtections: Object.freeze({ ...input.protectionEvidence.positiveProtections }),
        negativeControls: Object.freeze({ ...input.protectionEvidence.negativeControls })
      };
      return Object.freeze({
        ...unsigned,
        reportChecksum: engineeringFileProbeReportChecksum(unsigned)
      });
    }
  });
}

function assertProbeInput(input: EngineeringFileAccessFreshProbeInput): void {
  if (
    !isAbsolute(input.artifactPath) ||
    !isAbsolute(input.manifestPath) ||
    !isAbsolute(input.signaturePath) ||
    new Set([input.artifactPath, input.manifestPath, input.signaturePath]).size !== 3
  ) {
    throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_REQUIRES_DISTINCT_ABSOLUTE_PATHS");
  }
  if (!isCanonicalUtcTimestamp(input.checkedAt)) {
    throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_INVALID_CHECKED_AT");
  }
  if (!isSha256(input.publisherPolicyChecksum)) {
    throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_INVALID_PUBLISHER_POLICY");
  }
  if (
    !hasExactMap(
      input.protectionEvidence?.positiveProtections,
      ENGINEERING_FILE_POSITIVE_PROTECTIONS,
      "passed"
    ) ||
    !hasExactMap(
      input.protectionEvidence?.negativeControls,
      ENGINEERING_FILE_NEGATIVE_CONTROLS,
      "canary_exposed"
    )
  ) {
    throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_INVALID_PROTECTION_EVIDENCE");
  }
}

async function readRegularFile(path: string, label: string): Promise<Buffer> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error(`ENGINEERING_FILE_ACCESS_FRESH_PROBE_${label}_NOT_FILE`);
  return readFile(path);
}

async function assertArtifactSetUnchanged(
  input: EngineeringFileAccessFreshProbeInput,
  expected: {
    readonly artifactSha256: string;
    readonly artifactManifestSha256: string;
    readonly artifactManifestSignatureSha256: string;
  }
): Promise<void> {
  const [artifact, manifest, signature] = await Promise.all([
    readRegularFile(input.artifactPath, "artifactPath"),
    readRegularFile(input.manifestPath, "manifestPath"),
    readRegularFile(input.signaturePath, "signaturePath")
  ]);
  if (
    sha256(artifact) !== expected.artifactSha256 ||
    sha256(manifest) !== expected.artifactManifestSha256 ||
    sha256(signature) !== expected.artifactManifestSignatureSha256
  ) {
    throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_DIGEST_MISMATCH");
  }
}

function parseManifest(bytes: Buffer): {
  readonly adapterId: unknown;
  readonly target: unknown;
  readonly artifactSha256: unknown;
  readonly publisherPolicyChecksum: unknown;
} {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_INVALID_MANIFEST");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_INVALID_MANIFEST");
  }
  const manifest = value as Record<string, unknown>;
  const artifact = manifest["artifact"];
  return {
    adapterId: manifest["adapterId"],
    target: manifest["target"],
    artifactSha256:
      artifact !== null && typeof artifact === "object" && !Array.isArray(artifact)
        ? (artifact as Record<string, unknown>)["sha256"]
        : undefined,
    publisherPolicyChecksum: manifest["publisherPolicyChecksum"]
  };
}

async function probeInstalledAddon(addon: EngineeringFileAccessAddon): Promise<void> {
  assertAddon(addon);
  const fixtureParent = await mkdtemp(join(tmpdir(), "engineering-file-access-fresh-probe-"));
  const fixtureRoot = join(fixtureParent, "workspace");
  let rootId: bigint | undefined;
  try {
    await writeFile(
      join(fixtureParent, "engineering-file-access-fresh-probe-outside.txt"),
      "outside",
      "utf8"
    );
    await mkdir(join(fixtureRoot, "docs"), { recursive: true });
    await writeFile(join(fixtureRoot, fixtureRelativePath), fixtureText, {
      encoding: "utf8",
      flush: true
    });
    const openedRoot = addon.openWorkspaceRoot(fixtureRoot);
    if (!isAvailableRoot(openedRoot)) {
      throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_INVALID_ROOT");
    }
    rootId = openedRoot.rootId;
    const bytes = addon.readFile(rootId, fixtureRelativePath);
    if (!Buffer.isBuffer(bytes) || bytes.toString("utf8") !== fixtureText) {
      throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_READ_FAILED");
    }
    const byteLength = BigInt(bytes.byteLength);
    assertListedFixture(addon.listDirectory(rootId, "docs"), byteLength);
    assertIndexedFixture(addon.buildIndex(rootId), byteLength);
    assertSearchedFixture(addon.searchText(rootId, searchNeedle), bytes);
    for (const path of traversalCanaries) {
      await assertReadRejected(addon.readFile, rootId, path);
    }
  } finally {
    if (rootId !== undefined) await Promise.resolve(addon.closeWorkspaceRoot(rootId));
    await rm(fixtureParent, { recursive: true, force: true, maxRetries: 3 });
  }
}

function assertAddon(
  addon: EngineeringFileAccessAddon
): asserts addon is Required<EngineeringFileAccessAddon> {
  if (
    !addon ||
    typeof addon.adapterInfo !== "function" ||
    typeof addon.openWorkspaceRoot !== "function" ||
    typeof addon.closeWorkspaceRoot !== "function" ||
    typeof addon.readFile !== "function" ||
    typeof addon.listDirectory !== "function" ||
    typeof addon.buildIndex !== "function" ||
    typeof addon.searchText !== "function"
  ) {
    throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_INVALID_ADDON");
  }
  const info = addon.adapterInfo?.();
  if (
    info === null ||
    typeof info !== "object" ||
    (info as Record<string, unknown>)["target"] !== "win32-x64" ||
    (info as Record<string, unknown>)["batch"] !== "6" ||
    (info as Record<string, unknown>)["accessEligible"] !== "available" ||
    (info as Record<string, unknown>)["mutation"] !== "unavailable" ||
    (info as Record<string, unknown>)["recovery"] !== "unavailable"
  ) {
    throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_INVALID_ADDON");
  }
}

function isAvailableRoot(
  value: unknown
): value is { readonly rootId: bigint; readonly capability: "available" } {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>)["rootId"] === "bigint" &&
    (value as Record<string, unknown>)["capability"] === "available"
  );
}

function assertListedFixture(value: unknown, byteLength: bigint): void {
  if (
    !Array.isArray(value) ||
    !value.some(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        (entry as Record<string, unknown>)["name"] === "ordinary-utf8.txt" &&
        (entry as Record<string, unknown>)["directory"] === false &&
        (entry as Record<string, unknown>)["byteLength"] === byteLength
    )
  ) {
    throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_LIST_FAILED");
  }
}

function assertIndexedFixture(value: unknown, byteLength: bigint): void {
  if (
    value === null ||
    typeof value !== "object" ||
    (value as Record<string, unknown>)["truncated"] !== false ||
    !Array.isArray((value as Record<string, unknown>)["files"]) ||
    !(value as { readonly files: unknown[] }).files.some(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        (entry as Record<string, unknown>)["relativePath"] === fixtureRelativePath &&
        (entry as Record<string, unknown>)["byteLength"] === byteLength
    )
  ) {
    throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_INDEX_FAILED");
  }
}

function assertSearchedFixture(value: unknown, bytes: Buffer): void {
  const expectedByteOffset = BigInt(bytes.indexOf(Buffer.from(searchNeedle, "utf8")));
  if (
    value === null ||
    typeof value !== "object" ||
    (value as Record<string, unknown>)["truncated"] !== false ||
    !Array.isArray((value as Record<string, unknown>)["matches"]) ||
    !(value as { readonly matches: unknown[] }).matches.some(
      (match) =>
        match !== null &&
        typeof match === "object" &&
        (match as Record<string, unknown>)["relativePath"] === fixtureRelativePath &&
        (match as Record<string, unknown>)["byteOffset"] === expectedByteOffset
    )
  ) {
    throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_SEARCH_FAILED");
  }
}

async function assertReadRejected(
  readFile: (rootId: bigint, relativePath: string) => unknown,
  rootId: bigint,
  relativePath: string
): Promise<void> {
  try {
    await Promise.resolve(readFile(rootId, relativePath));
  } catch {
    return;
  }
  throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_TRAVERSAL_ACCEPTED");
}

function hasExactMap(
  value: unknown,
  keys: readonly string[],
  expected: "passed" | "canary_exposed"
): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => (value as Record<string, unknown>)[key] === expected)
  );
}

function isCanonicalUtcTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/iu.test(value);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
