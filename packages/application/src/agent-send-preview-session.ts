import { createHash, randomBytes } from "node:crypto";

import {
  parseCanonicalRoundManifestV2,
  serializeCanonicalRoundManifestV2,
  type CanonicalRoundManifestV2,
  type CanonicalRoundMessageV2,
  type CanonicalRoundToolCallV2
} from "@novel-studio/agent-engine";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

export const AGENT_SEND_PREVIEW_SCHEMA_VERSION = "2.0" as const;

const CHECKSUM = /^[a-f0-9]{64}$/u;
const MACHINE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const MAX_TEXT_LENGTH = 2_000_000;
const DEFAULT_PREVIEW_TTL_MS = 5 * 60 * 1_000;

export type AgentSendSemanticMessageV2 =
  | {
      readonly schemaVersion: typeof AGENT_SEND_PREVIEW_SCHEMA_VERSION;
      readonly role: "user";
      readonly content: string;
    }
  | {
      readonly schemaVersion: typeof AGENT_SEND_PREVIEW_SCHEMA_VERSION;
      readonly role: "assistant";
      readonly content: string;
      readonly toolCalls: readonly AgentSendSemanticToolCallV2[];
    }
  | {
      readonly schemaVersion: typeof AGENT_SEND_PREVIEW_SCHEMA_VERSION;
      readonly role: "tool";
      readonly content: string;
      readonly toolCallId: string;
    };

export interface AgentSendSemanticToolCallV2 {
  readonly schemaVersion: typeof AGENT_SEND_PREVIEW_SCHEMA_VERSION;
  readonly toolCallId: string;
  readonly name: string;
  readonly argumentsText: string;
}

export interface AgentSendSemanticToolV2 {
  readonly schemaVersion: typeof AGENT_SEND_PREVIEW_SCHEMA_VERSION;
  readonly name: string;
  readonly description: string | null;
  readonly inputSchema: JsonObject;
}

/** The app-owned semantic request. Transport IDs, secrets, signals, and cache handles are absent. */
export interface AgentFirstRoundSemanticPayloadV2 {
  readonly schemaVersion: typeof AGENT_SEND_PREVIEW_SCHEMA_VERSION;
  readonly systemPrompt: string;
  readonly messages: readonly AgentSendSemanticMessageV2[];
  readonly tools: readonly AgentSendSemanticToolV2[];
  readonly parameters: JsonObject;
}

export interface AgentSendPreviewTargetIdentityV2 {
  readonly providerId: string;
  readonly modelId: string;
  readonly connectionId: string;
  readonly accountIdentityChecksum: string;
  readonly adapterPolicyRevision: string;
  readonly adapterPolicyChecksum: string;
}

export interface AgentSendPreviewSourceBindingV2 {
  readonly sourceRef: string;
  readonly sourceRevision: string;
  readonly sourceChecksum: string;
}

/** Main-only identity facts that must still match immediately before the frozen payload is sent. */
export interface AgentSendPreviewValidationFactsV2 {
  readonly schemaVersion: typeof AGENT_SEND_PREVIEW_SCHEMA_VERSION;
  readonly scopeBindingChecksum: string;
  readonly runDraftId: string;
  readonly runDraftRevision: number;
  readonly runDraftChecksum: string;
  readonly requestRevision: string;
  readonly requestChecksum: string;
  readonly target: AgentSendPreviewTargetIdentityV2;
  readonly sourceBindings: readonly AgentSendPreviewSourceBindingV2[];
  readonly sharingDefaultsRevision: string;
  readonly sharingGrantRevision: string;
  readonly sharingGrantChecksum: string;
  readonly taskIntentChecksum: string;
  readonly capabilityRevision: string;
  readonly capabilityChecksum: string;
  readonly toolProjectionRevision: string;
  readonly toolProjectionChecksum: string;
  readonly providerSemanticVersionSetChecksum: string;
  readonly canonicalRoundManifestChecksum: string;
  readonly canonicalPayloadChecksum: string;
}

export type AgentSendPreviewSourceKind =
  | "disk_file"
  | "editor_buffer"
  | "story_bible_asset"
  | "project_conventions"
  | "workspace_outline"
  | "conversation_summary"
  | "compaction_summary"
  | "active_resource"
  | "explicit_reference";

export type AgentSendPreviewLocalProvenanceKind =
  | "workspace_identity"
  | "canonical_root_identity"
  | "absolute_path"
  | "artifact_identity"
  | "provider_account_identity"
  | "transport_secret"
  | "cache_resource_handle";

export interface AgentSendPreviewDisplaySourceV2 {
  readonly sourceRef: string;
  readonly label: string;
  readonly kind: AgentSendPreviewSourceKind;
  readonly content: string;
  readonly tokenCount: number | null;
  readonly tokenPrecision: "reported" | "estimated" | "unknown";
  readonly dirty: boolean;
  readonly truncated: boolean;
  readonly selectionState: "automatic" | "pinned" | "explicit" | "excluded";
  readonly grantSource: "not_applicable" | "workspace_default" | "run_grant" | "user_explicit";
}

