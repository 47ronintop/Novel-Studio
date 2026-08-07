import { createHash } from "node:crypto";

export const EDITOR_STATE_UNKNOWN = "EDITOR_STATE_UNKNOWN" as const;
export const TARGET_DIRTY = "TARGET_DIRTY" as const;
/** Upper bound for a renderer-provided draft retained by Main for non-mutation context. */
export const MAX_WRITING_EDITOR_BUFFER_BYTES = 256 * 1024;

export type WritingEditorResourceKind = "chapter" | "story_bible";
export type WritingEditorConnectionState = "connected" | "disconnected" | "unknown";

export interface WritingEditorResourceIdentity {
  readonly workspaceId: string;
  readonly resourceKind: WritingEditorResourceKind;
  readonly resourceId: string;
}

export interface WritingEditorInstanceIdentity extends WritingEditorResourceIdentity {
  readonly editorInstanceId: string;
}

export interface WritingEditorStateReport extends WritingEditorInstanceIdentity {
  readonly connection: WritingEditorConnectionState;
  readonly rendererRevision: number;
  readonly acknowledgedRevision: number;
  readonly dirty: boolean;
  readonly bufferChecksum: string;
  /** Renderer snapshot retained by Main only after its checksum and byte limit are verified. */
  readonly bufferContent: string;
}

export type WritingEditorState = Readonly<WritingEditorStateReport>;

export type WritingEditorStateUpdateErrorCode =
  "EDITOR_STATE_UPDATE_INVALID" | "EDITOR_STATE_STALE_UPDATE";

export interface WritingEditorStateUpdateError {
  readonly code: WritingEditorStateUpdateErrorCode;
  readonly message: string;
}

export type WritingEditorStateUpdateResult =
  | {
      readonly ok: true;
      readonly state: WritingEditorState;
    }
  | {
      readonly ok: false;
      readonly error: WritingEditorStateUpdateError;
    };

export type WritingEditorResourceObservation =
  | {
      readonly status: "connected";
      readonly target: WritingEditorResourceIdentity;
      readonly state: WritingEditorState;
    }
  | {
      readonly status: "disconnected";
      readonly target: WritingEditorResourceIdentity;
      readonly states: readonly WritingEditorState[];
    }
  | {
      readonly status: "unknown";
      readonly target: WritingEditorResourceIdentity;
      readonly reason: "missing" | "reported_unknown" | "ack_pending" | "multiple_connected";
      readonly states: readonly WritingEditorState[];
    };

export type WritingEditorMutationDecision =
  | {
      readonly ok: true;
      readonly code: "READY";
      readonly states: readonly WritingEditorState[];
    }
  | {
      readonly ok: false;
      readonly code: typeof EDITOR_STATE_UNKNOWN;
      readonly targets: readonly WritingEditorResourceIdentity[];
    }
  | {
      readonly ok: false;
      readonly code: typeof TARGET_DIRTY;
      readonly targets: readonly WritingEditorResourceIdentity[];
      readonly states: readonly WritingEditorState[];
    };

/**
 * Main's current decision for a single managed resource. `known` is returned only when a live
 * renderer handshake proves either the resource's current buffer, or that it was never opened /
 * was cleanly closed. Renderer-provided text is never used to establish that latter fact.
 */
export type WritingEditorMutationState =
  | {
      readonly status: "known";
      readonly dirty: boolean;
      readonly content: string;
      readonly rendererRevision?: number;
    }
  | { readonly status: "unknown"; readonly dirty: false; readonly content: "" };

export interface WritingEditorStateRegistry {
  report(report: WritingEditorStateReport): WritingEditorStateUpdateResult;
  readInstance(identity: WritingEditorInstanceIdentity): WritingEditorState | undefined;
  observe(target: WritingEditorResourceIdentity): WritingEditorResourceObservation;
  readForMutation(target: WritingEditorResourceIdentity): WritingEditorMutationState;
  decideMutation(targets: readonly WritingEditorResourceIdentity[]): WritingEditorMutationDecision;
  clearWorkspace(workspaceId: string): void;
}

