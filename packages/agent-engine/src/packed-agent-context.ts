import { createHash } from "node:crypto";

import type { AgentContextProfileId, AgentContextScope } from "./agent-context-scope.js";
import type {
  AgentContextPrecision,
  AgentContextSourceKind,
  AgentContextTruncationRange
} from "./context-snapshot.js";
import {
  parseProviderSemanticVersionSetV1,
  providerSemanticVersionSetChecksum,
  type ProviderSemanticVersionSetV1
} from "./provider-semantic-version-set.js";

export type AgentContextSelectionPolicy = "automatic" | "explicit" | "pinned";
export type AgentContextPreferenceScope = "automatic" | "run" | "project";

export interface PackedAgentContextSourceManifest {
  readonly refId: string;
  readonly sourceKind: AgentContextSourceKind;
  readonly relativePath?: string;
  readonly assetId?: string;
  readonly sourceRevision: number;
  readonly sourceChecksum: string;
  readonly tokenCount: number;
  readonly precision: AgentContextPrecision;
  readonly state: "active" | "excluded";
  readonly selectionReason: string;
  readonly selectionPolicy: AgentContextSelectionPolicy;
  readonly preferenceScope: AgentContextPreferenceScope;
  readonly priority: number;
  readonly truncationRange: AgentContextTruncationRange | null;
}

export interface PackedAgentContextBlock {
  readonly blockId: string;
  readonly refId: string;
  readonly sourceKind: AgentContextSourceKind;
  readonly order: number;
  readonly role: "user";
  readonly content: string;
  readonly checksum: string;
  readonly tokenCount: number;
  readonly precision: AgentContextPrecision;
  readonly truncationRange: AgentContextTruncationRange | null;
}

export interface PackedAgentContextTokenStats {
  readonly contextTokens: number;
  readonly pinnedTokens: number;
  readonly usedTokens: number;
  readonly safeInputBudget: number;
  readonly remainingTokens: number;
  readonly precision: AgentContextPrecision;
}

export interface PackedAgentContext {
  readonly schemaVersion: "1.0";
  readonly packedContextId: string;
  readonly scope: AgentContextScope;
  readonly contextProfileId: AgentContextProfileId;
  readonly blocks: readonly PackedAgentContextBlock[];
  readonly sources: readonly PackedAgentContextSourceManifest[];
  readonly excludedSources: readonly string[];
  readonly tokenStats: PackedAgentContextTokenStats;
  readonly payloadChecksum: string;
  readonly createdAt: string;
}

export type PackedAgentContextBlockManifest = Omit<PackedAgentContextBlock, "content" | "role">;

/**
 * Legacy manifest written before a packed context carried enough source-selection facts to be
 * reconstructed. It remains readable so an old run can report an explicit unavailable preview.
 */
export interface PackedAgentContextManifestV10 {
  readonly schemaVersion: "1.0";
  readonly packedContextId: string;
  readonly payloadChecksum: string;
  readonly blocks: readonly PackedAgentContextBlockManifest[];
  readonly tokenStats: PackedAgentContextTokenStats;
}

/** Content-free manifest sufficient to rebuild a packed context from its frozen prompt artifact. */
export interface PackedAgentContextManifestV11 extends Omit<
  PackedAgentContextManifestV10,
  "schemaVersion"
> {
  readonly schemaVersion: "1.1";
  readonly scope: AgentContextScope;
  readonly contextProfileId: AgentContextProfileId;
  readonly sources: readonly PackedAgentContextSourceManifest[];
  readonly excludedSources: readonly string[];
  readonly createdAt: string;
}

/**
 * Current manifest. Its checksum binds every content-free audit field, while payloadChecksum
 * deliberately continues to identify only the provider payload.
 */
export interface PackedAgentContextManifestV12 extends Omit<
  PackedAgentContextManifestV11,
  "schemaVersion"
> {
  readonly schemaVersion: "1.2";
  readonly manifestChecksum: string;
}

export interface PackedAgentContextSharingRevisionV2 {
  readonly defaultsRevision: string;
  readonly runGrantRevision: string;
}

