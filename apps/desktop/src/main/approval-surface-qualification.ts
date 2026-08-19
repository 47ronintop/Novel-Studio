import { createHash, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import type { TrustedApprovalSurfaceQualificationV1 } from "./agent-approval-confirmation.js";

const REQUIRED_ARTIFACTS = Object.freeze({
  approvalHtml: "apps/desktop/dist/approval/index.html",
  approvalJs: "apps/desktop/dist/approval/approval.js",
  approvalCss: "apps/desktop/dist/approval/approval.css",
  approvalPreload: "apps/desktop/dist/preload/approval-preload.cjs"
});
/**
 * These files are signed separately by the Security Architecture Owner, then
 * covered by the packaged application signature. They intentionally are not
 * part of APPROVAL_BUNDLE_DIGEST: including them would make the attestation
 * self-referential.
 */
const APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH =
  "apps/desktop/dist/approval/approval-surface-qualification-v1.json";
const APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH =
  "apps/desktop/dist/approval/approval-surface-qualification-v1.sig";
const APPROVAL_SURFACE_QUALIFICATION_ARTIFACTS = Object.freeze([
  APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH,
  APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH
] as const);
const REQUIRED_PACKAGE_ARTIFACTS = Object.freeze([
  ...Object.values(REQUIRED_ARTIFACTS),
  ...APPROVAL_SURFACE_QUALIFICATION_ARTIFACTS
] as const);
const HASH = /^[a-f0-9]{64}$/u;
const SOURCE_REVISION = /^[a-f0-9]{40}$/u;
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const CANONICAL_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_QUALIFICATION_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000;
const MAIN_OWNED = new WeakSet<object>();
const execFileAsync = promisify(execFile);
const ELECTRON_FUSE_SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX", "ascii");
const ELECTRON_FUSE_VERSION_V1 = 1;
const ELECTRON_FUSE_ENABLED = 0x31;
const EMBEDDED_ASAR_INTEGRITY_FUSE_INDEX = 4;
const ONLY_LOAD_APP_FROM_ASAR_FUSE_INDEX = 5;

/**
 * The immutable ADR-0004 qualification matrix. The signed attestation binds
 * this exact matrix checksum, not a free-form report supplied by a build.
 */
const APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1 = Object.freeze({
  schemaVersion: "1.0" as const,
  revision: "adr-0004-qualification-r1",
  cases: Object.freeze([
    "renderer_forgery_rejected",
    "binding_replay_rejected",
    "modal_navigation_and_injection_rejected",
    "untrusted_content_rendered_as_plain_text",
    "window_focus_default_and_cancel_contract",
    "accessibility_and_localization_contract",
    "crash_and_restart_revoke_evidence",
    "unsigned_digest_or_qualification_drift_closes_surface",
    "limited_run_preapproval_policy_exclusions"
  ] as const)
});
const APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM = sha256(
  canonicalJsonBytes(APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1)
);

/**
 * Deliberately empty until the Security Architecture Owner supplies a pinned
 * production signing key through a separately reviewed source change. A build
 * or project must never be able to add a trusted owner key at runtime.
 */
const PINNED_PRODUCTION_APPROVAL_SURFACE_OWNER_KEYS: Readonly<Record<string, string>> =
  Object.freeze({});

interface BuildManifest {
  readonly schemaVersion: "1.0";
  readonly sourceRevision: string;
  readonly sourceDirty: boolean;
  readonly artifacts: Record<
    string,
    { readonly path: string; readonly sha256: string; readonly sourceRevision: string }
  >;
}

export interface TrustedApprovalSurfaceQualificationAttestationV1 {
  readonly schemaVersion: "1.0";
  readonly authority: "security_architecture_owner";
  readonly qualificationRevision: string;
  readonly sourceRevision: string;
  readonly approvalBundleDigest: string;
  readonly approvalArtifactManifestChecksum: string;
  readonly qualificationMatrixRevision: string;
  readonly qualificationMatrixChecksum: string;
  /** Digest of an external, release-owned report that proves the fixed matrix passed. */
  readonly automatedReportChecksum: string;
  readonly ownerApprovalId: string;
  /** Selects a public key from the compiled Main-process trust store only. */
  readonly ownerKeyId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  /** SHA-256 of the canonical attestation with this field omitted. */
  readonly attestationChecksum: string;
}

export type ApprovalSurfaceOwnerTrustStore = Readonly<Record<string, string>>;

export interface ApprovalPackageSignatureInspector {
  /** True only when every listed relative file is protected by the installed package signature. */
  covers(paths: readonly string[]): Promise<boolean>;
}

export interface ExecutableCodeSignatureInspector {
  /** `valid` is returned only after Authenticode/codesign verification succeeds. */
  verify(executablePath: string): Promise<"valid" | "unsigned" | "invalid" | "unsupported">;
}

export interface ApprovalElectronFuseState {
  readonly embeddedAsarIntegrityValidationEnabled: boolean;
  readonly onlyLoadAppFromAsarEnabled: boolean;
}

/**
 * Reads only the two approval-relevant Electron V1 fuses from the packaged
 * executable. Keeping this probe local avoids a production dependency on the
 * build-time `@electron/fuses` package.
 */
export async function readApprovalElectronFuseState(
  executablePath: string
): Promise<ApprovalElectronFuseState | undefined> {
  try {
    const executable = await readFile(executablePath);
    const first = executable.indexOf(ELECTRON_FUSE_SENTINEL);
    if (first < 0) return undefined;
    const last = executable.lastIndexOf(ELECTRON_FUSE_SENTINEL);
    const sentinels = first === last ? [first] : [first, last];
    let embeddedAsarIntegrityValidationEnabled = true;
    let onlyLoadAppFromAsarEnabled = true;
    for (const sentinel of sentinels) {
      const wire = sentinel + ELECTRON_FUSE_SENTINEL.length;
      const version = executable[wire];
      const length = executable[wire + 1];
      if (
        version !== ELECTRON_FUSE_VERSION_V1 ||
        length === undefined ||
        length <= ONLY_LOAD_APP_FROM_ASAR_FUSE_INDEX
      ) {
        return undefined;
      }
      embeddedAsarIntegrityValidationEnabled &&=
        executable[wire + 2 + EMBEDDED_ASAR_INTEGRITY_FUSE_INDEX] === ELECTRON_FUSE_ENABLED;
      onlyLoadAppFromAsarEnabled &&=
        executable[wire + 2 + ONLY_LOAD_APP_FROM_ASAR_FUSE_INDEX] === ELECTRON_FUSE_ENABLED;
    }
    return {
      embeddedAsarIntegrityValidationEnabled,
      onlyLoadAppFromAsarEnabled
    };
  } catch {
    return undefined;
  }
}

/**
 * Real platform verifier for production composition. It invokes Windows
 * Authenticode validation or macOS codesign verification without a shell; all
 * other platforms fail closed. Callers may inject a fake only in focused tests.
 */
export function createSystemExecutableCodeSignatureInspector(
  platform: NodeJS.Platform = process.platform
): ExecutableCodeSignatureInspector {
  return {
    verify: async (executablePath) => {
      try {
        if (platform === "win32") {
          const systemRoot = process.env["SystemRoot"];
          if (systemRoot === undefined) return "invalid";
          const windowsPowerShellRoot = join(systemRoot, "System32", "WindowsPowerShell", "v1.0");
          const result = await execFileAsync(
            join(windowsPowerShellRoot, "powershell.exe"),
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "Import-Module $env:NOVEL_STUDIO_SIGNATURE_MODULE -ErrorAction Stop; $signature = Get-AuthenticodeSignature -LiteralPath $env:NOVEL_STUDIO_SIGNATURE_TARGET; [Console]::Out.Write($signature.Status.ToString())"
            ],
            {
              env: {
                ...process.env,
                NOVEL_STUDIO_SIGNATURE_TARGET: executablePath,
                NOVEL_STUDIO_SIGNATURE_MODULE: join(
                  windowsPowerShellRoot,
                  "Modules",
                  "Microsoft.PowerShell.Security",
                  "Microsoft.PowerShell.Security.psd1"
                )
              },
              windowsHide: true
            }
          );
          return classifyWindowsAuthenticodeStatus(result.stdout);
        }
        if (platform === "darwin") {
          await execFileAsync("codesign", [
            "--verify",
            "--deep",
            "--strict",
            "--verbose=2",
            executablePath
          ]);
          const details = await execFileAsync("codesign", [
            "--display",
            "--verbose=4",
            executablePath
          ]);
          const signatureDetails = `${details.stdout}\n${details.stderr}`;
          if (
            /^Signature=adhoc\r?$/mu.test(signatureDetails) ||
            /^TeamIdentifier=not set\r?$/mu.test(signatureDetails) ||
            !/^Authority=.+\r?$/mu.test(signatureDetails)
          ) {
            return "invalid";
          }
          return "valid";
        }
        return "unsupported";
      } catch {
        return "invalid";
      }
    }
  };
}