export interface AgentSendPreviewDisplayInputV2 {
  readonly schemaVersion: typeof AGENT_SEND_PREVIEW_SCHEMA_VERSION;
  readonly target: {
    readonly providerLabel: string;
    readonly modelLabel: string;
    readonly connectionLabel: string;
    readonly adapterPolicyLabel: string;
  };
  readonly guidance: {
    readonly version: string;
    readonly profileId: string;
    readonly runtimeFacts: JsonObject;
  };
  readonly sources: readonly AgentSendPreviewDisplaySourceV2[];
  readonly retainedLocalProvenanceKinds: readonly AgentSendPreviewLocalProvenanceKind[];
  readonly providerNativeSemanticChecksum: string | null;
}

export interface AgentSendPreviewDtoV2 extends AgentSendPreviewDisplayInputV2 {
  readonly previewId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly canonicalPayloadChecksum: string;
  readonly guidance: AgentSendPreviewDisplayInputV2["guidance"] & {
    readonly content: string;
  };
  readonly tools: readonly AgentSendSemanticToolV2[];
}

export interface PrepareAgentSendPreviewCommandV2 {
  readonly schemaVersion: typeof AGENT_SEND_PREVIEW_SCHEMA_VERSION;
  readonly commandId: string;
  readonly runDraftId: string;
  readonly expectedRunDraftRevision: number;
  readonly runDraftChecksum: string;
}

export interface ConfirmAgentSendPreviewCommandV2 {
  readonly schemaVersion: typeof AGENT_SEND_PREVIEW_SCHEMA_VERSION;
  readonly previewId: string;
  readonly canonicalPayloadChecksum: string;
}

export interface AgentSendPreviewPreparedMaterialV2 {
  readonly semanticPayload: AgentFirstRoundSemanticPayloadV2;
  /** Canonical bytes authored and validated by the Canonical Round Manifest 2.0 owner. */
  readonly canonicalRoundManifestJson: string;
  readonly validationFacts: AgentSendPreviewValidationFactsV2;
  readonly display: AgentSendPreviewDisplayInputV2;
}

export interface AgentConfirmedFirstSendV2 {
  readonly previewId: string;
  readonly canonicalPayloadChecksum: string;
  readonly canonicalRoundManifestJson: string;
  readonly canonicalRoundManifestChecksum: string;
  readonly providerSemanticVersionSetChecksum: string;
  /** Main-only target/source identity. It must never be copied into the Provider request. */
  readonly validationFacts: AgentSendPreviewValidationFactsV2;
  readonly semanticPayload: AgentFirstRoundSemanticPayloadV2;
}

export interface AgentSendPreviewMaterializerPort {
  materializeFirstRound(
    command: PrepareAgentSendPreviewCommandV2
  ): Promise<Result<AgentSendPreviewPreparedMaterialV2, UnifiedError>>;
  resolveCurrentValidationFacts(input: {
    readonly previewId: string;
    readonly runDraftId: string;
  }): Promise<Result<AgentSendPreviewValidationFactsV2, UnifiedError>>;
}

export interface CreateAgentSendPreviewSessionOptions<TSendResult> {
  readonly materializer: AgentSendPreviewMaterializerPort;
  readonly sendFrozenFirstRound: (
    input: AgentConfirmedFirstSendV2
  ) => Promise<Result<TSendResult, UnifiedError>>;
  readonly now?: () => string;
  readonly createPreviewId?: () => string;
  readonly previewTtlMs?: number;
  readonly traceId?: string;
}

export interface ConfirmedAgentSendResult<TSendResult> {
  readonly previewId: string;
  readonly canonicalPayloadChecksum: string;
  readonly value: TSendResult;
}

export interface AgentSendPreviewSession<TSendResult> {
  preparePreview(
    command: PrepareAgentSendPreviewCommandV2
  ): Promise<Result<AgentSendPreviewDtoV2, UnifiedError>>;
  confirmAndSend(
    command: ConfirmAgentSendPreviewCommandV2
  ): Promise<Result<ConfirmedAgentSendResult<TSendResult>, UnifiedError>>;
}

interface StoredPreview {
  readonly dto: AgentSendPreviewDtoV2;
  readonly facts: AgentSendPreviewValidationFactsV2;
  readonly semanticPayload: AgentFirstRoundSemanticPayloadV2;
  readonly canonicalRoundManifestJson: string;
  state: "prepared" | "validating" | "sending" | "consumed" | "stale";
}

interface PrepareReceipt<TSendResult> {
  readonly signature: string;
  readonly pending: ReturnType<AgentSendPreviewSession<TSendResult>["preparePreview"]>;
}

