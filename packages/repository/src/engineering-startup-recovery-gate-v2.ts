import { err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import {
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION,
  canonicalizeEngineeringMutationV2Json,
  sha256EngineeringMutationTextV2
} from "./engineering-file-mutation-port-v2.js";
import {
  createEngineeringRecoveryGateSnapshotV2,
  type EngineeringRecoveryGateReasonV2,
  type EngineeringRecoveryGateSnapshotV2
} from "./engineering-recovery-gate.js";
import { storageError, validationError } from "./errors.js";

/**
 * Startup state is intentionally separate from the root scanner. The root scanner owns V2 WAL,
 * blob, staging, reservation, legacy/recovery, and native-root evidence; this wrapper makes an
 * incomplete startup scan fail closed before any mutation caller can rely on that scanner.
 */
export const ENGINEERING_STARTUP_RECOVERY_GATE_V2_SCHEMA_VERSION =
  ENGINEERING_MUTATION_V2_SCHEMA_VERSION;

export type EngineeringStartupRecoveryGateStatusV2 = "not_started" | "clear" | "blocked";
export type EngineeringStartupRecoveryRootFailureV2 =
  "startup_scan_failed" | "fresh_assertion_failed";

/** Structural port implemented by EngineeringRecoveryGateV2 without a Main/runtime dependency. */
export interface EngineeringStartupRecoveryRootGatePortV2 {
  scanRoot(input: {
    readonly contentRootBindingId: string;
  }): Promise<Result<EngineeringRecoveryGateSnapshotV2, UnifiedError>>;
  assertMutationAllowed(contentRootBindingId: string): Promise<Result<void, UnifiedError>>;
}

export interface EngineeringStartupRecoveryRootSnapshotV2 {
  readonly schemaVersion: typeof ENGINEERING_STARTUP_RECOVERY_GATE_V2_SCHEMA_VERSION;
  readonly contentRootBindingId: string;
  readonly status: "clear" | "blocked";
  /** Exact strict snapshot from the root gate, absent only when its scan failed or was malformed. */
  readonly recoverySnapshot: EngineeringRecoveryGateSnapshotV2 | null;
  readonly startupFailure: EngineeringStartupRecoveryRootFailureV2 | null;
  readonly scannedAt: string;
  readonly capabilityRevision: string;
}

export interface EngineeringStartupRecoveryGateSnapshotV2 {
  readonly schemaVersion: typeof ENGINEERING_STARTUP_RECOVERY_GATE_V2_SCHEMA_VERSION;
  /** Aggregate health only; a blocked root does not make a separately clear root writable. */
  readonly status: EngineeringStartupRecoveryGateStatusV2;
  readonly roots: readonly EngineeringStartupRecoveryRootSnapshotV2[];
  readonly scannedAt: string | null;
  readonly capabilityRevision: string;
}

export interface EngineeringStartupRecoveryGateV2Options {
  readonly rootGate: EngineeringStartupRecoveryRootGatePortV2;
  readonly now?: () => string;
  readonly traceId?: string;
}

export interface EngineeringStartupRecoveryGateV2 {
  /**
   * Replaces any prior startup view. During a scan all roots are treated as unavailable; a
   * superseded caller receives an error rather than publishing stale clear state.
   */
  initialize(
    input: unknown
  ): Promise<Result<EngineeringStartupRecoveryGateSnapshotV2, UnifiedError>>;
  /** Requires a completed clear startup scan and then asks the root gate to scan freshly again. */
  assertMutationAllowed(contentRootBindingId: string): Promise<Result<void, UnifiedError>>;
  snapshot(): EngineeringStartupRecoveryGateSnapshotV2;
  rootSnapshot(contentRootBindingId: string): EngineeringStartupRecoveryRootSnapshotV2 | undefined;
}

/**
 * Main-owned startup coordinator. It has no Renderer/Provider mutation path and no `clear`
 * method: recovery resolution must happen in the dedicated recovery owner before a new scan.
 */
export function createEngineeringStartupRecoveryGateV2(
  options: EngineeringStartupRecoveryGateV2Options
): EngineeringStartupRecoveryGateV2 {
  const now = options.now ?? (() => new Date().toISOString());
  const traceId = options.traceId ?? "engineering-startup-recovery-gate-v2";
  const roots = new Map<string, EngineeringStartupRecoveryRootSnapshotV2>();
  let startupSnapshot = createStartupSnapshot("not_started", [], null);
  let initializing = false;
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();

  async function initialize(
    input: unknown
  ): Promise<Result<EngineeringStartupRecoveryGateSnapshotV2, UnifiedError>> {
    const contentRootBindingIds = parseInitializationInput(input);
    if (contentRootBindingIds === undefined) {
      return invalid("ENGINEERING_STARTUP_RECOVERY_GATE_INPUT_INVALID", traceId);
    }

    const requestGeneration = ++generation;
    // Clear synchronously, before waiting on a previous initializer, so an older clear snapshot
    // cannot authorize a write while a new startup/rescan is in progress.
    roots.clear();
    initializing = true;
    startupSnapshot = createStartupSnapshot("not_started", [], null);

    return serialized(async () => {
      const scannedAt = now();
      if (!isCanonicalTimestamp(scannedAt)) return clockInvalid(traceId);
      const scannedRoots: EngineeringStartupRecoveryRootSnapshotV2[] = [];
      for (const contentRootBindingId of contentRootBindingIds) {
        scannedRoots.push(await scanRoot(contentRootBindingId, scannedAt));
      }
      if (requestGeneration !== generation) return superseded(traceId);

      for (const root of scannedRoots) roots.set(root.contentRootBindingId, root);
      const status = scannedRoots.every((root) => root.status === "clear") ? "clear" : "blocked";
      startupSnapshot = createStartupSnapshot(status, scannedRoots, scannedAt);
      initializing = false;
      return ok(startupSnapshot);
    });
  }

  async function assertMutationAllowed(
    contentRootBindingId: string
  ): Promise<Result<void, UnifiedError>> {
    if (!isStableId(contentRootBindingId)) {
      return invalid("ENGINEERING_STARTUP_RECOVERY_GATE_ROOT_INVALID", traceId);
    }
    const root = roots.get(contentRootBindingId);
    if (initializing || root === undefined) return rootNotScanned(traceId);
    if (root.status !== "clear") return mutationBlocked(root, traceId);

    let fresh: Result<void, UnifiedError>;
    try {
      const result = await options.rootGate.assertMutationAllowed(contentRootBindingId);
      if (!isVoidResult(result))
        throw new Error("ENGINEERING_STARTUP_RECOVERY_GATE_ASSERT_INVALID");
      fresh = result;
    } catch {
      fresh = err(
        storageError({
          code: "ENGINEERING_STARTUP_RECOVERY_GATE_FRESH_ASSERTION_FAILED",
          message: "Engineering recovery could not be freshly revalidated.",
          suggestedAction: "Keep the content root closed and enter recovery review.",
          traceId
        })
      );
    }
    if (fresh.ok) return fresh;

    // The failure may mean a newly-created WAL, a native-root loss, or a failed scanner. Do not
    // retain the older clear snapshot; it remains blocked until the next explicit startup scan.
    const currentTime = now();
    const failedAt = isCanonicalTimestamp(currentTime) ? currentTime : root.scannedAt;
    const failedRoot = createRootSnapshot(
      contentRootBindingId,
      null,
      "fresh_assertion_failed",
      failedAt
    );
    roots.set(contentRootBindingId, failedRoot);
    startupSnapshot = createStartupSnapshot(
      "blocked",
      [...roots.values()],
      startupSnapshot.scannedAt
    );
    return mutationBlocked(failedRoot, traceId);
  }

  function snapshot(): EngineeringStartupRecoveryGateSnapshotV2 {
    return startupSnapshot;
  }

  function rootSnapshot(
    contentRootBindingId: string
  ): EngineeringStartupRecoveryRootSnapshotV2 | undefined {
    return isStableId(contentRootBindingId) ? roots.get(contentRootBindingId) : undefined;
  }

  async function scanRoot(
    contentRootBindingId: string,
    scannedAt: string
  ): Promise<EngineeringStartupRecoveryRootSnapshotV2> {
    try {
      const scanned = await options.rootGate.scanRoot({ contentRootBindingId });
      if (!scanned.ok) {
        return createRootSnapshot(contentRootBindingId, null, "startup_scan_failed", scannedAt);
      }
      const recoverySnapshot = parseStrictRecoverySnapshot(scanned.value, contentRootBindingId);
      return recoverySnapshot === undefined
        ? createRootSnapshot(contentRootBindingId, null, "startup_scan_failed", scannedAt)
        : createRootSnapshot(contentRootBindingId, recoverySnapshot, null, scannedAt);
    } catch {
      return createRootSnapshot(contentRootBindingId, null, "startup_scan_failed", scannedAt);
    }
  }

  async function serialized<T>(
    operation: () => Promise<Result<T, UnifiedError>>
  ): Promise<Result<T, UnifiedError>> {
    const previous = queue;
    let release: (() => void) | undefined;
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }

  return Object.freeze({ initialize, assertMutationAllowed, snapshot, rootSnapshot });
}

function createRootSnapshot(
  contentRootBindingId: string,
  recoverySnapshot: EngineeringRecoveryGateSnapshotV2 | null,
  startupFailure: EngineeringStartupRecoveryRootFailureV2 | null,
  scannedAt: string
): EngineeringStartupRecoveryRootSnapshotV2 {
  if (
    !isStableId(contentRootBindingId) ||
    !isCanonicalTimestamp(scannedAt) ||
    (recoverySnapshot === null && startupFailure === null) ||
    (recoverySnapshot !== null && startupFailure !== null)
  ) {
    throw new Error("ENGINEERING_STARTUP_RECOVERY_GATE_ROOT_SNAPSHOT_INVALID");
  }
  const status: "clear" | "blocked" = recoverySnapshot?.status === "clear" ? "clear" : "blocked";
  const unsigned = {
    schemaVersion: ENGINEERING_STARTUP_RECOVERY_GATE_V2_SCHEMA_VERSION,
    contentRootBindingId,
    status,
    recoverySnapshot,
    startupFailure,
    scannedAt
  };
  return freeze({
    ...unsigned,
    capabilityRevision: sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(unsigned)
    )
  });
}

