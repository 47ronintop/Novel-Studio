import { createHash } from "node:crypto";

export const ENGINEERING_EDITOR_STATE_UNKNOWN = "EDITOR_STATE_UNKNOWN" as const;
export const ENGINEERING_EDITOR_TARGET_DIRTY = "TARGET_DIRTY" as const;
/** Main retains a renderer draft only for an explicitly shared read context. */
export const MAX_ENGINEERING_EDITOR_BUFFER_BYTES = 256 * 1024;

export type EngineeringEditorConnectionState = "connected" | "disconnected" | "unknown";

/** An opaque native root binding plus the already-canonical relative file identity. */
export interface EngineeringEditorResourceIdentity {
  readonly rootBindingId: string;
  readonly relativePath: string;
}

export interface EngineeringEditorInstanceIdentity extends EngineeringEditorResourceIdentity {
  readonly editorInstanceId: string;
}

export interface EngineeringEditorStateReport extends EngineeringEditorInstanceIdentity {
  readonly connection: EngineeringEditorConnectionState;
  readonly rendererRevision: number;
  readonly acknowledgedRevision: number;
  readonly dirty: boolean;
  readonly bufferChecksum: string;
  /** Retained solely for a live, explicitly requested dirty-buffer share. */
  readonly bufferContent: string;
}

export type EngineeringEditorState = Readonly<EngineeringEditorStateReport>;

export type EngineeringEditorStateUpdateErrorCode =
  "EDITOR_STATE_UPDATE_INVALID" | "EDITOR_STATE_STALE_UPDATE";

export type EngineeringEditorStateUpdateResult =
  | { readonly ok: true; readonly state: EngineeringEditorState }
  | {
      readonly ok: false;
      readonly error: Readonly<{
        readonly code: EngineeringEditorStateUpdateErrorCode;
        readonly message: string;
      }>;
    };

export type EngineeringEditorObservation =
  | {
      readonly status: "connected";
      readonly target: EngineeringEditorResourceIdentity;
      readonly state: EngineeringEditorState;
    }
  | {
      readonly status: "disconnected";
      readonly target: EngineeringEditorResourceIdentity;
      readonly states: readonly EngineeringEditorState[];
    }
  | {
      readonly status: "unknown";
      readonly target: EngineeringEditorResourceIdentity;
      readonly reason: "missing" | "reported_unknown" | "ack_pending" | "multiple_connected";
      readonly states: readonly EngineeringEditorState[];
    };

/** Mutation callers receive no renderer text: disk/hardened-reader data remains the only base. */
export type EngineeringEditorMutationState =
  | { readonly status: "known"; readonly dirty: boolean; readonly rendererRevision: number }
  | { readonly status: "unknown"; readonly dirty: false };

export type EngineeringEditorMutationDecision =
  | {
      readonly ok: true;
      readonly code: "READY";
      readonly states: readonly EngineeringEditorState[];
    }
  | {
      readonly ok: false;
      readonly code: typeof ENGINEERING_EDITOR_STATE_UNKNOWN;
      readonly targets: readonly EngineeringEditorResourceIdentity[];
    }
  | {
      readonly ok: false;
      readonly code: typeof ENGINEERING_EDITOR_TARGET_DIRTY;
      readonly targets: readonly EngineeringEditorResourceIdentity[];
      readonly states: readonly EngineeringEditorState[];
    };

/** A draft is available only from a live, acknowledged dirty editor and only when requested. */
export type EngineeringEditorSharedRead =
  | {
      readonly status: "available";
      readonly target: EngineeringEditorResourceIdentity;
      readonly rendererRevision: number;
      readonly bufferChecksum: string;
      readonly bufferContent: string;
    }
  | {
      readonly status: "unavailable";
      readonly target: EngineeringEditorResourceIdentity;
      readonly reason: "clean" | "disconnected" | "unknown";
    };

export interface EngineeringEditorStateRegistry {
  report(report: EngineeringEditorStateReport): EngineeringEditorStateUpdateResult;
  readInstance(identity: EngineeringEditorInstanceIdentity): EngineeringEditorState | undefined;
  observe(target: EngineeringEditorResourceIdentity): EngineeringEditorObservation;
  readForMutation(target: EngineeringEditorResourceIdentity): EngineeringEditorMutationState;
  decideMutation(
    targets: readonly EngineeringEditorResourceIdentity[]
  ): EngineeringEditorMutationDecision;
  readForExplicitShare(target: EngineeringEditorResourceIdentity): EngineeringEditorSharedRead;
  clearRootBinding(rootBindingId: string): void;
}

