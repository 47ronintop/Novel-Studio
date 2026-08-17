import { createHash } from "node:crypto";

import type { JsonObject } from "@novel-studio/shared";

import {
  parseProviderSemanticVersionSetV1,
  providerSemanticVersionSetChecksum,
  type ProviderSemanticVersionSetV1
} from "./provider-semantic-version-set.js";

export const CANONICAL_ROUND_MANIFEST_SCHEMA_VERSION = "2.0" as const;
export const CANONICAL_MESSAGE_ORDER_VERSION = "2.0" as const;

export type CanonicalRoundEnvelopeKindV2 =
  | "untrusted_project_data"
  | "untrusted_conversation_data"
  | "untrusted_remote_data"
  | "untrusted_tool_data"
  | "untrusted_recovery_data";

export type CanonicalRoundMessageKindV2 =
  | "project_conventions"
  | "prior_conversation"
  | "compaction"
  | "workspace_outline"
  | "explicit_reference"
  | "active_resource"
  | "current_user_request"
  | "assistant"
  | "tool_result"
  | "remote_result"
  | "user_control"
  | "context_notice"
  | "recovery";

export interface CanonicalRoundToolCallV2 {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
  readonly providerMetadata: JsonObject | null;
}

export interface CanonicalRoundSourceRefV2 {
  readonly refId: string;
  readonly sourceKind: Exclude<
    CanonicalRoundMessageKindV2,
    "current_user_request" | "assistant" | "user_control"
  >;
  readonly sourceRevision: string;
  readonly sourceChecksum: string;
  readonly messageOrder: number;
}

export interface CanonicalRoundMessageV2 {
  readonly order: number;
  readonly kind: CanonicalRoundMessageKindV2;
  readonly role: "user" | "assistant" | "tool";
  readonly content: string;
  readonly contentChecksum: string;
  readonly sourceRefId: string | null;
  readonly envelopeKind: CanonicalRoundEnvelopeKindV2 | null;
  readonly toolCallId: string | null;
  readonly toolCalls: readonly CanonicalRoundToolCallV2[];
}

export interface CanonicalRoundAuthorityV2 {
  readonly role: "system";
  readonly content: string;
  readonly contentChecksum: string;
}

export interface CanonicalRoundToolProjectionV2 {
  readonly schemaVersion: "2.0";
  readonly catalogRevision: string;
  readonly descriptors: readonly JsonObject[];
  readonly projectionChecksum: string;
}

export interface CanonicalRoundSharingRevisionV2 {
  readonly defaultsRevision: string;
  readonly runGrantRevision: string;
}

export interface CanonicalRoundManifestV2 {
  readonly schemaVersion: typeof CANONICAL_ROUND_MANIFEST_SCHEMA_VERSION;
  readonly kind: "canonical_round_manifest";
  readonly roundId: string;
  readonly runId: string;
  readonly roundNumber: number;
  readonly messageOrderVersion: typeof CANONICAL_MESSAGE_ORDER_VERSION;
  readonly authority: CanonicalRoundAuthorityV2;
  readonly tools: CanonicalRoundToolProjectionV2;
  readonly sharing: CanonicalRoundSharingRevisionV2;
  readonly providerSemanticVersionSet: ProviderSemanticVersionSetV1;
  readonly providerSemanticVersionSetChecksum: string;
  readonly packedContextManifestChecksum: string | null;
  readonly messages: readonly CanonicalRoundMessageV2[];
  readonly sourceRefs: readonly CanonicalRoundSourceRefV2[];
  readonly manifestChecksum: string;
}

export interface CreateCanonicalRoundMessageV2Input {
  readonly kind: CanonicalRoundMessageKindV2;
  readonly role: CanonicalRoundMessageV2["role"];
  readonly content: string;
  readonly source?: Omit<CanonicalRoundSourceRefV2, "messageOrder">;
  readonly envelopeKind?: CanonicalRoundEnvelopeKindV2;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly {
    readonly id: string;
    readonly name: string;
    readonly arguments: string;
    readonly providerMetadata?: JsonObject;
  }[];
}

export interface CreateCanonicalRoundManifestV2Input {
  readonly roundId: string;
  readonly runId: string;
  readonly roundNumber: number;
  readonly authority: string;
  readonly toolCatalogRevision: string;
  readonly projectedToolDescriptors: readonly JsonObject[];
  readonly sharing: CanonicalRoundSharingRevisionV2;
  readonly providerSemanticVersionSet: ProviderSemanticVersionSetV1;
  readonly packedContextManifestChecksum?: string | null;
  readonly messages: readonly CreateCanonicalRoundMessageV2Input[];
}

