import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { parse as parseToml } from "@iarna/toml";

import { createUnifiedError, type UnifiedError } from "@novel-studio/shared";

import { validateAgentRelativePath } from "./path-guard.js";
import type { AgentWritePolicy } from "./agent-run-types.js";

const require = createRequire(import.meta.url);
const { load: parseYaml } = require("js-yaml") as {
  load: (source: string) => unknown;
};

export type ChangeSetAssetType = "chapter" | "text";
export type ChangeSetRangeUnit = "character" | "line" | "paragraph";
export type ChangeSetStatus =
  "awaiting_approval" | "approved" | "rejected" | "stale" | "applied" | "abandoned";

// ── Change Set v1.1: Operation types ─────────────────────────────────────────

/** The kind of file lifecycle operation in a v1.1 Change Set. */
export type ChangeSetOperationKind =
  "modify" | "create_file" | "move_file" | "delete_file" | "create_directory";

/** Base fields shared by all operation kinds. */
interface ChangeSetOperationBase {
  /** Stable ID allocated by the session; used to express dependencies. */
  readonly operationId: string;
  /** IDs of operations that must be committed before this one. */
  readonly dependsOn?: readonly string[];
  /** Idempotency key binding this operation to the originating tool call. */
  readonly toolCallIdempotencyKey: string;
  /** Operations are selected as an indivisible unit during Change Set review. */
  readonly selected?: boolean;
  /** Cross-asset facts sharing this ID must be selected and applied together. */
  readonly consistencyGroupId?: string;
}

export interface ChangeSetModifyOperation extends ChangeSetOperationBase {
  readonly kind: "modify";
  readonly relativePath: string;
}

export interface ChangeSetCreateFileOperation extends ChangeSetOperationBase {
  readonly kind: "create_file";
  readonly relativePath: string;
  readonly content: string;
}

export interface ChangeSetMoveFileOperation extends ChangeSetOperationBase {
  readonly kind: "move_file";
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly sourceChecksum: string;
}

export interface ChangeSetDeleteFileOperation extends ChangeSetOperationBase {
  readonly kind: "delete_file";
  readonly relativePath: string;
  readonly baseChecksum: string;
}

export interface ChangeSetCreateDirectoryOperation extends ChangeSetOperationBase {
  readonly kind: "create_directory";
  readonly relativePath: string;
}

export type ChangeSetOperation =
  | ChangeSetModifyOperation
  | ChangeSetCreateFileOperation
  | ChangeSetMoveFileOperation
  | ChangeSetDeleteFileOperation
  | ChangeSetCreateDirectoryOperation;

export interface ChangeSetRange {
  readonly unit: ChangeSetRangeUnit;
  readonly start: number;
  readonly end: number;
}

export interface ChangeSetValidationCheck {
  readonly status: "valid" | "invalid" | "not_applicable";
  readonly message?: string;
}

export interface ChangeSetValidation {
  readonly valid: boolean;
  readonly utf8: ChangeSetValidationCheck;
  readonly syntax: ChangeSetValidationCheck;
  readonly schema: ChangeSetValidationCheck;
  readonly asset: ChangeSetValidationCheck;
}

/**
 * Immutable authorization evidence for a Story Bible transition across the deleted boundary.
 * It is part of the Change Set checksum, so approval is bound to the exact evidence displayed.
 */
export type StoryBibleStatusTransitionProof =
  | {
      readonly action: "delete";
      readonly deletionImpactChecksum: string;
    }
  | {
      readonly action: "restore";
      readonly expectedStatus: "active" | "draft" | "archived";
      readonly historyAuthorizationChecksum: string;
    };

export interface ChangeSetHunk {
  readonly hunkId: string;
  readonly range: ChangeSetRange;
  readonly characterRange: {
    readonly start: number;
    readonly end: number;
  };
  readonly baseContent: string;
  readonly replacement: string;
  readonly selected: boolean;
}

export interface ChangeSetFileChange {
  readonly relativePath: string;
  readonly assetType: ChangeSetAssetType;
  readonly assetId?: string;
  readonly baseChecksum: string;
  readonly candidateChecksum: string;
  readonly baseContent: string;
  readonly candidateContent: string;
  readonly hunks: readonly ChangeSetHunk[];
  readonly validation: ChangeSetValidation;
  readonly selected: boolean;
  readonly consistencyGroupId?: string;
  readonly storyBibleStatusProof?: StoryBibleStatusTransitionProof;
}

export interface ChangeSet {
  readonly schemaVersion: "1.0" | "1.1";
  readonly changeSetId: string;
  readonly revision: number;
  readonly runId: string;
  readonly projectId: string;
  readonly checkpointId: string;
  readonly contextSnapshotId: string;
  readonly writePolicy?: AgentWritePolicy;
  readonly status: ChangeSetStatus;
  readonly checksum: string;
  readonly approvalToken: string;
  readonly files: readonly ChangeSetFileChange[];
  readonly createdAt: string;
  /**
   * Change Set v1.1: optional lifecycle operations appended alongside file changes.
   * When present, `operationsSchemaVersion` is "1.1". Absent for backward-compat v1.0 change sets.
   */
  readonly operationsSchemaVersion?: "1.1";
  readonly operations?: readonly ChangeSetOperation[];
}

export interface ChangeSetProposal {
  readonly relativePath: string;
  readonly assetType: ChangeSetAssetType;
  readonly assetId?: string;
  readonly baseContent: string;
  readonly baseChecksum: string;
  readonly range: ChangeSetRange;
  readonly replacement: string;
  readonly consistencyGroupId?: string;
  readonly storyBibleStatusProof?: StoryBibleStatusTransitionProof;
}

export interface CreateChangeSetRevisionInput {
  readonly changeSetId: string;
  readonly runId: string;
  readonly projectId: string;
  readonly checkpointId: string;
  readonly contextSnapshotId: string;
  readonly writePolicy?: AgentWritePolicy;
  readonly proposal: ChangeSetProposal;
  readonly createdAt: string;
}

export interface AppendChangeSetProposalInput {
  readonly proposal: ChangeSetProposal;
  readonly createdAt: string;
}