export function createWritingEditorStateRegistry(): WritingEditorStateRegistry {
  const resources = new Map<string, Map<string, WritingEditorState>>();

  function report(candidate: WritingEditorStateReport): WritingEditorStateUpdateResult {
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
    const nextInstances = instances ?? new Map<string, WritingEditorState>();
    nextInstances.set(candidate.editorInstanceId, state);
    if (instances === undefined) resources.set(resourceKey, nextInstances);
    return { ok: true, state };
  }

  function readInstance(identity: WritingEditorInstanceIdentity): WritingEditorState | undefined {
    return resources.get(keyForResource(identity))?.get(identity.editorInstanceId);
  }

  function observe(target: WritingEditorResourceIdentity): WritingEditorResourceObservation {
    const states = Object.freeze(
      [...(resources.get(keyForResource(target))?.values() ?? [])].sort((left, right) =>
        left.editorInstanceId.localeCompare(right.editorInstanceId)
      )
    );
    if (states.length === 0) {
      return unknownObservation(target, "missing", states);
    }

    const connected = states.filter((state) => state.connection === "connected");
    if (connected.length > 1) {
      return unknownObservation(target, "multiple_connected", states);
    }
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

  function decideMutation(
    targets: readonly WritingEditorResourceIdentity[]
  ): WritingEditorMutationDecision {
    const uniqueTargets = deduplicateTargets(targets);
    const decisions = uniqueTargets.map(resourceDecision);
    const unknownTargets = decisions
      .filter((decision) => decision.status === "unknown")
      .map((decision) => decision.target);
    if (unknownTargets.length > 0) {
      return Object.freeze({
        ok: false,
        code: EDITOR_STATE_UNKNOWN,
        targets: Object.freeze(unknownTargets)
      });
    }

    const states = decisions.flatMap((decision) =>
      decision.status === "known" ? decision.states : []
    );
    const dirtyStates = states.filter((state) => state.dirty);
    if (dirtyStates.length > 0) {
      return Object.freeze({
        ok: false,
        code: TARGET_DIRTY,
        targets: Object.freeze(dirtyStates.map(freezeTarget)),
        states: Object.freeze(dirtyStates)
      });
    }
    return Object.freeze({ ok: true, code: "READY", states: Object.freeze(states) });
  }

  function readForMutation(target: WritingEditorResourceIdentity): WritingEditorMutationState {
    const decision = resourceDecision(target);
    if (decision.status === "unknown") {
      return Object.freeze({ status: "unknown", dirty: false, content: "" });
    }
    const dirtyState = decision.states.find((state) => state.dirty);
    if (dirtyState !== undefined) {
      return Object.freeze({
        status: "known",
        dirty: true,
        content: dirtyState.bufferContent,
        rendererRevision: dirtyState.rendererRevision
      });
    }
    const connectedState = decision.states.find((state) => state.connection === "connected");
    return Object.freeze(
      connectedState === undefined
        ? { status: "known", dirty: false, content: "" }
        : {
            status: "known",
            dirty: false,
            content: connectedState.bufferContent,
            rendererRevision: connectedState.rendererRevision
          }
    );
  }

  function resourceDecision(target: WritingEditorResourceIdentity): ResourceMutationDecision {
    const observation = observe(target);
    if (observation.status === "connected") {
      return knownResourceDecision(target, [observation.state]);
    }
    if (observation.status === "unknown") {
      if (observation.reason !== "missing" || !hasStableWorkspaceConnection(target.workspaceId)) {
        return unknownResourceDecision(target);
      }
      // A healthy managed editor is connected for this workspace, while this resource has never
      // been reported. It therefore has no renderer buffer and is clean by construction.
      return knownResourceDecision(target, []);
    }
    if (!hasStableWorkspaceConnection(target.workspaceId)) return unknownResourceDecision(target);
    if (observation.states.some((state) => state.acknowledgedRevision !== state.rendererRevision)) {
      return unknownResourceDecision(target);
    }
    if (observation.states.some((state) => !state.dirty && state.bufferContent.length > 0)) {
      // A close from an older or malformed renderer still carries text. It is not the explicit
      // empty-buffer close contract, so Main must not infer that disk is authoritative.
      return unknownResourceDecision(target);
    }
    // `disconnected` is an explicit close only when its clean snapshot carries no retained
    // draft. A dirty close remains dirty; it is never upgraded to clean by this branch.
    return knownResourceDecision(target, observation.states);
  }

  function hasStableWorkspaceConnection(workspaceId: string): boolean {
    for (const instances of resources.values()) {
      for (const state of instances.values()) {
        if (
          state.workspaceId === workspaceId &&
          state.connection === "connected" &&
          state.acknowledgedRevision === state.rendererRevision
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function clearWorkspace(workspaceId: string): void {
    for (const [key, instances] of resources) {
      if ([...instances.values()].some((state) => state.workspaceId === workspaceId)) {
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
    clearWorkspace
  });
}

type ResourceMutationDecision =
  | {
      readonly status: "known";
      readonly target: WritingEditorResourceIdentity;
      readonly states: readonly WritingEditorState[];
    }
  | { readonly status: "unknown"; readonly target: WritingEditorResourceIdentity };

function knownResourceDecision(
  target: WritingEditorResourceIdentity,
  states: readonly WritingEditorState[]
): ResourceMutationDecision {
  return Object.freeze({
    status: "known",
    target: freezeTarget(target),
    states: Object.freeze(states)
  });
}

function unknownResourceDecision(target: WritingEditorResourceIdentity): ResourceMutationDecision {
  return Object.freeze({ status: "unknown", target: freezeTarget(target) });
}

function validateReport(report: WritingEditorStateReport): string | undefined {
  if (!isIdentityPart(report.workspaceId)) return "workspaceId must be a non-empty string.";
  if (!isIdentityPart(report.resourceId)) return "resourceId must be a non-empty string.";
  if (!isIdentityPart(report.editorInstanceId))
    return "editorInstanceId must be a non-empty string.";
  if (report.resourceKind !== "chapter" && report.resourceKind !== "story_bible") {
    return "resourceKind is not supported.";
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
  if (Buffer.byteLength(report.bufferContent, "utf8") > MAX_WRITING_EDITOR_BUFFER_BYTES) {
    return `bufferContent must not exceed ${MAX_WRITING_EDITOR_BUFFER_BYTES} UTF-8 bytes.`;
  }
  if (checksum(report.bufferContent) !== report.bufferChecksum) {
    return "bufferChecksum must match bufferContent.";
  }
  return undefined;
}

function staleUpdateReason(
  previous: WritingEditorState,
  candidate: WritingEditorStateReport
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
    if (!sameSnapshot) {
      return "A renderer revision cannot be reused for a different editor snapshot.";
    }
  }
  return undefined;
}

function unknownObservation(
  target: WritingEditorResourceIdentity,
  reason: Extract<WritingEditorResourceObservation, { readonly status: "unknown" }>["reason"],
  states: readonly WritingEditorState[]
): WritingEditorResourceObservation {
  return Object.freeze({ status: "unknown", target: freezeTarget(target), reason, states });
}

function deduplicateTargets(
  targets: readonly WritingEditorResourceIdentity[]
): readonly WritingEditorResourceIdentity[] {
  const unique = new Map<string, WritingEditorResourceIdentity>();
  for (const target of targets) {
    const key = keyForResource(target);
    if (!unique.has(key)) unique.set(key, freezeTarget(target));
  }
  return Object.freeze([...unique.values()]);
}

function freezeTarget(state: WritingEditorResourceIdentity): WritingEditorResourceIdentity {
  return Object.freeze({
    workspaceId: state.workspaceId,
    resourceKind: state.resourceKind,
    resourceId: state.resourceId
  });
}

function keyForResource(identity: WritingEditorResourceIdentity): string {
  return JSON.stringify([identity.workspaceId, identity.resourceKind, identity.resourceId]);
}

function isIdentityPart(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function updateError(
  code: WritingEditorStateUpdateErrorCode,
  message: string
): WritingEditorStateUpdateResult {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) });
}