const MANIFEST_FIELDS = Object.freeze([
  "schemaVersion",
  "kind",
  "roundId",
  "runId",
  "roundNumber",
  "messageOrderVersion",
  "authority",
  "tools",
  "sharing",
  "providerSemanticVersionSet",
  "providerSemanticVersionSetChecksum",
  "packedContextManifestChecksum",
  "messages",
  "sourceRefs",
  "manifestChecksum"
]);
const MESSAGE_FIELDS = Object.freeze([
  "order",
  "kind",
  "role",
  "content",
  "contentChecksum",
  "sourceRefId",
  "envelopeKind",
  "toolCallId",
  "toolCalls"
]);
const SOURCE_FIELDS = Object.freeze([
  "refId",
  "sourceKind",
  "sourceRevision",
  "sourceChecksum",
  "messageOrder"
]);
const TOOL_CALL_FIELDS = Object.freeze(["id", "name", "arguments", "providerMetadata"]);
const CHECKSUM = /^[a-f0-9]{64}$/u;
const FORBIDDEN_TRANSPORT_KEYS = new Set([
  "abortSignal",
  "apiKey",
  "authorization",
  "cacheHandle",
  "cacheResourceHandle",
  "requestId",
  "secret",
  "secretHeader",
  "transportSecret"
]);

export function createCanonicalRoundManifestV2(
  input: CreateCanonicalRoundManifestV2Input
): CanonicalRoundManifestV2 {
  const providerSet = parseProviderSemanticVersionSetV1(input.providerSemanticVersionSet);
  const providerSetChecksum = providerSemanticVersionSetChecksum(providerSet);
  assertSafeToken(input.roundId);
  assertSafeToken(input.runId);
  assertSafeToken(input.toolCatalogRevision);
  assertSafeToken(input.sharing.defaultsRevision);
  assertSafeToken(input.sharing.runGrantRevision);
  if (!isNonNegativeInteger(input.roundNumber) || input.authority.length === 0) invalid();
  if (!input.projectedToolDescriptors.every(isCanonicalJsonObject)) invalid();
  const descriptors = structuredClone(input.projectedToolDescriptors);
  const tools: CanonicalRoundToolProjectionV2 = {
    schemaVersion: "2.0",
    catalogRevision: input.toolCatalogRevision,
    descriptors,
    projectionChecksum: checksumText(
      canonicalSerialize({
        schemaVersion: "2.0",
        catalogRevision: input.toolCatalogRevision,
        descriptors
      })
    )
  };
  const messages: CanonicalRoundMessageV2[] = [];
  const sourceRefs: CanonicalRoundSourceRefV2[] = [];
  for (const [order, candidate] of input.messages.entries()) {
    const source = candidate.source;
    const message: CanonicalRoundMessageV2 = {
      order,
      kind: candidate.kind,
      role: candidate.role,
      content: candidate.content,
      contentChecksum: checksumText(candidate.content),
      sourceRefId: source?.refId ?? null,
      envelopeKind: candidate.envelopeKind ?? null,
      toolCallId: candidate.toolCallId ?? null,
      toolCalls: (candidate.toolCalls ?? []).map((call) => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments,
        providerMetadata:
          call.providerMetadata === undefined ? null : structuredClone(call.providerMetadata)
      }))
    };
    messages.push(message);
    if (source !== undefined) sourceRefs.push({ ...source, messageOrder: order });
  }
  const unsigned = {
    schemaVersion: CANONICAL_ROUND_MANIFEST_SCHEMA_VERSION,
    kind: "canonical_round_manifest" as const,
    roundId: input.roundId,
    runId: input.runId,
    roundNumber: input.roundNumber,
    messageOrderVersion: CANONICAL_MESSAGE_ORDER_VERSION,
    authority: {
      role: "system" as const,
      content: input.authority,
      contentChecksum: checksumText(input.authority)
    },
    tools,
    sharing: structuredClone(input.sharing),
    providerSemanticVersionSet: structuredClone(providerSet),
    providerSemanticVersionSetChecksum: providerSetChecksum,
    packedContextManifestChecksum: input.packedContextManifestChecksum ?? null,
    messages,
    sourceRefs
  };
  const manifest = {
    ...unsigned,
    manifestChecksum: checksumText(canonicalSerialize(unsigned))
  };
  return parseCanonicalRoundManifestV2(manifest);
}