export interface ChangeSetFileSelection {
  readonly relativePath: string;
  readonly selected: boolean;
  readonly selectedHunkIds?: readonly string[];
}

/** Selection for one indivisible v1.1 lifecycle operation. */
export interface ChangeSetOperationSelection {
  readonly operationId: string;
  readonly selected: boolean;
}

export interface SelectChangeSetRevisionInput {
  readonly files: readonly ChangeSetFileSelection[];
  /** Omitted operations retain their selection from the reviewed revision. */
  readonly operations?: readonly ChangeSetOperationSelection[];
  readonly createdAt: string;
}

export interface ChangeSetCandidateValidationInput {
  readonly relativePath: string;
  readonly assetType: ChangeSetAssetType;
  readonly assetId?: string;
  readonly baseContent: string;
  readonly candidateContent: string;
}

export interface ChangeSetExternalValidation {
  readonly schema?: ChangeSetValidationCheck;
  readonly asset?: ChangeSetValidationCheck;
}

export type ChangeSetCandidateValidator = (
  input: ChangeSetCandidateValidationInput
) => Promise<ChangeSetExternalValidation> | ChangeSetExternalValidation;

export interface ChangeSetRevisionOptions {
  readonly createHunkId?: () => string;
  readonly validateCandidate?: ChangeSetCandidateValidator;
}

interface DraftFileChange {
  readonly relativePath: string;
  readonly assetType: ChangeSetAssetType;
  readonly assetId?: string;
  readonly baseChecksum: string;
  readonly baseContent: string;
  readonly hunks: readonly ChangeSetHunk[];
  readonly consistencyGroupId?: string;
  readonly storyBibleStatusProof?: StoryBibleStatusTransitionProof;
}

export interface ChangeSetConsistencyGroupSelection {
  readonly allGroupIds: readonly string[];
  readonly selectedGroupIds: readonly string[];
  readonly splitGroupIds: readonly string[];
  readonly selectionChecksum?: string;
}

export async function createChangeSetRevision(
  input: CreateChangeSetRevisionInput,
  options: ChangeSetRevisionOptions = {}
): Promise<ChangeSet> {
  const draft = createDraftFile(input.proposal, options.createHunkId);
  return finalizeChangeSet(
    {
      ...input,
      writePolicy: input.writePolicy ?? "write_before_confirmation",
      revision: 1,
      files: [draft]
    },
    options.validateCandidate
  );
}

export async function appendChangeSetProposal(
  current: ChangeSet,
  input: AppendChangeSetProposalInput,
  options: ChangeSetRevisionOptions = {}
): Promise<ChangeSet> {
  const proposed = createDraftFile(input.proposal, options.createHunkId);
  const existing = current.files.find((file) => file.relativePath === proposed.relativePath);
  const files: DraftFileChange[] = current.files.map(toAllSelectedDraft);

  if (existing === undefined) {
    files.push(proposed);
  } else {
    if (
      existing.assetType !== proposed.assetType ||
      existing.assetId !== proposed.assetId ||
      existing.consistencyGroupId !== proposed.consistencyGroupId ||
      existing.baseChecksum !== proposed.baseChecksum ||
      existing.baseContent !== proposed.baseContent
    ) {
      throw changeSetError(
        "CHANGE_SET_BASE_MISMATCH",
        "The proposal no longer matches the Change Set base.",
        "Refresh the target and create a new proposal."
      );
    }
    const newHunk = proposed.hunks[0];
    if (newHunk === undefined) {
      throw changeSetError(
        "CHANGE_SET_INVALID",
        "The proposal did not produce a reviewable hunk.",
        "Regenerate the proposal."
      );
    }
    const mergedHunks = [
      ...existing.hunks
        .filter((hunk) => !rangesOverlap(hunk.characterRange, newHunk.characterRange))
        .map((hunk) => ({ ...hunk, selected: true })),
      newHunk
    ].sort((left, right) => left.characterRange.start - right.characterRange.start);
    const index = files.findIndex((file) => file.relativePath === proposed.relativePath);
    files[index] = { ...proposed, hunks: mergedHunks };
  }

  const revised = await finalizeChangeSet(
    {
      changeSetId: current.changeSetId,
      runId: current.runId,
      projectId: current.projectId,
      checkpointId: current.checkpointId,
      contextSnapshotId: current.contextSnapshotId,
      writePolicy: current.writePolicy ?? "write_before_confirmation",
      revision: current.revision + 1,
      createdAt: input.createdAt,
      files
    },
    options.validateCandidate
  );
  if ((current.operations?.length ?? 0) === 0) return revised;
  return finalizeOperationsChangeSet({
    changeSetId: current.changeSetId,
    runId: current.runId,
    projectId: current.projectId,
    checkpointId: current.checkpointId,
    contextSnapshotId: current.contextSnapshotId,
    writePolicy: effectiveOperationsWritePolicy(
      current.writePolicy ?? "write_before_confirmation",
      current.operations ?? []
    ),
    revision: current.revision + 1,
    createdAt: input.createdAt,
    files: revised.files,
    operations: current.operations ?? []
  });
}

