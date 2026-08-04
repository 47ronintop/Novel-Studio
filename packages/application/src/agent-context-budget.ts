import { createHash } from "node:crypto";

import {
  aggregateContextPrecision,
  calculateContextBudget,
  computeAgentRunToolCatalogRevision,
  computeAgentRunToolCatalogRevisionV2,
  createApprovalRuleSetProjection,
  createDeterministicTokenEstimator,
  type AgentContextPrecision,
  type AgentTokenEstimator,
  type AgentToolDescriptor,
  type AgentToolFacadeVersion
} from "@novel-studio/agent-engine";
import type { ContextBudgetSnapshotV11 } from "@novel-studio/agent-engine";
import {
  createUnifiedError,
  err,
  ok,
  type JsonObject,
  type Result,
  type UnifiedError
} from "@novel-studio/shared";

import type { AgentContextProfile } from "./agent-context-profile.js";
import {
  materializeProjectDataSource,
  type AgentPromptMaterialization,
  type AgentPromptMaterializationArtifact,
  type MaterializedAgentMessage
} from "./agent-prompt-materializer.js";

export const AGENT_CONTEXT_BUDGET_CONTRACT_VERSION = "1.0" as const;
export const AGENT_MAX_TOOL_RESULT_SUMMARY_UTF8_BYTES = 4_096;

export interface AgentBudgetToolCatalogInput {
  readonly facadeVersion: AgentToolFacadeVersion;
  readonly schemaVersion?: "1.0" | "2.0";
  readonly catalogRevision: string;
  readonly descriptors: readonly AgentToolDescriptor[];
}

export interface AgentBudgetArtifactPointer {
  readonly artifactId: string;
  readonly kind: string;
  readonly checksum: string;
}

export interface AgentBudgetSharingIdentity {
  readonly defaultsRevision: string;
  readonly grantRevision: string;
}

export interface ResolveBudgetInputsInput {
  readonly provider: string;
  readonly model: string;
  readonly modelProfileId: string;
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly requiredContextTokens?: number;
  readonly profile: AgentContextProfile;
  readonly prompt: AgentPromptMaterialization | AgentPromptMaterializationArtifact;
  readonly contextSources: readonly Parameters<typeof materializeProjectDataSource>[0][];
  readonly historyMessages?: readonly MaterializedAgentMessage[];
  readonly artifactPointers?: readonly AgentBudgetArtifactPointer[];
  readonly toolCatalog: AgentBudgetToolCatalogInput;
  readonly sharing?: AgentBudgetSharingIdentity;
  readonly estimator?: AgentTokenEstimator;
}

export interface ResolvedAgentContextBudgetInputs {
  readonly schemaVersion: typeof AGENT_CONTEXT_BUDGET_CONTRACT_VERSION;
  readonly provider: string;
  readonly model: string;
  readonly modelProfileId: string;
  readonly contextWindow: number;
  readonly maxOutputTokens?: number;
  readonly requiredContextTokens: number;
  readonly toolReserve: number;
  readonly systemReserve: number;
  readonly usedTokens: number;
  readonly precision: AgentContextPrecision;
  readonly toolCatalog: {
    readonly facadeVersion: AgentToolFacadeVersion;
    readonly schemaVersion?: "1.0" | "2.0";
    readonly catalogRevision: string;
    readonly descriptorChecksum: string;
    readonly descriptorCount: number;
  };
  readonly systemMaterializationChecksum: string;
  readonly usedMaterializationChecksum: string;
  readonly operandsChecksum: string;
  readonly sharing?: AgentBudgetSharingIdentity;
}

export interface ResolvedContextBudgetUsageLimits {
  readonly contextWindow: number;
  readonly safeInputBudget: number;
}

