import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  engineeringFileQualificationAttestationChecksum,
  validateEngineeringFileProbeReport,
  validateEngineeringFileProbeReportV2,
  createUnavailableEngineeringFileQualificationAttestation,
  validateEngineeringFileQualificationAttestation,
  type EngineeringFileProbeReportV1,
  type EngineeringFileProbeReportV2,
  type EngineeringFileQualificationAttestationV1,
  type EngineeringFileQualificationCapability,
  type EngineeringFileQualificationFailureReason
} from "@novel-studio/agent-engine";

import {
  ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY_CHECKSUM,
  arePinnedEngineeringFileAccessPublishers,
  hasConfiguredEngineeringFileAccessPublisherPolicy
} from "./engineering-file-access-publisher-policy.js";
import type { EngineeringFileCapabilityAuthority } from "./engineering-file-capability-authority.js";

const exec = promisify(execFile);

const candidateFiles = [
  "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.node",
  "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.json",
  "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.p7s"
] as const;

const BATCH_6_READ_ONLY_CAPABILITIES = ["root", "access", "read", "index"] as const;

export const ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT = deepFreeze({
  schemaVersion: "1.0" as const,
  adapterId: "novel_studio_engineering_file_access" as const,
  supportedTarget: "win32-x64" as const,
  implementationLanguage: "cpp20_node_api_repository_adapter" as const,
  sourceRoot: "native/engineering-file-access-win32",
  buildDefinition: "native/engineering-file-access-win32/CMakeLists.txt",
  nativeSource: "native/engineering-file-access-win32/src/engineering_file_access.cc",
  buildScript: "scripts/build-engineering-file-access-win32.mjs",
  signScript: "scripts/sign-engineering-file-access-win32.mjs",
  probeScript: "scripts/probe-engineering-file-access-package.mjs",
  packageProbeTest: "apps/desktop/test/engineering-file-access-package.e2e.ts",
  candidateArtifact: candidateFiles[0],
  candidateManifest: candidateFiles[1],
  candidateManifestSignature: candidateFiles[2],
  packagedArtifact:
    "resources/app.asar.unpacked/native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.node",
  packagedManifest:
    "resources/app.asar.unpacked/native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.json",
  packagedManifestSignature:
    "resources/app.asar.unpacked/native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.p7s",
  electronBuilderFiles: candidateFiles,
  electronBuilderAsarUnpack: candidateFiles
});

export type EngineeringFileCandidateArtifactState = "missing" | "partial" | "present" | "unknown";

export interface EngineeringFileCandidateInspector {
  inspect(): Promise<EngineeringFileCandidateArtifactState>;
}

export interface EngineeringFileAccessQualificationService extends EngineeringFileCapabilityAuthority {
  /** One-shot, cached Main-owned observation. There is deliberately no Renderer refresh method. */
  readAttestation(): Promise<EngineeringFileQualificationAttestationV1>;
  /** Main-only liveness check; expired evidence can never be reused by a pre-opened session. */
  hasCapability(capability: EngineeringFileQualificationCapability): Promise<boolean>;
  /** Main-only revocation notification for a fresh-probe expiry. */
  subscribeRevocation(listener: () => void): () => void;
}

/**
 * The only seam for a fresh, fixed-path packaged probe. It is supplied by Main composition, never
 * IPC, workspace contents, or the model; its report is still accepted only after signatures and
 * all installed-artifact digests have been rechecked below.
 */
export interface EngineeringFileAccessProductionProbe {
  probe(input: {
    readonly artifactPath: string;
    readonly manifestPath: string;
    readonly signaturePath: string;
    readonly checkedAt: string;
    readonly publisherPolicyChecksum: string;
    readonly protectionEvidence: EngineeringFileAccessProtectionEvidence;
    /** Present only for a signed Batch 7 manifest; omission keeps B6 read-only. */
    readonly mutationRecoveryEvidence?: EngineeringFileAccessBatch7MutationRecoveryEvidence;
    /** Present only for a signed Batch 7 manifest; omission keeps lifecycle-gated capabilities closed. */
    readonly lifecycleEvidence?: EngineeringFileAccessBatch8LifecycleEvidence;
  }): Promise<EngineeringFileProbeReportV1 | EngineeringFileProbeReportV2>;
}

