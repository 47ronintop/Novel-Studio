import type { EngineeringFileQualificationAttestationV1 } from "@novel-studio/agent-engine";

import {
  hasMainOwnedEngineeringFileQualification,
  mainOwnedEngineeringFileQualificationRevision
} from "./engineering-file-access-qualification.js";
import {
  CREATIVE_FILE_OPERATIONS,
  hasMainOwnedCreativeFileOperationQualification,
  hasMainOwnedUnsignedBetaCreativeFileOperationQualification,
  creativeFileOperationQualificationRevision,
  type CreativeFileOperation,
  type CreativeFileOperationQualificationV1
} from "./creative-file-operation-qualification.js";
import { isMainOwnedApprovalSurfaceQualification } from "./approval-surface-qualification.js";
import type { TrustedApprovalSurfaceQualificationV1 } from "./agent-approval-confirmation.js";
import type { EngineeringFileCapabilityAuthority } from "./engineering-file-capability-authority.js";

/**
 * Main-owned feature flags for the Agent capabilities that remain in product scope.
 * The renderer only reads the resolved effective state.
 */

export interface AgentFeatureFlags {
  /** Main-owned, explicitly authorized unsigned beta creative channel. */
  readonly unsignedBetaCreativeFileOperations: boolean;
  /** Guidance Registry/System Guidance 3.0; default off until its protocol dependencies ship. */
  readonly agentGuidanceV3: boolean;
  /** Phase A: search_project_text + find_project_references */
  readonly phaseA_searchEnabled: boolean;
  /** Phase B: file lifecycle (create/move/delete/mkdir) + Change Set v1.1 */
  readonly phaseB_fileLifecycleEnabled: boolean;
  /** Catalog 2.0 writing-domain mutations; each operation still requires its concrete backend. */
  readonly writingDomainCrudV2: boolean;
  /** Qualified existing-file replacement for creative_general. */
  readonly creativeTrustedReplaceV2: boolean;
  readonly creativeFileCreateV2: boolean;
  readonly creativeFileMoveV2: boolean;
  readonly creativeFileDeleteV2: boolean;
  readonly creativeDirectoryCreateV2: boolean;
  /** Main-owned Change Set 2.0 approval binding and confirmation boundary. */
  readonly approvalBindingV2: boolean;
  /** Phase D: web_search + fetch_url */
  readonly phaseD_networkReadEnabled: boolean;
  /** Phase E: remote MCP (requires phaseD network gate) */
  readonly phaseE_remoteMcpEnabled: boolean;
  /** Root-handle engineering list/read/search/index; unavailable without Main-owned qualification. */
  readonly engineeringHardenedAccessV1: boolean;
  readonly engineeringReplaceV2: boolean;
  readonly engineeringCreateV2: boolean;
  readonly engineeringMoveV2: boolean;
  readonly engineeringDeleteV2: boolean;
  readonly engineeringDirectoryCreateV1: boolean;
  /**
   * Monotonically-increasing revision string.
   * Must change when any flag changes so Permission Summary drift detection catches it.
   */
  readonly revision: string;
}

/** Default flags keep every optional capability off. */
export const DEFAULT_AGENT_FEATURE_FLAGS: AgentFeatureFlags = Object.freeze<AgentFeatureFlags>({
  unsignedBetaCreativeFileOperations: false,
  agentGuidanceV3: false,
  phaseA_searchEnabled: false,
  phaseB_fileLifecycleEnabled: false,
  writingDomainCrudV2: false,
  creativeTrustedReplaceV2: false,
  creativeFileCreateV2: false,
  creativeFileMoveV2: false,
  creativeFileDeleteV2: false,
  creativeDirectoryCreateV2: false,
  approvalBindingV2: false,
  phaseD_networkReadEnabled: false,
  phaseE_remoteMcpEnabled: false,
  engineeringHardenedAccessV1: false,
  engineeringReplaceV2: false,
  engineeringCreateV2: false,
  engineeringMoveV2: false,
  engineeringDeleteV2: false,
  engineeringDirectoryCreateV1: false,
  revision: "v1.0-default"
});