export function parseCanonicalRoundManifestV2(
  value: unknown,
  expectedChecksum?: string
): CanonicalRoundManifestV2 {
  if (!isRecord(value) || !hasExactlyFields(value, MANIFEST_FIELDS)) invalid();
  if (
    value["schemaVersion"] !== CANONICAL_ROUND_MANIFEST_SCHEMA_VERSION ||
    value["kind"] !== "canonical_round_manifest" ||
    value["messageOrderVersion"] !== CANONICAL_MESSAGE_ORDER_VERSION ||
    !isSafeToken(value["roundId"]) ||
    !isSafeToken(value["runId"]) ||
    !isNonNegativeInteger(value["roundNumber"])
  ) {
    invalid();
  }
  const authority = parseAuthority(value["authority"]);
  const tools = parseTools(value["tools"]);
  const sharing = parseSharing(value["sharing"]);
  const providerSetChecksum = value["providerSemanticVersionSetChecksum"];
  if (!isChecksum(providerSetChecksum)) invalid();
  const providerSet = parseProviderSemanticVersionSetV1(
    value["providerSemanticVersionSet"],
    providerSetChecksum
  );
  const packedChecksum = value["packedContextManifestChecksum"];
  if (packedChecksum !== null && !isChecksum(packedChecksum)) invalid();
  const messages = parseMessages(value["messages"]);
  const sourceRefs = parseSourceRefs(value["sourceRefs"]);
  if (!hasCanonicalMessageAndSourceOrder(messages, sourceRefs)) invalid();
  const manifestChecksum = value["manifestChecksum"];
  if (!isChecksum(manifestChecksum)) invalid();
  const unsigned = {
    schemaVersion: CANONICAL_ROUND_MANIFEST_SCHEMA_VERSION,
    kind: "canonical_round_manifest" as const,
    roundId: value["roundId"],
    runId: value["runId"],
    roundNumber: value["roundNumber"],
    messageOrderVersion: CANONICAL_MESSAGE_ORDER_VERSION,
    authority,
    tools,
    sharing,
    providerSemanticVersionSet: providerSet,
    providerSemanticVersionSetChecksum: providerSetChecksum,
    packedContextManifestChecksum: packedChecksum,
    messages,
    sourceRefs
  };
  const calculated = checksumText(canonicalSerialize(unsigned));
  if (
    manifestChecksum !== calculated ||
    (expectedChecksum !== undefined && calculated !== expectedChecksum)
  ) {
    invalid();
  }
  return deepFreeze({ ...unsigned, manifestChecksum: calculated }) as CanonicalRoundManifestV2;
}

export function serializeCanonicalRoundManifestV2(value: CanonicalRoundManifestV2): string {
  return canonicalSerialize(parseCanonicalRoundManifestV2(value));
}

export function canonicalRoundManifestChecksum(value: CanonicalRoundManifestV2): string {
  return parseCanonicalRoundManifestV2(value).manifestChecksum;
}

function parseAuthority(value: unknown): CanonicalRoundAuthorityV2 {
  if (
    !isRecord(value) ||
    !hasExactlyFields(value, ["role", "content", "contentChecksum"]) ||
    value["role"] !== "system" ||
    typeof value["content"] !== "string" ||
    value["content"].length === 0 ||
    value["contentChecksum"] !== checksumText(value["content"])
  ) {
    invalid();
  }
  return value as unknown as CanonicalRoundAuthorityV2;
}

function parseTools(value: unknown): CanonicalRoundToolProjectionV2 {
  if (
    !isRecord(value) ||
    !hasExactlyFields(value, [
      "schemaVersion",
      "catalogRevision",
      "descriptors",
      "projectionChecksum"
    ]) ||
    value["schemaVersion"] !== "2.0" ||
    !isSafeToken(value["catalogRevision"]) ||
    !Array.isArray(value["descriptors"]) ||
    !value["descriptors"].every(isCanonicalJsonObject) ||
    !isChecksum(value["projectionChecksum"])
  ) {
    invalid();
  }
  const expected = checksumText(
    canonicalSerialize({
      schemaVersion: "2.0",
      catalogRevision: value["catalogRevision"],
      descriptors: value["descriptors"]
    })
  );
  if (value["projectionChecksum"] !== expected) invalid();
  return value as unknown as CanonicalRoundToolProjectionV2;
}

