import { createHash } from "node:crypto";

import { validateStoryBibleWriteCandidate } from "@novel-studio/schemas";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type JsonValue,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

export type StoryBiblePatchOperation =
  | { readonly op: "add" | "replace"; readonly path: string; readonly value: JsonValue }
  | { readonly op: "remove"; readonly path: string };

export type StoryBibleStableEntryCollection =
  | "volumes"
  | "chapterOutlines"
  | "beats"
  | "events"
  | "knowledgeStates"
  | "stateHistory"
  | "milestones";

export interface StoryBiblePatchEntryRef {
  readonly collection: StoryBibleStableEntryCollection;
  readonly entryId: string;
  readonly baseEntryRevision: number;
  /** Required only for a beat nested inside one chapter outline. */
  readonly parentEntryId?: string;
}

export interface StoryBiblePatchDependency {
  readonly path: string;
  readonly valueChecksum: string;
}

export interface StoryBiblePatchAsset extends JsonObject {
  readonly schemaVersion: "1.1";
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly status: string;
  readonly summary: string;
  readonly aliases: string[];
  readonly relations: JsonObject[];
  readonly details: JsonObject;
  readonly extensions: JsonObject;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
  readonly passthrough?: JsonObject;
}

export interface PrepareStoryBiblePatchInput {
  readonly asset: StoryBiblePatchAsset;
  readonly baseRevision: number;
  readonly entryRef?: StoryBiblePatchEntryRef | null;
  readonly operations: readonly StoryBiblePatchOperation[];
  readonly dependencies?: readonly StoryBiblePatchDependency[];
  readonly knownAssetIds?: ReadonlySet<string>;
  readonly registeredExtensionNamespaces?: ReadonlySet<string>;
}

export interface PreparedStoryBiblePatch {
  readonly candidate: JsonObject;
  readonly latestBaseRevision: number;
  readonly rebased: boolean;
  readonly changedPaths: readonly string[];
  readonly entryRevision?: number;
}

const ROOT_WRITE_FIELDS = [
  "schemaVersion",
  "id",
  "type",
  "title",
  "status",
  "summary",
  "aliases",
  "relations",
  "details",
  "extensions",
  "createdAt"
] as const;

const PROTECTED_ROOT_FIELDS = new Set([
  "schemaVersion",
  "id",
  "type",
  "createdAt",
  "updatedAt",
  "revision",
  "passthrough",
  "relatedEntityIds"
]);

const ENTRY_ID_FIELDS: Readonly<Record<StoryBibleStableEntryCollection, string>> = {
  volumes: "volumeId",
  chapterOutlines: "chapterOutlineId",
  beats: "beatId",
  events: "eventId",
  knowledgeStates: "knowledgeStateId",
  stateHistory: "stateHistoryId",
  milestones: "milestoneId"
};