/** Message-protocol 2.0 manifest. It is intentionally not a normalized v1.2 view. */
export interface PackedAgentContextManifestV20 extends Omit<
  PackedAgentContextManifestV12,
  "schemaVersion" | "manifestChecksum"
> {
  readonly schemaVersion: "2.0";
  readonly messageOrderVersion: "2.0";
  readonly roundId: string;
  readonly sharing: PackedAgentContextSharingRevisionV2;
  readonly providerSemanticVersionSet: ProviderSemanticVersionSetV1;
  readonly providerSemanticVersionSetChecksum: string;
  readonly manifestChecksum: string;
}

export type PackedAgentContextManifest =
  | PackedAgentContextManifestV10
  | PackedAgentContextManifestV11
  | PackedAgentContextManifestV12
  | PackedAgentContextManifestV20;

export interface PackedAgentContextRebuildSource {
  readonly refId: string;
  readonly sourceKind: AgentContextSourceKind;
  readonly sourceRevision: number;
  /** Exact source body frozen in the historical prompt artifact. */
  readonly sourceContent: string;
  /** Exact provider block derived through the existing source materializer. */
  readonly blockContent: string;
}

export type PackedAgentContextRebuildResult =
  | {
      readonly status: "available";
      readonly packedContext: PackedAgentContext;
    }
  | {
      readonly status: "stale";
      readonly reason:
        | "manifest_invalid"
        | "source_manifest_mismatch"
        | "block_content_mismatch"
        | "manifest_mismatch";
    }
  | {
      readonly status: "unavailable";
      readonly reason: "legacy_manifest" | "source_material_missing";
    };

export interface CreatePackedAgentContextInput {
  readonly scope: AgentContextScope;
  readonly contextProfileId: AgentContextProfileId;
  readonly blocks: readonly Omit<PackedAgentContextBlock, "blockId" | "checksum" | "order">[];
  readonly sources: readonly PackedAgentContextSourceManifest[];
  readonly tokenStats: PackedAgentContextTokenStats;
  readonly createdAt: string;
}

export interface CreatePackedAgentContextManifestV2Input {
  readonly roundId: string;
  readonly sharing: PackedAgentContextSharingRevisionV2;
  readonly providerSemanticVersionSet: ProviderSemanticVersionSetV1;
}

const PACKED_MANIFEST_V2_FIELDS = Object.freeze([
  "schemaVersion",
  "packedContextId",
  "payloadChecksum",
  "scope",
  "contextProfileId",
  "blocks",
  "sources",
  "excludedSources",
  "tokenStats",
  "createdAt",
  "messageOrderVersion",
  "roundId",
  "sharing",
  "providerSemanticVersionSet",
  "providerSemanticVersionSetChecksum",
  "manifestChecksum"
]);

export function createPackedAgentContext(input: CreatePackedAgentContextInput): PackedAgentContext {
  const blocks = input.blocks.map((block, order) => {
    const checksum = checksumText(block.content);
    return {
      ...block,
      blockId: `context_block_${checksum.slice(0, 24)}_${String(order)}`,
      checksum,
      order
    };
  });
  const payloadChecksum = packedAgentContextPayloadChecksum({
    scope: input.scope,
    contextProfileId: input.contextProfileId,
    blocks
  });
  const packed: PackedAgentContext = {
    schemaVersion: "1.0",
    packedContextId: `packed_context_${payloadChecksum.slice(0, 32)}`,
    scope: input.scope,
    contextProfileId: input.contextProfileId,
    blocks,
    sources: [...input.sources],
    excludedSources: input.sources
      .filter((source) => source.state === "excluded")
      .map((source) => source.refId),
    tokenStats: input.tokenStats,
    payloadChecksum,
    createdAt: input.createdAt
  };
  if (!validatePackedAgentContext(packed)) {
    throw new Error("PACKED_AGENT_CONTEXT_INVALID");
  }
  return deepFreeze(packed);
}

