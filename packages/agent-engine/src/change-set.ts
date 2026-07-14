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
}

export interface ChangeSet {
  readonly schemaVersion: "1.0";
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
}

export interface ChangeSetProposal {
  readonly relativePath: string;
  readonly assetType: ChangeSetAssetType;
  readonly assetId?: string;
  readonly baseContent: string;
  readonly baseChecksum: string;
  readonly range: ChangeSetRange;
  readonly replacement: string;
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

export interface SelectChangeSetRevisionInput {
  readonly files: readonly ChangeSetFileSelection[];
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
    schemaVersion: "1.0",
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