export async function selectChangeSetRevision(
  current: ChangeSet,
  input: SelectChangeSetRevisionInput,
  options: Pick<ChangeSetRevisionOptions, "validateCandidate"> = {}
): Promise<ChangeSet> {
  const selections = new Map(input.files.map((selection) => [selection.relativePath, selection]));
  for (const selection of input.files) {
    if (!current.files.some((file) => file.relativePath === selection.relativePath)) {
      throw changeSetError(
        "CHANGE_SET_SELECTION_INVALID",
        "The selection references a file outside this Change Set revision.",
        "Refresh the Change Set before changing the selection."
      );
    }
  }

  const files = current.files.map((file): DraftFileChange => {
    const selection = selections.get(file.relativePath);
    if (selection === undefined) return toDraft(file);
    const selectedHunkIds =
      selection.selectedHunkIds === undefined ? undefined : new Set(selection.selectedHunkIds);
    if (
      selectedHunkIds !== undefined &&
      [...selectedHunkIds].some((hunkId) => !file.hunks.some((hunk) => hunk.hunkId === hunkId))
    ) {
      throw changeSetError(
        "CHANGE_SET_SELECTION_INVALID",
        "The selection references a hunk outside this Change Set revision.",
        "Refresh the Change Set before changing the selection."
      );
    }
    return {
      ...toDraft(file),
      hunks: file.hunks.map((hunk) => ({
        ...hunk,
        selected:
          selection.selected && (selectedHunkIds === undefined || selectedHunkIds.has(hunk.hunkId))
      }))
    };
  });

  const selectedOperations = selectChangeSetOperations(current.operations ?? [], input.operations);
  assertConsistencyGroupsAreIndivisible(files, selectedOperations);
  if (selectedOperations.length > 0) {
    const selectedFiles = await finalizeChangeSet(
      {
        changeSetId: current.changeSetId,
        runId: current.runId,
        projectId: current.projectId,
        checkpointId: current.checkpointId,
        contextSnapshotId: current.contextSnapshotId,
        writePolicy: effectiveOperationsWritePolicy(
          current.writePolicy ?? "write_before_confirmation",
          selectedOperations
        ),
        revision: current.revision + 1,
        createdAt: input.createdAt,
        files
      },
      options.validateCandidate
    );
    return finalizeOperationsChangeSet({
      changeSetId: current.changeSetId,
      runId: current.runId,
      projectId: current.projectId,
      checkpointId: current.checkpointId,
      contextSnapshotId: current.contextSnapshotId,
      writePolicy: effectiveOperationsWritePolicy(
        current.writePolicy ?? "write_before_confirmation",
        selectedOperations
      ),
      revision: current.revision + 1,
      createdAt: input.createdAt,
      files: selectedFiles.files,
      operations: selectedOperations
    });
  }

  return finalizeChangeSet(
    {
      changeSetId: current.changeSetId,
      runId: current.runId,
      projectId: current.projectId,
      checkpointId: current.checkpointId,
      contextSnapshotId: current.contextSnapshotId,
      writePolicy: current.writePolicy ?? "write_before_confirmation",
      revision: current.revision + 1,
      createdAt: input.createdAt,
      files
    },
    options.validateCandidate
  );
}

export function checksumChangeSetText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function inspectChangeSetConsistencyGroups(
  changeSet: ChangeSet
): ChangeSetConsistencyGroupSelection {
  const states = new Map<string, Set<boolean>>();
  for (const file of changeSet.files) {
    const selections =
      file.hunks.length === 0 ? [file.selected] : file.hunks.map((hunk) => hunk.selected);
    for (const selected of selections) {
      addConsistencyGroupState(states, file.consistencyGroupId, selected);
    }
  }
  for (const operation of changeSet.operations ?? []) {
    addConsistencyGroupState(
      states,
      operation.consistencyGroupId,
      operation.selected !== false
    );
  }
  const allGroupIds = [...states.keys()].sort(compareIdentifiers);
  const splitGroupIds = allGroupIds.filter((groupId) => (states.get(groupId)?.size ?? 0) > 1);
  const selectedGroupIds = allGroupIds.filter(
    (groupId) => states.get(groupId)?.size === 1 && states.get(groupId)?.has(true)
  );
  return deepFreeze({
    allGroupIds,
    selectedGroupIds,
    splitGroupIds,
    ...(allGroupIds.length === 0
      ? {}
      : {
          selectionChecksum: checksumChangeSetSelection(changeSet, selectedGroupIds)
        })
  });
}

export function checksumChangeSetSelection(
  changeSet: Pick<ChangeSet, "changeSetId" | "revision" | "checksum">,
  selectedConsistencyGroupIds: readonly string[]
): string {
  const normalized = [...new Set(selectedConsistencyGroupIds)].sort(compareIdentifiers);
  if (normalized.some((groupId) => !isOperationIdentifier(groupId))) {
    throw changeSetError(
      "CHANGE_SET_CONSISTENCY_GROUP_INVALID",
      "The selected consistency groups contain an invalid identifier.",
      "Refresh the Change Set and select only displayed consistency groups."
    );
  }
  return checksumChangeSetText(
    stableSerialize({
      changeSetId: changeSet.changeSetId,
      revision: changeSet.revision,
      checksum: changeSet.checksum,
      selectedConsistencyGroupIds: normalized
    })
  );
}

function createDraftFile(
  proposal: ChangeSetProposal,
  createHunkId: (() => string) | undefined
): DraftFileChange {
  const path = validateAgentRelativePath(proposal.relativePath);
  if (!path.ok) throw path.error;
  if (checksumChangeSetText(proposal.baseContent) !== proposal.baseChecksum) {
    throw changeSetError(
      "CHANGE_SET_BASE_MISMATCH",
      "The proposal base checksum is stale.",
      "Refresh the target and create a new proposal."
    );
  }
  const characterRange = resolveCharacterRange(proposal.baseContent, proposal.range);
  return {
    relativePath: path.value.relativePath,
    assetType: proposal.assetType,
    ...(proposal.assetId === undefined ? {} : { assetId: proposal.assetId }),
    ...(proposal.consistencyGroupId === undefined
      ? {}
      : { consistencyGroupId: validateConsistencyGroupId(proposal.consistencyGroupId) }),
    ...(proposal.storyBibleStatusProof === undefined
      ? {}
      : { storyBibleStatusProof: cloneStoryBibleStatusProof(proposal.storyBibleStatusProof) }),
    baseChecksum: proposal.baseChecksum,
    baseContent: proposal.baseContent,
    hunks: [
      {
        hunkId: createHunkId?.() ?? `hunk_${randomUUID().replaceAll("-", "")}`,
        range: { ...proposal.range },
        characterRange,
        baseContent: proposal.baseContent.slice(characterRange.start, characterRange.end),
        replacement: proposal.replacement,
        selected: true
      }
    ]
  };
}