/** @internal Exact Authenticode status mapping used by the packaged unsigned-beta gate. */
export function classifyWindowsAuthenticodeStatus(
  value: unknown
): "valid" | "unsigned" | "invalid" {
  if (typeof value !== "string") return "invalid";
  const status = value.trim();
  if (status === "Valid") return "valid";
  if (status === "NotSigned") return "unsigned";
  return "invalid";
}

export interface SignedAsarPackageCoverageOptions {
  /** Electron app.getAppPath() from the running Main process. */
  readonly appPath: string;
  /** Electron process.resourcesPath from the running Main process. */
  readonly resourcesPath: string;
  /** Packaged Electron executable, verified by the platform signature inspector. */
  readonly executablePath: string;
  /** Main-owned fuse probe; false/unknown is never treated as package coverage. */
  readonly embeddedAsarIntegrityValidationEnabled: () => boolean;
  readonly onlyLoadAppFromAsarEnabled: () => boolean;
  readonly executableCodeSignatureInspector: ExecutableCodeSignatureInspector;
}

/**
 * Production coverage inspector. ASAR integrity prevents post-package code
 * substitution; it is not a signature. Qualification requires a separately
 * verified platform executable signature as well as both integrity fuses.
 */
export function createSignedAsarPackageCoverageInspector(
  options: SignedAsarPackageCoverageOptions
): ApprovalPackageSignatureInspector {
  return {
    covers: async (paths) => {
      const appAsar = resolve(options.resourcesPath, "app.asar");
      if (resolve(options.appPath) !== appAsar) return false;
      if (
        !options.embeddedAsarIntegrityValidationEnabled() ||
        !options.onlyLoadAppFromAsarEnabled()
      ) {
        return false;
      }
      if (
        (await options.executableCodeSignatureInspector.verify(options.executablePath)) !== "valid"
      ) {
        return false;
      }
      const expected = REQUIRED_PACKAGE_ARTIFACTS;
      return paths.length === expected.length && expected.every((path) => paths.includes(path));
    }
  };
}