/** Validate a persisted C4 budget before reusing its limits for usage accounting. */
export function readResolvedContextBudgetUsageLimits(
  value: JsonObject,
  expected: {
    readonly contextBudgetSnapshotId: string;
    readonly provider: string;
    readonly model: string;
    readonly modelProfileId: string;
    readonly contextWindow: number;
    readonly facadeVersion: AgentToolFacadeVersion;
    readonly schemaVersion?: "1.0" | "2.0";
    readonly catalogRevision: string;
    readonly sharing?: AgentBudgetSharingIdentity;
  }
): Result<ResolvedContextBudgetUsageLimits, UnifiedError> {
  const audit = value["audit"];
  const catalog = isRecord(audit) ? audit["toolCatalog"] : undefined;
  const contextWindow = value["contextWindow"];
  const outputReserve = value["outputReserve"];
  const toolReserve = value["toolReserve"];
  const systemReserve = value["systemReserve"];
  const safeInputBudget = value["safeInputBudget"];
  const usedTokens = value["usedTokens"];
  const remainingTokens = value["remainingTokens"];
  const requiredContextTokens = value["requiredContextTokens"];
  const precision = value["precision"];
  const requestedMaxOutputTokens = isRecord(audit) ? audit["requestedMaxOutputTokens"] : undefined;
  const persistedSharing = isRecord(audit) ? audit["sharing"] : undefined;
  if (
    value["schemaVersion"] !== "1.1" ||
    value["contextBudgetSnapshotId"] !== expected.contextBudgetSnapshotId ||
    value["provider"] !== expected.provider ||
    value["model"] !== expected.model ||
    value["contextWindowSemantics"] !== "shared_input_output_window" ||
    contextWindow !== expected.contextWindow ||
    !isPositiveTokenCount(contextWindow) ||
    !isTokenCount(outputReserve) ||
    value["maxOutputTokens"] !== outputReserve ||
    !isTokenCount(toolReserve) ||
    !isTokenCount(systemReserve) ||
    !isPositiveTokenCount(safeInputBudget) ||
    safeInputBudget !== contextWindow - outputReserve - toolReserve - systemReserve ||
    !isTokenCount(requiredContextTokens) ||
    !isTokenCount(usedTokens) ||
    !isTokenCount(remainingTokens) ||
    remainingTokens !== Math.max(0, safeInputBudget - usedTokens) ||
    (precision !== "reported" && precision !== "estimated" && precision !== "unknown") ||
    !isRecord(audit) ||
    audit["budgetContractVersion"] !== AGENT_CONTEXT_BUDGET_CONTRACT_VERSION ||
    audit["modelProfileId"] !== expected.modelProfileId ||
    (requestedMaxOutputTokens !== null && !isPositiveTokenCount(requestedMaxOutputTokens)) ||
    !isChecksum(audit["operandsChecksum"]) ||
    !isChecksum(audit["systemMaterializationChecksum"]) ||
    !isChecksum(audit["usedMaterializationChecksum"]) ||
    !isRecord(catalog) ||
    catalog["facadeVersion"] !== expected.facadeVersion ||
    (expected.schemaVersion === undefined
      ? catalog["schemaVersion"] !== undefined
      : catalog["schemaVersion"] !== expected.schemaVersion) ||
    catalog["catalogRevision"] !== expected.catalogRevision ||
    !isChecksum(catalog["descriptorChecksum"]) ||
    !isTokenCount(catalog["descriptorCount"]) ||
    !sharingIdentityMatches(persistedSharing, expected.sharing)
  ) {
    return err(persistedBudgetInvalid(expected));
  }
  const resolvedWithoutChecksum = createResolvedOperands({
    provider: expected.provider,
    model: expected.model,
    modelProfileId: expected.modelProfileId,
    contextWindow,
    ...(requestedMaxOutputTokens === null ? {} : { maxOutputTokens: requestedMaxOutputTokens }),
    requiredContextTokens,
    toolReserve,
    systemReserve,
    usedTokens,
    precision,
    toolCatalog: {
      facadeVersion: expected.facadeVersion,
      ...(expected.schemaVersion === undefined ? {} : { schemaVersion: expected.schemaVersion }),
      catalogRevision: expected.catalogRevision,
      descriptorChecksum: catalog["descriptorChecksum"],
      descriptorCount: catalog["descriptorCount"]
    },
    systemMaterializationChecksum: audit["systemMaterializationChecksum"],
    usedMaterializationChecksum: audit["usedMaterializationChecksum"],
    ...(expected.sharing === undefined ? {} : { sharing: expected.sharing })
  });
  if (audit["operandsChecksum"] !== checksum(stableSerialize(resolvedWithoutChecksum))) {
    return err(persistedBudgetInvalid(expected));
  }
  return ok({ contextWindow, safeInputBudget });
}