function createStartupSnapshot(
  status: EngineeringStartupRecoveryGateStatusV2,
  rawRoots: readonly EngineeringStartupRecoveryRootSnapshotV2[],
  scannedAt: string | null
): EngineeringStartupRecoveryGateSnapshotV2 {
  const roots = [...rawRoots].sort((left, right) =>
    left.contentRootBindingId.localeCompare(right.contentRootBindingId)
  );
  if (
    !isStartupStatus(status) ||
    (status === "not_started" && (roots.length !== 0 || scannedAt !== null)) ||
    (status !== "not_started" && !isCanonicalTimestamp(scannedAt)) ||
    new Set(roots.map((root) => root.contentRootBindingId)).size !== roots.length ||
    roots.some((root) => !isStrictRootSnapshot(root)) ||
    (status === "clear" && roots.some((root) => root.status !== "clear")) ||
    (status === "blocked" && roots.every((root) => root.status === "clear"))
  ) {
    throw new Error("ENGINEERING_STARTUP_RECOVERY_GATE_SNAPSHOT_INVALID");
  }
  const unsigned = {
    schemaVersion: ENGINEERING_STARTUP_RECOVERY_GATE_V2_SCHEMA_VERSION,
    status,
    roots,
    scannedAt
  };
  return freeze({
    ...unsigned,
    capabilityRevision: sha256EngineeringMutationTextV2(
      canonicalizeEngineeringMutationV2Json(unsigned)
    )
  });
}