export function createAgentSendPreviewSession<TSendResult>(
  options: CreateAgentSendPreviewSessionOptions<TSendResult>
): AgentSendPreviewSession<TSendResult> {
  const traceId = options.traceId ?? "agent-send-preview";
  const now = options.now ?? (() => new Date().toISOString());
  const createPreviewId =
    options.createPreviewId ?? (() => `preview_${randomBytes(16).toString("hex")}`);
  const ttlMs = options.previewTtlMs ?? DEFAULT_PREVIEW_TTL_MS;
  const previews = new Map<string, StoredPreview>();
  const receipts = new Map<string, PrepareReceipt<TSendResult>>();

  const invalid = <T>(): Result<T, UnifiedError> =>
    err(previewError("AGENT_SEND_PREVIEW_INVALID", traceId));
  const stale = <T>(): Result<T, UnifiedError> =>
    err(previewError("AGENT_SEND_PREVIEW_STALE", traceId));

  async function prepareInternal(
    command: PrepareAgentSendPreviewCommandV2
  ): Promise<Result<AgentSendPreviewDtoV2, UnifiedError>> {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1) return invalid();
    let materialized: Awaited<
      ReturnType<AgentSendPreviewMaterializerPort["materializeFirstRound"]>
    >;
    try {
      materialized = await options.materializer.materializeFirstRound(command);
    } catch {
      return invalid();
    }
    if (!materialized.ok) return materialized;

    let semanticPayload: AgentFirstRoundSemanticPayloadV2;
    let facts: AgentSendPreviewValidationFactsV2;
    let display: AgentSendPreviewDisplayInputV2;
    let manifest: CanonicalRoundManifestV2;
    try {
      semanticPayload = parseAgentFirstRoundSemanticPayloadV2(materialized.value.semanticPayload);
      facts = parseAgentSendPreviewValidationFactsV2(materialized.value.validationFacts);
      display = parseAgentSendPreviewDisplayInputV2(materialized.value.display);
      manifest = parseCanonicalRoundManifestJson(
        materialized.value.canonicalRoundManifestJson,
        facts.canonicalRoundManifestChecksum
      );
      assertPreparedMaterialBindings(semanticPayload, facts, manifest, display);
    } catch {
      return invalid();
    }

    const canonicalPayloadChecksum = checksum(canonicalJson(semanticPayload));
    const canonicalRoundManifestChecksum = manifest.manifestChecksum;
    if (
      facts.runDraftId !== command.runDraftId ||
      facts.runDraftRevision !== command.expectedRunDraftRevision ||
      facts.runDraftChecksum !== command.runDraftChecksum ||
      facts.canonicalPayloadChecksum !== canonicalPayloadChecksum ||
      facts.canonicalRoundManifestChecksum !== canonicalRoundManifestChecksum
    ) {
      return invalid();
    }

    const createdAt = now();
    const createdAtMs = Date.parse(createdAt);
    if (!Number.isFinite(createdAtMs)) return invalid();
    const previewId = createPreviewId();
    if (!isMachineId(previewId) || previews.has(previewId)) return invalid();
    const dto = deepFreeze({
      ...display,
      previewId,
      createdAt,
      expiresAt: new Date(createdAtMs + ttlMs).toISOString(),
      canonicalPayloadChecksum,
      guidance: {
        ...display.guidance,
        content: semanticPayload.systemPrompt
      },
      tools: semanticPayload.tools
    });
    previews.set(previewId, {
      dto,
      facts,
      semanticPayload,
      canonicalRoundManifestJson: materialized.value.canonicalRoundManifestJson,
      state: "prepared"
    });
    return ok(dto);
  }

  return {
    preparePreview(command) {
      let parsed: PrepareAgentSendPreviewCommandV2;
      try {
        parsed = parsePrepareCommand(command);
      } catch {
        return Promise.resolve(invalid());
      }
      const signature = canonicalJson(parsed);
      const existing = receipts.get(parsed.commandId);
      if (existing !== undefined) {
        return existing.signature === signature ? existing.pending : Promise.resolve(invalid());
      }
      const pending = prepareInternal(parsed);
      receipts.set(parsed.commandId, { signature, pending });
      return pending;
    },

    async confirmAndSend(command) {
      let parsed: ConfirmAgentSendPreviewCommandV2;
      try {
        parsed = parseConfirmCommand(command);
      } catch {
        return invalid();
      }
      const preview = previews.get(parsed.previewId);
      if (
        preview === undefined ||
        preview.state !== "prepared" ||
        preview.dto.canonicalPayloadChecksum !== parsed.canonicalPayloadChecksum
      ) {
        return stale();
      }
      const currentTime = Date.parse(now());
      if (!Number.isFinite(currentTime) || currentTime >= Date.parse(preview.dto.expiresAt)) {
        preview.state = "stale";
        return stale();
      }

      preview.state = "validating";
      let current: Awaited<
        ReturnType<AgentSendPreviewMaterializerPort["resolveCurrentValidationFacts"]>
      >;
      try {
        current = await options.materializer.resolveCurrentValidationFacts({
          previewId: preview.dto.previewId,
          runDraftId: preview.facts.runDraftId
        });
      } catch {
        preview.state = "stale";
        return stale();
      }
      if (!current.ok) {
        preview.state = "stale";
        return current;
      }
      let currentFacts: AgentSendPreviewValidationFactsV2;
      try {
        currentFacts = parseAgentSendPreviewValidationFactsV2(current.value);
      } catch {
        preview.state = "stale";
        return stale();
      }
      if (canonicalJson(currentFacts) !== canonicalJson(preview.facts)) {
        preview.state = "stale";
        return stale();
      }

      preview.state = "sending";
      let sent: Result<TSendResult, UnifiedError>;
      try {
        sent = await options.sendFrozenFirstRound(
          deepFreeze({
            previewId: preview.dto.previewId,
            canonicalPayloadChecksum: preview.dto.canonicalPayloadChecksum,
            canonicalRoundManifestJson: preview.canonicalRoundManifestJson,
            canonicalRoundManifestChecksum: preview.facts.canonicalRoundManifestChecksum,
            providerSemanticVersionSetChecksum: preview.facts.providerSemanticVersionSetChecksum,
            validationFacts: preview.facts,
            semanticPayload: preview.semanticPayload
          })
        );
      } catch {
        return err(sendFailedError(traceId));
      } finally {
        preview.state = "consumed";
      }
      if (!sent.ok) return sent;
      return ok(
        Object.freeze({
          previewId: preview.dto.previewId,
          canonicalPayloadChecksum: preview.dto.canonicalPayloadChecksum,
          value: sent.value
        })
      );
    }
  };
}