async function finalizeChangeSet(
  input: {
    readonly changeSetId: string;
    readonly runId: string;
    readonly projectId: string;
    readonly checkpointId: string;
    readonly contextSnapshotId: string;
    readonly writePolicy: AgentWritePolicy;
    readonly revision: number;
    readonly createdAt: string;
    readonly files: readonly DraftFileChange[];
  },
  validator: ChangeSetCandidateValidator | undefined
): Promise<ChangeSet> {
  const files = await Promise.all(input.files.map((file) => finalizeFile(file, validator)));
  const checksum = checksumChangeSetText(
    stableSerialize({
      changeSetId: input.changeSetId,
      revision: input.revision,
      runId: input.runId,
      checkpointId: input.checkpointId,
      contextSnapshotId: input.contextSnapshotId,
      writePolicy: input.writePolicy,
      files: files.map((file) => ({
        relativePath: file.relativePath,
        assetType: file.assetType,
        assetId: file.assetId ?? null,
        consistencyGroupId: file.consistencyGroupId ?? null,
        storyBibleStatusProof: file.storyBibleStatusProof ?? null,
        baseChecksum: file.baseChecksum,
        candidateChecksum: file.candidateChecksum,
        selected: file.selected,
        validation: file.validation,
        hunks: file.hunks.map((hunk) => ({
          hunkId: hunk.hunkId,
          characterRange: hunk.characterRange,
          replacement: hunk.replacement,
          selected: hunk.selected
        }))
      }))
    })
  );
  const approvalToken = checksumChangeSetText(`${input.changeSetId}:${input.revision}:${checksum}`);
  return deepFreeze({
    schemaVersion: files.some(
      (file) =>
        file.consistencyGroupId !== undefined || file.storyBibleStatusProof !== undefined
    )
      ? "1.1"
      : "1.0",
    changeSetId: input.changeSetId,
    revision: input.revision,
    runId: input.runId,
    projectId: input.projectId,
    checkpointId: input.checkpointId,
    contextSnapshotId: input.contextSnapshotId,
    writePolicy: input.writePolicy,
    status: "awaiting_approval",
    checksum,
    approvalToken,
    files,
    createdAt: input.createdAt
  });
}

async function finalizeFile(
  draft: DraftFileChange,
  validator: ChangeSetCandidateValidator | undefined
): Promise<ChangeSetFileChange> {
  const selectedHunks = draft.hunks.filter((hunk) => hunk.selected);
  const candidateContent = applyHunks(draft.baseContent, selectedHunks);
  const external =
    (await validator?.({
      relativePath: draft.relativePath,
      assetType: draft.assetType,
      ...(draft.assetId === undefined ? {} : { assetId: draft.assetId }),
      baseContent: draft.baseContent,
      candidateContent
    })) ?? {};
  const validation = validateCandidate(draft.relativePath, candidateContent, external);
  return {
    relativePath: draft.relativePath,
    assetType: draft.assetType,
    ...(draft.assetId === undefined ? {} : { assetId: draft.assetId }),
    ...(draft.consistencyGroupId === undefined
      ? {}
      : { consistencyGroupId: draft.consistencyGroupId }),
    ...(draft.storyBibleStatusProof === undefined
      ? {}
      : { storyBibleStatusProof: cloneStoryBibleStatusProof(draft.storyBibleStatusProof) }),
    baseChecksum: draft.baseChecksum,
    candidateChecksum: checksumChangeSetText(candidateContent),
    baseContent: draft.baseContent,
    candidateContent,
    hunks: draft.hunks.map((hunk) => ({
      ...hunk,
      range: { ...hunk.range },
      characterRange: { ...hunk.characterRange }
    })),
    validation,
    selected: selectedHunks.length > 0
  };
}

function validateCandidate(
  relativePath: string,
  candidateContent: string,
  external: ChangeSetExternalValidation
): ChangeSetValidation {
  const utf8 = isWellFormedUnicode(candidateContent)
    ? ({ status: "valid" } as const)
    : ({
        status: "invalid",
        message: "Candidate contains an unpaired Unicode surrogate."
      } as const);
  let syntax: ChangeSetValidationCheck = { status: "not_applicable" };
  const extension = relativePath.slice(relativePath.lastIndexOf(".")).toLowerCase();
  try {
    if (extension === ".json") {
      JSON.parse(candidateContent);
      syntax = { status: "valid" };
    } else if (extension === ".yaml" || extension === ".yml") {
      parseYaml(candidateContent);
      syntax = { status: "valid" };
    } else if (extension === ".toml") {
      parseToml(candidateContent);
      syntax = { status: "valid" };
    }
  } catch {
    if (extension === ".json") {
      syntax = { status: "invalid", message: "Candidate is not valid JSON." };
    } else if (extension === ".yaml" || extension === ".yml") {
      syntax = { status: "invalid", message: "Candidate is not valid YAML." };
    } else if (extension === ".toml") {
      syntax = { status: "invalid", message: "Candidate is not valid TOML." };
    }
  }
  const schema = external.schema ?? { status: "not_applicable" };
  const asset = external.asset ?? { status: "not_applicable" };
  return {
    valid: [utf8, syntax, schema, asset].every((check) => check.status !== "invalid"),
    utf8,
    syntax,
    schema,
    asset
  };
}

function resolveCharacterRange(
  content: string,
  range: ChangeSetRange
): {
  readonly start: number;
  readonly end: number;
} {
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end <= range.start
  ) {
    throw rangeError();
  }
  if (range.unit === "character") {
    if (range.end > content.length) throw rangeError();
    return { start: range.start, end: range.end };
  }
  const spans = segmentSpans(content, range.unit);
  if (range.end > spans.length) throw rangeError();
  return {
    start: spans[range.start]?.start ?? 0,
    end: spans[range.end - 1]?.end ?? 0
  };
}

function segmentSpans(
  content: string,
  unit: Exclude<ChangeSetRangeUnit, "character">
): readonly { readonly start: number; readonly end: number }[] {
  const delimiter = unit === "line" ? /\r?\n/g : /\r?\n(?:[ \t]*\r?\n)+/g;
  const spans: { start: number; end: number }[] = [];
  let start = 0;
  for (const match of content.matchAll(delimiter)) {
    const index = match.index;
    spans.push({ start, end: index });
    start = index + match[0].length;
  }
  spans.push({ start, end: content.length });
  return spans;
}

function applyHunks(baseContent: string, hunks: readonly ChangeSetHunk[]): string {
  let candidate = baseContent;
  for (const hunk of [...hunks].sort(
    (left, right) => right.characterRange.start - left.characterRange.start
  )) {
    candidate =
      candidate.slice(0, hunk.characterRange.start) +
      hunk.replacement +
      candidate.slice(hunk.characterRange.end);
  }
  return candidate;
}