export function createPackedAgentContextManifest(
  packed: PackedAgentContext
): PackedAgentContextManifestV12 {
  if (!validatePackedAgentContext(packed)) throw new Error("PACKED_AGENT_CONTEXT_INVALID");
  const unsigned = {
    schemaVersion: "1.2" as const,
    packedContextId: packed.packedContextId,
    payloadChecksum: packed.payloadChecksum,
    scope: structuredClone(packed.scope),
    contextProfileId: packed.contextProfileId,
    blocks: packed.blocks.map(({ content: _content, role: _role, ...block }) => {
      void _content;
      void _role;
      return block;
    }),
    sources: packed.sources.map((source) => ({ ...source })),
    excludedSources: [...packed.excludedSources],
    tokenStats: { ...packed.tokenStats },
    createdAt: packed.createdAt
  };
  return deepFreeze({
    ...unsigned,
    manifestChecksum: packedAgentContextManifestChecksum(unsigned)
  });
}

/** Strict 2.0 writer. The legacy writer above remains available only for historical run paths. */
export function createPackedAgentContextManifestV2(
  packed: PackedAgentContext,
  input: CreatePackedAgentContextManifestV2Input
): PackedAgentContextManifestV20 {
  if (!validatePackedAgentContext(packed) || !isSafeToken(input.roundId)) {
    throw new Error("PACKED_AGENT_CONTEXT_INVALID");
  }
  if (!isSharingRevisionV2(input.sharing)) throw new Error("PACKED_AGENT_CONTEXT_INVALID");
  let providerSet: ProviderSemanticVersionSetV1;
  try {
    providerSet = parseProviderSemanticVersionSetV1(input.providerSemanticVersionSet);
  } catch {
    throw new Error("PACKED_AGENT_CONTEXT_INVALID");
  }
  const providerChecksum = providerSemanticVersionSetChecksum(providerSet);
  const unsigned = {
    schemaVersion: "2.0" as const,
    packedContextId: packed.packedContextId,
    payloadChecksum: packed.payloadChecksum,
    scope: structuredClone(packed.scope),
    contextProfileId: packed.contextProfileId,
    blocks: packed.blocks.map(({ content: _content, role: _role, ...block }) => {
      void _content;
      void _role;
      return block;
    }),
    sources: packed.sources.map((source) => ({ ...source })),
    excludedSources: [...packed.excludedSources],
    tokenStats: { ...packed.tokenStats },
    createdAt: packed.createdAt,
    messageOrderVersion: "2.0" as const,
    roundId: input.roundId,
    sharing: structuredClone(input.sharing),
    providerSemanticVersionSet: structuredClone(providerSet),
    providerSemanticVersionSetChecksum: providerChecksum
  };
  return parsePackedAgentContextManifestV2({
    ...unsigned,
    manifestChecksum: checksumText(stableSerialize(unsigned))
  });
}