export function prepareStoryBiblePatch(
  input: PrepareStoryBiblePatchInput
): Result<PreparedStoryBiblePatch, UnifiedError> {
  if (input.operations.length === 0 || input.operations.length > 100) {
    return err(patchError("STORY_BIBLE_PATCH_INVALID", "Patch must contain 1 to 100 operations."));
  }
  const dependencyCheck = validateDependencies(input.asset, input.dependencies ?? []);
  if (!dependencyCheck.ok) return dependencyCheck;

  const candidate = selectWriteCandidate(input.asset);
  const entryRef = input.entryRef ?? null;
  if (entryRef === null && input.baseRevision !== input.asset.revision) {
    return err(revisionConflict(input.asset.revision));
  }

  let target: JsonObject = candidate;
  let nextEntryRevision: number | undefined;
  if (entryRef !== null) {
    const entry = findStableEntry(candidate, entryRef);
    if (!entry.ok) return entry;
    const currentEntryRevision = entry.value["entryRevision"];
    if (
      !Number.isSafeInteger(currentEntryRevision) ||
      currentEntryRevision !== entryRef.baseEntryRevision
    ) {
      return err(
        patchError(
          "STORY_BIBLE_ENTRY_REVISION_CONFLICT",
          "The Story Bible child entry changed after the patch was prepared.",
          {
            entryId: entryRef.entryId,
            currentEntryRevision: Number.isSafeInteger(currentEntryRevision)
              ? Number(currentEntryRevision)
              : null
          }
        )
      );
    }
    target = entry.value;
    nextEntryRevision = entryRef.baseEntryRevision + 1;
  }

  const changedPaths: string[] = [];
  for (const operation of input.operations) {
    const applied = applyRestrictedOperation(target, operation, entryRef);
    if (!applied.ok) return applied;
    changedPaths.push(
      entryRef === null
        ? operation.path
        : `/details/${entryRef.collection}/${entryRef.entryId}${operation.path}`
    );
  }
  if (nextEntryRevision !== undefined) target["entryRevision"] = nextEntryRevision;

  const legacyPassthrough = input.asset.passthrough;
  const validation = validateStoryBibleWriteCandidate(candidate, {
    ...(input.knownAssetIds === undefined ? {} : { knownAssetIds: input.knownAssetIds }),
    ...(input.registeredExtensionNamespaces === undefined
      ? {}
      : { registeredExtensionNamespaces: input.registeredExtensionNamespaces }),
    allowLegacyId:
      input.asset.revision === 0 ||
      (isRecord(legacyPassthrough) && legacyPassthrough["sourceSchemaVersion"] === "1.0")
  });
  if (!validation.valid) {
    return err(
      patchError("STORY_BIBLE_CANDIDATE_INVALID", "Patched Story Bible candidate is invalid.", {
        issues: validation.issues.map((issue) => ({
          instancePath: issue.instancePath,
          schemaPath: issue.schemaPath,
          keyword: issue.keyword,
          message: issue.message
        }))
      })
    );
  }

  return ok({
    candidate,
    latestBaseRevision: input.asset.revision,
    rebased: entryRef !== null && input.baseRevision !== input.asset.revision,
    changedPaths,
    ...(nextEntryRevision === undefined ? {} : { entryRevision: nextEntryRevision })
  });
}

export function checksumStoryBibleSelectorValue(value: JsonValue | undefined): string {
  return createHash("sha256").update(stableJson(value), "utf8").digest("hex");
}

function validateDependencies(
  asset: StoryBiblePatchAsset,
  dependencies: readonly StoryBiblePatchDependency[]
): Result<void, UnifiedError> {
  for (const dependency of dependencies) {
    const read = readPointer(asset, dependency.path);
    if (!read.ok || checksumStoryBibleSelectorValue(read.value) !== dependency.valueChecksum) {
      return err(
        patchError(
          "STORY_BIBLE_PATCH_DEPENDENCY_CONFLICT",
          "A Story Bible field used by the patch has changed.",
          { path: dependency.path }
        )
      );
    }
  }
  return ok(undefined);
}

function selectWriteCandidate(asset: StoryBiblePatchAsset): JsonObject {
  const candidate: JsonObject = {};
  for (const field of ROOT_WRITE_FIELDS) {
    const value = asset[field];
    if (value !== undefined) candidate[field] = structuredClone(value);
  }
  return candidate;
}

function findStableEntry(
  candidate: JsonObject,
  ref: StoryBiblePatchEntryRef
): Result<JsonObject, UnifiedError> {
  const details = candidate["details"];
  if (!isRecord(details)) return err(entryNotFound(ref));
  if (ref.collection === "beats") {
    if (ref.parentEntryId === undefined) return err(entryNotFound(ref));
    const chapter = objectArray(details["chapterOutlines"]).find(
      (entry) => entry["chapterOutlineId"] === ref.parentEntryId
    );
    const beat = objectArray(chapter?.["beats"]).find((entry) => entry["beatId"] === ref.entryId);
    return beat === undefined ? err(entryNotFound(ref)) : ok(beat);
  }
  const key = ENTRY_ID_FIELDS[ref.collection];
  const entry = objectArray(details[ref.collection]).find(
    (candidateEntry) => candidateEntry[key] === ref.entryId
  );
  return entry === undefined ? err(entryNotFound(ref)) : ok(entry);
}