export function parseAgentFirstRoundSemanticPayloadV2(
  value: unknown
): AgentFirstRoundSemanticPayloadV2 {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ["schemaVersion", "systemPrompt", "messages", "tools", "parameters"])
  )
    invalidInput();
  if (value["schemaVersion"] !== AGENT_SEND_PREVIEW_SCHEMA_VERSION) invalidInput();
  const systemPrompt = parseText(value["systemPrompt"], false);
  const messages = parseArray(value["messages"], parseSemanticMessage);
  const tools = parseArray(value["tools"], parseSemanticTool);
  const parameters = parseJsonObject(value["parameters"]);
  assertUnique(tools.map((tool) => tool.name));
  assertToolTranscript(messages);
  return deepFreeze({
    schemaVersion: AGENT_SEND_PREVIEW_SCHEMA_VERSION,
    systemPrompt,
    messages,
    tools,
    parameters
  });
}

export function serializeAgentFirstRoundSemanticPayloadV2(
  value: AgentFirstRoundSemanticPayloadV2
): string {
  return canonicalJson(parseAgentFirstRoundSemanticPayloadV2(value));
}

export function canonicalAgentFirstRoundSemanticPayloadChecksumV2(
  value: AgentFirstRoundSemanticPayloadV2
): string {
  return checksum(serializeAgentFirstRoundSemanticPayloadV2(value));
}

export function parseAgentSendPreviewValidationFactsV2(
  value: unknown
): AgentSendPreviewValidationFactsV2 {
  const fields = [
    "schemaVersion",
    "scopeBindingChecksum",
    "runDraftId",
    "runDraftRevision",
    "runDraftChecksum",
    "requestRevision",
    "requestChecksum",
    "target",
    "sourceBindings",
    "sharingDefaultsRevision",
    "sharingGrantRevision",
    "sharingGrantChecksum",
    "taskIntentChecksum",
    "capabilityRevision",
    "capabilityChecksum",
    "toolProjectionRevision",
    "toolProjectionChecksum",
    "providerSemanticVersionSetChecksum",
    "canonicalRoundManifestChecksum",
    "canonicalPayloadChecksum"
  ] as const;
  if (!isRecord(value) || !hasExactlyKeys(value, fields)) invalidInput();
  if (value["schemaVersion"] !== AGENT_SEND_PREVIEW_SCHEMA_VERSION) invalidInput();
  const sourceBindings = parseArray(value["sourceBindings"], parseSourceBinding);
  assertUnique(sourceBindings.map((source) => source.sourceRef));
  return deepFreeze({
    schemaVersion: AGENT_SEND_PREVIEW_SCHEMA_VERSION,
    scopeBindingChecksum: parseChecksum(value["scopeBindingChecksum"]),
    runDraftId: parseMachineId(value["runDraftId"]),
    runDraftRevision: parsePositiveInteger(value["runDraftRevision"]),
    runDraftChecksum: parseChecksum(value["runDraftChecksum"]),
    requestRevision: parseMachineId(value["requestRevision"]),
    requestChecksum: parseChecksum(value["requestChecksum"]),
    target: parseTargetIdentity(value["target"]),
    sourceBindings,
    sharingDefaultsRevision: parseRevision(value["sharingDefaultsRevision"]),
    sharingGrantRevision: parseRevision(value["sharingGrantRevision"]),
    sharingGrantChecksum: parseChecksumOrNotApplicable(value["sharingGrantChecksum"]),
    taskIntentChecksum: parseChecksumOrNotApplicable(value["taskIntentChecksum"]),
    capabilityRevision: parseRevision(value["capabilityRevision"]),
    capabilityChecksum: parseChecksum(value["capabilityChecksum"]),
    toolProjectionRevision: parseRevision(value["toolProjectionRevision"]),
    toolProjectionChecksum: parseChecksum(value["toolProjectionChecksum"]),
    providerSemanticVersionSetChecksum: parseChecksum(value["providerSemanticVersionSetChecksum"]),
    canonicalRoundManifestChecksum: parseChecksum(value["canonicalRoundManifestChecksum"]),
    canonicalPayloadChecksum: parseChecksum(value["canonicalPayloadChecksum"])
  });
}