export interface ApprovalSurfaceQualificationOptions {
  readonly rootDirectory: string;
  readonly buildManifestPath: string;
  readonly mode: "production" | "development";
  readonly packageSignatureInspector?: ApprovalPackageSignatureInspector;
  readonly readFile?: (path: string) => Promise<Buffer>;
  /**
   * Test seam only. Production callers use the compiled, intentionally empty
   * trust store until a Security Architecture Owner key is separately pinned.
   */
  readonly ownerTrustStore?: ApprovalSurfaceOwnerTrustStore;
  /** Main-owned clock seam used only to make qualification expiry testable. */
  readonly now?: () => string;
}

export interface ApprovalSurfaceQualificationProvider {
  readonly refresh: () => Promise<Result<TrustedApprovalSurfaceQualificationV1, UnifiedError>>;
  readonly get: () => TrustedApprovalSurfaceQualificationV1 | undefined;
}

/** Loads a qualified approval bundle only from a clean, signed production build. */
export async function loadApprovalSurfaceQualification(
  options: ApprovalSurfaceQualificationOptions
): Promise<Result<TrustedApprovalSurfaceQualificationV1, UnifiedError>> {
  if (options.mode !== "production" || options.packageSignatureInspector === undefined) {
    return qualificationFailure("TRUSTED_APPROVAL_QUALIFICATION_UNAVAILABLE");
  }
  const reader = options.readFile ?? readFile;
  let manifest: BuildManifest;
  try {
    manifest = JSON.parse(
      (await reader(options.buildManifestPath)).toString("utf8")
    ) as BuildManifest;
  } catch {
    return qualificationFailure("TRUSTED_APPROVAL_QUALIFICATION_MANIFEST_INVALID");
  }
  if (!isManifest(manifest) || manifest.sourceDirty) {
    return qualificationFailure("TRUSTED_APPROVAL_QUALIFICATION_MANIFEST_INVALID");
  }
  const entries = Object.entries(REQUIRED_ARTIFACTS);
  const artifactRows: string[] = [];
  for (const [name, relativePath] of entries) {
    const artifact = manifest.artifacts[name];
    if (
      artifact === undefined ||
      artifact.path !== relativePath ||
      artifact.sourceRevision !== manifest.sourceRevision ||
      !HASH.test(artifact.sha256)
    ) {
      return qualificationFailure("TRUSTED_APPROVAL_QUALIFICATION_ARTIFACT_MISSING");
    }
    try {
      const bytes = await reader(resolve(options.rootDirectory, relativePath));
      if (sha256(bytes) !== artifact.sha256) {
        return qualificationFailure("TRUSTED_APPROVAL_QUALIFICATION_DIGEST_DRIFT");
      }
    } catch {
      return qualificationFailure("TRUSTED_APPROVAL_QUALIFICATION_ARTIFACT_MISSING");
    }
    artifactRows.push(`${relativePath}\n${artifact.sha256}`);
  }
  if (!(await options.packageSignatureInspector.covers(REQUIRED_PACKAGE_ARTIFACTS))) {
    return qualificationFailure("TRUSTED_APPROVAL_QUALIFICATION_PACKAGE_UNCOVERED");
  }
  const bundleDigest = approvalBundleDigest(artifactRows);
  const attestation = await readApprovalSurfaceQualificationAttestation({
    reader,
    rootDirectory: options.rootDirectory,
    manifest,
    bundleDigest,
    ownerTrustStore: options.ownerTrustStore ?? PINNED_PRODUCTION_APPROVAL_SURFACE_OWNER_KEYS,
    now: options.now ?? (() => new Date().toISOString())
  });
  if (!attestation.ok) return attestation;
  const qualification: TrustedApprovalSurfaceQualificationV1 = Object.freeze({
    schemaVersion: "1.0",
    status: "qualified",
    bundleDigest,
    qualificationRevision: attestation.value.qualificationRevision,
    sourceRevision: attestation.value.sourceRevision,
    approvalArtifactManifestChecksum: attestation.value.approvalArtifactManifestChecksum,
    qualificationMatrixRevision: attestation.value.qualificationMatrixRevision,
    qualificationMatrixChecksum: attestation.value.qualificationMatrixChecksum,
    automatedReportChecksum: attestation.value.automatedReportChecksum,
    ownerApprovalId: attestation.value.ownerApprovalId,
    ownerKeyId: attestation.value.ownerKeyId,
    issuedAt: attestation.value.issuedAt,
    expiresAt: attestation.value.expiresAt,
    attestationChecksum: attestation.value.attestationChecksum
  });
  MAIN_OWNED.add(qualification);
  return ok(qualification);
}