function rangesOverlap(
  left: { readonly start: number; readonly end: number },
  right: { readonly start: number; readonly end: number }
): boolean {
  return left.start < right.end && right.start < left.end;
}

function toDraft(file: ChangeSetFileChange): DraftFileChange {
  return {
    relativePath: file.relativePath,
    assetType: file.assetType,
    ...(file.assetId === undefined ? {} : { assetId: file.assetId }),
    ...(file.consistencyGroupId === undefined
      ? {}
      : { consistencyGroupId: file.consistencyGroupId }),
    ...(file.storyBibleStatusProof === undefined
      ? {}
      : { storyBibleStatusProof: cloneStoryBibleStatusProof(file.storyBibleStatusProof) }),
    baseChecksum: file.baseChecksum,
    baseContent: file.baseContent,
    hunks: file.hunks.map((hunk) => ({ ...hunk }))
  };
}

function toAllSelectedDraft(file: ChangeSetFileChange): DraftFileChange {
  return {
    ...toDraft(file),
    hunks: file.hunks.map((hunk) => ({ ...hunk, selected: true }))
  };
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

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function rangeError(): UnifiedError {
  return changeSetError(
    "CHANGE_SET_RANGE_INVALID",
    "The proposal range does not identify existing target content.",
    "Refresh the target and provide a valid non-empty range."
  );
}

function changeSetError(code: string, message: string, suggestedAction: string): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction,
    traceId: "change-set"
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// ── Change Set v1.1: Operation creation helpers ───────────────────────────────

/** Create a modify operation (wraps an existing file hunk). */
export function createModifyOperation(input: {
  readonly operationId: string;
  readonly relativePath: string;
  readonly toolCallIdempotencyKey: string;
  readonly dependsOn?: readonly string[];
  readonly consistencyGroupId?: string;
}): ChangeSetModifyOperation {
  return freezeOperation({
    kind: "modify",
    operationId: input.operationId,
    relativePath: input.relativePath,
    toolCallIdempotencyKey: input.toolCallIdempotencyKey,
    selected: true,
    ...(input.consistencyGroupId === undefined
      ? {}
      : { consistencyGroupId: input.consistencyGroupId }),
    ...(input.dependsOn === undefined ? {} : { dependsOn: Object.freeze([...input.dependsOn]) })
  });
}

/** Create a create_file operation. */
export function createFileOperation(input: {
  readonly operationId: string;
  readonly relativePath: string;
  readonly content: string;
  readonly toolCallIdempotencyKey: string;
  readonly dependsOn?: readonly string[];
  readonly consistencyGroupId?: string;
}): ChangeSetCreateFileOperation {
  return freezeOperation({
    kind: "create_file",
    operationId: input.operationId,
    relativePath: input.relativePath,
    content: input.content,
    toolCallIdempotencyKey: input.toolCallIdempotencyKey,
    selected: true,
    ...(input.consistencyGroupId === undefined
      ? {}
      : { consistencyGroupId: input.consistencyGroupId }),
    ...(input.dependsOn === undefined ? {} : { dependsOn: Object.freeze([...input.dependsOn]) })
  });
}

/** Create a move_file operation. */
export function moveFileOperation(input: {
  readonly operationId: string;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly sourceChecksum: string;
  readonly toolCallIdempotencyKey: string;
  readonly dependsOn?: readonly string[];
  readonly consistencyGroupId?: string;
}): ChangeSetMoveFileOperation {
  return freezeOperation({
    kind: "move_file",
    operationId: input.operationId,
    sourcePath: input.sourcePath,
    targetPath: input.targetPath,
    sourceChecksum: input.sourceChecksum,
    toolCallIdempotencyKey: input.toolCallIdempotencyKey,
    selected: true,
    ...(input.consistencyGroupId === undefined
      ? {}
      : { consistencyGroupId: input.consistencyGroupId }),
    ...(input.dependsOn === undefined ? {} : { dependsOn: Object.freeze([...input.dependsOn]) })
  });
}

/** Create a delete_file operation. */
export function deleteFileOperation(input: {
  readonly operationId: string;
  readonly relativePath: string;
  readonly baseChecksum: string;
  readonly toolCallIdempotencyKey: string;
  readonly dependsOn?: readonly string[];
  readonly consistencyGroupId?: string;
}): ChangeSetDeleteFileOperation {
  return freezeOperation({
    kind: "delete_file",
    operationId: input.operationId,
    relativePath: input.relativePath,
    baseChecksum: input.baseChecksum,
    toolCallIdempotencyKey: input.toolCallIdempotencyKey,
    selected: true,
    ...(input.consistencyGroupId === undefined
      ? {}
      : { consistencyGroupId: input.consistencyGroupId }),
    ...(input.dependsOn === undefined ? {} : { dependsOn: Object.freeze([...input.dependsOn]) })
  });
}

/** Create a create_directory operation. */
export function createDirectoryOperation(input: {
  readonly operationId: string;
  readonly relativePath: string;
  readonly toolCallIdempotencyKey: string;
  readonly dependsOn?: readonly string[];
  readonly consistencyGroupId?: string;
}): ChangeSetCreateDirectoryOperation {
  return freezeOperation({
    kind: "create_directory",
    operationId: input.operationId,
    relativePath: input.relativePath,
    toolCallIdempotencyKey: input.toolCallIdempotencyKey,
    selected: true,
    ...(input.consistencyGroupId === undefined
      ? {}
      : { consistencyGroupId: input.consistencyGroupId }),
    ...(input.dependsOn === undefined ? {} : { dependsOn: Object.freeze([...input.dependsOn]) })
  });
}

/** Build the first revision of an operations-only Change Set (Task B.3 lifecycle tools). */
export function createOperationsChangeSetRevision(input: {
  readonly changeSetId: string;
  readonly runId: string;
  readonly projectId: string;
  readonly checkpointId: string;
  readonly contextSnapshotId: string;
  readonly writePolicy?: AgentWritePolicy;
  readonly operation: ChangeSetOperation;
  readonly createdAt: string;
}): ChangeSet {
  const operations = [normalizeChangeSetOperation(input.operation)];
  assertOperationsPreflight(operations);
  return finalizeOperationsChangeSet({
    changeSetId: input.changeSetId,
    runId: input.runId,
    projectId: input.projectId,
    checkpointId: input.checkpointId,
    contextSnapshotId: input.contextSnapshotId,
    writePolicy: effectiveOperationsWritePolicy(
      input.writePolicy ?? "write_before_confirmation",
      operations
    ),
    revision: 1,
    createdAt: input.createdAt,
    operations,
    files: []
  });
}

/** Append one more lifecycle operation onto an existing Change Set revision. */
export function appendChangeSetOperation(
  current: ChangeSet,
  input: { readonly operation: ChangeSetOperation; readonly createdAt: string }
): ChangeSet {
  const operations = [
    ...(current.operations ?? []).map(normalizeChangeSetOperation),
    normalizeChangeSetOperation(input.operation)
  ];
  assertOperationsPreflight(operations);
  return finalizeOperationsChangeSet({
    changeSetId: current.changeSetId,
    runId: current.runId,
    projectId: current.projectId,
    checkpointId: current.checkpointId,
    contextSnapshotId: current.contextSnapshotId,
    writePolicy: effectiveOperationsWritePolicy(
      current.writePolicy ?? "write_before_confirmation",
      operations
    ),
    revision: current.revision + 1,
    createdAt: input.createdAt,
    operations,
    files: current.files
  });
}

function finalizeOperationsChangeSet(input: {
  readonly changeSetId: string;
  readonly runId: string;
  readonly projectId: string;
  readonly checkpointId: string;
  readonly contextSnapshotId: string;
  readonly writePolicy: AgentWritePolicy;
  readonly revision: number;
  readonly createdAt: string;
  readonly operations: readonly ChangeSetOperation[];
  readonly files: readonly ChangeSetFileChange[];
}): ChangeSet {
  const operations = input.operations.map(normalizeChangeSetOperation);
  assertOperationsPreflight(operations);
  assertConsistencyGroupsAreIndivisible(input.files, operations);
  const checksum = checksumChangeSetText(
    stableSerialize({
      changeSetId: input.changeSetId,
      revision: input.revision,
      runId: input.runId,
      checkpointId: input.checkpointId,
      contextSnapshotId: input.contextSnapshotId,
      writePolicy: input.writePolicy,
      files: serializeChangeSetFiles(input.files),
      operations: operations.map((operation) => ({ ...operation }))
    })
  );
  const approvalToken = checksumChangeSetText(`${input.changeSetId}:${input.revision}:${checksum}`);
  return deepFreeze({
    schemaVersion: "1.1",
    changeSetId: input.changeSetId,
    revision: input.revision,
    runId: input.runId,
    projectId: input.projectId,
    checkpointId: input.checkpointId,
    contextSnapshotId: input.contextSnapshotId,
    writePolicy: input.writePolicy,
    status: "awaiting_approval",
    checksum,
    approvalToken,
    files: input.files,
    createdAt: input.createdAt,
    operationsSchemaVersion: "1.1" as const,
    operations
  });
}

/**
 * DAG preflight for Change Set operations. Returns an error if:
 * - There are duplicate operationIds.
 * - There are cycles in the dependency graph.
 * - A dependsOn references an unknown operationId.
 * - There are path conflicts (same path used in create+delete at same level, etc.).
 */
export function preflightChangeSetOperations(
  operations: readonly ChangeSetOperation[]
): { readonly ok: true } | { readonly ok: false; readonly error: string } {
  for (const operation of operations) {
    const validationError = validateChangeSetOperation(operation);
    if (validationError !== undefined) return { ok: false, error: validationError };
  }
  const ids = new Set<string>();
  const duplicates: string[] = [];
  for (const op of operations) {
    if (ids.has(op.operationId)) duplicates.push(op.operationId);
    ids.add(op.operationId);
  }
  if (duplicates.length > 0) {
    return { ok: false, error: `Duplicate operation IDs: ${duplicates.join(", ")}` };
  }

  // Verify all dependsOn references known IDs
  for (const op of operations) {
    for (const dep of op.dependsOn ?? []) {
      if (!ids.has(dep)) {
        return { ok: false, error: `Operation ${op.operationId} depends on unknown ID: ${dep}` };
      }
    }
  }

  // Detect cycles via DFS
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const adjacency = new Map<string, readonly string[]>(
    operations.map((op) => [op.operationId, op.dependsOn ?? []])
  );

  function hasCycle(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const dep of adjacency.get(nodeId) ?? []) {
      if (hasCycle(dep)) return true;
    }
    inStack.delete(nodeId);
    return false;
  }

  for (const op of operations) {
    if (hasCycle(op.operationId)) {
      return {
        ok: false,
        error: `Cycle detected in operation dependencies involving: ${op.operationId}`
      };
    }
  }

  const operationById = new Map(operations.map((operation) => [operation.operationId, operation]));
  const creates = new Map<string, ChangeSetOperation>();
  const deletes = new Map<string, ChangeSetOperation>();
  const moveSources = new Map<string, ChangeSetMoveFileOperation>();
  const moveTargets = new Map<string, ChangeSetMoveFileOperation>();

  for (const operation of operations) {
    if (operation.kind === "create_file" || operation.kind === "create_directory") {
      const existing = creates.get(operation.relativePath);
      if (existing !== undefined) {
        return {
          ok: false,
          error: `Path conflict: ${existing.operationId} and ${operation.operationId} both create ${operation.relativePath}`
        };
      }
      creates.set(operation.relativePath, operation);
    }
    if (operation.kind === "delete_file") {
      const existing = deletes.get(operation.relativePath);
      if (existing !== undefined) {
        return {
          ok: false,
          error: `Path conflict: ${existing.operationId} and ${operation.operationId} both delete ${operation.relativePath}`
        };
      }
      deletes.set(operation.relativePath, operation);
    }
    if (operation.kind === "move_file") {
      const source = moveSources.get(operation.sourcePath);
      if (source !== undefined) {
        return {
          ok: false,
          error: `Move conflict: ${source.operationId} and ${operation.operationId} share source ${operation.sourcePath}`
        };
      }
      const target = moveTargets.get(operation.targetPath);
      if (target !== undefined) {
        return {
          ok: false,
          error: `Move conflict: ${target.operationId} and ${operation.operationId} share target ${operation.targetPath}`
        };
      }
      moveSources.set(operation.sourcePath, operation);
      moveTargets.set(operation.targetPath, operation);
    }
  }

  for (const [path, create] of creates) {
    const deletion = deletes.get(path);
    if (deletion !== undefined) {
      return {
        ok: false,
        error: `Path conflict: ${create.operationId} creates and ${deletion.operationId} deletes ${path}`
      };
    }
    const moveSource = moveSources.get(path);
    const moveTarget = moveTargets.get(path);
    if (moveSource !== undefined || moveTarget !== undefined) {
      return {
        ok: false,
        error: `Path conflict: ${create.operationId} creates path ${path} used by move ${
          (moveSource ?? moveTarget)?.operationId
        }`
      };
    }
  }

  for (const [path, deletion] of deletes) {
    const moveSource = moveSources.get(path);
    const moveTarget = moveTargets.get(path);
    if (moveSource !== undefined || moveTarget !== undefined) {
      return {
        ok: false,
        error: `Path conflict: ${deletion.operationId} deletes path ${path} used by move ${
          (moveSource ?? moveTarget)?.operationId
        }`
      };
    }
  }

  // A move chain is valid only when the move that frees the destination is a dependency.
  // This rejects accidental overwrites and leaves a swap as a dependency cycle above.
  for (const move of moveTargets.values()) {
    const sourceOwner = moveSources.get(move.targetPath);
    if (
      sourceOwner !== undefined &&
      !operationDependsOn(move, sourceOwner.operationId, operationById)
    ) {
      return {
        ok: false,
        error: `Move conflict: ${move.operationId} targets ${move.targetPath} before ${sourceOwner.operationId} frees it`
      };
    }
  }

  for (const operation of operations) {
    const targetPath = operationTargetPath(operation);
    if (targetPath === undefined) continue;
    const parentDirectory = parentPath(targetPath);
    const creator = creates.get(parentDirectory);
    if (
      creator?.kind === "create_directory" &&
      !operationDependsOn(operation, creator.operationId, operationById)
    ) {
      return {
        ok: false,
        error: `Operation ${operation.operationId} must depend on directory creation ${creator.operationId} for ${parentDirectory}`
      };
    }
  }

  return { ok: true };
}