export function parseAgentSendPreviewDisplayInputV2(
  value: unknown
): AgentSendPreviewDisplayInputV2 {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      "schemaVersion",
      "target",
      "guidance",
      "sources",
      "retainedLocalProvenanceKinds",
      "providerNativeSemanticChecksum"
    ])
  )
    invalidInput();
  if (value["schemaVersion"] !== AGENT_SEND_PREVIEW_SCHEMA_VERSION) invalidInput();
  const sources = parseArray(value["sources"], parseDisplaySource);
  assertUnique(sources.map((source) => source.sourceRef));
  const provenance = parseArray(value["retainedLocalProvenanceKinds"], parseLocalProvenanceKind);
  assertUnique(provenance);
  return deepFreeze({
    schemaVersion: AGENT_SEND_PREVIEW_SCHEMA_VERSION,
    target: parseDisplayTarget(value["target"]),
    guidance: parseDisplayGuidance(value["guidance"]),
    sources,
    retainedLocalProvenanceKinds: provenance,
    providerNativeSemanticChecksum:
      value["providerNativeSemanticChecksum"] === null
        ? null
        : parseChecksum(value["providerNativeSemanticChecksum"])
  });
}

function parsePrepareCommand(value: unknown): PrepareAgentSendPreviewCommandV2 {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      "schemaVersion",
      "commandId",
      "runDraftId",
      "expectedRunDraftRevision",
      "runDraftChecksum"
    ])
  )
    invalidInput();
  if (value["schemaVersion"] !== AGENT_SEND_PREVIEW_SCHEMA_VERSION) invalidInput();
  return deepFreeze({
    schemaVersion: AGENT_SEND_PREVIEW_SCHEMA_VERSION,
    commandId: parseMachineId(value["commandId"]),
    runDraftId: parseMachineId(value["runDraftId"]),
    expectedRunDraftRevision: parsePositiveInteger(value["expectedRunDraftRevision"]),
    runDraftChecksum: parseChecksum(value["runDraftChecksum"])
  });
}

function parseConfirmCommand(value: unknown): ConfirmAgentSendPreviewCommandV2 {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ["schemaVersion", "previewId", "canonicalPayloadChecksum"])
  )
    invalidInput();
  if (value["schemaVersion"] !== AGENT_SEND_PREVIEW_SCHEMA_VERSION) invalidInput();
  return deepFreeze({
    schemaVersion: AGENT_SEND_PREVIEW_SCHEMA_VERSION,
    previewId: parseMachineId(value["previewId"]),
    canonicalPayloadChecksum: parseChecksum(value["canonicalPayloadChecksum"])
  });
}

function parseSemanticMessage(value: unknown): AgentSendSemanticMessageV2 {
  if (!isRecord(value) || value["schemaVersion"] !== AGENT_SEND_PREVIEW_SCHEMA_VERSION) {
    invalidInput();
  }
  if (value["role"] === "user" && hasExactlyKeys(value, ["schemaVersion", "role", "content"])) {
    return deepFreeze({
      schemaVersion: AGENT_SEND_PREVIEW_SCHEMA_VERSION,
      role: "user",
      content: parseText(value["content"])
    });
  }
  if (
    value["role"] === "assistant" &&
    hasExactlyKeys(value, ["schemaVersion", "role", "content", "toolCalls"])
  ) {
    return deepFreeze({
      schemaVersion: AGENT_SEND_PREVIEW_SCHEMA_VERSION,
      role: "assistant",
      content: parseText(value["content"]),
      toolCalls: parseArray(value["toolCalls"], parseSemanticToolCall)
    });
  }
  if (
    value["role"] === "tool" &&
    hasExactlyKeys(value, ["schemaVersion", "role", "content", "toolCallId"])
  ) {
    return deepFreeze({
      schemaVersion: AGENT_SEND_PREVIEW_SCHEMA_VERSION,
      role: "tool",
      content: parseText(value["content"]),
      toolCallId: parseMachineId(value["toolCallId"])
    });
  }
  invalidInput();
}