export function calculateResolvedContextBudget(input: {
  readonly contextBudgetSnapshotId: string;
  readonly resolved: ResolvedAgentContextBudgetInputs;
  readonly calculatedAt: string;
}): Result<ContextBudgetSnapshotV11, UnifiedError> {
  const base = calculateContextBudget({
    contextBudgetSnapshotId: input.contextBudgetSnapshotId,
    provider: input.resolved.provider,
    model: input.resolved.model,
    contextWindow: input.resolved.contextWindow,
    ...(input.resolved.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: input.resolved.maxOutputTokens }),
    toolReserve: input.resolved.toolReserve,
    systemReserve: input.resolved.systemReserve,
    requiredContextTokens: input.resolved.requiredContextTokens,
    usedTokens: input.resolved.usedTokens,
    precision: input.resolved.precision,
    calculatedAt: input.calculatedAt
  });
  if (!base.ok) return base;
  return ok({
    ...base.value,
    schemaVersion: "1.1",
    audit: {
      budgetContractVersion: input.resolved.schemaVersion,
      modelProfileId: input.resolved.modelProfileId,
      requestedMaxOutputTokens: input.resolved.maxOutputTokens ?? null,
      operandsChecksum: input.resolved.operandsChecksum,
      systemMaterializationChecksum: input.resolved.systemMaterializationChecksum,
      usedMaterializationChecksum: input.resolved.usedMaterializationChecksum,
      toolCatalog: input.resolved.toolCatalog,
      ...(input.resolved.sharing === undefined ? {} : { sharing: input.resolved.sharing })
    }
  });
}

/**
 * Resolve every budget operand from the exact frozen prompt and tool catalog used by the provider.
 * All desktop paths call this function; callers may choose the snapshot id/time, but cannot estimate
 * wrappers or schemas independently.
 */
