import { createHash } from "node:crypto";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

import { normalizeAgentContextScope, type AgentContextScope } from "./agent-context-scope.js";
import type { AgentWorkspaceKind } from "./agent-tool-capabilities.js";
import type { AgentContextMode } from "./agent-run-types.js";
import { validateAgentRelativePath } from "./path-guard.js";

export interface AgentContextRange {
  readonly start: number;
  readonly end: number;
}

export type ContextDraftRef =
  | {
      readonly kind: "chapter";
      readonly refId: string;
      readonly chapterId: string;
      readonly label: string;
      readonly range?: AgentContextRange;
    }
  | {
      readonly kind: "story_bible";
      readonly refId: string;
      readonly assetId: string;
      readonly label: string;
    }
  | {
      readonly kind: "project_file";
      readonly refId: string;
      readonly relativePath: string;
      readonly label: string;
      readonly range?: AgentContextRange;
      /**
       * The on-disk SHA-256 captured for an automatically maintained active project file. Manual
       * refs predate this guard and intentionally remain valid without it.
       */
      readonly expectedChecksum?: string;
    }
  | {
      readonly kind: "editor_selection";
      readonly refId: string;
      readonly editorRevision: number;
      readonly label: string;
      readonly range: AgentContextRange;
    };

export type ContextDraftActiveResourceRef = Extract<
  ContextDraftRef,
  { readonly kind: "project_file" | "story_bible" }
>;

export interface ContextDraftV10 {
  readonly schemaVersion: "1.0";
  readonly contextDraftId: string;
  readonly conversationId: string;
  readonly projectId: string;
  readonly contextMode: AgentContextMode;
  readonly revision: number;
  readonly refs: readonly ContextDraftRef[];
  readonly checksum: string;
  readonly updatedAt: string;
}

export interface ContextDraftV11 extends Omit<
  ContextDraftV10,
  "schemaVersion" | "projectId" | "contextMode"
> {
  readonly schemaVersion: "1.1";
  readonly scope: AgentContextScope;
  readonly contextMode: AgentContextMode;
  readonly activeResourceRef: ContextDraftActiveResourceRef | null;
}

export type ContextDraftSourceOverrideDecision = "automatic" | "pinned" | "excluded";

export type ContextDraftSourceOverride =
  | {
      readonly refId: string;
      readonly decision: "automatic";
      readonly priority?: never;
    }
  | {
      readonly refId: string;
      readonly decision: "pinned" | "excluded";
      readonly priority: number;
    };

export interface ContextDraftV12 extends Omit<ContextDraftV11, "schemaVersion"> {
  readonly schemaVersion: "1.2";
  readonly sourceOverrides: readonly ContextDraftSourceOverride[];
}

export type ContextDraft = ContextDraftV12;

export type ContextDraftMutation =
  | { readonly kind: "add_ref"; readonly ref: ContextDraftRef }
  | { readonly kind: "remove_ref"; readonly refId: string }
  | {
      readonly kind: "set_selection";
      readonly ref: Extract<ContextDraftRef, { readonly kind: "editor_selection" }> | null;
    }
  | {
      readonly kind: "set_active_resource";
      readonly ref: ContextDraftActiveResourceRef | null;
    }
  | {
      readonly kind: "set_source_override";
      readonly refId: string;
      readonly decision: "automatic" | null;
      readonly priority?: never;
    }
  | {
      readonly kind: "set_source_override";
      readonly refId: string;
      readonly decision: "pinned" | "excluded";
      readonly priority: number;
    };

export interface CreateContextDraftInput {
  readonly contextDraftId: string;
  readonly conversationId: string;
  readonly scope: AgentContextScope;
  readonly contextMode: AgentContextMode;
  readonly refs?: readonly ContextDraftRef[];
  readonly activeResourceRef?: ContextDraftActiveResourceRef | null;
  readonly sourceOverrides?: readonly ContextDraftSourceOverride[];
  readonly updatedAt: string;
}

