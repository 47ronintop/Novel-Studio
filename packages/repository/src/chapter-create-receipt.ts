import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import type { ChapterCreateApplyReceipt } from "@novel-studio/agent-engine";

const chapterCreateGroupPrefix = "chapter-create-";
const chapterCreateGroupPattern = /^chapter-create-([a-f0-9]{64})$/u;
const chapterIdPattern = /^ch_[A-Za-z0-9_-]+$/u;
const require = createRequire(import.meta.url);

export interface ChapterCreateOperationLike {
  readonly kind: string;
  readonly operationId?: unknown;
  readonly relativePath?: unknown;
  readonly content?: unknown;
  readonly consistencyGroupId?: unknown;
}

export type ChapterCreateCandidateInspection =
  | { readonly kind: "not_formal" }
  | { readonly kind: "invalid"; readonly reason: string }
  | {
      readonly kind: "valid";
      readonly operationId: string;
      readonly consistencyGroupId: string;
      readonly catalogRevision: string;
      readonly chapterId: string;
      readonly relativePath: string;
      readonly order: number;
      readonly volumeId?: string;
      readonly persistedChecksum: string;
    };

/**
 * Inspects the repository-owned shape of a formal chapter create operation. A reserved
 * `chapter-create-*` consistency group is fail-closed if any field is malformed.
 */
export function inspectChapterCreateCandidate(
  operation: ChapterCreateOperationLike
): ChapterCreateCandidateInspection {
  const consistencyGroupId = operation.consistencyGroupId;
  if (
    typeof consistencyGroupId !== "string" ||
    !consistencyGroupId.startsWith(chapterCreateGroupPrefix)
  ) {
    return { kind: "not_formal" };
  }
  if (
    operation.kind !== "create_file" ||
    typeof operation.operationId !== "string" ||
    operation.operationId.length === 0 ||
    typeof operation.relativePath !== "string" ||
    typeof operation.content !== "string"
  ) {
    return { kind: "invalid", reason: "operation shape" };
  }
  const groupMatch = chapterCreateGroupPattern.exec(consistencyGroupId);
  if (groupMatch?.[1] === undefined) {
    return { kind: "invalid", reason: "consistency group" };
  }
  const parsed = parseChapterMarkdown(operation.content);
  if (parsed === undefined) return { kind: "invalid", reason: "chapter serialization" };
  const frontmatter = parsed.frontmatter;
  const chapterId = frontmatter["id"];
  const title = frontmatter["title"];
  const order = frontmatter["order"];
  const volumeId = frontmatter["volumeId"];
  const createdAt = frontmatter["createdAt"];
  const updatedAt = frontmatter["updatedAt"];
  if (
    frontmatter["schemaVersion"] !== "1.0" ||
    frontmatter["type"] !== "chapter" ||
    typeof chapterId !== "string" ||
    !chapterIdPattern.test(chapterId) ||
    typeof title !== "string" ||
    title.length === 0 ||
    title.length > 512 ||
    title !== title.trim() ||
    typeof order !== "number" ||
    !Number.isSafeInteger(order) ||
    order < 1 ||
    frontmatter["status"] !== "draft" ||
    frontmatter["revision"] !== 1 ||
    frontmatter["wordCount"] !== countWords(parsed.body) ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string" ||
    createdAt !== updatedAt ||
    Number.isNaN(Date.parse(createdAt)) ||
    (volumeId !== undefined && (typeof volumeId !== "string" || volumeId.trim().length === 0)) ||
    operation.relativePath !== `chapters/${chapterId}.md`
  ) {
    return { kind: "invalid", reason: "chapter metadata" };
  }
  return {
    kind: "valid",
    operationId: operation.operationId,
    consistencyGroupId,
    catalogRevision: groupMatch[1],
    chapterId,
    relativePath: operation.relativePath,
    order,
    ...(volumeId === undefined ? {} : { volumeId }),
    persistedChecksum: checksum(operation.content)
  };
}