function assertOperationsPreflight(operations: readonly ChangeSetOperation[]): void {
  const preflight = preflightChangeSetOperations(operations);
  if (!preflight.ok) {
    throw changeSetError(
      "CHANGE_SET_OPERATION_INVALID",
      preflight.error,
      "Resolve the operation conflict and retry with a new proposal."
    );
  }
}

function freezeOperation<T extends ChangeSetOperation>(operation: T): T {
  const normalized = normalizeChangeSetOperation(operation) as T;
  return deepFreeze(normalized);
}

function normalizeChangeSetOperation(operation: ChangeSetOperation): ChangeSetOperation {
  const validationError = validateChangeSetOperation(operation);
  if (validationError !== undefined) {
    throw changeSetError(
      "CHANGE_SET_OPERATION_INVALID",
      validationError,
      "Use a canonical path and complete lifecycle-operation metadata."
    );
  }
  return {
    ...operation,
    selected: operation.selected !== false,
    ...(operation.dependsOn === undefined ? {} : { dependsOn: [...operation.dependsOn] })
  };
}

function validateChangeSetOperation(operation: ChangeSetOperation): string | undefined {
  if (!isOperationIdentifier(operation.operationId)) {
    return "Operation IDs must be stable non-empty identifiers up to 128 characters.";
  }
  if (!isOperationIdentifier(operation.toolCallIdempotencyKey)) {
    return `Operation ${operation.operationId} has an invalid idempotency binding.`;
  }
  if (
    operation.consistencyGroupId !== undefined &&
    !isOperationIdentifier(operation.consistencyGroupId)
  ) {
    return `Operation ${operation.operationId} has an invalid consistency group ID.`;
  }
  if (
    operation.dependsOn !== undefined &&
    operation.dependsOn.some((dependency) => !isOperationIdentifier(dependency))
  ) {
    return `Operation ${operation.operationId} has an invalid dependency ID.`;
  }

  switch (operation.kind) {
    case "modify":
    case "create_file":
      return validateOperationPath(operation.relativePath, true);
    case "delete_file":
      return (
        validateOperationPath(operation.relativePath, true) ??
        validateChecksum(operation.baseChecksum, operation.operationId)
      );
    case "move_file":
      return (
        validateOperationPath(operation.sourcePath, true) ??
        validateOperationPath(operation.targetPath, true) ??
        (operation.sourcePath === operation.targetPath
          ? `Move operation ${operation.operationId} must use different source and target paths.`
          : undefined) ??
        validateChecksum(operation.sourceChecksum, operation.operationId)
      );
    case "create_directory":
      return validateOperationPath(operation.relativePath, false);
    default:
      return "Operation has an unsupported kind.";
  }
}