export function createContextDraft(input: CreateContextDraftInput): ContextDraft {
  return finalizeContextDraft({
    schemaVersion: "1.2",
    contextDraftId: input.contextDraftId,
    conversationId: input.conversationId,
    scope: input.scope,
    contextMode: input.contextMode,
    revision: 1,
    refs: input.scope.kind === "standalone" ? [] : (input.refs ?? []),
    activeResourceRef:
      input.scope.kind === "standalone"
        ? null
        : activeResourceForMode(input.activeResourceRef ?? null, input.contextMode),
    sourceOverrides: input.scope.kind === "standalone" ? [] : (input.sourceOverrides ?? []),
    updatedAt: input.updatedAt
  });
}

/**
 * Apply one mutation to a Context Draft, producing exactly one immutable next revision. Rejects
 * duplicate refs, chapter/Story-Bible refs in general-file mode, and Path-Guard-rejected files.
 */
export function applyContextDraftMutation(
  draft: ContextDraft,
  mutation: ContextDraftMutation,
  updatedAt: string
): Result<ContextDraft, UnifiedError> {
  switch (mutation.kind) {
    case "add_ref": {
      const rejection = validateRef(mutation.ref, draft.contextMode);
      if (rejection !== undefined) return err(rejection);
      if (draft.refs.some((ref) => ref.refId === mutation.ref.refId)) {
        return err(
          contextDraftError(
            "CONTEXT_DRAFT_REF_DUPLICATE",
            "The context reference is already present in this draft."
          )
        );
      }
      return ok(nextRevision(draft, [...draft.refs, mutation.ref], updatedAt));
    }
    case "remove_ref": {
      const refs = draft.refs.filter((ref) => ref.refId !== mutation.refId);
      return ok(nextRevision(draft, refs, updatedAt));
    }
    case "set_selection": {
      const withoutSelection = draft.refs.filter((ref) => ref.kind !== "editor_selection");
      const refs = mutation.ref === null ? withoutSelection : [...withoutSelection, mutation.ref];
      return ok(nextRevision(draft, refs, updatedAt));
    }
    case "set_active_resource": {
      if (draft.scope.kind === "standalone") {
        return mutation.ref === null
          ? ok(nextRevision(draft, [...draft.refs], updatedAt, null))
          : err(
              contextDraftError(
                "CONTEXT_DRAFT_REF_SCOPE_INVALID",
                "Standalone conversations cannot bind a project resource."
              )
            );
      }
      if (mutation.ref !== null) {
        const rejection = validateRef(mutation.ref, draft.contextMode);
        if (rejection !== undefined) return err(rejection);
        if (!activeResourceMatchesMode(mutation.ref, draft.contextMode)) {
          return err(
            contextDraftError(
              "CONTEXT_DRAFT_ACTIVE_RESOURCE_MODE_INVALID",
              "The active resource does not match the selected context mode."
            )
          );
        }
      }
      return ok(nextRevision(draft, [...draft.refs], updatedAt, mutation.ref));
    }
    case "set_source_override": {
      if (draft.scope.kind === "standalone") {
        return err(
          contextDraftError(
            "CONTEXT_DRAFT_REF_SCOPE_INVALID",
            "Standalone conversations cannot customize project context sources."
          )
        );
      }
      if (!isValidOverrideRefId(mutation.refId)) {
        return err(
          contextDraftError(
            "CONTEXT_DRAFT_SOURCE_OVERRIDE_INVALID",
            "The context source override reference is invalid."
          )
        );
      }
      if (
        ((mutation.decision === "pinned" || mutation.decision === "excluded") &&
          (mutation.priority === undefined || !isValidPriority(mutation.priority))) ||
        ((mutation.decision === "automatic" || mutation.decision === null) &&
          mutation.priority !== undefined)
      ) {
        return err(
          contextDraftError(
            "CONTEXT_DRAFT_SOURCE_PRIORITY_INVALID",
            "The context source priority must be an integer from 0 to 100."
          )
        );
      }
      const remaining = draft.sourceOverrides.filter(
        (override) => override.refId !== mutation.refId
      );
      let sourceOverrides: readonly ContextDraftSourceOverride[];
      if (mutation.decision === null) {
        sourceOverrides = remaining;
      } else if (mutation.decision === "automatic") {
        sourceOverrides = [...remaining, { refId: mutation.refId, decision: "automatic" }];
      } else {
        const priority = mutation.priority;
        if (priority === undefined) {
          return err(
            contextDraftError(
              "CONTEXT_DRAFT_SOURCE_PRIORITY_INVALID",
              "The context source priority must be an integer from 0 to 100."
            )
          );
        }
        sourceOverrides = [
          ...remaining,
          { refId: mutation.refId, decision: mutation.decision, priority }
        ];
      }
      return ok(
        nextRevision(draft, [...draft.refs], updatedAt, draft.activeResourceRef, sourceOverrides)
      );
    }
  }
}