function applyRestrictedOperation(
  target: JsonObject,
  operation: StoryBiblePatchOperation,
  entryRef: StoryBiblePatchEntryRef | null
): Result<void, UnifiedError> {
  const segments = parsePointer(operation.path);
  if (segments === undefined || segments.length === 0) {
    return err(patchError("STORY_BIBLE_PATCH_INVALID", "Patch paths must target one field."));
  }
  if (entryRef === null && PROTECTED_ROOT_FIELDS.has(segments[0] ?? "")) {
    return err(
      patchError("STORY_BIBLE_PATCH_FIELD_FORBIDDEN", "The patch targets a system-managed field.")
    );
  }
  if (
    entryRef !== null &&
    (segments[0] === ENTRY_ID_FIELDS[entryRef.collection] || segments[0] === "entryRevision")
  ) {
    return err(
      patchError(
        "STORY_BIBLE_PATCH_FIELD_FORBIDDEN",
        "Stable entry identity and revision are system-managed."
      )
    );
  }

  let parent = target;
  for (const segment of segments.slice(0, -1)) {
    if (/^(?:0|[1-9][0-9]*|-)$/u.test(segment)) {
      return err(
        patchError(
          "STORY_BIBLE_PATCH_ARRAY_INDEX_FORBIDDEN",
          "Patch paths must not address arrays by index."
        )
      );
    }
    const child = parent[segment];
    if (Array.isArray(child)) {
      return err(
        patchError(
          "STORY_BIBLE_PATCH_ARRAY_INDEX_FORBIDDEN",
          "Patch paths must not address arrays by index."
        )
      );
    }
    if (!isRecord(child)) {
      return err(
        patchError("STORY_BIBLE_PATCH_PATH_NOT_FOUND", "The patch parent path does not exist.")
      );
    }
    parent = child;
  }
  const key = segments.at(-1);
  if (key === undefined || /^(?:0|[1-9][0-9]*|-)$/u.test(key)) {
    return err(
      patchError(
        "STORY_BIBLE_PATCH_ARRAY_INDEX_FORBIDDEN",
        "Patch paths must not address arrays by index."
      )
    );
  }
  const exists = Object.prototype.hasOwnProperty.call(parent, key);
  if (operation.op === "remove") {
    if (!exists)
      return err(patchError("STORY_BIBLE_PATCH_PATH_NOT_FOUND", "The patch field does not exist."));
    Reflect.deleteProperty(parent, key);
    return ok(undefined);
  }
  if (operation.op === "replace" && !exists) {
    return err(
      patchError("STORY_BIBLE_PATCH_PATH_NOT_FOUND", "The replacement field does not exist.")
    );
  }
  parent[key] = structuredClone(operation.value);
  return ok(undefined);
}

function readPointer(
  value: JsonObject,
  pointer: string
): Result<JsonValue | undefined, UnifiedError> {
  const segments = parsePointer(pointer);
  if (segments === undefined) {
    return err(
      patchError("STORY_BIBLE_PATCH_INVALID", "Dependency selectors must be JSON Pointers.")
    );
  }
  let current: JsonValue = value;
  for (const segment of segments) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return err(
        patchError("STORY_BIBLE_PATCH_PATH_NOT_FOUND", "The dependency selector does not exist.")
      );
    }
    current = current[segment] as JsonValue;
  }
  return ok(current);
}

function parsePointer(pointer: string): string[] | undefined {
  if (!pointer.startsWith("/") || pointer.includes("\0")) return undefined;
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function entryNotFound(ref: StoryBiblePatchEntryRef): UnifiedError {
  return patchError(
    "STORY_BIBLE_ENTRY_NOT_FOUND",
    "The stable Story Bible child entry does not exist.",
    {
      collection: ref.collection,
      entryId: ref.entryId
    }
  );
}

function revisionConflict(currentRevision: number): UnifiedError {
  return patchError(
    "STORY_BIBLE_REVISION_CONFLICT",
    "The Story Bible asset changed after the patch was prepared.",
    { currentRevision }
  );
}

function patchError(code: string, message: string, detail?: JsonObject): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message,
    recoverability: "user-action",
    suggestedAction: "Refresh the Story Bible entry and prepare the patch again.",
    traceId: "story-bible-candidate-validator",
    ...(detail === undefined ? {} : { redactedDetail: detail })
  });
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJson(value: JsonValue | undefined): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