function validateOperationPath(path: string, filePath: boolean): string | undefined {
  if (filePath) {
    const result = validateAgentRelativePath(path);
    return result.ok
      ? undefined
      : "Operation paths must be canonical project-relative text-file paths.";
  }
  const segments = path.split("/");
  const blockedRoots = new Set([
    ".git",
    ".novel-studio",
    "node_modules",
    "history",
    "dist",
    "build",
    ".cache"
  ]);
  const windowsDeviceName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  if (
    path.length === 0 ||
    path !== path.trim() ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.includes(":") ||
    path.startsWith("/") ||
    path.startsWith("//") ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    segments.some((segment) => windowsDeviceName.test(segment)) ||
    blockedRoots.has((segments[0] ?? "").toLowerCase())
  ) {
    return "Operation paths must be canonical project-relative paths.";
  }
  return undefined;
}

function validateChecksum(checksum: string, operationId: string): string | undefined {
  return /^[a-f0-9]{64}$/.test(checksum)
    ? undefined
    : `Operation ${operationId} must include a lowercase SHA-256 base checksum.`;
}

function isOperationIdentifier(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function operationTargetPath(operation: ChangeSetOperation): string | undefined {
  switch (operation.kind) {
    case "modify":
    case "create_file":
    case "create_directory":
      return operation.relativePath;
    case "move_file":
      return operation.targetPath;
    case "delete_file":
      return undefined;
  }
}

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "" : path.slice(0, separator);
}

