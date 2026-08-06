export const EDITOR_STATE_UNKNOWN = "EDITOR_STATE_UNKNOWN" as const;
export const TARGET_DIRTY = "TARGET_DIRTY" as const;

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

export interface WritingEditorStateRegistry {
  report(report: WritingEditorStateReport): WritingEditorStateUpdateResult;
  readInstance(identity: WritingEditorInstanceIdentity): WritingEditorState | undefined;
  observe(target: WritingEditorResourceIdentity): WritingEditorResourceObservation;
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
    const observations = uniqueTargets.map(observe);
    const unknownTargets = observations
      .filter((observation) => observation.status !== "connected")
      .map((observation) => observation.target);
    if (unknownTargets.length > 0) {
      return Object.freeze({
        ok: false,
        code: EDITOR_STATE_UNKNOWN,
        targets: Object.freeze(unknownTargets)
      });
    }

    const states = observations.map((observation) => {
      if (observation.status !== "connected") throw new Error("unreachable editor observation");
      return observation.state;
    });
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

  function clearWorkspace(workspaceId: string): void {
    for (const [key, instances] of resources) {
      if ([...instances.values()].some((state) => state.workspaceId === workspaceId)) {
        resources.delete(key);
      }
    }
  }

  return Object.freeze({ report, readInstance, observe, decideMutation, clearWorkspace });
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

function updateError(
  code: WritingEditorStateUpdateErrorCode,
  message: string
): WritingEditorStateUpdateResult {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) });
}