export interface EngineeringFileAccessProtectionEvidence {
  readonly positiveProtections: Readonly<
    Record<
      | "rootRelativeTraversal"
      | "noFollowTraversal"
      | "rawByteIdentity"
      | "receiptBinding"
      | "durability"
      | "recoveryRootBinding",
      "passed"
    >
  >;
  readonly negativeControls: Readonly<
    Record<
      | "rootRelativeDisabled"
      | "noFollowDisabled"
      | "rawByteIdentityDisabled"
      | "receiptBindingDisabled"
      | "durabilityDisabled"
      | "recoveryRootBindingDisabled",
      "canary_exposed"
    >
  >;
}

export interface EngineeringFileAccessBatch7MutationRecoveryEvidence {
  readonly positiveProtections: Readonly<
    Record<"replace" | "create" | "receiptBinding" | "walPreparation" | "recoveryScan", "passed">
  >;
  readonly negativeControls: Readonly<
    Record<
      "rawByteManifestMismatch" | "staleBase" | "createRace" | "faultRecoveryRequired",
      "canary_exposed"
    >
  >;
}

/** B8 lifecycle evidence is a prerequisite for the B7 mutation/recovery grant. */
export interface EngineeringFileAccessBatch8LifecycleEvidence {
  readonly positiveProtections: Readonly<
    Record<"createDirectory" | "move" | "quarantine" | "restore" | "purge", "passed">
  >;
  /** The lifecycle probe has no negative canaries; an empty map is part of the contract. */
  readonly negativeControls: Readonly<Record<never, never>>;
}

const mainOwnedAttestations = new WeakSet<object>();

export function createEngineeringFileAccessQualificationService(options: {
  readonly packageKind: "development" | "production";
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly now?: () => string;
  /** Main composition/test seam only. It is never populated from IPC, a project, or model output. */
  readonly candidateInspector?: EngineeringFileCandidateInspector;
  /** Main composition/test seam for a fresh installed-package probe. */
  readonly productionProbe?: EngineeringFileAccessProductionProbe;
}): EngineeringFileAccessQualificationService {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = `${platform}-${arch}`;
  const now = options.now ?? (() => new Date().toISOString());
  const basePath = candidateBasePath(options.packageKind);
  const inspector = options.candidateInspector ?? createCandidateInspector(basePath);
  const productionProbe = options.productionProbe ?? unavailableProductionProbe;
  let cached: Promise<EngineeringFileQualificationAttestationV1> | undefined;
  const revocationListeners = new Set<() => void>();
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let revoked = false;

  const readAttestation = () => {
    cached ??= observeAttestation({
      target,
      packageKind: options.packageKind,
      checkedAt: now(),
      inspector,
      evidencePaths: productionEvidencePaths(basePath),
      productionProbe
    })
      .then(registerMainOwnedAttestation)
      .then((attestation) => {
        scheduleExpiry(attestation);
        return attestation;
      });
    return cached;
  };

  function revoke(): void {
    if (revoked) return;
    revoked = true;
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    for (const listener of revocationListeners) {
      try {
        listener();
      } catch {
        // Revocation is fail-closed even if a consumer's UI cleanup throws.
      }
    }
  }

  const scheduleExpiry = (attestation: EngineeringFileQualificationAttestationV1): void => {
    if (attestation.status !== "available" || attestation.expiresAt === null) return;
    const expiresAt = Date.parse(attestation.expiresAt);
    const observedAt = Date.parse(now());
    if (!Number.isFinite(expiresAt) || !Number.isFinite(observedAt) || expiresAt <= observedAt) {
      revoke();
      return;
    }
    const expire = (): void => {
      if (Date.parse(now()) < expiresAt) {
        const remaining = Math.max(1, expiresAt - Date.parse(now()));
        expiryTimer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
        expiryTimer.unref();
        return;
      }
      revoke();
    };
    expiryTimer = setTimeout(expire, Math.min(expiresAt - observedAt, 2_147_483_647));
    expiryTimer.unref();
  };

  return Object.freeze({
    readAttestation,
    async hasCapability(capability: EngineeringFileQualificationCapability) {
      const attestation = await readAttestation();
      return !revoked && hasMainOwnedEngineeringFileQualification(attestation, capability, now());
    },
    subscribeRevocation(listener: () => void) {
      revocationListeners.add(listener);
      if (revoked) listener();
      return () => revocationListeners.delete(listener);
    }
  });
}