export function createAgentFeatureFlags(
  overrides?: Partial<AgentFeatureFlags>,
  engineeringQualification?: EngineeringFileQualificationAttestationV1,
  observedAt: string = new Date().toISOString()
): AgentFeatureFlags {
  if (overrides === undefined) return DEFAULT_AGENT_FEATURE_FLAGS;
  const merged = { ...DEFAULT_AGENT_FEATURE_FLAGS, ...overrides };
  const approvalBindingV2 = merged.agentGuidanceV3 && merged.approvalBindingV2;
  const creativeMutationAuthority = approvalBindingV2 || merged.unsignedBetaCreativeFileOperations;
  const engineeringRequested =
    merged.engineeringHardenedAccessV1 ||
    merged.engineeringReplaceV2 ||
    merged.engineeringCreateV2 ||
    merged.engineeringMoveV2 ||
    merged.engineeringDeleteV2 ||
    merged.engineeringDirectoryCreateV1;
  const accessEnabled =
    merged.engineeringHardenedAccessV1 &&
    hasMainOwnedEngineeringFileQualification(engineeringQualification, "root", observedAt) &&
    hasMainOwnedEngineeringFileQualification(engineeringQualification, "access", observedAt);
  const mutationEnabled =
    accessEnabled &&
    hasMainOwnedEngineeringFileQualification(engineeringQualification, "mutation", observedAt);
  const recoveryEnabled =
    mutationEnabled &&
    hasMainOwnedEngineeringFileQualification(engineeringQualification, "recovery", observedAt);
  const flags: AgentFeatureFlags = {
    ...merged,
    approvalBindingV2,
    writingDomainCrudV2: approvalBindingV2 && merged.writingDomainCrudV2,
    creativeTrustedReplaceV2: creativeMutationAuthority && merged.creativeTrustedReplaceV2,
    creativeFileCreateV2: creativeMutationAuthority && merged.creativeFileCreateV2,
    creativeFileMoveV2: creativeMutationAuthority && merged.creativeFileMoveV2,
    creativeFileDeleteV2: approvalBindingV2 && merged.creativeFileDeleteV2,
    creativeDirectoryCreateV2: creativeMutationAuthority && merged.creativeDirectoryCreateV2,
    phaseE_remoteMcpEnabled: merged.phaseE_remoteMcpEnabled && merged.phaseD_networkReadEnabled,
    engineeringHardenedAccessV1: accessEnabled,
    engineeringReplaceV2: approvalBindingV2 && merged.engineeringReplaceV2 && recoveryEnabled,
    engineeringCreateV2: approvalBindingV2 && merged.engineeringCreateV2 && recoveryEnabled,
    engineeringMoveV2: approvalBindingV2 && merged.engineeringMoveV2 && mutationEnabled,
    engineeringDeleteV2: approvalBindingV2 && merged.engineeringDeleteV2 && recoveryEnabled,
    engineeringDirectoryCreateV1:
      approvalBindingV2 && merged.engineeringDirectoryCreateV1 && mutationEnabled,
    revision: engineeringRequested
      ? `${merged.revision}:engineering-native:${mainOwnedEngineeringFileQualificationRevision(
          engineeringQualification,
          observedAt
        )}`
      : merged.revision
  };
  return Object.freeze(flags);
}

/**
 * Production-only resolver. Unlike the lower-level flag normalizer, it refuses a plain object
 * or a port's presence as approval evidence: only the verifier's Main-owned object can enable
 * V2 mutation capabilities.
 */
export function createProductionAgentFeatureFlags(
  overrides: Partial<AgentFeatureFlags>,
  approvalQualification: TrustedApprovalSurfaceQualificationV1 | undefined,
  engineeringQualification?: EngineeringFileQualificationAttestationV1,
  now: () => string = () => new Date().toISOString(),
  creativeQualifications?: Readonly<
    Partial<Record<CreativeFileOperation, CreativeFileOperationQualificationV1>>
  >
): AgentFeatureFlags {
  const observedAt = now();
  const qualified = hasCurrentMainOwnedApprovalSurfaceQualification(
    approvalQualification,
    observedAt
  );
  const creativeQualified = (operation: CreativeFileOperation): boolean =>
    qualified &&
    hasMainOwnedCreativeFileOperationQualification(
      creativeQualifications?.[operation],
      operation,
      observedAt
    );
  const flags = createAgentFeatureFlags(
    {
      ...overrides,
      approvalBindingV2: qualified && overrides.approvalBindingV2 === true,
      writingDomainCrudV2: qualified && overrides.writingDomainCrudV2 === true,
      creativeTrustedReplaceV2:
        creativeQualified("replace_file") && overrides.creativeTrustedReplaceV2 === true,
      creativeFileCreateV2:
        creativeQualified("create_file") && overrides.creativeFileCreateV2 === true,
      creativeFileMoveV2: creativeQualified("move_file") && overrides.creativeFileMoveV2 === true,
      creativeFileDeleteV2:
        creativeQualified("delete_file") && overrides.creativeFileDeleteV2 === true,
      creativeDirectoryCreateV2:
        creativeQualified("create_directory") && overrides.creativeDirectoryCreateV2 === true
    },
    engineeringQualification,
    observedAt
  );
  const creativeRevision =
    creativeQualifications === undefined
      ? ""
      : `:creative-qualification:${creativeQualificationRevision(creativeQualifications)}`;
  return Object.freeze({
    ...flags,
    revision: `${flags.revision}:approval-surface:${
      qualified ? approvalQualification.attestationChecksum : "unavailable"
    }${creativeRevision}`
  });
}

/**
 * Resolves the deliberately narrower unsigned beta channel. Its Main-owned V2 confirmation port
 * is not production qualification and cannot satisfy the signed stable release gate.
 */