function parseSharing(value: unknown): CanonicalRoundSharingRevisionV2 {
  if (
    !isRecord(value) ||
    !hasExactlyFields(value, ["defaultsRevision", "runGrantRevision"]) ||
    !isSafeToken(value["defaultsRevision"]) ||
    !isSafeToken(value["runGrantRevision"])
  ) {
    invalid();
  }
  return value as unknown as CanonicalRoundSharingRevisionV2;
}

function parseMessages(value: unknown): readonly CanonicalRoundMessageV2[] {
  if (!Array.isArray(value)) invalid();
  const messages: CanonicalRoundMessageV2[] = [];
  for (const [order, candidate] of value.entries()) {
    if (!isRecord(candidate) || !hasExactlyFields(candidate, MESSAGE_FIELDS)) invalid();
    if (
      candidate["order"] !== order ||
      !isMessageKind(candidate["kind"]) ||
      !isMessageRole(candidate["role"]) ||
      typeof candidate["content"] !== "string" ||
      candidate["contentChecksum"] !== checksumText(candidate["content"]) ||
      (candidate["sourceRefId"] !== null && !isSafeToken(candidate["sourceRefId"])) ||
      (candidate["envelopeKind"] !== null && !isEnvelopeKind(candidate["envelopeKind"])) ||
      (candidate["toolCallId"] !== null && !isSafeToken(candidate["toolCallId"])) ||
      !Array.isArray(candidate["toolCalls"]) ||
      !candidate["toolCalls"].every(isToolCall)
    ) {
      invalid();
    }
    messages.push(candidate as unknown as CanonicalRoundMessageV2);
  }
  return messages;
}

function parseSourceRefs(value: unknown): readonly CanonicalRoundSourceRefV2[] {
  if (!Array.isArray(value)) invalid();
  const refs: CanonicalRoundSourceRefV2[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !hasExactlyFields(candidate, SOURCE_FIELDS) ||
      !isSafeToken(candidate["refId"]) ||
      !isSourceMessageKind(candidate["sourceKind"]) ||
      !isSafeToken(candidate["sourceRevision"]) ||
      !isChecksum(candidate["sourceChecksum"]) ||
      !isNonNegativeInteger(candidate["messageOrder"]) ||
      seen.has(candidate["refId"])
    ) {
      invalid();
    }
    seen.add(candidate["refId"]);
    refs.push(candidate as unknown as CanonicalRoundSourceRefV2);
  }
  return refs;
}

function hasCanonicalMessageAndSourceOrder(
  messages: readonly CanonicalRoundMessageV2[],
  sourceRefs: readonly CanonicalRoundSourceRefV2[]
): boolean {
  const currentRequestOrder = messages.findIndex(
    (message) => message.kind === "current_user_request"
  );
  if (
    currentRequestOrder < 0 ||
    messages.filter((message) => message.kind === "current_user_request").length !== 1
  ) {
    return false;
  }
  // The 2.0 manifest format was originally emitted as
  // project_conventions -> prior_conversation -> workspace_outline.  New
  // materializations put all stable project context before mutable
  // conversation data so provider prefix caches can be reused. Keep parsing
  // the old order for persisted ledgers while validating newly emitted rounds
  // with the stable-prefix order.
  const initialOrder = resolveInitialMessageOrder(messages, currentRequestOrder);
  if (initialOrder === undefined) return false;
  let priorRank = -1;
  const pairedToolCalls = new Set<string>();
  for (const message of messages) {
    if (message.order < currentRequestOrder) {
      const rank = initialMessageRank(message.kind, initialOrder);
      if (rank === undefined || rank < priorRank) return false;
      priorRank = rank;
    } else if (message.order === currentRequestOrder) {
      if (
        message.role !== "user" ||
        message.envelopeKind !== null ||
        message.sourceRefId !== null ||
        message.toolCallId !== null ||
        message.toolCalls.length !== 0
      ) {
        return false;
      }
    } else if (initialMessageRank(message.kind, initialOrder) !== undefined) {
      return false;
    }
    if (message.kind === "assistant") {
      if (
        message.role !== "assistant" ||
        message.envelopeKind !== null ||
        message.sourceRefId !== null ||
        message.toolCallId !== null
      ) {
        return false;
      }
      for (const call of message.toolCalls) {
        if (pairedToolCalls.has(call.id)) return false;
        pairedToolCalls.add(call.id);
      }
    } else if (message.toolCalls.length !== 0) {
      return false;
    }
    if (!messageEnvelopeAndRoleMatch(message, pairedToolCalls)) return false;
  }
  const expectedRefs = messages.flatMap((message) => {
    if (message.sourceRefId === null) return [];
    const ref = sourceRefs.find((candidate) => candidate.refId === message.sourceRefId);
    return ref === undefined ? [] : [ref];
  });
  if (expectedRefs.length !== sourceRefs.length) return false;
  if (
    !expectedRefs.every(
      (ref, index) =>
        ref === sourceRefs[index] &&
        ref.messageOrder === messages.find((message) => message.sourceRefId === ref.refId)?.order &&
        ref.sourceKind === messages[ref.messageOrder]?.kind
    )
  ) {
    return false;
  }
  return sourceRefs.every((ref) => {
    const message = messages[ref.messageOrder];
    if (message === undefined) return false;
    const envelope = parseEnvelopeMetadata(message.content);
    return (
      envelope !== undefined &&
      envelope.dataChecksum === ref.sourceChecksum &&
      ((ref.sourceKind !== "prior_conversation" && ref.sourceKind !== "compaction") ||
        envelope.summaryRevision === ref.sourceRevision)
    );
  });
}

