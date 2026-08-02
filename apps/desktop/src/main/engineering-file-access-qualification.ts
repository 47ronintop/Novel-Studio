import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createUnavailableEngineeringFileQualificationAttestation,
  validateEngineeringFileQualificationAttestation,
  type EngineeringFileQualificationAttestationV1,
  type EngineeringFileQualificationCapability,
  type EngineeringFileQualificationFailureReason
} from "@novel-studio/agent-engine";

const candidateFiles = [
  "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.node",
  "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.json",
  "native/engineering-file-access-win32/dist/win32-x64/engineering_file_access.manifest.p7s"
] as const;

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

export interface EngineeringFileAccessQualificationService {
  /** One-shot, cached Main-owned observation. There is deliberately no Renderer refresh method. */
  readAttestation(): Promise<EngineeringFileQualificationAttestationV1>;
}

const mainOwnedAttestations = new WeakSet<object>();

export function createEngineeringFileAccessQualificationService(options: {
  readonly packageKind: "development" | "production";
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly now?: () => string;
  /** Main composition/test seam only. It is never populated from IPC, a project, or model output. */
  readonly candidateInspector?: EngineeringFileCandidateInspector;
}): EngineeringFileAccessQualificationService {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = `${platform}-${arch}`;
  const now = options.now ?? (() => new Date().toISOString());
  const inspector = options.candidateInspector ?? createCandidateInspector(options.packageKind);
  let cached: Promise<EngineeringFileQualificationAttestationV1> | undefined;

  return Object.freeze({
    readAttestation() {
      cached ??= observeUnavailableAttestation({
        target,
        packageKind: options.packageKind,
        checkedAt: now(),
        inspector
      }).then(registerMainOwnedAttestation);
      return cached;
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
  capability: EngineeringFileQualificationCapability
): boolean {
  return (
    isMainOwnedEngineeringFileQualificationAttestation(value) &&
    value.status === "available" &&
    value.productionQualified &&
    value.capabilities[capability] === "available"
  );
}

export function mainOwnedEngineeringFileQualificationRevision(value: unknown): string {
  return isMainOwnedEngineeringFileQualificationAttestation(value)
    ? value.attestationChecksum
    : "unavailable";
}

async function observeUnavailableAttestation(input: {
  readonly target: string;
  readonly packageKind: "development" | "production";
  readonly checkedAt: string;
  readonly inspector: EngineeringFileCandidateInspector;
}): Promise<EngineeringFileQualificationAttestationV1> {
  if (input.target !== ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.supportedTarget) {
    return unavailable(input, false, ["unsupported_platform", "adapter_not_implemented_batch_0"]);
  }
  try {
    const state = await input.inspector.inspect();
    switch (state) {
      case "missing":
        return unavailable(input, false, ["host_missing", "adapter_not_implemented_batch_0"]);
      case "partial":
        return unavailable(input, true, ["host_partial", "adapter_not_implemented_batch_0"]);
      case "present":
        return unavailable(input, true, [
          "candidate_unqualified",
          "adapter_not_implemented_batch_0"
        ]);
      case "unknown":
        return unavailable(input, false, ["evidence_unknown", "adapter_not_implemented_batch_0"]);
    }
  } catch {
    return unavailable(input, false, ["probe_error", "adapter_not_implemented_batch_0"]);
  }
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

function createCandidateInspector(
  packageKind: "development" | "production"
): EngineeringFileCandidateInspector {
  const basePath = candidateBasePath(packageKind);
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

function candidateBasePath(packageKind: "development" | "production"): string {
  if (packageKind === "production") {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath !== undefined) return join(resourcesPath, "app.asar.unpacked");
  }
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
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