function parseSemanticToolCall(value: unknown): AgentSendSemanticToolCallV2 {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ["schemaVersion", "toolCallId", "name", "argumentsText"])
  )
    invalidInput();
  if (value["schemaVersion"] !== AGENT_SEND_PREVIEW_SCHEMA_VERSION) invalidInput();
  return deepFreeze({
    schemaVersion: AGENT_SEND_PREVIEW_SCHEMA_VERSION,
    toolCallId: parseMachineId(value["toolCallId"]),
    name: parseMachineId(value["name"]),
    argumentsText: parseText(value["argumentsText"])
  });
}

function parseSemanticTool(value: unknown): AgentSendSemanticToolV2 {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ["schemaVersion", "name", "description", "inputSchema"])
  )
    invalidInput();
  if (value["schemaVersion"] !== AGENT_SEND_PREVIEW_SCHEMA_VERSION) invalidInput();
  return deepFreeze({
    schemaVersion: AGENT_SEND_PREVIEW_SCHEMA_VERSION,
    name: parseMachineId(value["name"]),
    description: value["description"] === null ? null : parseText(value["description"]),
    inputSchema: parseJsonObject(value["inputSchema"])
  });
}

function parseTargetIdentity(value: unknown): AgentSendPreviewTargetIdentityV2 {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      "providerId",
      "modelId",
      "connectionId",
      "accountIdentityChecksum",
      "adapterPolicyRevision",
      "adapterPolicyChecksum"
    ])
  )
    invalidInput();
  return deepFreeze({
    providerId: parseMachineId(value["providerId"]),
    modelId: parseMachineId(value["modelId"]),
    connectionId: parseMachineId(value["connectionId"]),
    accountIdentityChecksum: parseChecksum(value["accountIdentityChecksum"]),
    adapterPolicyRevision: parseRevision(value["adapterPolicyRevision"]),
    adapterPolicyChecksum: parseChecksum(value["adapterPolicyChecksum"])
  });
}

function parseSourceBinding(value: unknown): AgentSendPreviewSourceBindingV2 {
  if (!isRecord(value) || !hasExactlyKeys(value, ["sourceRef", "sourceRevision", "sourceChecksum"]))
    invalidInput();
  return deepFreeze({
    sourceRef: parseMachineId(value["sourceRef"]),
    sourceRevision: parseRevision(value["sourceRevision"]),
    sourceChecksum: parseChecksum(value["sourceChecksum"])
  });
}

function parseDisplayTarget(value: unknown): AgentSendPreviewDisplayInputV2["target"] {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, ["providerLabel", "modelLabel", "connectionLabel", "adapterPolicyLabel"])
  )
    invalidInput();
  return deepFreeze({
    providerLabel: parseText(value["providerLabel"], false),
    modelLabel: parseText(value["modelLabel"], false),
    connectionLabel: parseText(value["connectionLabel"], false),
    adapterPolicyLabel: parseText(value["adapterPolicyLabel"], false)
  });
}

function parseDisplayGuidance(value: unknown): AgentSendPreviewDisplayInputV2["guidance"] {
  if (!isRecord(value) || !hasExactlyKeys(value, ["version", "profileId", "runtimeFacts"])) {
    invalidInput();
  }
  return deepFreeze({
    version: parseRevision(value["version"]),
    profileId: parseMachineId(value["profileId"]),
    runtimeFacts: parseJsonObject(value["runtimeFacts"])
  });
}

function parseDisplaySource(value: unknown): AgentSendPreviewDisplaySourceV2 {
  if (
    !isRecord(value) ||
    !hasExactlyKeys(value, [
      "sourceRef",
      "label",
      "kind",
      "content",
      "tokenCount",
      "tokenPrecision",
      "dirty",
      "truncated",
      "selectionState",
      "grantSource"
    ])
  )
    invalidInput();
  const tokenCount = value["tokenCount"];
  if (tokenCount !== null && (!Number.isSafeInteger(tokenCount) || (tokenCount as number) < 0)) {
    invalidInput();
  }
  return deepFreeze({
    sourceRef: parseMachineId(value["sourceRef"]),
    label: parseText(value["label"], false),
    kind: parseEnum(value["kind"], [
      "disk_file",
      "editor_buffer",
      "story_bible_asset",
      "project_conventions",
      "workspace_outline",
      "conversation_summary",
      "compaction_summary",
      "active_resource",
      "explicit_reference"
    ] as const),
    content: parseText(value["content"]),
    tokenCount: tokenCount as number | null,
    tokenPrecision: parseEnum(value["tokenPrecision"], [
      "reported",
      "estimated",
      "unknown"
    ] as const),
    dirty: parseBoolean(value["dirty"]),
    truncated: parseBoolean(value["truncated"]),
    selectionState: parseEnum(value["selectionState"], [
      "automatic",
      "pinned",
      "explicit",
      "excluded"
    ] as const),
    grantSource: parseEnum(value["grantSource"], [
      "not_applicable",
      "workspace_default",
      "run_grant",
      "user_explicit"
    ] as const)
  });
}

