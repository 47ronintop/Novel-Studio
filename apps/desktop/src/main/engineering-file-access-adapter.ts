import { createRequire } from "node:module";
import { isAbsolute, join, relative } from "node:path";

import type {
  EngineeringStateDirectoryEntryV2,
  EngineeringStateDurabilityPortV2,
  EngineeringStateFileHandleV2
} from "@novel-studio/repository";

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

interface EngineeringFileAccessAddonMetadataBase {
  readonly adapterId: "novel_studio_engineering_file_access";
  readonly target: "win32-x64";
  readonly accessEligible: "available" | "unavailable";
}

export type EngineeringFileAccessAddonMetadata =
  | (EngineeringFileAccessAddonMetadataBase & {
      readonly batch: "6";
      readonly mutation: "unavailable";
      readonly recovery: "unavailable";
    })
  | (EngineeringFileAccessAddonMetadataBase & {
      readonly batch: "7";
      readonly mutation: "available";
      readonly recovery: "available";
      readonly mutationV2Probe: "available";
      readonly recoveryScanProbe: "available";
      readonly stateDurabilityProbe: "available";
    })
  | (EngineeringFileAccessAddonMetadataBase & {
      /** B8 exposes additional probe-only primitives; production authorization remains external. */
      readonly batch: "8";
      readonly mutation: "available";
      readonly recovery: "available";
      readonly mutationV2Probe: "available";
      readonly recoveryScanProbe: "available";
      readonly stateDurabilityProbe: "available";
    });

export interface EngineeringFileAccessAddon {
  readonly adapterInfo: () => unknown;
  readonly openWorkspaceRoot: (rootPath: string) => unknown;
  readonly closeWorkspaceRoot: (rootId: bigint) => unknown;
  readonly listDirectory: (rootId: bigint, relativePath?: string) => unknown;
  readonly readFile: (rootId: bigint, relativePath: string) => unknown;
  readonly searchText: (rootId: bigint, query: string) => unknown;
  readonly buildIndex: (rootId: bigint) => unknown;
}

interface EngineeringStateDurabilityAddon extends EngineeringFileAccessAddon {
  readonly openEngineeringStateRoot: (stateRoot: string) => unknown;
  readonly closeEngineeringStateRoot: (stateRootId: bigint) => unknown;
  readonly ensureEngineeringStateDirectoryNoFollow: (
    stateRootId: bigint,
    relativePath: string
  ) => unknown;
  readonly flushEngineeringStateDirectory: (stateRootId: bigint, relativePath: string) => unknown;
  readonly openEngineeringStateExclusiveNoFollow: (
    stateRootId: bigint,
    relativePath: string
  ) => unknown;
  readonly writeEngineeringStateFile: (fileId: bigint, bytes: Uint8Array) => unknown;
  readonly syncEngineeringStateFile: (fileId: bigint) => unknown;
  readonly closeEngineeringStateFile: (fileId: bigint) => unknown;
  readonly readEngineeringStateFileNoFollow: (stateRootId: bigint, relativePath: string) => unknown;
  readonly readEngineeringStateDirectoryNoFollow: (
    stateRootId: bigint,
    relativePath: string
  ) => unknown;
  readonly linkEngineeringStateFileNoFollow: (
    stateRootId: bigint,
    existingRelativePath: string,
    newRelativePath: string
  ) => unknown;
  readonly renameReplaceEngineeringStateFileNoFollow: (
    stateRootId: bigint,
    oldRelativePath: string,
    newRelativePath: string
  ) => unknown;
  readonly unlinkEngineeringStateFileNoFollow: (
    stateRootId: bigint,
    relativePath: string
  ) => unknown;
}

/** Main-owned lifetime handle for the native state-root descriptor. */
export interface EngineeringStateDurabilityPortV2Handle extends EngineeringStateDurabilityPortV2 {
  /** Releases the native state-root descriptor. Safe to call repeatedly, including after a throw. */
  dispose(): void;
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
  const addonPath = options?.addonPath ?? resolveEngineeringFileAccessAddonPath();
  const loadModule = options?.loadModule ?? createRequire(import.meta.url);
  let cached: EngineeringFileAccessAddonLoadResult | undefined;

  return Object.freeze({
    load() {
      cached ??= loadEngineeringFileAccessAddon(loadModule, addonPath);
      return cached;
    }
  });
}

/**
 * Development/probe builds use the source-tree artifact; packaged production builds load the
 * same artifact from Electron's asar-unpacked location. This selects a path only after Main's
 * separate qualification service has accepted the installed artifact set.
 */