export function resolveBudgetInputs(
  input: ResolveBudgetInputsInput
): Result<ResolvedAgentContextBudgetInputs, UnifiedError> {
  const invalid = validateInput(input);
  if (invalid !== undefined) return err(budgetInputsInvalid(input, invalid));

  const expectedCatalogRevision = computeBudgetCatalogRevision(input.toolCatalog);
  if (input.toolCatalog.catalogRevision !== expectedCatalogRevision) {
    return err(budgetInputsInvalid(input, "toolCatalog.catalogRevision"));
  }
  if (
    input.prompt.profileId !== input.profile.profileId ||
    input.prompt.profileVersion !== input.profile.profileVersion ||
    input.prompt.systemPrompt.length === 0 ||
    input.prompt.toolCatalogRevision !== input.toolCatalog.catalogRevision
  ) {
    return err(budgetInputsInvalid(input, "prompt.profile"));
  }
  const standaloneProfile = input.profile.profileId === "standalone";
  if (
    standaloneProfile !== (input.profile.scope.kind === "standalone") ||
    (standaloneProfile &&
      input.contextSources.some((source) => source.sourceKind !== "compaction_summary"))
  ) {
    return err(budgetInputsInvalid(input, "standalone.contextSources"));
  }
  if (standaloneProfile && input.toolCatalog.descriptors.length > 0) {
    return err(budgetInputsInvalid(input, "standalone.toolCatalog"));
  }
  if (
    standaloneProfile &&
    input.contextSources.some(
      (source) =>
        source.sourceKind === "compaction_summary" &&
        (source.assetId === undefined ||
          !(input.artifactPointers ?? []).some(
            (pointer) =>
              pointer.kind === "compaction_summary" &&
              pointer.artifactId === source.assetId &&
              pointer.checksum === checksum(source.content)
          ))
    )
  ) {
    return err(budgetInputsInvalid(input, "standalone.compactionSummaryPointer"));
  }
  if (stableSerialize(input.prompt.contextSources) !== stableSerialize(input.contextSources)) {
    return err(budgetInputsInvalid(input, "prompt.contextSources"));
  }

  const estimator = input.estimator ?? createDeterministicTokenEstimator();
  const sourceKeys = new Map<string, number>();
  for (const source of input.contextSources) {
    if (source.sourceKind === "system_guidance") {
      return err(budgetInputsInvalid(input, "contextSources.systemGuidance"));
    }
    const key = stableSerialize(materializeProjectDataSource(source));
    sourceKeys.set(key, (sourceKeys.get(key) ?? 0) + 1);
  }
  for (const message of input.prompt.messages) {
    const key = stableSerialize(message);
    const remaining = sourceKeys.get(key) ?? 0;
    if (remaining > 0) sourceKeys.set(key, remaining - 1);
  }
  if ([...sourceKeys.values()].some((remaining) => remaining !== 0)) {
    return err(budgetInputsInvalid(input, "prompt.contextSources"));
  }
  const conventionMessages = input.contextSources
    .filter((source) => source.sourceKind === "project_conventions")
    .map(materializeProjectDataSource);
  const conventionKeys = new Map<string, number>();
  for (const message of conventionMessages) {
    const key = stableSerialize(message);
    conventionKeys.set(key, (conventionKeys.get(key) ?? 0) + 1);
  }
  const dynamicMessages = [...input.prompt.messages, ...(input.historyMessages ?? [])].filter(
    (message) => {
      const key = stableSerialize(message);
      const remaining = conventionKeys.get(key) ?? 0;
      if (remaining === 0) return true;
      conventionKeys.set(key, remaining - 1);
      return false;
    }
  );
  if ([...conventionKeys.values()].some((remaining) => remaining !== 0)) {
    return err(budgetInputsInvalid(input, "prompt.conventions"));
  }

  const systemMaterial = providerSystemMaterial(input.provider, {
    systemPrompt: input.prompt.systemPrompt,
    conventionMessages,
    artifactPointers: input.artifactPointers ?? []
  });
  const usedMaterial = providerMessagesMaterial(input.provider, dynamicMessages);
  const toolMaterial = providerToolMaterial(input.provider, input.toolCatalog.descriptors);
  const systemSerialized = stableSerialize(systemMaterial);
  const usedSerialized = stableSerialize(usedMaterial);
  const systemCount = estimator.count(systemSerialized, input.modelProfileId);
  const usedCount = estimator.count(usedSerialized, input.modelProfileId);
  const toolCount =
    input.toolCatalog.descriptors.length === 0
      ? { tokens: 0, precision: systemCount.precision }
      : estimator.count(stableSerialize(toolMaterial), input.modelProfileId);

  if (
    !isTokenCount(systemCount.tokens) ||
    !isTokenCount(usedCount.tokens) ||
    !isTokenCount(toolCount.tokens)
  ) {
    return err(budgetInputsInvalid(input, "tokenizer.result"));
  }

  const descriptorChecksum = checksum(
    stableSerialize(
      input.toolCatalog.descriptors.map((descriptor) => ({
        id: descriptor.id ?? descriptor.name,
        providerName: descriptor.providerName ?? descriptor.name,
        description: descriptor.description ?? "",
        inputSchema: descriptor.inputSchema,
        descriptorDigest: descriptor.descriptorDigest ?? ""
      }))
    )
  );
  const proof = {
    facadeVersion: input.toolCatalog.facadeVersion,
    ...(input.toolCatalog.schemaVersion === undefined
      ? {}
      : { schemaVersion: input.toolCatalog.schemaVersion }),
    catalogRevision: input.toolCatalog.catalogRevision,
    descriptorChecksum,
    descriptorCount: input.toolCatalog.descriptors.length
  };
  const resolvedWithoutChecksum = createResolvedOperands({
    provider: input.provider,
    model: input.model,
    modelProfileId: input.modelProfileId,
    contextWindow: input.contextWindow as number,
    ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
    requiredContextTokens: input.requiredContextTokens as number,
    toolReserve: toolCount.tokens,
    systemReserve: systemCount.tokens,
    usedTokens: usedCount.tokens,
    precision: aggregateContextPrecision([
      systemCount.precision,
      usedCount.precision,
      ...(input.toolCatalog.descriptors.length === 0 ? [] : [toolCount.precision])
    ]),
    toolCatalog: proof,
    systemMaterializationChecksum: checksum(systemSerialized),
    usedMaterializationChecksum: checksum(usedSerialized),
    ...(input.sharing === undefined ? {} : { sharing: cloneSharingIdentity(input.sharing) })
  });
  return ok(
    deepFreeze({
      ...resolvedWithoutChecksum,
      operandsChecksum: checksum(stableSerialize(resolvedWithoutChecksum))
    })
  );
}