export function createEngineeringEditorStateRegistry(): EngineeringEditorStateRegistry {
  const resources = new Map<string, Map<string, EngineeringEditorState>>();

  function report(candidate: EngineeringEditorStateReport): EngineeringEditorStateUpdateResult {
    const validationError = validateReport(candidate);
    if (validationError !== undefined)
      return updateError("EDITOR_STATE_UPDATE_INVALID", validationError);

    const resourceKey = keyForResource(candidate);
    const instances = resources.get(resourceKey);
    const previous = instances?.get(candidate.editorInstanceId);
    if (previous !== undefined) {
      const staleReason = staleUpdateReason(previous, candidate);
      if (staleReason !== undefined) return updateError("EDITOR_STATE_STALE_UPDATE", staleReason);
    }

    const state = Object.freeze({ ...candidate });
    const nextInstances = instances ?? new Map<string, EngineeringEditorState>();
    nextInstances.set(candidate.editorInstanceId, state);
    if (instances === undefined) resources.set(resourceKey, nextInstances);
    return Object.freeze({ ok: true, state });
  }

  function readInstance(
    identity: EngineeringEditorInstanceIdentity
  ): EngineeringEditorState | undefined {
    return resources.get(keyForResource(identity))?.get(identity.editorInstanceId);
  }

  function observe(target: EngineeringEditorResourceIdentity): EngineeringEditorObservation {
    const states = Object.freeze(
      [...(resources.get(keyForResource(target))?.values() ?? [])].sort((left, right) =>
        left.editorInstanceId.localeCompare(right.editorInstanceId)
      )
    );
    if (states.length === 0) return unknownObservation(target, "missing", states);

    const connected = states.filter((state) => state.connection === "connected");
    if (connected.length > 1) return unknownObservation(target, "multiple_connected", states);
    if (connected.length === 1) {
      const state = connected[0];
      if (state === undefined || state.acknowledgedRevision !== state.rendererRevision) {
        return unknownObservation(target, "ack_pending", states);
      }
      return Object.freeze({ status: "connected", target: freezeTarget(target), state });
    }
    if (states.some((state) => state.connection === "unknown")) {
      return unknownObservation(target, "reported_unknown", states);
    }
    return Object.freeze({ status: "disconnected", target: freezeTarget(target), states });
  }

  function readForMutation(
    target: EngineeringEditorResourceIdentity
  ): EngineeringEditorMutationState {
    const observation = observe(target);
    if (observation.status !== "connected")
      return Object.freeze({ status: "unknown", dirty: false });
    return Object.freeze({
      status: "known",
      dirty: observation.state.dirty,
      rendererRevision: observation.state.rendererRevision
    });
  }

  function decideMutation(
    targets: readonly EngineeringEditorResourceIdentity[]
  ): EngineeringEditorMutationDecision {
    const uniqueTargets = deduplicateTargets(targets);
    const observations = uniqueTargets.map((target) => ({ target, observation: observe(target) }));
    const unknownTargets = observations
      .filter(({ observation }) => observation.status !== "connected")
      .map(({ target }) => target);
    if (unknownTargets.length > 0) {
      return Object.freeze({
        ok: false,
        code: ENGINEERING_EDITOR_STATE_UNKNOWN,
        targets: Object.freeze(unknownTargets)
      });
    }

    const states = observations.flatMap(({ observation }) =>
      observation.status === "connected" ? [observation.state] : []
    );
    const dirtyStates = states.filter((state) => state.dirty);
    if (dirtyStates.length > 0) {
      return Object.freeze({
        ok: false,
        code: ENGINEERING_EDITOR_TARGET_DIRTY,
        targets: Object.freeze(dirtyStates.map(freezeTarget)),
        states: Object.freeze(dirtyStates)
      });
    }
    return Object.freeze({ ok: true, code: "READY", states: Object.freeze(states) });
  }

  function readForExplicitShare(
    target: EngineeringEditorResourceIdentity
  ): EngineeringEditorSharedRead {
    const observation = observe(target);
    if (observation.status === "unknown") {
      return unavailableShare(target, "unknown");
    }
    if (observation.status === "disconnected") {
      return unavailableShare(target, "disconnected");
    }
    if (!observation.state.dirty) return unavailableShare(target, "clean");
    return Object.freeze({
      status: "available",
      target: freezeTarget(target),
      rendererRevision: observation.state.rendererRevision,
      bufferChecksum: observation.state.bufferChecksum,
      bufferContent: observation.state.bufferContent
    });
  }

  function clearRootBinding(rootBindingId: string): void {
    for (const [key, instances] of resources) {
      if ([...instances.values()].some((state) => state.rootBindingId === rootBindingId)) {
        resources.delete(key);
      }
    }
  }

  return Object.freeze({
    report,
    readInstance,
    observe,
    readForMutation,
    decideMutation,
    readForExplicitShare,
    clearRootBinding
  });
}