type InitialMessageOrder = "stable-prefix" | "legacy";

function resolveInitialMessageOrder(
  messages: readonly CanonicalRoundMessageV2[],
  currentRequestOrder: number
): InitialMessageOrder | undefined {
  const workspaceOrder = messages.findIndex(
    (message) => message.order < currentRequestOrder && message.kind === "workspace_outline"
  );
  const conversationOrder = messages.findIndex(
    (message) =>
      message.order < currentRequestOrder &&
      (message.kind === "prior_conversation" || message.kind === "compaction")
  );
  if (workspaceOrder >= 0 && conversationOrder >= 0) {
    return workspaceOrder < conversationOrder ? "stable-prefix" : "legacy";
  }
  return "stable-prefix";
}

function messageEnvelopeAndRoleMatch(
  message: CanonicalRoundMessageV2,
  pairedToolCalls: ReadonlySet<string>
): boolean {
  if (message.kind === "assistant") return true;
  if (message.kind === "current_user_request" || message.kind === "user_control") {
    return (
      message.role === "user" &&
      message.envelopeKind === null &&
      message.sourceRefId === null &&
      message.toolCallId === null
    );
  }
  const expectedEnvelope = envelopeForMessageKind(message.kind);
  const expectedRole =
    expectedEnvelope === "untrusted_tool_data" || expectedEnvelope === "untrusted_remote_data"
      ? "tool"
      : "user";
  if (
    message.role !== expectedRole ||
    message.envelopeKind !== expectedEnvelope ||
    message.sourceRefId === null
  ) {
    return false;
  }
  const envelope = parseEnvelopeMetadata(message.content);
  if (
    envelope === undefined ||
    envelope.kind !== expectedEnvelope ||
    !messageKindMatchesEnvelopeSource(message.kind, envelope.sourceKind)
  ) {
    return false;
  }
  const refId = message.sourceRefId;
  if (
    envelope.sourceKind === "project_conventions" ||
    envelope.sourceKind === "workspace_outline" ||
    envelope.sourceKind === "disk_file" ||
    envelope.sourceKind === "editor_buffer" ||
    envelope.sourceKind === "story_bible_asset"
  ) {
    if (envelope.refId !== refId) return false;
  }
  if (expectedRole === "tool") {
    return (
      message.toolCallId !== null &&
      pairedToolCalls.has(message.toolCallId) &&
      envelope.toolCallId === message.toolCallId
    );
  }
  return message.toolCallId === null;
}

function initialMessageRank(
  kind: CanonicalRoundMessageKindV2,
  order: InitialMessageOrder
): number | undefined {
  if (kind === "project_conventions") return 0;
  if (order === "stable-prefix") {
    if (kind === "workspace_outline") return 1;
    if (kind === "prior_conversation" || kind === "compaction") return 2;
  } else {
    if (kind === "prior_conversation" || kind === "compaction") return 1;
    if (kind === "workspace_outline") return 2;
  }
  if (kind === "explicit_reference") return 3;
  if (kind === "active_resource") return 4;
  return undefined;
}