function createResolvedOperands(
  input: Omit<ResolvedAgentContextBudgetInputs, "schemaVersion" | "operandsChecksum">
) {
  return {
    schemaVersion: AGENT_CONTEXT_BUDGET_CONTRACT_VERSION,
    provider: input.provider,
    model: input.model,
    modelProfileId: input.modelProfileId,
    contextWindow: input.contextWindow,
    ...(input.maxOutputTokens === undefined ? {} : { maxOutputTokens: input.maxOutputTokens }),
    requiredContextTokens: input.requiredContextTokens,
    toolReserve: input.toolReserve,
    systemReserve: input.systemReserve,
    usedTokens: input.usedTokens,
    precision: input.precision,
    toolCatalog: input.toolCatalog,
    systemMaterializationChecksum: input.systemMaterializationChecksum,
    usedMaterializationChecksum: input.usedMaterializationChecksum,
    ...(input.sharing === undefined ? {} : { sharing: input.sharing })
  };
}

function computeBudgetCatalogRevision(input: AgentBudgetToolCatalogInput): string {
  if (input.schemaVersion !== "2.0") {
    return computeAgentRunToolCatalogRevision(input.facadeVersion, input.descriptors);
  }
  const operations = input.descriptors.flatMap((descriptor) => {
    if (descriptor.effect !== "propose") return [];
    if (descriptor.writeOperation === undefined) throw new Error("AGENT_TOOL_OPERATION_UNMAPPED");
    return [descriptor.writeOperation];
  });
  const projection =
    operations.length === 0
      ? { version: "not_applicable", checksum: "not_applicable", rules: [] as const }
      : createApprovalRuleSetProjection(operations);
  return computeAgentRunToolCatalogRevisionV2({
    descriptors: input.descriptors,
    approvalRuleSetVersion: projection.version,
    approvalRuleSetChecksum: projection.checksum,
    approvalRules: projection.rules
  });
}