export function buildChapterCreateApplyReceipt(input: {
  readonly changeSetId: string;
  readonly consistencyGroupId: string | undefined;
  readonly operation: ChapterCreateOperationLike;
}): ChapterCreateApplyReceipt | undefined {
  const inspected = inspectChapterCreateCandidate(input.operation);
  if (inspected.kind !== "valid" || inspected.consistencyGroupId !== input.consistencyGroupId) {
    return undefined;
  }
  return {
    schemaVersion: "1.0",
    changeSetId: input.changeSetId,
    consistencyGroupId: inspected.consistencyGroupId,
    operationId: inspected.operationId,
    chapterId: inspected.chapterId,
    relativePath: inspected.relativePath,
    catalogRevision: inspected.catalogRevision,
    order: inspected.order,
    status: "draft",
    revision: 1,
    ...(inspected.volumeId === undefined ? {} : { volumeId: inspected.volumeId }),
    persistedChecksum: inspected.persistedChecksum,
    historyVersionId: null,
    inverse: {
      kind: "delete_file",
      relativePath: inspected.relativePath,
      expectedChecksum: inspected.persistedChecksum
    }
  };
}

export function isChapterCreateReceiptBound(input: {
  readonly receipt: unknown;
  readonly changeSetId: string;
  readonly consistencyGroupId: string | undefined;
  readonly operation: ChapterCreateOperationLike;
  readonly afterChecksum?: string;
}): boolean {
  const expected = buildChapterCreateApplyReceipt(input);
  if (expected === undefined || input.afterChecksum !== undefined) {
    if (expected === undefined) return false;
    if (input.afterChecksum !== expected.persistedChecksum) return false;
  }
  if (!isRecord(input.receipt)) return false;
  const receipt = input.receipt;
  const expectedKeys = Object.keys(expected).sort();
  if (Object.keys(receipt).sort().join("\u0000") !== expectedKeys.join("\u0000")) return false;
  if (
    receipt.schemaVersion !== expected.schemaVersion ||
    receipt.changeSetId !== expected.changeSetId ||
    receipt.consistencyGroupId !== expected.consistencyGroupId ||
    receipt.operationId !== expected.operationId ||
    receipt.chapterId !== expected.chapterId ||
    receipt.relativePath !== expected.relativePath ||
    receipt.catalogRevision !== expected.catalogRevision ||
    receipt.order !== expected.order ||
    receipt.status !== expected.status ||
    receipt.revision !== expected.revision ||
    receipt.persistedChecksum !== expected.persistedChecksum ||
    receipt.historyVersionId !== null ||
    !isRecord(receipt.inverse)
  ) {
    return false;
  }
  const inverse = receipt.inverse;
  return (
    Object.keys(inverse).sort().join("\u0000") === "expectedChecksum\u0000kind\u0000relativePath" &&
    inverse.kind === expected.inverse.kind &&
    inverse.relativePath === expected.inverse.relativePath &&
    inverse.expectedChecksum === expected.inverse.expectedChecksum &&
    (expected.volumeId === undefined
      ? receipt.volumeId === undefined
      : receipt.volumeId === expected.volumeId)
  );
}

function parseChapterMarkdown(
  content: string
): { readonly frontmatter: Record<string, unknown>; readonly body: string } | undefined {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u);
  if (match === null) return undefined;
  let frontmatter: unknown;
  try {
    const { load } = requireYaml();
    frontmatter = load(match[1] ?? "");
  } catch {
    return undefined;
  }
  if (!isRecord(frontmatter)) return undefined;
  return { frontmatter, body: (match[2] ?? "").replace(/^\n/u, "") };
}

function requireYaml(): { readonly load: (source: string) => unknown } {
  // Keep the repository's existing optional runtime dependency lazy for recovery-only callers.
  return require("js-yaml") as { readonly load: (source: string) => unknown };
}

function countWords(body: string): number {
  return body.trim().length === 0 ? 0 : body.trim().split(/\s+/u).length;
}

function checksum(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