/**
 * Serialized or reconstructed attestations never retain this Main-process provenance. This guard,
 * rather than the attestation's ordinary checksum, is the capability-authority boundary.
 */
export function isMainOwnedEngineeringFileQualificationAttestation(
  value: unknown
): value is EngineeringFileQualificationAttestationV1 {
  return (
    value !== null &&
    typeof value === "object" &&
    mainOwnedAttestations.has(value) &&
    validateEngineeringFileQualificationAttestation(value)
  );
}

export function hasMainOwnedEngineeringFileQualification(
  value: unknown,
  capability: EngineeringFileQualificationCapability,
  observedAt: string = new Date().toISOString()
): boolean {
  return (
    isMainOwnedEngineeringFileQualificationAttestation(value) &&
    value.status === "available" &&
    value.productionQualified &&
    value.expiresAt !== null &&
    Date.parse(observedAt) < Date.parse(value.expiresAt) &&
    value.capabilities[capability] === "available"
  );
}

export function mainOwnedEngineeringFileQualificationRevision(
  value: unknown,
  observedAt: string = new Date().toISOString()
): string {
  // The revision distinguishes Main-owned unavailable attestations (for example, an expired
  // fresh probe) from a missing or renderer-supplied value. It is not a capability grant.
  if (!isMainOwnedEngineeringFileQualificationAttestation(value)) return "unavailable";
  // A previously available attestation must change the feature revision at its expiry boundary,
  // while a Main-owned unavailable observation still has a stable diagnostic revision.
  return value.status === "available" &&
    !hasMainOwnedEngineeringFileQualification(value, "root", observedAt)
    ? "unavailable"
    : value.attestationChecksum;
}

async function observeAttestation(input: {
  readonly target: string;
  readonly packageKind: "development" | "production";
  readonly checkedAt: string;
  readonly inspector: EngineeringFileCandidateInspector;
  readonly evidencePaths: ProductionEvidencePaths;
  readonly productionProbe: EngineeringFileAccessProductionProbe;
}): Promise<EngineeringFileQualificationAttestationV1> {
  if (input.target !== ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.supportedTarget) {
    return unavailable(input, false, ["unsupported_platform"]);
  }

  let state: EngineeringFileCandidateArtifactState;
  try {
    state = await input.inspector.inspect();
  } catch {
    return unavailable(input, false, ["probe_error"]);
  }
  switch (state) {
    case "missing":
      return unavailable(input, false, ["host_missing"]);
    case "partial":
      return unavailable(input, true, ["host_partial"]);
    case "unknown":
      return unavailable(input, false, ["evidence_unknown"]);
    case "present":
      break;
  }

  // Development artifacts are intentionally never evidence, even if they expose the B6 ABI.
  if (input.packageKind === "development") {
    return unavailable(input, true, ["candidate_unqualified"]);
  }

  const production = await verifyProductionEvidence(
    input.evidencePaths,
    input.checkedAt,
    input.productionProbe
  );
  if (production.status === "unavailable") {
    return unavailable(input, true, ["candidate_unqualified", ...production.failureReasons]);
  }
  return production.batch === "7"
    ? createBatch7AvailableAttestation({
        target: input.target,
        checkedAt: input.checkedAt,
        report: production.report
      })
    : createBatch6AvailableAttestation({
        target: input.target,
        checkedAt: input.checkedAt,
        report: production.report
      });
}