function parseStrictRecoverySnapshot(
  value: unknown,
  contentRootBindingId: string
): EngineeringRecoveryGateSnapshotV2 | undefined {
  if (!hasExactKeys(value, recoverySnapshotKeys)) return undefined;
  if (
    value["schemaVersion"] !== ENGINEERING_MUTATION_V2_SCHEMA_VERSION ||
    value["contentRootBindingId"] !== contentRootBindingId ||
    (value["status"] !== "clear" && value["status"] !== "blocked") ||
    !Array.isArray(value["reasons"]) ||
    value["reasons"].some((reason) => !isRecoveryReason(reason)) ||
    new Set(value["reasons"]).size !== value["reasons"].length ||
    !isSha256(value["capabilityRevision"]) ||
    !isCanonicalTimestamp(value["scannedAt"])
  ) {
    return undefined;
  }
  try {
    const expected = createEngineeringRecoveryGateSnapshotV2({
      contentRootBindingId,
      reasons: value["reasons"] as EngineeringRecoveryGateReasonV2[],
      scannedAt: value["scannedAt"] as string
    });
    return sameCanonicalJson(expected, value) ? expected : undefined;
  } catch {
    return undefined;
  }
}

function isStrictRootSnapshot(value: unknown): value is EngineeringStartupRecoveryRootSnapshotV2 {
  if (!hasExactKeys(value, rootSnapshotKeys)) return false;
  if (
    value["schemaVersion"] !== ENGINEERING_STARTUP_RECOVERY_GATE_V2_SCHEMA_VERSION ||
    !isStableId(value["contentRootBindingId"]) ||
    (value["status"] !== "clear" && value["status"] !== "blocked") ||
    !isCanonicalTimestamp(value["scannedAt"]) ||
    !isSha256(value["capabilityRevision"])
  ) {
    return false;
  }
  let recoverySnapshot: EngineeringRecoveryGateSnapshotV2 | null;
  if (value["recoverySnapshot"] === null) {
    recoverySnapshot = null;
  } else {
    const parsed = parseStrictRecoverySnapshot(
      value["recoverySnapshot"],
      value["contentRootBindingId"]
    );
    if (parsed === undefined) return false;
    recoverySnapshot = parsed;
  }
  const startupFailure = value["startupFailure"];
  let typedStartupFailure: EngineeringStartupRecoveryRootFailureV2 | null;
  if (recoverySnapshot === null) {
    if (!isRootFailure(startupFailure)) return false;
    typedStartupFailure = startupFailure;
  } else {
    if (startupFailure !== null) return false;
    typedStartupFailure = null;
  }
  const expected = createRootSnapshot(
    value["contentRootBindingId"],
    recoverySnapshot,
    typedStartupFailure,
    value["scannedAt"]
  );
  return sameCanonicalJson(expected, value);
}