async function readApprovalSurfaceQualificationAttestation(input: {
  readonly reader: (path: string) => Promise<Buffer>;
  readonly rootDirectory: string;
  readonly manifest: BuildManifest;
  readonly bundleDigest: string;
  readonly ownerTrustStore: ApprovalSurfaceOwnerTrustStore;
  readonly now: () => string;
}): Promise<Result<TrustedApprovalSurfaceQualificationAttestationV1, UnifiedError>> {
  let parsed: unknown;
  let signature: Buffer;
  try {
    const [bytes, signatureBytes] = await Promise.all([
      input.reader(resolve(input.rootDirectory, APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH)),
      input.reader(resolve(input.rootDirectory, APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH))
    ]);
    parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    signature = signatureBytes;
  } catch {
    return qualificationFailure("TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_MISSING");
  }
  if (!isApprovalSurfaceQualificationAttestation(parsed)) {
    return qualificationFailure("TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_INVALID");
  }
  const observedAt = Date.parse(input.now());
  if (
    !Number.isFinite(observedAt) ||
    Date.parse(parsed.issuedAt) > observedAt ||
    observedAt >= Date.parse(parsed.expiresAt)
  ) {
    return qualificationFailure("TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_EXPIRED");
  }
  if (
    parsed.attestationChecksum !== approvalSurfaceQualificationAttestationChecksum(parsed) ||
    parsed.sourceRevision !== input.manifest.sourceRevision ||
    parsed.approvalBundleDigest !== input.bundleDigest ||
    parsed.approvalArtifactManifestChecksum !== approvalArtifactManifestChecksum(input.manifest) ||
    parsed.qualificationMatrixRevision !== APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1.revision ||
    parsed.qualificationMatrixChecksum !== APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM
  ) {
    return qualificationFailure("TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_BINDING_MISMATCH");
  }
  const ownerPublicKey = Object.hasOwn(input.ownerTrustStore, parsed.ownerKeyId)
    ? input.ownerTrustStore[parsed.ownerKeyId]
    : undefined;
  if (typeof ownerPublicKey !== "string" || ownerPublicKey.length === 0) {
    return qualificationFailure("TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_UNTRUSTED_OWNER");
  }
  try {
    if (
      !verify(
        null,
        approvalSurfaceQualificationAttestationCanonicalBytes(parsed),
        ownerPublicKey,
        signature
      )
    ) {
      return qualificationFailure("TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_SIGNATURE_INVALID");
    }
  } catch {
    return qualificationFailure("TRUSTED_APPROVAL_QUALIFICATION_ATTESTATION_SIGNATURE_INVALID");
  }
  return ok(Object.freeze(parsed));
}