function parseLocalProvenanceKind(value: unknown): AgentSendPreviewLocalProvenanceKind {
  return parseEnum(value, [
    "workspace_identity",
    "canonical_root_identity",
    "absolute_path",
    "artifact_identity",
    "provider_account_identity",
    "transport_secret",
    "cache_resource_handle"
  ] as const);
}

function assertToolTranscript(messages: readonly AgentSendSemanticMessageV2[]): void {
  const pendingCalls = new Set<string>();
  const completedCalls = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls) {
        if (pendingCalls.has(call.toolCallId) || completedCalls.has(call.toolCallId)) {
          invalidInput();
        }
        pendingCalls.add(call.toolCallId);
      }
    } else if (message.role === "tool") {
      if (!pendingCalls.delete(message.toolCallId) || completedCalls.has(message.toolCallId)) {
        invalidInput();
      }
      completedCalls.add(message.toolCallId);
    }
  }
}

function parseCanonicalRoundManifestJson(
  value: unknown,
  expectedChecksum: string
): CanonicalRoundManifestV2 {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_TEXT_LENGTH) {
    invalidInput();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    invalidInput();
  }
  let manifest: CanonicalRoundManifestV2;
  try {
    manifest = parseCanonicalRoundManifestV2(parsed, expectedChecksum);
  } catch {
    invalidInput();
  }
  if (serializeCanonicalRoundManifestV2(manifest) !== value) invalidInput();
  return manifest;
}

function assertPreparedMaterialBindings(
  payload: AgentFirstRoundSemanticPayloadV2,
  facts: AgentSendPreviewValidationFactsV2,
  manifest: CanonicalRoundManifestV2,
  display: AgentSendPreviewDisplayInputV2
): void {
  const currentRequest = manifest.messages.find(
    (message) => message.kind === "current_user_request"
  );
  if (
    manifest.roundNumber !== 0 ||
    manifest.authority.content !== payload.systemPrompt ||
    manifest.providerSemanticVersionSetChecksum !== facts.providerSemanticVersionSetChecksum ||
    manifest.tools.catalogRevision !== facts.toolProjectionRevision ||
    manifest.tools.projectionChecksum !== facts.toolProjectionChecksum ||
    manifest.sharing.defaultsRevision !== facts.sharingDefaultsRevision ||
    manifest.sharing.runGrantRevision !== facts.sharingGrantRevision ||
    currentRequest?.contentChecksum !== facts.requestChecksum ||
    !semanticMessagesMatchManifest(payload.messages, manifest.messages) ||
    !semanticToolsMatchProjection(payload.tools, manifest.tools.descriptors) ||
    !sourceBindingsMatchManifest(facts.sourceBindings, manifest) ||
    !displaySourcesMatchManifest(display.sources, manifest)
  ) {
    invalidInput();
  }
}

function displaySourcesMatchManifest(
  displaySources: readonly AgentSendPreviewDisplaySourceV2[],
  manifest: CanonicalRoundManifestV2
): boolean {
  const included = displaySources.filter((source) => source.selectionState !== "excluded");
  if (included.length !== manifest.sourceRefs.length) return false;
  if (
    displaySources.some(
      (source) =>
        source.selectionState === "excluded" &&
        manifest.sourceRefs.some((manifestSource) => manifestSource.refId === source.sourceRef)
    )
  ) {
    return false;
  }
  return included.every((source, index) => {
    const manifestSource = manifest.sourceRefs[index];
    const message =
      manifestSource === undefined ? undefined : manifest.messages[manifestSource.messageOrder];
    return (
      manifestSource?.refId === source.sourceRef &&
      message?.sourceRefId === source.sourceRef &&
      providerVisibleEnvelopeData(message.content) === source.content
    );
  });
}

function providerVisibleEnvelopeData(content: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return undefined;
  }
  return isRecord(value) && typeof value["data"] === "string" ? value["data"] : undefined;
}

function semanticMessagesMatchManifest(
  payloadMessages: readonly AgentSendSemanticMessageV2[],
  manifestMessages: readonly CanonicalRoundMessageV2[]
): boolean {
  return (
    payloadMessages.length === manifestMessages.length &&
    payloadMessages.every((message, index) => {
      const manifest = manifestMessages[index];
      if (
        manifest === undefined ||
        message.role !== manifest.role ||
        message.content !== manifest.content
      ) {
        return false;
      }
      if (message.role === "tool") return message.toolCallId === manifest.toolCallId;
      if (message.role !== "assistant") return manifest.toolCalls.length === 0;
      return semanticToolCallsMatchManifest(message.toolCalls, manifest.toolCalls);
    })
  );
}

