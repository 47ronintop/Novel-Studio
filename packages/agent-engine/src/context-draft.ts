import { createHash } from "node:crypto";

import { createUnifiedError, err, ok, type Result, type UnifiedError } from "@novel-studio/shared";

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
    }
  | {
      readonly kind: "editor_selection";
      readonly refId: string;
      readonly editorRevision: number;
      readonly label: string;
      readonly range: AgentContextRange;
    };

export interface ContextDraft {
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

export type ContextDraftMutation =
  | { readonly kind: "add_ref"; readonly ref: ContextDraftRef }
  | { readonly kind: "remove_ref"; readonly refId: string }
  | {
      readonly kind: "set_selection";
      readonly ref: Extract<ContextDraftRef, { readonly kind: "editor_selection" }> | null;
    };

export interface CreateContextDraftInput {
  readonly contextDraftId: string;
  readonly conversationId: string;
  readonly projectId: string;
  readonly contextMode: AgentContextMode;
  readonly refs?: readonly ContextDraftRef[];
  readonly updatedAt: string;
}

export function createContextDraft(input: CreateContextDraftInput): ContextDraft {
  return finalizeContextDraft({
    schemaVersion: "1.0",
    contextDraftId: input.contextDraftId,
    conversationId: input.conversationId,
    projectId: input.projectId,
    contextMode: input.contextMode,
    revision: 1,
    refs: input.refs ?? [],
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
    schemaVersion: "1.0",
    contextDraftId: draft.contextDraftId,
    conversationId: draft.conversationId,
    projectId: draft.projectId,
    contextMode,
    revision: draft.revision + 1,
    refs,
    updatedAt
  });
}

export function checksumContextDraft(draft: Omit<ContextDraft, "checksum">): string {
  return checksumText(
    stableSerialize({
      contextDraftId: draft.contextDraftId,
      conversationId: draft.conversationId,
      projectId: draft.projectId,
      contextMode: draft.contextMode,
      revision: draft.revision,
      refs: draft.refs
    })
  );
}

function validateRef(ref: ContextDraftRef, contextMode: AgentContextMode): UnifiedError | undefined {
  if (contextMode === "general_file" && (ref.kind === "chapter" || ref.kind === "story_bible")) {
    return contextDraftError(
      "CONTEXT_DRAFT_REF_MODE_INVALID",
      "Chapter and Story Bible references are available only in writing mode."
    );
  }
  if (ref.kind === "project_file") {
    const validated = validateAgentRelativePath(ref.relativePath);
    if (!validated.ok) return validated.error;
  }
  return undefined;
}

function nextRevision(
  draft: ContextDraft,
  refs: readonly ContextDraftRef[],
  updatedAt: string
): ContextDraft {
  return finalizeContextDraft({
    schemaVersion: "1.0",
    contextDraftId: draft.contextDraftId,
    conversationId: draft.conversationId,
    projectId: draft.projectId,
    contextMode: draft.contextMode,
    revision: draft.revision + 1,
    refs,
    updatedAt
  });
}

function finalizeContextDraft(draft: Omit<ContextDraft, "checksum">): ContextDraft {
  return deepFreeze({ ...draft, checksum: checksumContextDraft(draft) });
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