/** SHA-256 of the approval bundle, excluding the attestation and its signature. */
export function approvalBundleDigest(artifactRows: readonly string[]): string {
  return sha256(Buffer.from([...artifactRows].sort().join("\n"), "utf8"));
}

/** Stable checksum of the complete generated artifact manifest. */
export function approvalArtifactManifestChecksum(manifest: {
  readonly artifacts: BuildManifest["artifacts"];
}): string {
  return sha256(canonicalJsonBytes(manifest.artifacts));
}

/** SHA-256 of the strict attestation payload with its checksum field omitted. */
export function approvalSurfaceQualificationAttestationChecksum(
  value: Omit<TrustedApprovalSurfaceQualificationAttestationV1, "attestationChecksum">
): string {
  const unsigned: Record<string, unknown> = { ...value };
  delete unsigned["attestationChecksum"];
  return sha256(canonicalJsonBytes(unsigned));
}

/** Detached Ed25519 signatures cover the full canonical payload, including its checksum. */
export function approvalSurfaceQualificationAttestationCanonicalBytes(
  value: TrustedApprovalSurfaceQualificationAttestationV1
): Buffer {
  return canonicalJsonBytes(value);
}

/**
 * Minimal JCS-compatible canonical JSON for this strict JSON-only schema.
 * The attestation contains strings only; rejecting unsupported values keeps a
 * signing input from acquiring accidental coercions or implementation-specific
 * serialization semantics.
 */
export function canonicalJsonBytes(value: unknown): Buffer {
  return Buffer.from(canonicalJson(value), "utf8");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("APPROVAL_QUALIFICATION_CANONICAL_JSON_INVALID");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("APPROVAL_QUALIFICATION_CANONICAL_JSON_INVALID");
}

export function createApprovalSurfaceQualificationProvider(
  options: ApprovalSurfaceQualificationOptions
): ApprovalSurfaceQualificationProvider {
  let current: TrustedApprovalSurfaceQualificationV1 | undefined;
  return {
    refresh: async () => {
      const loaded = await loadApprovalSurfaceQualification(options);
      current = loaded.ok ? loaded.value : undefined;
      return loaded;
    },
    get: () => current
  };
}