export function resolveEngineeringFileAccessAddonPath(
  resourcesPath: string | undefined = (
    process as NodeJS.Process & { readonly resourcesPath?: string }
  ).resourcesPath
): string {
  if (resourcesPath === undefined) {
    return ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.candidateArtifact;
  }
  return join(
    resourcesPath,
    "app.asar.unpacked",
    ...ENGINEERING_FILE_ACCESS_PACKAGING_CONTRACT.candidateArtifact.split("/")
  );
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

/**
 * Main-only adapter for app-state persistence. It is intentionally not part of the workspace
 * access port and receives only paths proven lexically beneath Main's selected state root.
 * Returning undefined leaves Repository's durability seam unqualified and therefore fail-closed.
 */
export function createEngineeringStateDurabilityPortV2(options: {
  readonly stateRoot: string;
  readonly addonLoader: EngineeringFileAccessAddonLoader;
}): EngineeringStateDurabilityPortV2Handle | undefined {
  if (!isAbsolute(options.stateRoot)) return undefined;
  const loaded = options.addonLoader.load();
  if (loaded.status !== "loaded" || !isEngineeringStateDurabilityAddon(loaded.addon))
    return undefined;
  const addon = loaded.addon;

  let stateRootId: bigint;
  try {
    const opened = addon.openEngineeringStateRoot(options.stateRoot);
    if (typeof opened !== "bigint") return undefined;
    stateRootId = opened;
  } catch {
    return undefined;
  }

  const toRelative = (path: string, allowRoot: boolean): string => {
    if (!isAbsolute(path)) throw new Error("Engineering state path must be absolute.");
    const candidate = relative(options.stateRoot, path).replaceAll("\\", "/");
    if (candidate === "") {
      if (allowRoot) return candidate;
      throw new Error("Engineering state file path cannot be the state root.");
    }
    if (isAbsolute(candidate) || candidate === ".." || candidate.startsWith("../")) {
      throw new Error("Engineering state path escapes the Main-owned state root.");
    }
    return candidate;
  };
  const call = async (operation: () => unknown): Promise<void> => {
    try {
      await Promise.resolve(operation());
    } catch (cause) {
      throw normalizeEngineeringStateNativeError(cause);
    }
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    // Mark this descriptor unavailable before crossing the native boundary so a throwing close
    // cannot cause a second close attempt during later Main shutdown cleanup.
    disposed = true;
    addon.closeEngineeringStateRoot(stateRootId);
  };

  const durability: EngineeringStateDurabilityPortV2Handle = {
    qualification: "qualified" as const,
    ensureDirectoryNoFollow: (path) =>
      call(() =>
        addon.ensureEngineeringStateDirectoryNoFollow(stateRootId, toRelative(path, true))
      ),
    flushDirectory: (path) =>
      call(() => addon.flushEngineeringStateDirectory(stateRootId, toRelative(path, true))),
    openExclusiveNoFollow: async (path): Promise<EngineeringStateFileHandleV2> => {
      let fileId: unknown;
      try {
        fileId = await Promise.resolve(
          addon.openEngineeringStateExclusiveNoFollow(stateRootId, toRelative(path, false))
        );
      } catch (cause) {
        throw normalizeEngineeringStateNativeError(cause);
      }
      if (typeof fileId !== "bigint") throw new Error("Engineering state file handle is invalid.");
      let closed = false;
      return Object.freeze({
        writeFile: async (bytes: Uint8Array) => {
          if (closed) throw new Error("Engineering state file handle is closed.");
          await call(() => addon.writeEngineeringStateFile(fileId, bytes));
        },
        sync: async () => {
          if (closed) throw new Error("Engineering state file handle is closed.");
          await call(() => addon.syncEngineeringStateFile(fileId));
        },
        close: async () => {
          if (closed) return;
          closed = true;
          await call(() => addon.closeEngineeringStateFile(fileId));
        }
      });
    },
    readFileNoFollow: async (path) => {
      let bytes: unknown;
      try {
        bytes = await Promise.resolve(
          addon.readEngineeringStateFileNoFollow(stateRootId, toRelative(path, false))
        );
      } catch (cause) {
        throw normalizeEngineeringStateNativeError(cause);
      }
      if (!(bytes instanceof Uint8Array))
        throw new Error("Engineering state read result is invalid.");
      return new Uint8Array(bytes);
    },
    readDirectoryNoFollow: async (path): Promise<readonly EngineeringStateDirectoryEntryV2[]> => {
      let entries: unknown;
      try {
        entries = await Promise.resolve(
          addon.readEngineeringStateDirectoryNoFollow(stateRootId, toRelative(path, true))
        );
      } catch (cause) {
        throw normalizeEngineeringStateNativeError(cause);
      }
      if (!Array.isArray(entries) || !entries.every(isEngineeringStateDirectoryEntry)) {
        throw new Error("Engineering state directory result is invalid.");
      }
      return Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
    },
    linkNoFollow: (existingPath, newPath) =>
      call(() =>
        addon.linkEngineeringStateFileNoFollow(
          stateRootId,
          toRelative(existingPath, false),
          toRelative(newPath, false)
        )
      ),
    renameReplaceNoFollow: (oldPath, newPath) =>
      call(() =>
        addon.renameReplaceEngineeringStateFileNoFollow(
          stateRootId,
          toRelative(oldPath, false),
          toRelative(newPath, false)
        )
      ),
    unlinkNoFollow: (path) =>
      call(() => addon.unlinkEngineeringStateFileNoFollow(stateRootId, toRelative(path, false))),
    dispose
  };
  return Object.freeze(durability);
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
  if (value === null || typeof value !== "object") return false;
  const record = value as unknown as Record<string, unknown>;
  return [
    "adapterInfo",
    "openWorkspaceRoot",
    "closeWorkspaceRoot",
    "listDirectory",
    "readFile",
    "searchText",
    "buildIndex"
  ].every((name) => typeof record[name] === "function");
}

function isEngineeringStateDurabilityAddon(
  value: unknown
): value is EngineeringStateDurabilityAddon {
  if (!isEngineeringFileAccessAddon(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  return [
    "openEngineeringStateRoot",
    "closeEngineeringStateRoot",
    "ensureEngineeringStateDirectoryNoFollow",
    "flushEngineeringStateDirectory",
    "openEngineeringStateExclusiveNoFollow",
    "writeEngineeringStateFile",
    "syncEngineeringStateFile",
    "closeEngineeringStateFile",
    "readEngineeringStateFileNoFollow",
    "readEngineeringStateDirectoryNoFollow",
    "linkEngineeringStateFileNoFollow",
    "renameReplaceEngineeringStateFileNoFollow",
    "unlinkEngineeringStateFileNoFollow"
  ].every((name) => typeof record[name] === "function");
}

function isEngineeringStateDirectoryEntry(
  value: unknown
): value is EngineeringStateDirectoryEntryV2 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    typeof record["name"] === "string" &&
    (record["kind"] === "file" ||
      record["kind"] === "directory" ||
      record["kind"] === "symlink" ||
      record["kind"] === "other")
  );
}

function normalizeEngineeringStateNativeError(cause: unknown): unknown {
  if (cause === null || typeof cause !== "object" || !("code" in cause)) return cause;
  const code = (cause as { readonly code?: unknown }).code;
  if (code === "ENGINEERING_ACCESS_NOT_FOUND") {
    return Object.assign(new Error("Engineering state object is missing."), { code: "ENOENT" });
  }
  if (code === "ENGINEERING_MUTATION_TARGET_ALREADY_EXISTS") {
    return Object.assign(new Error("Engineering state object already exists."), { code: "EEXIST" });
  }
  return cause;
}

function isEngineeringFileAccessAddonMetadata(
  value: unknown
): value is EngineeringFileAccessAddonMetadata {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const expectedKeys =
    record["batch"] === "7" || record["batch"] === "8"
      ? [
          "accessEligible",
          "adapterId",
          "batch",
          "mutation",
          "mutationV2Probe",
          "recovery",
          "recoveryScanProbe",
          "stateDurabilityProbe",
          "target"
        ]
      : ["accessEligible", "adapterId", "batch", "mutation", "recovery", "target"];
  const keys = Object.keys(record).sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    record["adapterId"] === "novel_studio_engineering_file_access" &&
    record["target"] === "win32-x64" &&
    (record["accessEligible"] === "available" || record["accessEligible"] === "unavailable") &&
    ((record["batch"] === "6" &&
      record["mutation"] === "unavailable" &&
      record["recovery"] === "unavailable") ||
      ((record["batch"] === "7" || record["batch"] === "8") &&
        record["mutation"] === "available" &&
        record["recovery"] === "available" &&
        record["mutationV2Probe"] === "available" &&
        record["recoveryScanProbe"] === "available" &&
        record["stateDurabilityProbe"] === "available"))
  );
}