/**
 * This verifier is deliberately concrete: it reads the installed artifact set, checks every
 * digest/probe invariant, then asks Windows and OpenSSL to validate the two actual signatures.
 * No injected or serialized value can claim either trust result.
 */
async function verifyProductionEvidence(
  paths: ProductionEvidencePaths,
  checkedAt: string,
  productionProbe: EngineeringFileAccessProductionProbe
): Promise<ProductionEvidenceResult> {
  let artifact: Buffer;
  let manifestBytes: Buffer;
  let signature: Buffer;
  let manifest: unknown;
  try {
    [artifact, manifestBytes, signature] = await Promise.all([
      readFile(paths.artifact),
      readFile(paths.manifest),
      readFile(paths.signature)
    ]);
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    return productionUnavailable(["evidence_unknown"]);
  }

  const artifactSha256 = sha256(artifact);
  const manifestSha256 = sha256(manifestBytes);
  const signatureSha256 = sha256(signature);
  const batch = isBatch6ProductionManifest(manifest, artifactSha256)
    ? "6"
    : isBatch7ProductionManifest(manifest, artifactSha256)
      ? "7"
      : undefined;
  if (batch === undefined) {
    return productionUnavailable(["digest_mismatch"]);
  }
  const protectionEvidence = signedBatch6ProbeEvidence(manifest);
  if (protectionEvidence === undefined) return productionUnavailable(["probe_contract_mismatch"]);
  const mutationRecoveryEvidence =
    batch === "7" ? signedBatch7MutationRecoveryEvidence(manifest) : undefined;
  if (batch === "7" && mutationRecoveryEvidence === undefined) {
    return productionUnavailable(["probe_contract_mismatch"]);
  }
  const lifecycleEvidence = batch === "7" ? signedBatch8LifecycleEvidence(manifest) : undefined;
  if (batch === "7" && lifecycleEvidence === undefined) {
    return productionUnavailable(["probe_contract_mismatch"]);
  }

  const signaturesTrusted = await verifyInstalledSignatures(paths);
  if (!signaturesTrusted) return productionUnavailable(["signature_mismatch"]);
  let report: EngineeringFileProbeReportV1 | EngineeringFileProbeReportV2;
  try {
    report = await productionProbe.probe({
      artifactPath: paths.artifact,
      manifestPath: paths.manifest,
      signaturePath: paths.signature,
      checkedAt,
      publisherPolicyChecksum: ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY_CHECKSUM,
      protectionEvidence,
      ...(mutationRecoveryEvidence === undefined ? {} : { mutationRecoveryEvidence }),
      ...(lifecycleEvidence === undefined ? {} : { lifecycleEvidence })
    });
  } catch {
    return productionUnavailable(["probe_error"]);
  }
  const reportValidation =
    batch === "7"
      ? validateEngineeringFileProbeReportV2(report, checkedAt)
      : validateEngineeringFileProbeReport(report, checkedAt);
  const reasons = new Set<EngineeringFileQualificationFailureReason>(
    reportValidation.failureReasons
  );
  if (
    !isProbeReportForInstalledArtifacts(report, artifactSha256, manifestSha256, signatureSha256)
  ) {
    reasons.add("digest_mismatch");
  }
  if (report.publisherPolicyChecksum !== ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY_CHECKSUM) {
    reasons.add("signature_mismatch");
  }
  if (
    batch === "7" &&
    (!isBatch7ProbeReport(report) ||
      mutationRecoveryEvidence === undefined ||
      !sameBatch7MutationRecoveryEvidence(
        report.mutationRecoveryEvidence,
        mutationRecoveryEvidence
      ) ||
      lifecycleEvidence === undefined)
  ) {
    reasons.add("probe_contract_mismatch");
  }
  if (reasons.size > 0) return productionUnavailable([...reasons]);
  return batch === "7"
    ? Object.freeze({
        status: "available" as const,
        batch: "7" as const,
        report: report as EngineeringFileProbeReportV2
      })
    : Object.freeze({
        status: "available" as const,
        batch: "6" as const,
        report: report as EngineeringFileProbeReportV1
      });
}