/** Prevents a Renderer/provider clone from being treated as app-owned qualification. */
export function isMainOwnedApprovalSurfaceQualification(
  value: unknown
): value is TrustedApprovalSurfaceQualificationV1 {
  return typeof value === "object" && value !== null && MAIN_OWNED.has(value);
}

function isManifest(value: unknown): value is BuildManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate["schemaVersion"] === "1.0" &&
    typeof candidate["sourceRevision"] === "string" &&
    SOURCE_REVISION.test(candidate["sourceRevision"]) &&
    typeof candidate["sourceDirty"] === "boolean" &&
    typeof candidate["artifacts"] === "object" &&
    candidate["artifacts"] !== null
  );
}

function isApprovalSurfaceQualificationAttestation(
  value: unknown
): value is TrustedApprovalSurfaceQualificationAttestationV1 {
  if (!hasExactKeys(value, approvalSurfaceQualificationAttestationKeys)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate["schemaVersion"] !== "1.0" ||
    candidate["authority"] !== "security_architecture_owner" ||
    !isStableId(candidate["qualificationRevision"]) ||
    !isSourceRevision(candidate["sourceRevision"]) ||
    !isHash(candidate["approvalBundleDigest"]) ||
    !isHash(candidate["approvalArtifactManifestChecksum"]) ||
    !isStableId(candidate["qualificationMatrixRevision"]) ||
    !isHash(candidate["qualificationMatrixChecksum"]) ||
    !isHash(candidate["automatedReportChecksum"]) ||
    !isStableId(candidate["ownerApprovalId"]) ||
    !isStableId(candidate["ownerKeyId"]) ||
    !isCanonicalUtcTimestamp(candidate["issuedAt"]) ||
    !isCanonicalUtcTimestamp(candidate["expiresAt"]) ||
    !isHash(candidate["attestationChecksum"])
  ) {
    return false;
  }
  const issuedAt = Date.parse(candidate["issuedAt"] as string);
  const expiresAt = Date.parse(candidate["expiresAt"] as string);
  return expiresAt > issuedAt && expiresAt - issuedAt <= MAX_QUALIFICATION_VALIDITY_MS;
}

const approvalSurfaceQualificationAttestationKeys = [
  "schemaVersion",
  "authority",
  "qualificationRevision",
  "sourceRevision",
  "approvalBundleDigest",
  "approvalArtifactManifestChecksum",
  "qualificationMatrixRevision",
  "qualificationMatrixChecksum",
  "automatedReportChecksum",
  "ownerApprovalId",
  "ownerKeyId",
  "issuedAt",
  "expiresAt",
  "attestationChecksum"
] as const;

function hasExactKeys(
  value: unknown,
  expected: readonly string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

function isSourceRevision(value: unknown): value is string {
  return typeof value === "string" && SOURCE_REVISION.test(value);
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && STABLE_ID.test(value);
}

function isCanonicalUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_UTC_TIMESTAMP.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function qualificationFailure(code: string): Result<never, UnifiedError> {
  return err(
    createUnifiedError({
      code,
      category: "AgentError",
      message: "The Main-owned approval surface is not qualified.",
      recoverability: "user-action",
      suggestedAction: "Use a clean, signed packaged build.",
      traceId: "desktop-approval-surface-qualification"
    })
  );
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export { REQUIRED_ARTIFACTS };
export {
  APPROVAL_SURFACE_QUALIFICATION_ATTESTATION_PATH,
  APPROVAL_SURFACE_QUALIFICATION_SIGNATURE_PATH,
  APPROVAL_SURFACE_QUALIFICATION_ARTIFACTS,
  REQUIRED_PACKAGE_ARTIFACTS,
  APPROVAL_SURFACE_QUALIFICATION_MATRIX_V1,
  APPROVAL_SURFACE_QUALIFICATION_MATRIX_CHECKSUM,
  PINNED_PRODUCTION_APPROVAL_SURFACE_OWNER_KEYS
};