export function parsePackedAgentContextManifestV2(
  value: unknown,
  expectedChecksum?: string
): PackedAgentContextManifestV20 {
  if (!isRecord(value) || !hasExactlyFields(value, PACKED_MANIFEST_V2_FIELDS)) {
    throw new Error("PACKED_AGENT_CONTEXT_MANIFEST_INVALID");
  }
  if (
    value["schemaVersion"] !== "2.0" ||
    value["messageOrderVersion"] !== "2.0" ||
    !isSafeToken(value["roundId"]) ||
    !isSharingRevisionV2(value["sharing"]) ||
    !isStrictContextScope(value["scope"]) ||
    !isContextProfileId(value["contextProfileId"]) ||
    !Array.isArray(value["blocks"]) ||
    !value["blocks"].every(isStrictPackedBlockManifest) ||
    !Array.isArray(value["sources"]) ||
    !value["sources"].every(isStrictPackedSource) ||
    !Array.isArray(value["excludedSources"]) ||
    !value["excludedSources"].every((refId) => typeof refId === "string") ||
    !isStrictTokenStats(value["tokenStats"]) ||
    !isIsoTimestamp(value["createdAt"]) ||
    !isChecksum(value["payloadChecksum"]) ||
    !isChecksum(value["providerSemanticVersionSetChecksum"]) ||
    !isChecksum(value["manifestChecksum"]) ||
    typeof value["packedContextId"] !== "string"
  ) {
    throw new Error("PACKED_AGENT_CONTEXT_MANIFEST_INVALID");
  }
  const blocks = value["blocks"] as unknown as readonly PackedAgentContextBlockManifest[];
  const sources = value["sources"] as unknown as readonly PackedAgentContextSourceManifest[];
  const excludedSources = value["excludedSources"] as unknown as readonly string[];
  if (
    value["packedContextId"] !==
      `packed_context_${String(value["payloadChecksum"]).slice(0, 32)}` ||
    !hasValidPackedRelationships(blocks, sources) ||
    stableSerialize(excludedSources) !==
      stableSerialize(
        sources.filter((source) => source.state === "excluded").map((source) => source.refId)
      )
  ) {
    throw new Error("PACKED_AGENT_CONTEXT_MANIFEST_INVALID");
  }
  let providerSet: ProviderSemanticVersionSetV1;
  try {
    providerSet = parseProviderSemanticVersionSetV1(
      value["providerSemanticVersionSet"],
      value["providerSemanticVersionSetChecksum"] as string
    );
  } catch {
    throw new Error("PACKED_AGENT_CONTEXT_MANIFEST_INVALID");
  }
  const unsigned = {
    schemaVersion: "2.0" as const,
    packedContextId: value["packedContextId"] as string,
    payloadChecksum: value["payloadChecksum"] as string,
    scope: value["scope"] as AgentContextScope,
    contextProfileId: value["contextProfileId"] as AgentContextProfileId,
    blocks,
    sources,
    excludedSources,
    tokenStats: value["tokenStats"] as unknown as PackedAgentContextTokenStats,
    createdAt: value["createdAt"] as string,
    messageOrderVersion: "2.0" as const,
    roundId: value["roundId"] as string,
    sharing: value["sharing"] as unknown as PackedAgentContextSharingRevisionV2,
    providerSemanticVersionSet: providerSet,
    providerSemanticVersionSetChecksum: value["providerSemanticVersionSetChecksum"] as string
  };
  const calculated = checksumText(stableSerialize(unsigned));
  if (
    value["manifestChecksum"] !== calculated ||
    (expectedChecksum !== undefined && calculated !== expectedChecksum)
  ) {
    throw new Error("PACKED_AGENT_CONTEXT_MANIFEST_INVALID");
  }
  return deepFreeze({ ...unsigned, manifestChecksum: calculated });
}

export function serializePackedAgentContextManifestV2(
  value: PackedAgentContextManifestV20
): string {
  return stableSerialize(parsePackedAgentContextManifestV2(value));
}

/** Explicit legacy reader. It never fabricates 2.0 authority, sharing, or semantic-version facts. */
export function readLegacyPackedAgentContextManifest(
  value: unknown
): PackedAgentContextManifestV10 | PackedAgentContextManifestV11 | PackedAgentContextManifestV12 {
  if (!validateLegacyPackedAgentContextManifest(value)) {
    throw new Error("PACKED_AGENT_CONTEXT_MANIFEST_INVALID");
  }
  return deepFreeze(structuredClone(value));
}

/** The canonical checksum for every persisted packed-context audit fact except itself. */
export function packedAgentContextManifestChecksum(
  manifest: Omit<PackedAgentContextManifestV12, "manifestChecksum">
): string {
  return checksumText(
    stableSerialize({
      schemaVersion: manifest.schemaVersion,
      packedContextId: manifest.packedContextId,
      payloadChecksum: manifest.payloadChecksum,
      scope: manifest.scope,
      contextProfileId: manifest.contextProfileId,
      blocks: manifest.blocks,
      sources: manifest.sources,
      excludedSources: manifest.excludedSources,
      tokenStats: manifest.tokenStats,
      createdAt: manifest.createdAt
    })
  );
}