/** Produce a fresh revision without changing refs — used to re-resolve refs (e.g. stale editor selection). */
export function refreshContextDraft(draft: ContextDraft, updatedAt: string): ContextDraft {
  return nextRevision(draft, [...draft.refs], updatedAt);
}

/**
 * Change the draft's context mode, producing one next revision. Switching to general-file drops
 * chapter/Story-Bible refs, which are writing-mode-only, so the draft never carries invalid refs.
 */
export function setContextDraftMode(
  draft: ContextDraft,
  contextMode: AgentContextMode,
  updatedAt: string
): ContextDraft {
  const refs =
    contextMode === "general_file"
      ? draft.refs.filter((ref) => ref.kind !== "chapter" && ref.kind !== "story_bible")
      : draft.refs;
  return finalizeContextDraft({
    schemaVersion: "1.2",
    contextDraftId: draft.contextDraftId,
    conversationId: draft.conversationId,
    scope: draft.scope,
    contextMode,
    revision: draft.revision + 1,
    refs,
    activeResourceRef: activeResourceForMode(draft.activeResourceRef, contextMode),
    sourceOverrides: draft.sourceOverrides,
    updatedAt
  });
}

export function checksumContextDraft(draft: Omit<ContextDraft, "checksum">): string {
  return checksumText(
    stableSerialize({
      contextDraftId: draft.contextDraftId,
      conversationId: draft.conversationId,
      scope: draft.scope,
      contextMode: draft.contextMode,
      revision: draft.revision,
      refs: draft.refs,
      activeResourceRef: draft.activeResourceRef,
      sourceOverrides: draft.sourceOverrides
    })
  );
}

export function normalizeContextDraft(
  value: Readonly<Record<string, unknown>>,
  legacyWorkspaceKind?: AgentWorkspaceKind
): ContextDraft {
  const { projectId: _legacyProjectId, ...withoutLegacyProjectId } = value;
  void _legacyProjectId;
  if (value["schemaVersion"] === "1.2") {
    const scope = normalizeAgentContextScope(value["scope"], undefined, legacyWorkspaceKind);
    const sourceOverrides = normalizeSourceOverrides(value["sourceOverrides"]);
    return deepFreeze({
      ...withoutLegacyProjectId,
      scope,
      sourceOverrides
    } as unknown as ContextDraft);
  }
  if (value["schemaVersion"] === "1.1") {
    const scope = normalizeAgentContextScope(value["scope"], undefined, legacyWorkspaceKind);
    return deepFreeze({
      ...withoutLegacyProjectId,
      schemaVersion: "1.2",
      scope,
      sourceOverrides: []
    } as unknown as ContextDraft);
  }
  if (value["schemaVersion"] !== "1.0") throw new Error("CONTEXT_DRAFT_VERSION_UNSUPPORTED");
  const scope = normalizeAgentContextScope(undefined, value["projectId"], legacyWorkspaceKind);
  return deepFreeze({
    ...withoutLegacyProjectId,
    schemaVersion: "1.2",
    scope,
    refs: scope.kind === "standalone" ? [] : value["refs"],
    activeResourceRef: null,
    sourceOverrides: []
  } as unknown as ContextDraft);
}

function validateRef(
  ref: ContextDraftRef,
  contextMode: AgentContextMode
): UnifiedError | undefined {
  if (contextMode === "general_file" && (ref.kind === "chapter" || ref.kind === "story_bible")) {
    return contextDraftError(
      "CONTEXT_DRAFT_REF_MODE_INVALID",
      "Chapter and Story Bible references are available only in writing mode."
    );
  }
  if (ref.kind === "project_file") {
    const validated = validateAgentRelativePath(ref.relativePath);
    if (!validated.ok) return validated.error;
    if (ref.expectedChecksum !== undefined && !isExpectedChecksum(ref.expectedChecksum)) {
      return contextDraftError(
        "CONTEXT_DRAFT_REF_CHECKSUM_INVALID",
        "A project-file checksum must be a lowercase SHA-256 value."
      );
    }
  }
  return undefined;
}