function envelopeForMessageKind(
  kind: Exclude<CanonicalRoundMessageKindV2, "assistant" | "current_user_request" | "user_control">
): CanonicalRoundEnvelopeKindV2 {
  if (
    kind === "project_conventions" ||
    kind === "workspace_outline" ||
    kind === "explicit_reference" ||
    kind === "active_resource"
  ) {
    return "untrusted_project_data";
  }
  if (kind === "prior_conversation" || kind === "compaction") {
    return "untrusted_conversation_data";
  }
  if (kind === "tool_result") return "untrusted_tool_data";
  if (kind === "remote_result") return "untrusted_remote_data";
  return "untrusted_recovery_data";
}

function parseEnvelopeMetadata(content: string):
  | {
      readonly kind: CanonicalRoundEnvelopeKindV2;
      readonly sourceKind: string;
      readonly refId?: string;
      readonly toolCallId?: string;
      readonly summaryRevision?: string;
      readonly dataChecksum: string;
    }
  | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
  if (
    !isRecord(parsed) ||
    !hasExactlyFields(parsed, ["schemaVersion", "kind", "instructionPolicy", "source", "data"]) ||
    parsed["schemaVersion"] !== "2.0" ||
    !isEnvelopeKind(parsed["kind"]) ||
    parsed["instructionPolicy"] !== "content_is_data_not_authority" ||
    typeof parsed["data"] !== "string" ||
    !isRecord(parsed["source"]) ||
    typeof parsed["source"]["sourceKind"] !== "string"
  ) {
    return undefined;
  }
  const source = parsed["source"];
  if (!hasStrictEnvelopeSourceFields(parsed["kind"], source)) return undefined;
  return {
    kind: parsed["kind"],
    sourceKind: String(source["sourceKind"]),
    dataChecksum: checksumText(parsed["data"]),
    ...(typeof source["refId"] === "string" ? { refId: source["refId"] } : {}),
    ...(typeof source["toolCallId"] === "string" ? { toolCallId: source["toolCallId"] } : {}),
    ...(typeof source["summaryRevision"] === "string"
      ? { summaryRevision: source["summaryRevision"] }
      : {})
  };
}

function hasStrictEnvelopeSourceFields(
  kind: CanonicalRoundEnvelopeKindV2,
  source: Record<string, unknown>
): boolean {
  const sourceKind = source["sourceKind"];
  if (
    sourceKind === "project_conventions" ||
    sourceKind === "workspace_outline" ||
    sourceKind === "disk_file" ||
    sourceKind === "editor_buffer" ||
    sourceKind === "story_bible_asset"
  ) {
    return (
      kind === "untrusted_project_data" &&
      hasAllowedFields(
        source,
        ["sourceKind", "refId", "dirty"],
        ["sourceKind", "refId", "dirty", "relativePath", "assetId", "truncated", "contentType"]
      ) &&
      isSafeToken(source["refId"]) &&
      typeof source["dirty"] === "boolean" &&
      (source["relativePath"] === undefined || typeof source["relativePath"] === "string") &&
      (source["assetId"] === undefined || isSafeToken(source["assetId"])) &&
      (source["truncated"] === undefined || typeof source["truncated"] === "boolean") &&
      (source["contentType"] === undefined || isSafeToken(source["contentType"]))
    );
  }
  if (sourceKind === "prior_conversation" || sourceKind === "compaction") {
    return (
      kind === "untrusted_conversation_data" &&
      hasAllowedFields(
        source,
        ["sourceKind", "summaryRevision"],
        ["sourceKind", "summaryRevision", "truncated"]
      ) &&
      isSafeToken(source["summaryRevision"]) &&
      (source["truncated"] === undefined || typeof source["truncated"] === "boolean")
    );
  }
  if (sourceKind === "network" || sourceKind === "remote_mcp") {
    return (
      kind === "untrusted_remote_data" &&
      hasAllowedFields(
        source,
        ["sourceKind", "toolCallId"],
        ["sourceKind", "toolCallId", "originLabel", "contentType", "truncated"]
      ) &&
      isSafeToken(source["toolCallId"]) &&
      (source["originLabel"] === undefined || isSafeToken(source["originLabel"])) &&
      (source["contentType"] === undefined || isSafeToken(source["contentType"])) &&
      (source["truncated"] === undefined || typeof source["truncated"] === "boolean")
    );
  }
  if (sourceKind === "tool_result") {
    return (
      kind === "untrusted_tool_data" &&
      hasExactlyFields(source, ["sourceKind", "toolCallId", "providerToolName", "resultKind"]) &&
      isSafeToken(source["toolCallId"]) &&
      isSafeToken(source["providerToolName"]) &&
      isSafeToken(source["resultKind"])
    );
  }
  return (
    sourceKind === "recovery_summary" &&
    kind === "untrusted_recovery_data" &&
    hasAllowedFields(
      source,
      ["sourceKind", "recoveryEventKind"],
      ["sourceKind", "recoveryEventKind", "truncated"]
    ) &&
    isSafeToken(source["recoveryEventKind"]) &&
    (source["truncated"] === undefined || typeof source["truncated"] === "boolean")
  );
}