export function createUnsignedBetaAgentFeatureFlags(
  creativeQualifications:
    | Readonly<Partial<Record<CreativeFileOperation, CreativeFileOperationQualificationV1>>>
    | undefined,
  authorized: boolean,
  approvalPortAvailable: boolean,
  now: string = new Date().toISOString()
): AgentFeatureFlags {
  const mutationAuthority = authorized && approvalPortAvailable;
  const qualified = (operation: CreativeFileOperation): boolean =>
    mutationAuthority &&
    (operation === "replace_file" ||
      operation === "create_file" ||
      operation === "move_file" ||
      operation === "delete_file" ||
      operation === "create_directory") &&
    hasMainOwnedUnsignedBetaCreativeFileOperationQualification(
      creativeQualifications?.[operation],
      operation,
      now
    );
  const hasQualifiedMutation =
    qualified("replace_file") ||
    qualified("create_file") ||
    qualified("move_file") ||
    qualified("delete_file") ||
    qualified("create_directory");
  const flags = createAgentFeatureFlags({
    agentGuidanceV3: hasQualifiedMutation,
    unsignedBetaCreativeFileOperations: mutationAuthority,
    creativeTrustedReplaceV2: qualified("replace_file"),
    creativeFileCreateV2: qualified("create_file"),
    creativeFileMoveV2: qualified("move_file"),
    creativeFileDeleteV2: qualified("delete_file"),
    creativeDirectoryCreateV2: qualified("create_directory"),
    approvalBindingV2: hasQualifiedMutation,
    revision: `desktop-main:unsigned-beta:${mutationAuthority ? "authorized" : "unavailable"}`
  });
  return Object.freeze({
    ...flags,
    revision: `${flags.revision}:creative-qualification:${creativeQualificationRevision(
      creativeQualifications
    )}`
  });
}

/** Resolves the engineering workspace's explicit unsigned-beta channel without creating a
 * production qualification attestation or weakening the signed release resolver. */
export async function createUnsignedBetaEngineeringAgentFeatureFlags(input: {
  readonly authorized: boolean;
  readonly approvalBindingAvailable: boolean;
  readonly capabilityAuthority: EngineeringFileCapabilityAuthority;
  readonly mutationBackendAvailable: boolean;
  readonly lifecycleCapabilities?: Readonly<{
    readonly move: boolean;
    readonly delete: boolean;
    readonly createDirectory: boolean;
  }>;
}): Promise<AgentFeatureFlags> {
  const [root, access, mutation, recovery] = await Promise.all([
    input.capabilityAuthority.hasCapability("root"),
    input.capabilityAuthority.hasCapability("access"),
    input.capabilityAuthority.hasCapability("mutation"),
    input.capabilityAuthority.hasCapability("recovery")
  ]).catch(() => [false, false, false, false] as const);
  const accessEnabled = input.authorized && input.approvalBindingAvailable && root && access;
  const mutationEnabled = accessEnabled && input.mutationBackendAvailable && mutation && recovery;
  const flags = createAgentFeatureFlags({
    agentGuidanceV3: accessEnabled,
    phaseA_searchEnabled: accessEnabled,
    approvalBindingV2: input.authorized && input.approvalBindingAvailable,
    engineeringHardenedAccessV1: accessEnabled,
    engineeringReplaceV2: mutationEnabled,
    engineeringCreateV2: mutationEnabled,
    engineeringMoveV2: mutationEnabled && input.lifecycleCapabilities?.move === true,
    engineeringDeleteV2: mutationEnabled && input.lifecycleCapabilities?.delete === true,
    engineeringDirectoryCreateV1:
      mutationEnabled && input.lifecycleCapabilities?.createDirectory === true,
    revision: `desktop-main:unsigned-beta-engineering:${
      input.authorized ? "authorized" : "unavailable"
    }`
  });
  return Object.freeze({
    ...flags,
    engineeringHardenedAccessV1: accessEnabled,
    engineeringReplaceV2: mutationEnabled,
    engineeringCreateV2: mutationEnabled,
    engineeringMoveV2: mutationEnabled && input.lifecycleCapabilities?.move === true,
    engineeringDeleteV2: mutationEnabled && input.lifecycleCapabilities?.delete === true,
    engineeringDirectoryCreateV1:
      mutationEnabled && input.lifecycleCapabilities?.createDirectory === true,
    revision: `${flags.revision}:native-${mutationEnabled ? "available" : "unavailable"}`
  });
}

function creativeQualificationRevision(
  qualifications:
    | Readonly<Partial<Record<CreativeFileOperation, CreativeFileOperationQualificationV1>>>
    | undefined
): string {
  if (qualifications === undefined) return "unavailable";
  return CREATIVE_FILE_OPERATIONS.map((operation) =>
    creativeFileOperationQualificationRevision(qualifications[operation])
  ).join(".");
}

/** Main-only production gate used both by capability resolution and runtime activation. */
export function hasCurrentMainOwnedApprovalSurfaceQualification(
  value: unknown,
  now: string = new Date().toISOString()
): value is TrustedApprovalSurfaceQualificationV1 {
  if (!isMainOwnedApprovalSurfaceQualification(value)) return false;
  const observedAt = Date.parse(now);
  const issuedAt = Date.parse(value.issuedAt);
  const expiresAt = Date.parse(value.expiresAt);
  return (
    Number.isFinite(observedAt) &&
    Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    issuedAt <= observedAt &&
    observedAt < expiresAt
  );
}