function parseInitializationInput(value: unknown): readonly string[] | undefined {
  if (
    !hasExactKeys(value, initializationInputKeys) ||
    !Array.isArray(value["contentRootBindingIds"]) ||
    value["contentRootBindingIds"].some((root) => !isStableId(root))
  ) {
    return undefined;
  }
  const roots = [...value["contentRootBindingIds"]] as string[];
  return new Set(roots).size === roots.length ? freeze(roots) : undefined;
}

function isRecoveryReason(value: unknown): value is EngineeringRecoveryGateReasonV2 {
  return (
    value === "root_unavailable" ||
    value === "prepared_transaction" ||
    value === "unknown_record" ||
    value === "authentication_failed" ||
    value === "orphaned_object" ||
    value === "legacy_recovery_pending"
  );
}

function isRootFailure(value: unknown): value is EngineeringStartupRecoveryRootFailureV2 {
  return value === "startup_scan_failed" || value === "fresh_assertion_failed";
}

function isStartupStatus(value: unknown): value is EngineeringStartupRecoveryGateStatusV2 {
  return value === "not_started" || value === "clear" || value === "blocked";
}

function isVoidResult(value: unknown): value is Result<void, UnifiedError> {
  return (
    value !== null &&
    typeof value === "object" &&
    (((value as { readonly ok?: unknown }).ok === true &&
      (value as { readonly value?: unknown }).value === undefined) ||
      ((value as { readonly ok?: unknown }).ok === false && "error" in value))
  );
}

function isStableId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isCanonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
  );
}

function sameCanonicalJson(left: unknown, right: unknown): boolean {
  return (
    canonicalizeEngineeringMutationV2Json(left) === canonicalizeEngineeringMutationV2Json(right)
  );
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalid<T = never>(code: string, traceId: string): Result<T, UnifiedError> {
  return err(
    validationError({
      code,
      message: "Engineering startup recovery gate input is invalid.",
      suggestedAction: "Use Main-owned stable content-root bindings.",
      traceId
    })
  );
}

function rootNotScanned<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_STARTUP_RECOVERY_GATE_ROOT_UNSCANNED",
      message: "Engineering mutation is unavailable until startup recovery scanning completes.",
      suggestedAction: "Complete Main-owned startup recovery scanning for this content root.",
      traceId
    })
  );
}

function mutationBlocked<T = never>(
  root: EngineeringStartupRecoveryRootSnapshotV2,
  traceId: string
): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_STARTUP_RECOVERY_GATE_BLOCKED",
      message: "Engineering mutation is blocked for this content root until recovery is resolved.",
      suggestedAction: "Resolve Main-owned recovery state and run startup scanning again.",
      traceId,
      redactedDetail: {
        sourceReasonCount: root.recoverySnapshot?.reasons.length ?? 0,
        startupFailure: root.startupFailure !== null
      }
    })
  );
}

function clockInvalid<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_STARTUP_RECOVERY_GATE_CLOCK_INVALID",
      message: "Main could not create a canonical startup scan timestamp.",
      suggestedAction: "Restore trusted Main time before enabling Engineering mutations.",
      traceId
    })
  );
}

function superseded<T = never>(traceId: string): Result<T, UnifiedError> {
  return err(
    storageError({
      code: "ENGINEERING_STARTUP_RECOVERY_GATE_SUPERSEDED",
      message: "A newer startup recovery scan replaced this scan request.",
      suggestedAction: "Use the newest Main-owned startup snapshot before mutation.",
      traceId
    })
  );
}

const initializationInputKeys = ["contentRootBindingIds"] as const;
const recoverySnapshotKeys = [
  "capabilityRevision",
  "contentRootBindingId",
  "reasons",
  "scannedAt",
  "schemaVersion",
  "status"
] as const;
const rootSnapshotKeys = [
  "capabilityRevision",
  "contentRootBindingId",
  "recoverySnapshot",
  "scannedAt",
  "schemaVersion",
  "startupFailure",
  "status"
] as const;