function validateInput(input: ResolveBudgetInputsInput): string | undefined {
  if (typeof input.provider !== "string" || input.provider.trim().length === 0) return "provider";
  if (typeof input.model !== "string" || input.model.trim().length === 0) return "model";
  if (typeof input.modelProfileId !== "string" || input.modelProfileId.trim().length === 0) {
    return "modelProfileId";
  }
  if (!isPositiveTokenCount(input.contextWindow)) return "contextWindow";
  if (!isTokenCount(input.requiredContextTokens)) return "requiredContextTokens";
  if (input.maxOutputTokens !== undefined && !isPositiveTokenCount(input.maxOutputTokens)) {
    return "maxOutputTokens";
  }
  if (
    !isRecord(input.profile) ||
    typeof input.profile.profileId !== "string" ||
    typeof input.profile.profileVersion !== "string"
  ) {
    return "profile";
  }
  if (
    !isRecord(input.prompt) ||
    typeof input.prompt.profileId !== "string" ||
    typeof input.prompt.profileVersion !== "string" ||
    typeof input.prompt.systemPrompt !== "string" ||
    !Array.isArray(input.prompt.messages)
  ) {
    return "prompt";
  }
  if (!Array.isArray(input.contextSources)) return "contextSources";
  if (input.historyMessages !== undefined && !Array.isArray(input.historyMessages)) {
    return "historyMessages";
  }
  if (input.artifactPointers !== undefined) {
    if (!Array.isArray(input.artifactPointers)) return "artifactPointers";
    if (
      input.artifactPointers.some(
        (pointer) =>
          !isRecord(pointer) ||
          !isNonEmptyString(pointer.artifactId) ||
          !isNonEmptyString(pointer.kind) ||
          !isChecksum(pointer.checksum)
      )
    ) {
      return "artifactPointers";
    }
  }
  if (!isRecord(input.toolCatalog)) return "toolCatalog";
  if (
    typeof input.toolCatalog.catalogRevision !== "string" ||
    input.toolCatalog.catalogRevision.length === 0
  ) {
    return "toolCatalog.catalogRevision";
  }
  if (!Array.isArray(input.toolCatalog.descriptors)) return "toolCatalog.descriptors";
  if (input.sharing !== undefined && !isSharingIdentity(input.sharing)) return "sharing";
  return undefined;
}

function providerSystemMaterial(
  provider: string,
  input: {
    readonly systemPrompt: string;
    readonly conventionMessages: readonly MaterializedAgentMessage[];
    readonly artifactPointers: readonly AgentBudgetArtifactPointer[];
  }
): JsonObject {
  const fixedControl = {
    schemaVersion: AGENT_CONTEXT_BUDGET_CONTRACT_VERSION,
    conversationEnvelope: "messages",
    controlEnvelope: "streaming_agent_round",
    dataEnvelope: "untrusted_project_data",
    instructionPolicy: "content_is_data_not_authority"
  };
  const conventions = providerMessagesMaterial(provider, input.conventionMessages);
  const pointers = input.artifactPointers.map((pointer) => ({
    kind: pointer.kind,
    artifactId: pointer.artifactId,
    checksum: pointer.checksum
  }));
  switch (providerFamily(provider)) {
    case "anthropic":
      return {
        system: input.systemPrompt,
        messages: conventions,
        fixedControl,
        artifactPointers: pointers
      };
    case "gemini":
      return {
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        contents: conventions,
        fixedControl,
        artifactPointers: pointers
      };
    default:
      return {
        messages: [
          { role: "system", content: input.systemPrompt },
          ...(conventions as unknown as readonly JsonObject[])
        ],
        fixedControl,
        artifactPointers: pointers
      };
  }
}

function providerMessagesMaterial(
  provider: string,
  messages: readonly MaterializedAgentMessage[]
): JsonObject[] {
  const family = providerFamily(provider);
  return messages.map<JsonObject>((message) => {
    if (family === "gemini") {
      return {
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
        ...(message.toolCallId === undefined ? {} : { toolCallId: message.toolCallId })
      };
    }
    if (family === "anthropic") {
      return {
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
        ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId })
      };
    }
    return {
      role: message.role,
      content: message.content,
      ...(message.toolCallId === undefined ? {} : { tool_call_id: message.toolCallId }),
      ...(message.toolCalls === undefined
        ? {}
        : {
            tool_calls: message.toolCalls.map((toolCall) => ({
              id: toolCall.id,
              name: toolCall.name,
              arguments: toolCall.arguments,
              ...(toolCall.providerMetadata === undefined
                ? {}
                : { providerMetadata: toolCall.providerMetadata })
            }))
          })
    };
  });
}