function isExpectedChecksum(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function activeResourceMatchesMode(
  ref: ContextDraftActiveResourceRef,
  contextMode: AgentContextMode
): boolean {
  return (
    (contextMode === "writing" && ref.kind === "story_bible") ||
    (contextMode === "general_file" && ref.kind === "project_file")
  );
}

function activeResourceForMode(
  ref: ContextDraftActiveResourceRef | null,
  contextMode: AgentContextMode
): ContextDraftActiveResourceRef | null {
  return ref !== null && activeResourceMatchesMode(ref, contextMode) ? ref : null;
}

function nextRevision(
  draft: ContextDraft,
  refs: readonly ContextDraftRef[],
  updatedAt: string,
  activeResourceRef = draft.activeResourceRef,
  sourceOverrides = draft.sourceOverrides
): ContextDraft {
  return finalizeContextDraft({
    schemaVersion: "1.2",
    contextDraftId: draft.contextDraftId,
    conversationId: draft.conversationId,
    scope: draft.scope,
    contextMode: draft.contextMode,
    revision: draft.revision + 1,
    refs: draft.scope.kind === "standalone" ? [] : refs,
    activeResourceRef: draft.scope.kind === "standalone" ? null : activeResourceRef,
    sourceOverrides: draft.scope.kind === "standalone" ? [] : sourceOverrides,
    updatedAt
  });
}

function finalizeContextDraft(draft: Omit<ContextDraft, "checksum">): ContextDraft {
  const canonical = {
    ...draft,
    sourceOverrides: [...draft.sourceOverrides].sort((left, right) =>
      left.refId.localeCompare(right.refId)
    )
  };
  return deepFreeze({ ...canonical, checksum: checksumContextDraft(canonical) });
}

function isValidOverrideRefId(value: string): boolean {
  if (value.length === 0 || value.length > 512) return false;
  for (let index = 0; index < value.length; index += 1) {
    const characterCode = value.charCodeAt(index);
    if (characterCode <= 31 || characterCode === 127) return false;
  }
  return true;
}

function isValidPriority(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 100;
}

function normalizeSourceOverrides(value: unknown): readonly ContextDraftSourceOverride[] {
  if (!Array.isArray(value)) throw new Error("CONTEXT_DRAFT_SOURCE_OVERRIDE_INVALID");
  const overrides: ContextDraftSourceOverride[] = [];
  const refs = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new Error("CONTEXT_DRAFT_SOURCE_OVERRIDE_INVALID");
    }
    const override = candidate as Record<string, unknown>;
    const refId = override["refId"];
    const decision = override["decision"];
    if (
      typeof refId !== "string" ||
      !isValidOverrideRefId(refId) ||
      refs.has(refId) ||
      (decision !== "automatic" && decision !== "pinned" && decision !== "excluded")
    ) {
      throw new Error("CONTEXT_DRAFT_SOURCE_OVERRIDE_INVALID");
    }
    if (decision === "automatic") {
      if (
        override["priority"] !== undefined ||
        Object.keys(override).some((key) => key !== "refId" && key !== "decision")
      ) {
        throw new Error("CONTEXT_DRAFT_SOURCE_OVERRIDE_INVALID");
      }
      overrides.push({ refId, decision });
    } else {
      const priority = override["priority"];
      if (
        typeof priority !== "number" ||
        !isValidPriority(priority) ||
        Object.keys(override).some(
          (key) => key !== "refId" && key !== "decision" && key !== "priority"
        )
      ) {
        throw new Error("CONTEXT_DRAFT_SOURCE_OVERRIDE_INVALID");
      }
      overrides.push({ refId, decision, priority });
    }
    refs.add(refId);
  }
  return overrides;
}

function contextDraftError(code: string, message: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Adjust the context reference and retry.",
    traceId: "context-draft"
  });
}

function checksumText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