function validateReport(report: EngineeringEditorStateReport): string | undefined {
  if (!isOpaqueIdentity(report.rootBindingId))
    return "rootBindingId must be a non-empty NFC string.";
  if (!isRelativePath(report.relativePath))
    return "relativePath must be a canonical relative POSIX path.";
  if (!isOpaqueIdentity(report.editorInstanceId)) {
    return "editorInstanceId must be a non-empty NFC string.";
  }
  if (
    report.connection !== "connected" &&
    report.connection !== "disconnected" &&
    report.connection !== "unknown"
  ) {
    return "connection is not supported.";
  }
  if (!isRevision(report.rendererRevision) || !isRevision(report.acknowledgedRevision)) {
    return "rendererRevision and acknowledgedRevision must be non-negative safe integers.";
  }
  if (report.acknowledgedRevision > report.rendererRevision) {
    return "acknowledgedRevision cannot exceed rendererRevision.";
  }
  if (typeof report.dirty !== "boolean") return "dirty must be a boolean.";
  if (typeof report.bufferChecksum !== "string" || !/^[a-f0-9]{64}$/u.test(report.bufferChecksum)) {
    return "bufferChecksum must be a lowercase SHA-256 checksum.";
  }
  if (typeof report.bufferContent !== "string") return "bufferContent must be a string.";
  if (Buffer.byteLength(report.bufferContent, "utf8") > MAX_ENGINEERING_EDITOR_BUFFER_BYTES) {
    return `bufferContent must not exceed ${MAX_ENGINEERING_EDITOR_BUFFER_BYTES} UTF-8 bytes.`;
  }
  if (checksum(report.bufferContent) !== report.bufferChecksum) {
    return "bufferChecksum must match bufferContent.";
  }
  if (report.connection !== "connected" && report.bufferContent.length > 0) {
    return "A disconnected or unknown editor must not retain a buffer.";
  }
  return undefined;
}

function staleUpdateReason(
  previous: EngineeringEditorState,
  candidate: EngineeringEditorStateReport
): string | undefined {
  if (candidate.rendererRevision < previous.rendererRevision) {
    return "rendererRevision cannot move backwards.";
  }
  if (candidate.acknowledgedRevision < previous.acknowledgedRevision) {
    return "acknowledgedRevision cannot move backwards.";
  }
  if (previous.connection !== "connected" && candidate.connection === "connected") {
    return "A disconnected or unknown editor instance cannot reconnect; use a new instance ID.";
  }
  if (candidate.rendererRevision === previous.rendererRevision) {
    const sameSnapshot =
      candidate.connection === previous.connection &&
      candidate.dirty === previous.dirty &&
      candidate.bufferChecksum === previous.bufferChecksum;
    if (!sameSnapshot)
      return "A renderer revision cannot be reused for a different editor snapshot.";
  }
  return undefined;
}

function unknownObservation(
  target: EngineeringEditorResourceIdentity,
  reason: Extract<EngineeringEditorObservation, { readonly status: "unknown" }>["reason"],
  states: readonly EngineeringEditorState[]
): EngineeringEditorObservation {
  return Object.freeze({ status: "unknown", target: freezeTarget(target), reason, states });
}

function unavailableShare(
  target: EngineeringEditorResourceIdentity,
  reason: Extract<EngineeringEditorSharedRead, { readonly status: "unavailable" }>["reason"]
): EngineeringEditorSharedRead {
  return Object.freeze({ status: "unavailable", target: freezeTarget(target), reason });
}

function deduplicateTargets(
  targets: readonly EngineeringEditorResourceIdentity[]
): readonly EngineeringEditorResourceIdentity[] {
  const unique = new Map<string, EngineeringEditorResourceIdentity>();
  for (const target of targets) {
    const key = keyForResource(target);
    if (!unique.has(key)) unique.set(key, freezeTarget(target));
  }
  return Object.freeze([...unique.values()]);
}

function freezeTarget(
  target: EngineeringEditorResourceIdentity
): EngineeringEditorResourceIdentity {
  return Object.freeze({ rootBindingId: target.rootBindingId, relativePath: target.relativePath });
}

function keyForResource(identity: EngineeringEditorResourceIdentity): string {
  return JSON.stringify([identity.rootBindingId, identity.relativePath]);
}

function isOpaqueIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value.trim().length > 0 &&
    value === value.normalize("NFC") &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

function isRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 4096 ||
    Buffer.byteLength(value, "utf8") > 4096 ||
    value !== value.normalize("NFC") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /[\p{Cc}\p{Cf}]/u.test(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function updateError(
  code: EngineeringEditorStateUpdateErrorCode,
  message: string
): EngineeringEditorStateUpdateResult {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) });
}