async function verifyInstalledSignatures(paths: ProductionEvidencePaths): Promise<boolean> {
  // A test override of the observed target must not turn a non-Windows host into a trust oracle.
  if (process.platform !== "win32" || !hasConfiguredEngineeringFileAccessPublisherPolicy()) {
    return false;
  }
  try {
    const [authenticodeSignerCertificateSha256, detachedCmsSignerCertificateSha256] =
      await Promise.all([
        readAuthenticodeSignerCertificateSha256(paths.artifact),
        readDetachedCmsSignerCertificateSha256(paths.signature, paths.manifest)
      ]);
    return arePinnedEngineeringFileAccessPublishers({
      authenticodeSignerCertificateSha256,
      detachedCmsSignerCertificateSha256
    });
  } catch {
    return false;
  }
}

function isProbeReportForInstalledArtifacts(
  value: unknown,
  artifactSha256: string,
  manifestSha256: string,
  signatureSha256: string
): value is EngineeringFileProbeReportV1 | EngineeringFileProbeReportV2 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const report = value as Record<string, unknown>;
  return (
    report["artifactSha256"] === artifactSha256 &&
    report["artifactManifestSha256"] === manifestSha256 &&
    report["artifactManifestSignatureSha256"] === signatureSha256
  );
}

function isBatch7ProbeReport(value: unknown): value is EngineeringFileProbeReportV2 {
  return (
    value !== null && typeof value === "object" && (value as { batch?: unknown }).batch === "7"
  );
}

function isBatch6ProductionManifest(value: unknown, artifactSha256: string): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const manifest = value as Record<string, unknown>;
  const eligibility = manifest["eligibility"];
  const signing = manifest["signing"];
  const qualification = manifest["qualification"];
  const artifact = manifest["artifact"];
  return (
    manifest["adapterId"] === ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.adapterId &&
    manifest["target"] === ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.supportedTarget &&
    isRecord(artifact) &&
    artifact["sha256"] === artifactSha256 &&
    isRecord(signing) &&
    signing["authenticode"] === "trusted_publisher" &&
    signing["detachedCms"] === "trusted_publisher" &&
    signing["developmentUnsigned"] === undefined &&
    isBatch6Eligibility(eligibility) &&
    isBatch6Qualification(qualification) &&
    manifest["publisherPolicyChecksum"] === ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY_CHECKSUM
  );
}

function isBatch7ProductionManifest(value: unknown, artifactSha256: string): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  const eligibility = manifest["eligibility"];
  const signing = manifest["signing"];
  const qualification = manifest["qualification"];
  const artifact = manifest["artifact"];
  return (
    manifest["adapterId"] === ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.adapterId &&
    manifest["target"] === ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.supportedTarget &&
    isRecord(artifact) &&
    artifact["sha256"] === artifactSha256 &&
    isRecord(signing) &&
    signing["authenticode"] === "trusted_publisher" &&
    signing["detachedCms"] === "trusted_publisher" &&
    signing["developmentUnsigned"] === undefined &&
    isBatch7Eligibility(eligibility) &&
    isBatch7Qualification(qualification) &&
    manifest["publisherPolicyChecksum"] === ENGINEERING_FILE_ACCESS_PUBLISHER_POLICY_CHECKSUM
  );
}

function isBatch6Eligibility(value: unknown): boolean {
  if (!isRecord(value) || value["batch"] !== "6") return false;
  return (
    BATCH_6_READ_ONLY_CAPABILITIES.every((capability) => value[capability] === "available") &&
    value["mutation"] === "unavailable" &&
    value["recovery"] === "unavailable"
  );
}

function isBatch7Eligibility(value: unknown): boolean {
  return (
    isRecord(value) &&
    value["batch"] === "7" &&
    BATCH_6_READ_ONLY_CAPABILITIES.every((capability) => value[capability] === "available") &&
    value["mutation"] === "available" &&
    value["recovery"] === "available"
  );
}