/**
 * Rebuilds through the canonical packed-context constructor and then compares the newly produced
 * manifest byte-for-byte (under stable serialization). No current workspace files are consulted.
 */
export function rebuildPackedAgentContextFromManifest(input: {
  readonly manifest: unknown;
  readonly sources: readonly PackedAgentContextRebuildSource[];
}): PackedAgentContextRebuildResult {
  if (!validatePackedAgentContextManifest(input.manifest)) {
    return { status: "stale", reason: "manifest_invalid" };
  }
  if (input.manifest.schemaVersion === "1.0" || input.manifest.schemaVersion === "1.1") {
    return { status: "unavailable", reason: "legacy_manifest" };
  }
  const manifest = input.manifest;
  const activeSources = manifest.sources.filter((source) => source.state === "active");
  const evidenceByRef = new Map<string, PackedAgentContextRebuildSource>();
  for (const source of input.sources) {
    if (evidenceByRef.has(source.refId)) {
      return { status: "stale", reason: "source_manifest_mismatch" };
    }
    evidenceByRef.set(source.refId, source);
  }
  const expectedRefs = new Set(activeSources.map((source) => source.refId));
  if ([...evidenceByRef.keys()].some((refId) => !expectedRefs.has(refId))) {
    return { status: "stale", reason: "source_manifest_mismatch" };
  }
  if (activeSources.some((source) => !evidenceByRef.has(source.refId))) {
    return { status: "unavailable", reason: "source_material_missing" };
  }
  for (const source of activeSources) {
    const evidence = evidenceByRef.get(source.refId);
    if (
      evidence === undefined ||
      evidence.sourceKind !== source.sourceKind ||
      evidence.sourceRevision !== source.sourceRevision ||
      checksumText(evidence.sourceContent) !== source.sourceChecksum
    ) {
      return { status: "stale", reason: "source_manifest_mismatch" };
    }
  }
  const rebuiltBlocks: Array<CreatePackedAgentContextInput["blocks"][number]> = [];
  for (const block of manifest.blocks) {
    const evidence = evidenceByRef.get(block.refId);
    if (evidence === undefined) {
      return { status: "unavailable", reason: "source_material_missing" };
    }
    if (checksumText(evidence.blockContent) !== block.checksum) {
      return { status: "stale", reason: "block_content_mismatch" };
    }
    rebuiltBlocks.push({
      refId: block.refId,
      sourceKind: block.sourceKind,
      role: "user",
      content: evidence.blockContent,
      tokenCount: block.tokenCount,
      precision: block.precision,
      truncationRange: block.truncationRange
    });
  }
  let rebuilt: PackedAgentContext;
  try {
    rebuilt = createPackedAgentContext({
      scope: manifest.scope,
      contextProfileId: manifest.contextProfileId,
      blocks: rebuiltBlocks,
      sources: manifest.sources,
      tokenStats: manifest.tokenStats,
      createdAt: manifest.createdAt
    });
  } catch {
    return { status: "stale", reason: "manifest_mismatch" };
  }
  const rebuiltManifest =
    manifest.schemaVersion === "2.0"
      ? createPackedAgentContextManifestV2(rebuilt, {
          roundId: manifest.roundId,
          sharing: manifest.sharing,
          providerSemanticVersionSet: manifest.providerSemanticVersionSet
        })
      : createPackedAgentContextManifest(rebuilt);
  return stableSerialize(rebuiltManifest) === stableSerialize(manifest)
    ? { status: "available", packedContext: rebuilt }
    : { status: "stale", reason: "manifest_mismatch" };
}

