import { createRequire } from "node:module";

import { ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT } from "./engineering-file-access-qualification.js";

/** The entire B6 native call surface. Later mutation and recovery batches are intentionally absent. */
export const ENGINEERING_WORKSPACE_ACCESS_OPERATIONS = Object.freeze([
  "list",
  "read",
  "search",
  "index"
] as const);

export type EngineeringWorkspaceAccessOperation =
  (typeof ENGINEERING_WORKSPACE_ACCESS_OPERATIONS)[number];

export type EngineeringFileAccessAddonUnavailableReason =
  "native_module_load_failed" | "native_module_invalid";

export interface EngineeringFileAccessAddonMetadata {
  readonly adapterId: "novel_studio_engineering_file_access";
  readonly target: "win32-x64";
  readonly batch: "6";
  readonly accessEligible: "available" | "unavailable";
  readonly mutation: "unavailable";
  readonly recovery: "unavailable";
}

export interface EngineeringFileAccessAddon {
  /**
   * The only ABI surface B6 validates. Access method signatures remain private to the native
   * adapter until the repository access-port contract is wired in a later task.
   */
  readonly adapterInfo: () => unknown;
}

export type EngineeringFileAccessAddonLoadResult =
  | {
      readonly status: "loaded";
      readonly addon: EngineeringFileAccessAddon;
      readonly metadata: EngineeringFileAccessAddonMetadata;
    }
  | {
      readonly status: "unavailable";
      readonly reason: EngineeringFileAccessAddonUnavailableReason;
    };

export interface EngineeringFileAccessAddonLoader {
  /** A one-shot Main-owned load. This is deliberately not callable over IPC. */
  load(): EngineeringFileAccessAddonLoadResult;
}

export type EngineeringWorkspaceAccessPortUnavailableReason =
  | "operation_not_available_in_batch_6"
  | "native_addon_unavailable"
  | "production_wiring_not_enabled";

export interface EngineeringWorkspaceAccessPortResult {
  readonly status: "unavailable";
  readonly operation: string;
  readonly reason: EngineeringWorkspaceAccessPortUnavailableReason;
}

/**
 * The narrow B6 access port. It deliberately has no mutation, recovery, or directory-creation
 * method, and it never invokes a native access method before that ABI is contractually published.
 */
export interface EngineeringWorkspaceAccessPort {
  readonly operations: readonly EngineeringWorkspaceAccessOperation[];
  request(operation: string): EngineeringWorkspaceAccessPortResult;
}

/**
 * Uses the sole ADR-0003 addon path. The injectable module loader exists only for Main composition
 * and unit tests; it does not introduce a second host, build path, or capability authority.
 */
export function createEngineeringFileAccessAddonLoader(options?: {
  readonly addonPath?: string;
  readonly loadModule?: (path: string) => unknown;
}): EngineeringFileAccessAddonLoader {
  const addonPath =
    options?.addonPath ?? ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.candidateArtifact;
  const loadModule = options?.loadModule ?? createRequire(import.meta.url);
  let cached: EngineeringFileAccessAddonLoadResult | undefined;

  return Object.freeze({
    load() {
      cached ??= loadEngineeringFileAccessAddon(loadModule, addonPath);
      return cached;
    }
  });
}

export function createEngineeringWorkspaceAccessPort(options: {
  readonly addonLoader: EngineeringFileAccessAddonLoader;
}): EngineeringWorkspaceAccessPort {
  return Object.freeze({
    operations: ENGINEERING_WORKSPACE_ACCESS_OPERATIONS,
    request(operation: string): EngineeringWorkspaceAccessPortResult {
      if (!isEngineeringWorkspaceAccessOperation(operation)) {
        return portUnavailable(operation, "operation_not_available_in_batch_6");
      }
      const loaded = options.addonLoader.load();
      if (loaded.status !== "loaded") return portUnavailable(operation, "native_addon_unavailable");

      // Loading and validating addon metadata is not production authorization and does not expose
      // an access ABI. The future repository port is the sole place that may add that delegation.
      return portUnavailable(operation, "production_wiring_not_enabled");
    }
  });
}

export function isEngineeringWorkspaceAccessOperation(
  value: string
): value is EngineeringWorkspaceAccessOperation {
  return ENGINEERING_WORKSPACE_ACCESS_OPERATIONS.some((operation) => operation === value);
}

function loadEngineeringFileAccessAddon(
  loadModule: (path: string) => unknown,
  addonPath: string
): EngineeringFileAccessAddonLoadResult {
  let candidate: unknown;
  try {
    candidate = loadModule(addonPath);
  } catch {
    return unavailable("native_module_load_failed");
  }
  if (!isEngineeringFileAccessAddon(candidate)) return unavailable("native_module_invalid");

  let metadata: unknown;
  try {
    metadata = candidate.adapterInfo();
  } catch {
    return unavailable("native_module_invalid");
  }
  if (!isEngineeringFileAccessAddonMetadata(metadata)) return unavailable("native_module_invalid");

  return Object.freeze({ status: "loaded" as const, addon: candidate, metadata });
}

function unavailable(
  reason: EngineeringFileAccessAddonUnavailableReason
): EngineeringFileAccessAddonLoadResult {
  return Object.freeze({ status: "unavailable" as const, reason });
}

function portUnavailable(
  operation: string,
  reason: EngineeringWorkspaceAccessPortUnavailableReason
): EngineeringWorkspaceAccessPortResult {
  return Object.freeze({ status: "unavailable" as const, operation, reason });
}

function isEngineeringFileAccessAddon(value: unknown): value is EngineeringFileAccessAddon {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>)["adapterInfo"] === "function"
  );
}

function isEngineeringFileAccessAddonMetadata(
  value: unknown
): value is EngineeringFileAccessAddonMetadata {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const expectedKeys = ["accessEligible", "adapterId", "batch", "mutation", "recovery", "target"];
  const keys = Object.keys(record).sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    record["adapterId"] === "novel_studio_engineering_file_access" &&
    record["target"] === "win32-x64" &&
    record["batch"] === "6" &&
    (record["accessEligible"] === "available" || record["accessEligible"] === "unavailable") &&
    record["mutation"] === "unavailable" &&
    record["recovery"] === "unavailable"
  );
}
