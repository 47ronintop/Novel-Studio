import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import type {
  AiWritingSelectionRange,
  AiWritingSelectionReview
} from "./ai-writing-workflow-types.js";

export function validateAiWritingSchema(input: {
  readonly schemaId: string;
  readonly value: JsonObject;
}): { readonly valid: boolean; readonly redactedDetail?: JsonObject } {
  if (input.schemaId === "schema.ai-writing.input.v1") {
    return {
      valid:
        typeof input.value["instruction"] === "string" &&
        typeof input.value["currentBody"] === "string"
    };
  }
  if (input.schemaId === "schema.ai-selection-preview.input.v1") {
    const selection = input.value["selection"];
    return {
      valid:
        typeof input.value["instruction"] === "string" &&
        typeof input.value["currentBody"] === "string" &&
        typeof selection === "object" &&
        selection !== null &&
        !Array.isArray(selection)
    };
  }
  if (input.schemaId === "schema.ai-selection-preview.output.v1") {
    return { valid: toSelectionPreviewOutput(input.value) !== undefined };
  }

  return { valid: toAiWritingOutput(input.value) !== undefined };
}

export function toAiWritingOutput(
  value: JsonObject
): { readonly proposedBody: string; readonly summary: string } | undefined {
  const proposedBody = value["proposedBody"];
  const summary = value["summary"];
  return typeof proposedBody === "string" && typeof summary === "string"
    ? { proposedBody, summary }
    : undefined;
}

export function toSelectionPreviewOutput(
  value: JsonObject
): { readonly proposedText: string; readonly summary: string } | undefined {
  const proposedText = value["proposedText"];
  const summary = value["summary"];
  return typeof proposedText === "string" && typeof summary === "string"
    ? { proposedText, summary }
    : undefined;
}

export function validateSelectionRange(
  body: string,
  selection: AiWritingSelectionRange
): Result<AiWritingSelectionRange, UnifiedError> {
  if (
    !Number.isInteger(selection.startOffset) ||
    !Number.isInteger(selection.endOffset) ||
    selection.startOffset < 0 ||
    selection.endOffset > body.length ||
    selection.startOffset >= selection.endOffset
  ) {
    return aiWorkflowError({
      code: "AI_WORKFLOW_SELECTION_INVALID",
      message: "AI selection preview requires a non-empty selection inside the active chapter.",
      suggestedAction: "Select text in the active chapter before requesting a selection preview."
    });
  }
  if (body.slice(selection.startOffset, selection.endOffset) !== selection.selectedText) {
    return aiWorkflowError({
      code: "AI_WORKFLOW_SELECTION_STALE",
      message: "The selected text no longer matches the active chapter.",
      suggestedAction: "Refresh the selection and request the preview again."
    });
  }
  return ok(selection);
}

export function replaceSelection(
  body: string,
  selection: AiWritingSelectionRange,
  proposedText: string
): string {
  return `${body.slice(0, selection.startOffset)}${proposedText}${body.slice(selection.endOffset)}`;
}

export function createSelectionReview(
  selection: AiWritingSelectionRange,
  proposedText: string
): AiWritingSelectionReview {
  return {
    status: "pending",
    originalText: selection.selectedText,
    proposedText,
    rangeLabel: `${selection.startOffset}-${selection.endOffset}`,
    compareLabel: `${selection.selectedText} -> ${proposedText}`
  };
}

export const estimateSelectionTokens = (selectedText: string): number =>
  Math.max(1, Math.ceil(selectedText.length / 4));

export function invalidWorkflowAction<T>(kind: string): Result<T, UnifiedError> {
  return aiWorkflowError({
    code: "AI_WORKFLOW_INVALID_ACTION",
    message: `Unexpected AI workflow action: ${kind}.`,
    suggestedAction: "Inspect the AI writing workflow definition."
  });
}

export function aiWorkflowError<T>(input: {
  readonly code: string;
  readonly message: string;
  readonly suggestedAction: string;
}): Result<T, UnifiedError> {
  return err(
    createUnifiedError({
      code: input.code,
      category: "UserError",
      message: input.message,
      recoverability: "user-action",
      suggestedAction: input.suggestedAction,
      traceId: "ai-writing-workflow"
    })
  );
}