export function validatePackedAgentContext(value: unknown): value is PackedAgentContext {
  if (!isRecord(value) || value["schemaVersion"] !== "1.0") return false;
  const blocks = value["blocks"];
  const sources = value["sources"];
  const excludedSources = value["excludedSources"];
  if (
    typeof value["packedContextId"] !== "string" ||
    typeof value["payloadChecksum"] !== "string" ||
    !isIsoTimestamp(value["createdAt"]) ||
    !isContextScope(value["scope"]) ||
    !isContextProfileId(value["contextProfileId"]) ||
    !Array.isArray(blocks) ||
    !blocks.every(isPackedBlock) ||
    !Array.isArray(sources) ||
    !sources.every(isPackedSource) ||
    !Array.isArray(excludedSources) ||
    !excludedSources.every((refId) => typeof refId === "string") ||
    !isTokenStats(value["tokenStats"])
  ) {
    return false;
  }
  const excludedRefs = sources
    .filter((source) => source.state === "excluded")
    .map((source) => source.refId);
  if (
    !hasValidPackedRelationships(blocks, sources) ||
    stableSerialize(excludedSources) !== stableSerialize(excludedRefs)
  ) {
    return false;
  }
  const expectedChecksum = packedAgentContextPayloadChecksum({
    scope: value["scope"],
    contextProfileId: value["contextProfileId"],
    blocks
  });
  return (
    value["payloadChecksum"] === expectedChecksum &&
    value["packedContextId"] === `packed_context_${expectedChecksum.slice(0, 32)}`
  );
}

export function validatePackedAgentContextManifest(
  value: unknown
): value is PackedAgentContextManifest {
  if (isRecord(value) && value["schemaVersion"] === "2.0") {
    try {
      parsePackedAgentContextManifestV2(value);
      return true;
    } catch {
      return false;
    }
  }
  return validateLegacyPackedAgentContextManifest(value);
}

function validateLegacyPackedAgentContextManifest(
  value: unknown
): value is
  PackedAgentContextManifestV10 | PackedAgentContextManifestV11 | PackedAgentContextManifestV12 {
  if (
    !isRecord(value) ||
    (value["schemaVersion"] !== "1.0" &&
      value["schemaVersion"] !== "1.1" &&
      value["schemaVersion"] !== "1.2")
  ) {
    return false;
  }
  const blocks = value["blocks"];
  const baseValid =
    typeof value["packedContextId"] === "string" &&
    isChecksum(value["payloadChecksum"]) &&
    Array.isArray(blocks) &&
    blocks.every(isPackedBlockManifest) &&
    hasCanonicalBlockOrder(blocks) &&
    isTokenStats(value["tokenStats"]);
  if (
    !baseValid ||
    value["packedContextId"] !== `packed_context_${String(value["payloadChecksum"]).slice(0, 32)}`
  ) {
    return false;
  }
  if (value["schemaVersion"] === "1.0") return true;
  const sources = value["sources"];
  const excludedSources = value["excludedSources"];
  if (
    !isContextScope(value["scope"]) ||
    !isContextProfileId(value["contextProfileId"]) ||
    !Array.isArray(sources) ||
    !sources.every(isPackedSource) ||
    !Array.isArray(excludedSources) ||
    !excludedSources.every((refId) => typeof refId === "string") ||
    !isIsoTimestamp(value["createdAt"]) ||
    !hasValidPackedRelationships(blocks, sources)
  ) {
    return false;
  }
  const expectedExcluded = sources
    .filter((source) => source.state === "excluded")
    .map((source) => source.refId);
  if (stableSerialize(excludedSources) !== stableSerialize(expectedExcluded)) return false;
  if (value["schemaVersion"] === "1.1") return true;
  return (
    isChecksum(value["manifestChecksum"]) &&
    value["manifestChecksum"] ===
      packedAgentContextManifestChecksum({
        schemaVersion: "1.2",
        packedContextId: value["packedContextId"],
        payloadChecksum: String(value["payloadChecksum"]),
        scope: value["scope"],
        contextProfileId: value["contextProfileId"],
        blocks,
        sources,
        excludedSources,
        tokenStats: value["tokenStats"] as PackedAgentContextTokenStats,
        createdAt: value["createdAt"]
      })
  );
}