function operationDependsOn(
  operation: ChangeSetOperation,
  dependencyId: string,
  operations: ReadonlyMap<string, ChangeSetOperation>
): boolean {
  const visited = new Set<string>();
  const visit = (current: ChangeSetOperation): boolean => {
    for (const dependency of current.dependsOn ?? []) {
      if (dependency === dependencyId) return true;
      if (visited.has(dependency)) continue;
      visited.add(dependency);
      const target = operations.get(dependency);
      if (target !== undefined && visit(target)) return true;
    }
    return false;
  };
  return visit(operation);
}

function selectChangeSetOperations(
  operations: readonly ChangeSetOperation[],
  selections: readonly ChangeSetOperationSelection[] | undefined
): readonly ChangeSetOperation[] {
  if (operations.length === 0) {
    if ((selections?.length ?? 0) > 0) {
      throw changeSetError(
        "CHANGE_SET_SELECTION_INVALID",
        "The selection references lifecycle operations outside this Change Set revision.",
        "Refresh the Change Set before changing the selection."
      );
    }
    return [];
  }
  const byId = new Map(operations.map((operation) => [operation.operationId, operation]));
  const selectedById = new Map(
    (selections ?? []).map((selection) => [selection.operationId, selection])
  );
  for (const selection of selections ?? []) {
    if (!byId.has(selection.operationId)) {
      throw changeSetError(
        "CHANGE_SET_SELECTION_INVALID",
        "The selection references a lifecycle operation outside this Change Set revision.",
        "Refresh the Change Set before changing the selection."
      );
    }
  }
  const selected = operations.map((operation) => ({
    ...operation,
    selected: selectedById.get(operation.operationId)?.selected ?? operation.selected !== false
  }));
  const selectedIds = new Set(
    selected
      .filter((operation) => operation.selected !== false)
      .map((operation) => operation.operationId)
  );
  for (const operation of selected) {
    if (operation.selected === false) continue;
    for (const dependency of operation.dependsOn ?? []) {
      if (!selectedIds.has(dependency)) {
        throw changeSetError(
          "CHANGE_SET_SELECTION_DEPENDENCY_MISSING",
          `Selected operation ${operation.operationId} requires selected dependency ${dependency}.`,
          "Select the operation dependency closure before approval."
        );
      }
    }
  }
  return selected.map(normalizeChangeSetOperation);
}

function effectiveOperationsWritePolicy(
  policy: AgentWritePolicy,
  operations: readonly ChangeSetOperation[]
): AgentWritePolicy {
  return operations.some(
    (operation) =>
      operation.kind === "move_file" ||
      operation.kind === "delete_file" ||
      operation.kind === "create_directory"
  )
    ? "write_before_confirmation"
    : policy;
}

function serializeChangeSetFiles(files: readonly ChangeSetFileChange[]): readonly unknown[] {
  return files.map((file) => ({
    relativePath: file.relativePath,
    assetType: file.assetType,
    assetId: file.assetId ?? null,
    consistencyGroupId: file.consistencyGroupId ?? null,
    storyBibleStatusProof: file.storyBibleStatusProof ?? null,
    baseChecksum: file.baseChecksum,
    candidateChecksum: file.candidateChecksum,
    selected: file.selected,
    validation: file.validation,
    hunks: file.hunks.map((hunk) => ({
      hunkId: hunk.hunkId,
      characterRange: hunk.characterRange,
      replacement: hunk.replacement,
      selected: hunk.selected
    }))
  }));
}

function cloneStoryBibleStatusProof(
  proof: StoryBibleStatusTransitionProof
): StoryBibleStatusTransitionProof {
  return proof.action === "delete"
    ? { action: "delete", deletionImpactChecksum: proof.deletionImpactChecksum }
    : {
        action: "restore",
        expectedStatus: proof.expectedStatus,
        historyAuthorizationChecksum: proof.historyAuthorizationChecksum
      };
}

function assertConsistencyGroupsAreIndivisible(
  files: readonly (Pick<DraftFileChange, "consistencyGroupId" | "hunks"> & {
    readonly selected?: boolean;
  })[],
  operations: readonly ChangeSetOperation[]
): void {
  const states = new Map<string, Set<boolean>>();
  for (const file of files) {
    const selections =
      file.hunks.length === 0
        ? [file.selected === true]
        : file.hunks.map((hunk) => hunk.selected);
    for (const selected of selections) {
      addConsistencyGroupState(states, file.consistencyGroupId, selected);
    }
  }
  for (const operation of operations) {
    addConsistencyGroupState(
      states,
      operation.consistencyGroupId,
      operation.selected !== false
    );
  }
  const splitGroupId = [...states.entries()].find(([, selections]) => selections.size > 1)?.[0];
  if (splitGroupId !== undefined) {
    throw changeSetError(
      "CHANGE_SET_CONSISTENCY_GROUP_SPLIT",
      `Consistency group ${splitGroupId} cannot be partially selected.`,
      "Select or reject every change in the consistency group together."
    );
  }
}

function addConsistencyGroupState(
  states: Map<string, Set<boolean>>,
  consistencyGroupId: string | undefined,
  selected: boolean
): void {
  if (consistencyGroupId === undefined) return;
  const groupId = validateConsistencyGroupId(consistencyGroupId);
  const selections = states.get(groupId) ?? new Set<boolean>();
  selections.add(selected);
  states.set(groupId, selections);
}

function validateConsistencyGroupId(consistencyGroupId: string): string {
  if (!isOperationIdentifier(consistencyGroupId)) {
    throw changeSetError(
      "CHANGE_SET_CONSISTENCY_GROUP_INVALID",
      "Consistency group IDs must be stable identifiers up to 128 characters.",
      "Generate a stable consistency group ID before staging the change."
    );
  }
  return consistencyGroupId;
}

function compareIdentifiers(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