function isBatch6Qualification(value: unknown): boolean {
  if (!isRecord(value) || value["productionQualified"] !== true) return false;
  const eligible = value["eligibleCapabilities"];
  const unavailable = value["unavailableCapabilities"];
  const probeEvidence = value["probeEvidence"];
  return (
    Array.isArray(eligible) &&
    sameStrings(eligible, BATCH_6_READ_ONLY_CAPABILITIES) &&
    Array.isArray(unavailable) &&
    sameStrings(unavailable, ["mutation", "recovery"]) &&
    isSignedBatch6ProbeEvidence(probeEvidence)
  );
}

function isBatch7Qualification(value: unknown): boolean {
  if (!isRecord(value) || value["productionQualified"] !== true) return false;
  return (
    Array.isArray(value["eligibleCapabilities"]) &&
    sameStrings(value["eligibleCapabilities"], [
      ...BATCH_6_READ_ONLY_CAPABILITIES,
      "mutation",
      "recovery"
    ]) &&
    Array.isArray(value["unavailableCapabilities"]) &&
    sameStrings(value["unavailableCapabilities"], []) &&
    isSignedBatch6ProbeEvidence(value["probeEvidence"]) &&
    isSignedBatch7MutationRecoveryEvidence(value["mutationRecoveryEvidence"]) &&
    isSignedBatch8LifecycleEvidence(value["lifecycleEvidence"])
  );
}

function isSignedBatch6ProbeEvidence(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    hasExactStatusMap(
      value["positiveProtections"],
      [
        "rootRelativeTraversal",
        "noFollowTraversal",
        "rawByteIdentity",
        "receiptBinding",
        "durability",
        "recoveryRootBinding"
      ],
      "passed"
    ) &&
    hasExactStatusMap(
      value["negativeControls"],
      [
        "rootRelativeDisabled",
        "noFollowDisabled",
        "rawByteIdentityDisabled",
        "receiptBindingDisabled",
        "durabilityDisabled",
        "recoveryRootBindingDisabled"
      ],
      "canary_exposed"
    )
  );
}

function signedBatch6ProbeEvidence(
  manifest: unknown
): EngineeringFileAccessProtectionEvidence | undefined {
  if (!isRecord(manifest) || !isRecord(manifest["qualification"])) return undefined;
  const evidence = manifest["qualification"]["probeEvidence"];
  return isSignedBatch6ProbeEvidence(evidence)
    ? (evidence as EngineeringFileAccessProtectionEvidence)
    : undefined;
}

function isSignedBatch7MutationRecoveryEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactStatusMap(
      value["positiveProtections"],
      ["replace", "create", "receiptBinding", "walPreparation", "recoveryScan"],
      "passed"
    ) &&
    hasExactStatusMap(
      value["negativeControls"],
      ["rawByteManifestMismatch", "staleBase", "createRace", "faultRecoveryRequired"],
      "canary_exposed"
    )
  );
}

function signedBatch7MutationRecoveryEvidence(
  manifest: unknown
): EngineeringFileAccessBatch7MutationRecoveryEvidence | undefined {
  if (!isRecord(manifest) || !isRecord(manifest["qualification"])) return undefined;
  const evidence = manifest["qualification"]["mutationRecoveryEvidence"];
  return isSignedBatch7MutationRecoveryEvidence(evidence)
    ? (evidence as EngineeringFileAccessBatch7MutationRecoveryEvidence)
    : undefined;
}

function isSignedBatch8LifecycleEvidence(
  value: unknown
): value is EngineeringFileAccessBatch8LifecycleEvidence {
  return (
    isRecord(value) &&
    hasExactStatusMap(
      value["positiveProtections"],
      ["createDirectory", "move", "quarantine", "restore", "purge"],
      "passed"
    ) &&
    isRecord(value["negativeControls"]) &&
    Object.keys(value["negativeControls"]).length === 0
  );
}

function signedBatch8LifecycleEvidence(
  manifest: unknown
): EngineeringFileAccessBatch8LifecycleEvidence | undefined {
  if (!isRecord(manifest) || !isRecord(manifest["qualification"])) return undefined;
  const evidence = manifest["qualification"]["lifecycleEvidence"];
  return isSignedBatch8LifecycleEvidence(evidence)
    ? (evidence as EngineeringFileAccessBatch8LifecycleEvidence)
    : undefined;
}