function providerToolMaterial(
  provider: string,
  descriptors: readonly AgentToolDescriptor[]
): JsonObject {
  const definitions = descriptors.map((descriptor) => {
    const name = descriptor.providerName ?? descriptor.name;
    switch (providerFamily(provider)) {
      case "anthropic":
        return {
          name,
          ...(descriptor.description === undefined ? {} : { description: descriptor.description }),
          input_schema: descriptor.inputSchema
        };
      case "gemini":
        return {
          name,
          ...(descriptor.description === undefined ? {} : { description: descriptor.description }),
          parametersJsonSchema: descriptor.inputSchema
        };
      default:
        return {
          type: "function",
          function: {
            name,
            ...(descriptor.description === undefined
              ? {}
              : { description: descriptor.description }),
            parameters: descriptor.inputSchema
          }
        };
    }
  });
  const maximumResultSummary = providerMessagesMaterial(provider, [
    {
      role: "tool",
      toolCallId: "tool_call_maximum_summary",
      content: "x".repeat(AGENT_MAX_TOOL_RESULT_SUMMARY_UTF8_BYTES)
    }
  ]);
  return providerFamily(provider) === "gemini"
    ? { tools: [{ functionDeclarations: definitions }], maximumResultSummary }
    : { tools: definitions, maximumResultSummary };
}

function providerFamily(provider: string): "openai" | "anthropic" | "gemini" {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "anthropic") return "anthropic";
  if (normalized === "google-gemini" || normalized === "gemini") return "gemini";
  return "openai";
}

function budgetInputsInvalid(input: ResolveBudgetInputsInput, field: string): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CONTEXT_BUDGET_INPUTS_INVALID",
    category: "ValidationError",
    message: "The server-authoritative context budget inputs are incomplete or invalid.",
    recoverability: "user-action",
    suggestedAction: "Choose a model with verified budget capabilities and retry.",
    traceId: "agent-context-budget-inputs",
    redactedDetail: {
      provider: typeof input.provider === "string" ? input.provider : "",
      model: typeof input.model === "string" ? input.model : "",
      field
    }
  });
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isSharingIdentity(value: unknown): value is AgentBudgetSharingIdentity {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    isChecksum(value["defaultsRevision"]) &&
    isChecksum(value["grantRevision"])
  );
}

function cloneSharingIdentity(value: AgentBudgetSharingIdentity): AgentBudgetSharingIdentity {
  return {
    defaultsRevision: value.defaultsRevision,
    grantRevision: value.grantRevision
  };
}

function sharingIdentityMatches(
  persisted: unknown,
  expected: AgentBudgetSharingIdentity | undefined
): boolean {
  if (expected === undefined) return persisted === undefined;
  return (
    isSharingIdentity(persisted) &&
    persisted.defaultsRevision === expected.defaultsRevision &&
    persisted.grantRevision === expected.grantRevision
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function persistedBudgetInvalid(expected: {
  readonly contextBudgetSnapshotId: string;
  readonly provider: string;
  readonly model: string;
}): UnifiedError {
  return createUnifiedError({
    code: "AGENT_CONTEXT_BUDGET_SNAPSHOT_INVALID",
    category: "ValidationError",
    message: "The persisted context budget proof is missing, invalid, or bound to another run.",
    recoverability: "user-action",
    suggestedAction: "Reload the run and retry with its persisted context budget.",
    traceId: "agent-context-budget-inputs",
    redactedDetail: {
      contextBudgetSnapshotId: expected.contextBudgetSnapshotId,
      provider: expected.provider,
      model: expected.model
    }
  });
}

function isPositiveTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function checksum(value: string): string {
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