function semanticToolCallsMatchManifest(
  payloadCalls: readonly AgentSendSemanticToolCallV2[],
  manifestCalls: readonly CanonicalRoundToolCallV2[]
): boolean {
  return (
    payloadCalls.length === manifestCalls.length &&
    payloadCalls.every((call, index) => {
      const manifest = manifestCalls[index];
      return (
        manifest !== undefined &&
        call.toolCallId === manifest.id &&
        call.name === manifest.name &&
        call.argumentsText === manifest.arguments
      );
    })
  );
}

function semanticToolsMatchProjection(
  tools: readonly AgentSendSemanticToolV2[],
  descriptors: readonly JsonObject[]
): boolean {
  return (
    tools.length === descriptors.length &&
    tools.every((tool, index) => {
      const descriptor = descriptors[index];
      if (descriptor === undefined) return false;
      const projectedName = descriptor["providerName"] ?? descriptor["name"];
      const description = descriptor["description"] ?? null;
      return (
        projectedName === tool.name &&
        description === tool.description &&
        canonicalJson(descriptor["inputSchema"]) === canonicalJson(tool.inputSchema)
      );
    })
  );
}

function sourceBindingsMatchManifest(
  bindings: readonly AgentSendPreviewSourceBindingV2[],
  manifest: CanonicalRoundManifestV2
): boolean {
  return (
    bindings.length === manifest.sourceRefs.length &&
    bindings.every((binding, index) => {
      const source = manifest.sourceRefs[index];
      return (
        source !== undefined &&
        binding.sourceRef === source.refId &&
        binding.sourceRevision === source.sourceRevision &&
        binding.sourceChecksum === source.sourceChecksum
      );
    })
  );
}

function parseJsonObject(value: unknown): JsonObject {
  if (!isRecord(value)) invalidInput();
  return JSON.parse(canonicalJson(value)) as JsonObject;
}

function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string") {
    if (hasUnpairedSurrogate(value)) invalidInput();
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidInput();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) invalidInput();
    seen.add(value);
    const result = `[${value
      .map((child, index) => {
        if (!Object.hasOwn(value, index)) invalidInput();
        return canonicalJson(child, seen);
      })
      .join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (!isRecord(value) || seen.has(value)) invalidInput();
  seen.add(value);
  const result = `{${Object.keys(value)
    .sort()
    .map((key) => {
      if (hasUnpairedSurrogate(key)) invalidInput();
      return `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`;
    })
    .join(",")}}`;
  seen.delete(value);
  return result;
}

function parseArray<T>(value: unknown, parser: (child: unknown) => T): readonly T[] {
  if (!Array.isArray(value)) invalidInput();
  return Object.freeze(value.map(parser));
}

function parseText(value: unknown, allowEmpty = true): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_TEXT_LENGTH ||
    (!allowEmpty && value.length === 0) ||
    hasUnpairedSurrogate(value)
  )
    invalidInput();
  return value;
}

function parseMachineId(value: unknown): string {
  if (typeof value !== "string" || !isMachineId(value)) invalidInput();
  return value;
}

function isMachineId(value: string): boolean {
  return MACHINE_ID.test(value);
}

function parseRevision(value: unknown): string {
  return parseMachineId(value);
}

function parseChecksum(value: unknown): string {
  if (typeof value !== "string" || !CHECKSUM.test(value)) invalidInput();
  return value;
}

function parseChecksumOrNotApplicable(value: unknown): string {
  if (value === "not_applicable") return value;
  return parseChecksum(value);
}

function parsePositiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalidInput();
  return value;
}

function parseBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalidInput();
  return value;
}

function parseEnum<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) invalidInput();
  return value as T[number];
}

function assertUnique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) invalidInput();
}

function hasExactlyKeys(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalidInput(): never {
  throw new Error("AGENT_SEND_PREVIEW_INVALID");
}

function previewError(
  code: "AGENT_SEND_PREVIEW_INVALID" | "AGENT_SEND_PREVIEW_STALE",
  traceId: string
): UnifiedError {
  return createUnifiedError({
    code,
    category: "ValidationError",
    message:
      code === "AGENT_SEND_PREVIEW_STALE"
        ? "The send preview is stale or has already been consumed."
        : "The send preview input is invalid.",
    recoverability: "user-action",
    suggestedAction: "Prepare and review a new send preview before sending.",
    traceId
  });
}

function sendFailedError(traceId: string): UnifiedError {
  return createUnifiedError({
    code: "AGENT_SEND_PREVIEW_SEND_FAILED",
    category: "AgentError",
    message: "The frozen first round could not be sent.",
    recoverability: "user-action",
    suggestedAction: "Prepare a new preview before retrying because send outcome is unknown.",
    traceId
  });
}