function sameBatch7MutationRecoveryEvidence(
  actual: EngineeringFileAccessBatch7MutationRecoveryEvidence,
  expected: EngineeringFileAccessBatch7MutationRecoveryEvidence
): boolean {
  return (
    JSON.stringify(actual.positiveProtections) === JSON.stringify(expected.positiveProtections) &&
    JSON.stringify(actual.negativeControls) === JSON.stringify(expected.negativeControls)
  );
}

function createBatch6AvailableAttestation(input: {
  readonly target: string;
  readonly checkedAt: string;
  readonly report: EngineeringFileProbeReportV1;
}): EngineeringFileQualificationAttestationV1 {
  const unsigned = {
    schemaVersion: "1.0" as const,
    authority: "desktop_main_engineering_file_access_qualification" as const,
    adapterId: ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.adapterId,
    target: input.target,
    packageKind: "production" as const,
    status: "available" as const,
    productionQualified: true,
    candidateArtifactPresent: true,
    capabilities: {
      root: "available" as const,
      access: "available" as const,
      mutation: "unavailable" as const,
      recovery: "unavailable" as const
    },
    artifactSha256: input.report.artifactSha256,
    artifactManifestSha256: input.report.artifactManifestSha256,
    probeReportChecksum: input.report.reportChecksum,
    expiresAt: input.report.expiresAt,
    failureReasons: [] as const,
    checkedAt: input.checkedAt
  };
  return deepFreeze({
    ...unsigned,
    attestationChecksum: engineeringFileQualificationAttestationChecksum(unsigned)
  });
}

function createBatch7AvailableAttestation(input: {
  readonly target: string;
  readonly checkedAt: string;
  readonly report: EngineeringFileProbeReportV2;
}): EngineeringFileQualificationAttestationV1 {
  const unsigned = {
    schemaVersion: "1.0" as const,
    authority: "desktop_main_engineering_file_access_qualification" as const,
    adapterId: ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.adapterId,
    target: input.target,
    packageKind: "production" as const,
    status: "available" as const,
    productionQualified: true,
    candidateArtifactPresent: true,
    capabilities: {
      root: "available" as const,
      access: "available" as const,
      mutation: "available" as const,
      recovery: "available" as const
    },
    artifactSha256: input.report.artifactSha256,
    artifactManifestSha256: input.report.artifactManifestSha256,
    probeReportChecksum: input.report.reportChecksum,
    expiresAt: input.report.expiresAt,
    failureReasons: [] as const,
    checkedAt: input.checkedAt
  };
  return deepFreeze({
    ...unsigned,
    attestationChecksum: engineeringFileQualificationAttestationChecksum(unsigned)
  });
}

function unavailable(
  input: {
    readonly target: string;
    readonly packageKind: "development" | "production";
    readonly checkedAt: string;
  },
  candidateArtifactPresent: boolean,
  failureReasons: readonly EngineeringFileQualificationFailureReason[]
): EngineeringFileQualificationAttestationV1 {
  return createUnavailableEngineeringFileQualificationAttestation({
    target: input.target,
    packageKind: input.packageKind,
    candidateArtifactPresent,
    failureReasons,
    checkedAt: input.checkedAt
  });
}

function registerMainOwnedAttestation(
  attestation: EngineeringFileQualificationAttestationV1
): EngineeringFileQualificationAttestationV1 {
  mainOwnedAttestations.add(attestation);
  return attestation;
}

function createCandidateInspector(basePath: string): EngineeringFileCandidateInspector {
  const componentPaths = candidateFiles.map((path) => join(basePath, ...path.split("/")));
  return Object.freeze({
    async inspect(): Promise<EngineeringFileCandidateArtifactState> {
      const exists = await Promise.all(componentPaths.map(fileExists));
      const presentCount = exists.filter(Boolean).length;
      if (presentCount === 0) return "missing";
      return presentCount === componentPaths.length ? "present" : "partial";
    }
  });
}