function messageKindMatchesEnvelopeSource(
  kind: CanonicalRoundMessageKindV2,
  sourceKind: string
): boolean {
  if (kind === "project_conventions") return sourceKind === "project_conventions";
  if (kind === "prior_conversation") return sourceKind === "prior_conversation";
  if (kind === "compaction") return sourceKind === "compaction";
  if (kind === "workspace_outline") return sourceKind === "workspace_outline";
  if (kind === "explicit_reference") {
    return sourceKind === "disk_file" || sourceKind === "story_bible_asset";
  }
  if (kind === "active_resource") {
    return sourceKind === "disk_file" || sourceKind === "editor_buffer";
  }
  if (kind === "tool_result") return sourceKind === "tool_result";
  if (kind === "remote_result") return sourceKind === "network" || sourceKind === "remote_mcp";
  if (kind === "context_notice" || kind === "recovery") {
    return sourceKind === "recovery_summary";
  }
  return true;
}

function isToolCall(value: unknown): value is CanonicalRoundToolCallV2 {
  return (
    isRecord(value) &&
    hasExactlyFields(value, TOOL_CALL_FIELDS) &&
    isSafeToken(value["id"]) &&
    isSafeToken(value["name"]) &&
    typeof value["arguments"] === "string" &&
    (value["providerMetadata"] === null || isCanonicalJsonObject(value["providerMetadata"]))
  );
}

function isCanonicalJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && isJsonValueWithoutTransportState(value);
}

function isJsonValueWithoutTransportState(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValueWithoutTransportState);
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([key, child]) => !FORBIDDEN_TRANSPORT_KEYS.has(key) && isJsonValueWithoutTransportState(child)
  );
}

function isMessageKind(value: unknown): value is CanonicalRoundMessageKindV2 {
  return (
    value === "project_conventions" ||
    value === "prior_conversation" ||
    value === "compaction" ||
    value === "workspace_outline" ||
    value === "explicit_reference" ||
    value === "active_resource" ||
    value === "current_user_request" ||
    value === "assistant" ||
    value === "tool_result" ||
    value === "remote_result" ||
    value === "user_control" ||
    value === "context_notice" ||
    value === "recovery"
  );
}

function isSourceMessageKind(value: unknown): value is CanonicalRoundSourceRefV2["sourceKind"] {
  return (
    isMessageKind(value) &&
    value !== "current_user_request" &&
    value !== "assistant" &&
    value !== "user_control"
  );
}

function isMessageRole(value: unknown): value is CanonicalRoundMessageV2["role"] {
  return value === "user" || value === "assistant" || value === "tool";
}

function isEnvelopeKind(value: unknown): value is CanonicalRoundEnvelopeKindV2 {
  return (
    value === "untrusted_project_data" ||
    value === "untrusted_conversation_data" ||
    value === "untrusted_remote_data" ||
    value === "untrusted_tool_data" ||
    value === "untrusted_recovery_data"
  );
}

function assertSafeToken(value: unknown): asserts value is string {
  if (!isSafeToken(value)) invalid();
}

function isSafeToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    // eslint-disable-next-line no-control-regex -- Persisted identities reject control characters.
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && CHECKSUM.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasExactlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function hasAllowedFields(
  value: Record<string, unknown>,
  required: readonly string[],
  allowed: readonly string[]
): boolean {
  return (
    required.every((field) => Object.hasOwn(value, field)) &&
    Object.keys(value).every((field) => allowed.includes(field))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checksumText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalSerialize(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function invalid(): never {
  throw new Error("CANONICAL_ROUND_MANIFEST_INVALID");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