export function packedAgentContextPayloadChecksum(input: {
  readonly scope: AgentContextScope;
  readonly contextProfileId: AgentContextProfileId;
  readonly blocks: readonly Pick<
    PackedAgentContextBlock,
    "blockId" | "refId" | "sourceKind" | "order" | "role" | "content"
  >[];
}): string {
  return checksumText(
    stableSerialize({
      schemaVersion: "1.0",
      scope: input.scope,
      contextProfileId: input.contextProfileId,
      blocks: input.blocks.map((block) => ({
        blockId: block.blockId,
        refId: block.refId,
        sourceKind: block.sourceKind,
        order: block.order,
        role: block.role,
        content: block.content
      }))
    })
  );
}

function isPackedBlock(value: unknown): value is PackedAgentContextBlock {
  return (
    isRecord(value) &&
    value["role"] === "user" &&
    typeof value["content"] === "string" &&
    value["checksum"] === checksumText(value["content"]) &&
    isPackedBlockManifest(value)
  );
}

function isPackedBlockManifest(value: unknown): value is PackedAgentContextBlockManifest {
  return (
    isRecord(value) &&
    typeof value["blockId"] === "string" &&
    typeof value["refId"] === "string" &&
    isSourceKind(value["sourceKind"]) &&
    isNonNegativeInteger(value["order"]) &&
    isChecksum(value["checksum"]) &&
    isNonNegativeInteger(value["tokenCount"]) &&
    isPrecision(value["precision"]) &&
    (value["truncationRange"] === null || isTruncationRange(value["truncationRange"]))
  );
}

function isStrictPackedBlockManifest(value: unknown): value is PackedAgentContextBlockManifest {
  return (
    isRecord(value) &&
    hasExactlyFields(value, [
      "blockId",
      "refId",
      "sourceKind",
      "order",
      "checksum",
      "tokenCount",
      "precision",
      "truncationRange"
    ]) &&
    isPackedBlockManifest(value)
  );
}

function hasCanonicalBlockOrder(blocks: readonly PackedAgentContextBlockManifest[]): boolean {
  return blocks.every(
    (block, order) =>
      block.order === order &&
      block.blockId === `context_block_${block.checksum.slice(0, 24)}_${String(order)}`
  );
}

function hasValidPackedRelationships(
  blocks: readonly PackedAgentContextBlockManifest[],
  sources: readonly PackedAgentContextSourceManifest[]
): boolean {
  const refs = sources.map((source) => source.refId);
  const activeSources = sources.filter((source) => source.state === "active");
  const firstExcluded = sources.findIndex((source) => source.state === "excluded");
  if (
    new Set(refs).size !== refs.length ||
    new Set(blocks.map((block) => block.refId)).size !== blocks.length ||
    !hasCanonicalBlockOrder(blocks) ||
    blocks.length !== activeSources.length ||
    (firstExcluded >= 0 &&
      sources.slice(firstExcluded).some((source) => source.state !== "excluded"))
  ) {
    return false;
  }
  return blocks.every((block, order) => {
    const source = activeSources[order];
    return (
      source !== undefined &&
      block.refId === source.refId &&
      block.sourceKind === source.sourceKind &&
      block.tokenCount === source.tokenCount &&
      block.precision === source.precision &&
      stableSerialize(block.truncationRange) === stableSerialize(source.truncationRange)
    );
  });
}

function isPackedSource(value: unknown): value is PackedAgentContextSourceManifest {
  return (
    isRecord(value) &&
    typeof value["refId"] === "string" &&
    isSourceKind(value["sourceKind"]) &&
    (value["relativePath"] === undefined || typeof value["relativePath"] === "string") &&
    (value["assetId"] === undefined || typeof value["assetId"] === "string") &&
    isNonNegativeInteger(value["sourceRevision"]) &&
    isChecksum(value["sourceChecksum"]) &&
    isNonNegativeInteger(value["tokenCount"]) &&
    isPrecision(value["precision"]) &&
    (value["state"] === "active" || value["state"] === "excluded") &&
    typeof value["selectionReason"] === "string" &&
    value["selectionReason"].length > 0 &&
    (value["selectionPolicy"] === "automatic" ||
      value["selectionPolicy"] === "explicit" ||
      value["selectionPolicy"] === "pinned") &&
    (value["preferenceScope"] === "automatic" ||
      value["preferenceScope"] === "run" ||
      value["preferenceScope"] === "project") &&
    isPriority(value["priority"]) &&
    (value["truncationRange"] === null || isTruncationRange(value["truncationRange"]))
  );
}