interface ProductionEvidencePaths {
  readonly artifact: string;
  readonly manifest: string;
  readonly signature: string;
}

type ProductionEvidenceResult =
  | {
      readonly status: "available";
      readonly batch: "6";
      readonly report: EngineeringFileProbeReportV1;
    }
  | {
      readonly status: "available";
      readonly batch: "7";
      readonly report: EngineeringFileProbeReportV2;
    }
  | {
      readonly status: "unavailable";
      readonly failureReasons: readonly EngineeringFileQualificationFailureReason[];
    };

function productionEvidencePaths(basePath: string): ProductionEvidencePaths {
  return {
    artifact: join(
      basePath,
      ...ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.candidateArtifact.split("/")
    ),
    manifest: join(
      basePath,
      ...ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.candidateManifest.split("/")
    ),
    signature: join(
      basePath,
      ...ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.candidateManifestSignature.split("/")
    )
  };
}

function candidateBasePath(packageKind: "development" | "production"): string {
  if (packageKind === "production") {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath !== undefined) return join(resourcesPath, "app.asar.unpacked");
  }
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
}

function productionUnavailable(
  failureReasons: readonly EngineeringFileQualificationFailureReason[]
): ProductionEvidenceResult {
  return Object.freeze({
    status: "unavailable" as const,
    failureReasons: Object.freeze([...new Set(failureReasons)].sort())
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameStrings(value: readonly unknown[], expected: readonly string[]): boolean {
  return (
    value.length === expected.length &&
    [...value].sort().every((item, index) => item === expected[index])
  );
}

function hasExactStatusMap(value: unknown, keys: readonly string[], expected: string): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => value[key] === expected)
  );
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

const unavailableProductionProbe: EngineeringFileAccessProductionProbe = Object.freeze({
  async probe(): Promise<EngineeringFileProbeReportV1 | EngineeringFileProbeReportV2> {
    // The release pipeline must inject the fixed Main-owned packaged probe. A static report in the
    // package is deliberately not a substitute: it is stale after one hour and is not authority.
    throw new Error("ENGINEERING_FILE_ACCESS_FRESH_PROBE_UNAVAILABLE");
  }
});

async function readAuthenticodeSignerCertificateSha256(artifactPath: string): Promise<string> {
  const result = await exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "$signature = Get-AuthenticodeSignature -LiteralPath $args[0]",
        "if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) { exit 1 }",
        "$hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($signature.SignerCertificate.RawData)",
        "[Convert]::ToHexString($hash).ToLowerInvariant()"
      ].join("; "),
      artifactPath
    ],
    { windowsHide: true }
  );
  return parseCertificateSha256(result.stdout);
}

async function readDetachedCmsSignerCertificateSha256(
  signaturePath: string,
  manifestPath: string
): Promise<string> {
  const result = await exec(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      [
        "Add-Type -AssemblyName System.Security.Cryptography.Pkcs",
        "$content = [System.Security.Cryptography.Pkcs.ContentInfo]::new([System.IO.File]::ReadAllBytes($args[1]))",
        "$cms = [System.Security.Cryptography.Pkcs.SignedCms]::new($content, $true)",
        "$cms.Decode([System.IO.File]::ReadAllBytes($args[0]))",
        "if (-not $cms.Detached -or $cms.SignerInfos.Count -ne 1 -or $null -eq $cms.SignerInfos[0].Certificate) { exit 1 }",
        "$cms.CheckSignature($true)",
        "$hash = [System.Security.Cryptography.SHA256]::Create().ComputeHash($cms.SignerInfos[0].Certificate.RawData)",
        "[Convert]::ToHexString($hash).ToLowerInvariant()"
      ].join("; "),
      signaturePath,
      manifestPath
    ],
    { windowsHide: true }
  );
  return parseCertificateSha256(result.stdout);
}

function parseCertificateSha256(value: string): string {
  const checksum = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(checksum)) throw new Error("ENGINEERING_SIGNER_CERTIFICATE_INVALID");
  return checksum;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const entry = await stat(path);
    return entry.isFile();
  } catch {
    return false;
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