function isStrictPackedSource(value: unknown): value is PackedAgentContextSourceManifest {
  if (!isRecord(value)) return false;
  const expected = [
    "refId",
    "sourceKind",
    ...(value["relativePath"] === undefined ? [] : ["relativePath"]),
    ...(value["assetId"] === undefined ? [] : ["assetId"]),
    "sourceRevision",
    "sourceChecksum",
    "tokenCount",
    "precision",
    "state",
    "selectionReason",
    "selectionPolicy",
    "preferenceScope",
    "priority",
    "truncationRange"
  ];
  return hasExactlyFields(value, expected) && isPackedSource(value);
}

function isTokenStats(value: unknown): value is PackedAgentContextTokenStats {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value["contextTokens"]) &&
    isNonNegativeInteger(value["pinnedTokens"]) &&
    isNonNegativeInteger(value["usedTokens"]) &&
    isNonNegativeInteger(value["safeInputBudget"]) &&
    isNonNegativeInteger(value["remainingTokens"]) &&
    isPrecision(value["precision"])
  );
}

function isStrictTokenStats(value: unknown): value is PackedAgentContextTokenStats {
  return (
    isRecord(value) &&
    hasExactlyFields(value, [
      "contextTokens",
      "pinnedTokens",
      "usedTokens",
      "safeInputBudget",
      "remainingTokens",
      "precision"
    ]) &&
    isTokenStats(value)
  );
}

function isContextScope(value: unknown): value is AgentContextScope {
  return (
    isRecord(value) &&
    ((value["kind"] === "standalone" && typeof value["scopeId"] === "string") ||
      (value["kind"] === "workspace" &&
        (value["workspaceKind"] === "creativeProject" ||
          value["workspaceKind"] === "engineeringWorkspace") &&
        typeof value["workspaceId"] === "string"))
  );
}

function isStrictContextScope(value: unknown): value is AgentContextScope {
  if (!isRecord(value)) return false;
  const expected =
    value["kind"] === "standalone" ? ["kind", "scopeId"] : ["kind", "workspaceKind", "workspaceId"];
  return hasExactlyFields(value, expected) && isContextScope(value);
}

function isSharingRevisionV2(value: unknown): value is PackedAgentContextSharingRevisionV2 {
  return (
    isRecord(value) &&
    hasExactlyFields(value, ["defaultsRevision", "runGrantRevision"]) &&
    isSafeToken(value["defaultsRevision"]) &&
    isSafeToken(value["runGrantRevision"])
  );
}

function isContextProfileId(value: unknown): value is AgentContextProfileId {
  return (
    value === "standalone" ||
    value === "writing" ||
    value === "creative_general" ||
    value === "engineering"
  );
}

function isSourceKind(value: unknown): value is AgentContextSourceKind {
  return (
    value === "disk_file" ||
    value === "editor_buffer" ||
    value === "story_bible_asset" ||
    value === "project_conventions" ||
    value === "workspace_outline" ||
    value === "compaction_summary" ||
    value === "system_guidance"
  );
}

function isTruncationRange(value: unknown): value is AgentContextTruncationRange {
  return (
    isRecord(value) &&
    value["unit"] === "unicode_code_point" &&
    isNonNegativeInteger(value["start"]) &&
    isNonNegativeInteger(value["end"]) &&
    isNonNegativeInteger(value["originalEnd"]) &&
    value["start"] <= value["end"] &&
    value["end"] <= value["originalEnd"]
  );
}

function isPrecision(value: unknown): value is AgentContextPrecision {
  return value === "reported" || value === "estimated" || value === "unknown";
}

function isPriority(value: unknown): value is number {
  return isNonNegativeInteger(value) && value <= 100;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isSafeToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    // eslint-disable-next-line no-control-regex -- Persisted identities reject controls.
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function hasExactlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checksumText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
