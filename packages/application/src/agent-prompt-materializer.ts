import { createHash } from "node:crypto";

import {
  agentControlEventMessageMappingV20,
  aggregateContextPrecision,
  createCanonicalRoundManifestV2,
  createDeterministicTokenEstimator,
  createPackedAgentContext,
  createPackedAgentContextManifest,
  createPackedAgentContextManifestV2,
  parseProviderSemanticVersionSetV1,
  validatePackedAgentContext,
  validateAgentContextSourceMaterialization,
  type AgentContextPreferenceScope,
  type AgentContextPrecision,
  type AgentRunEvent,
  type AgentControlEventTypeV20,
  type AgentContextSourceInput,
  type AgentTokenEstimator,
  type CanonicalRoundManifestV2,
  type CanonicalRoundMessageKindV2,
  type CreateCanonicalRoundMessageV2Input,
  type PackedAgentContext,
  type PackedAgentContextManifestV20,
  type PackedAgentContextSourceManifest,
  type ProviderSemanticVersionSetV1
} from "@novel-studio/agent-engine";
import type { JsonObject } from "@novel-studio/shared";

import {
  AGENT_CONTEXT_PROFILE_VERSION,
  parseAgentContextProfile,
  type AgentContextProfile,
  type AgentContextProfileId
} from "./agent-context-profile.js";
import {
  parseCurrentAgentGuidanceRefId,
  parseHistoricalAgentGuidanceRefId,
  verifyCurrentAgentGuidance,
  verifyHistoricalAgentGuidance
} from "./agent-guidance-registry.js";
import type {
  MaterializedAgentGuidanceProofV3,
  MaterializedAgentGuidanceV3,
  NormalizedRegisteredGuidanceBuildInputV3
} from "./agent-guidance-registry.js";
import {
  parseProviderVisibleAgentRuntimeFacts,
  type ProviderVisibleAgentRuntimeFacts
} from "./agent-runtime-facts.js";
import { AGENT_SYSTEM_GUIDANCE_VERSION } from "./agent-system-prompt.js";
import { parseWritingTaskIntent, type WritingTaskIntent } from "./writing-task-intent.js";
import { createAgentContextSourceMaterializationArtifact } from "./workspace-project-context.js";
import {
  createProviderVisibleUntrustedEnvelope,
  isProviderVisibleEnvelopeAllowedInRole,
  parseProviderVisibleUntrustedEnvelope,
  providerVisibleSummaryRevision,
  serializeProviderVisibleUntrustedEnvelope,
  type ProviderVisibleProjectSourceKind
} from "./agent-untrusted-envelope.js";

export type MaterializedAgentMessageRole = "system" | "user" | "assistant" | "tool";

export interface MaterializedAgentMessage {
  readonly role: MaterializedAgentMessageRole;
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly {
    readonly id: string;
    readonly name: string;
    readonly arguments: string;
    readonly providerMetadata?: JsonObject;
  }[];
}

export interface AgentPromptMaterialization {
  readonly schemaVersion: "1.0";
  readonly profileId: AgentContextProfileId;
  readonly profileVersion: typeof AGENT_CONTEXT_PROFILE_VERSION;
  readonly systemPrompt: string;
  readonly toolCatalogRevision: string;
  readonly contextSources: readonly AgentContextSourceInput[];
  readonly stablePrefixMessages: readonly MaterializedAgentMessage[];
  readonly dynamicSuffixMessages: readonly MaterializedAgentMessage[];
  readonly messages: readonly MaterializedAgentMessage[];
  readonly stablePrefixChecksum: string;
}

/**
 * Content-bearing, immutable input needed to reproduce a run's prompt base after restart. Runtime
 * conversation/tool history remains event-sourced; this artifact freezes everything that precedes
 * that history, including the exact app-authored system prompt and current source bodies.
 */
export interface LegacyAgentPromptMaterializationArtifactV11 extends Omit<
  AgentPromptMaterialization,
  "schemaVersion"
> {
  readonly schemaVersion: "1.1";
  readonly artifactId: string;
  readonly runId: string;
  readonly contextSnapshotId: string;
  readonly profile: AgentContextProfile;
  readonly toolCatalogRevision: string;
  readonly userRequest: string;
  readonly systemGuidanceRefId: string;
  readonly guidanceTemplateChecksum: string;
  readonly contextSources: readonly AgentContextSourceInput[];
  readonly conversationSummaryMessages: readonly MaterializedAgentMessage[];
  /** Present for new packed runs; covered by the artifact checksum to bind the audit manifest. */
  readonly packedContextManifestChecksum?: string;
  readonly checksum: string;
}

export interface AgentPromptMaterializationArtifactV2 extends Omit<
  AgentPromptMaterialization,
  "schemaVersion"
> {
  readonly schemaVersion: "2.0";
  readonly artifactId: string;
  readonly runId: string;
  readonly contextSnapshotId: string;
  readonly profile: AgentContextProfile;
  readonly toolCatalogRevision: string;
  readonly userRequest: string;
  readonly systemGuidanceRefId: string;
  readonly guidanceTemplateChecksum: string;
  readonly guidanceRegistryKey: string;
  readonly guidanceRendererVersion: string;
  readonly normalizedGuidanceInput: NormalizedRegisteredGuidanceBuildInputV3;
  readonly runtimeFacts: ProviderVisibleAgentRuntimeFacts;
  readonly writingTaskIntent: WritingTaskIntent | null;
  readonly writingGenerationGuidanceVersion: "not_applicable" | "2.0";
  readonly providerSemanticVersionSet: ProviderSemanticVersionSetV1;
  readonly guidanceProof: MaterializedAgentGuidanceProofV3;
  readonly contextSources: readonly AgentContextSourceInput[];
  readonly conversationSummaryMessages: readonly MaterializedAgentMessage[];
  readonly packedContextManifestChecksum?: string;
  readonly checksum: string;
}

export type AgentPromptMaterializationArtifact =
  LegacyAgentPromptMaterializationArtifactV11 | AgentPromptMaterializationArtifactV2;

export interface MaterializeAgentPromptInput {
  readonly profile: AgentContextProfile;
  readonly systemPrompt: string;
  readonly toolCatalogRevision: string;
  readonly userRequest: string;
  readonly contextSources?: readonly AgentContextSourceInput[];
  readonly conversationSummaryMessages?: readonly MaterializedAgentMessage[];
  readonly historyMessages?: readonly MaterializedAgentMessage[];
  readonly packedContext?: PackedAgentContext;
}

export interface MaterializeCanonicalAgentRoundInput extends MaterializeAgentPromptInput {
  readonly roundId: string;
  readonly runId: string;
  readonly roundNumber: number;
  readonly projectedToolDescriptors: readonly JsonObject[];
  readonly sharing: {
    readonly defaultsRevision: string;
    readonly runGrantRevision: string;
  };
  readonly providerSemanticVersionSet: ProviderSemanticVersionSetV1;
}

export interface MaterializedCanonicalAgentRound {
  readonly prompt: AgentPromptMaterialization;
  readonly packedContextManifest: PackedAgentContextManifestV20 | null;
  readonly canonicalRoundManifest: CanonicalRoundManifestV2;
}

export interface PackAgentContextInput {
  readonly profile: AgentContextProfile;
  readonly contextSources: readonly AgentContextSourceInput[];
  readonly excludedContextSources?: readonly AgentContextSourceInput[];
  /** Excluded audit records retained from an earlier v1.2 manifest after their bodies were evicted. */
  readonly excludedSourceManifests?: readonly PackedAgentContextSourceManifest[];
  readonly modelProfileId: string;
  readonly usedTokens: number;
  readonly safeInputBudget: number;
  readonly remainingTokens: number;
  readonly precision: AgentContextPrecision;
  readonly createdAt: string;
  readonly estimator?: AgentTokenEstimator;
}

export interface CreateAgentPromptMaterializationArtifactInput extends Omit<
  MaterializeAgentPromptInput,
  "historyMessages"
> {
  readonly runId: string;
  readonly contextSnapshotId: string;
  readonly systemGuidanceRefId?: string;
  /** Parsing-only compatibility input; new writes derive this from packedContext. */
  readonly packedContextManifestChecksum?: string;
  readonly guidanceMaterialization: MaterializedAgentGuidanceV3;
}

export type CreateHistoricalAgentPromptMaterializationArtifactInput = Omit<
  CreateAgentPromptMaterializationArtifactInput,
  "guidanceMaterialization"
>;

const stableProjectSourceKinds = new Set<string>(["project_conventions", "workspace_outline"]);
const stablePrefixSourceKinds = new Set<string>(["project_conventions"]);

export function materializeAgentPrompt(
  input: MaterializeAgentPromptInput
): AgentPromptMaterialization {
  const sources = input.contextSources ?? [];
  if (
    input.conversationSummaryMessages !== undefined &&
    parseConversationSummaryMessages(input.conversationSummaryMessages) === undefined
  ) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  if (
    input.historyMessages !== undefined &&
    parseMessages(input.historyMessages, "v2") === undefined
  ) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  assertProjectSourceProfile(sources, input.profile);
  if (input.packedContext !== undefined) {
    assertPackedContextMatchesSources(input.packedContext, input.profile, sources);
  }
  const orderedSources = orderedProjectContextSources(sources);
  const packedMessages = input.packedContext?.blocks.map(({ role, content }) => ({
    role,
    content
  }));
  const sourceMessages = packedMessages ?? orderedSources.map(materializeProjectDataSource);
  const sourceEntries = orderedSources.map((source, index) => ({
    source,
    message: sourceMessages[index]
  }));
  if (sourceEntries.some((entry) => entry.message === undefined)) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  const stablePrefixMessages = sourceEntries
    .filter((entry) => stablePrefixSourceKinds.has(entry.source.sourceKind))
    .map((entry) => entry.message as MaterializedAgentMessage);
  const conversationMessages =
    input.conversationSummaryMessages === undefined
      ? []
      : materializeAgentConversationContext(input.conversationSummaryMessages);
  const dynamicSuffixMessages: MaterializedAgentMessage[] = [
    ...conversationMessages,
    ...sourceEntries
      .filter((entry) => !stablePrefixSourceKinds.has(entry.source.sourceKind))
      .map((entry) => entry.message as MaterializedAgentMessage),
    { role: "user", content: input.userRequest },
    ...(input.historyMessages ?? [])
  ];
  const stablePrefixChecksum = checksum(
    stableSerialize({
      schemaVersion: "1.0",
      scope: input.profile.scope,
      profileId: input.profile.profileId,
      profileVersion: input.profile.profileVersion,
      systemPrompt: input.systemPrompt,
      toolCatalogRevision: input.toolCatalogRevision,
      sourceIdentities: sources
        .filter((source) => stableProjectSourceKinds.has(source.sourceKind))
        .sort(compareStableProjectSources)
        .map(stableProjectSourceIdentity),
      messages: stablePrefixMessages
    })
  );
  return deepFreeze({
    schemaVersion: "1.0",
    profileId: input.profile.profileId,
    profileVersion: input.profile.profileVersion,
    systemPrompt: input.systemPrompt,
    toolCatalogRevision: input.toolCatalogRevision,
    contextSources: structuredClone(sources),
    stablePrefixMessages,
    dynamicSuffixMessages,
    messages: [...stablePrefixMessages, ...dynamicSuffixMessages],
    stablePrefixChecksum
  });
}

/** One materializer for preview/start/refresh/compaction/hydrate and Plan-to-Act callers. */
export function materializeCanonicalAgentRound(
  input: MaterializeCanonicalAgentRoundInput
): MaterializedCanonicalAgentRound {
  const prompt = materializeAgentPrompt(input);
  const orderedSources = orderedProjectContextSources(input.contextSources ?? []);
  const sourceMessages =
    input.packedContext?.blocks.map(({ role, content }) => ({ role, content })) ??
    orderedSources.map(materializeProjectDataSource);
  const canonicalMessages: CreateCanonicalRoundMessageV2Input[] = [];
  const addSource = (source: AgentContextSourceInput, message: MaterializedAgentMessage): void => {
    const kind = canonicalKindForContextSource(source.sourceKind);
    const sourceRevision =
      kind === "compaction"
        ? compactionSummaryRevision(message.content)
        : String(source.sourceRevision ?? 0);
    canonicalMessages.push({
      kind,
      role: "user",
      content: message.content,
      source: {
        refId: source.refId,
        sourceKind: kind,
        sourceRevision,
        sourceChecksum: checksum(source.content)
      },
      envelopeKind:
        source.sourceKind === "compaction_summary"
          ? "untrusted_conversation_data"
          : "untrusted_project_data"
    });
  };
  for (const [index, source] of orderedSources.entries()) {
    if (source.sourceKind !== "project_conventions") continue;
    const message = sourceMessages[index];
    if (message === undefined) throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
    addSource(source, message);
  }
  const conversationMessages = materializeAgentConversationContext(
    input.conversationSummaryMessages ?? []
  );
  for (const message of conversationMessages) {
    const envelope = parseProviderVisibleUntrustedEnvelope(message.content);
    if (envelope.source.sourceKind !== "prior_conversation") {
      throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
    }
    canonicalMessages.push({
      kind: "prior_conversation",
      role: "user",
      content: message.content,
      source: {
        refId: `prior_conversation:${envelope.source.summaryRevision}`,
        sourceKind: "prior_conversation",
        sourceRevision: envelope.source.summaryRevision,
        sourceChecksum: checksum(envelope.data)
      },
      envelopeKind: "untrusted_conversation_data"
    });
  }
  for (const [index, source] of orderedSources.entries()) {
    if (source.sourceKind === "project_conventions") continue;
    const message = sourceMessages[index];
    if (message === undefined) throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
    addSource(source, message);
  }
  canonicalMessages.push({
    kind: "current_user_request",
    role: "user",
    content: input.userRequest
  });
  for (const [historyIndex, message] of (input.historyMessages ?? []).entries()) {
    canonicalMessages.push(canonicalHistoryMessage(message, historyIndex));
  }
  const packedContextManifest =
    input.packedContext === undefined
      ? null
      : createPackedAgentContextManifestV2(input.packedContext, {
          roundId: input.roundId,
          sharing: input.sharing,
          providerSemanticVersionSet: input.providerSemanticVersionSet
        });
  const canonicalRoundManifest = createCanonicalRoundManifestV2({
    roundId: input.roundId,
    runId: input.runId,
    roundNumber: input.roundNumber,
    authority: input.systemPrompt,
    toolCatalogRevision: input.toolCatalogRevision,
    projectedToolDescriptors: input.projectedToolDescriptors,
    sharing: input.sharing,
    providerSemanticVersionSet: input.providerSemanticVersionSet,
    packedContextManifestChecksum: packedContextManifest?.manifestChecksum ?? null,
    messages: canonicalMessages
  });
  if (
    stableSerialize(
      canonicalRoundManifest.messages.map(({ role, content, toolCallId, toolCalls }) => ({
        role,
        content,
        ...(toolCallId === null ? {} : { toolCallId }),
        ...(toolCalls.length === 0 ? {} : { toolCalls })
      }))
    ) !==
    stableSerialize(
      prompt.messages.map((message) => ({
        ...message,
        ...(message.toolCalls === undefined
          ? {}
          : {
              toolCalls: message.toolCalls.map((call) => ({
                ...call,
                providerMetadata: call.providerMetadata ?? null
              }))
            })
      }))
    )
  ) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  return deepFreeze({ prompt, packedContextManifest, canonicalRoundManifest });
}

function compactionSummaryRevision(content: string): string {
  const envelope = parseProviderVisibleUntrustedEnvelope(content);
  if (envelope.source.sourceKind !== "compaction") {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  return envelope.source.summaryRevision;
}

function canonicalKindForContextSource(
  sourceKind: AgentContextSourceInput["sourceKind"]
): Extract<
  CanonicalRoundMessageKindV2,
  | "project_conventions"
  | "compaction"
  | "workspace_outline"
  | "explicit_reference"
  | "active_resource"
> {
  if (sourceKind === "project_conventions") return "project_conventions";
  if (sourceKind === "compaction_summary") return "compaction";
  if (sourceKind === "workspace_outline") return "workspace_outline";
  if (sourceKind === "editor_buffer") return "active_resource";
  if (sourceKind === "system_guidance") {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  return "explicit_reference";
}

function canonicalHistoryMessage(
  message: MaterializedAgentMessage,
  historyIndex: number
): CreateCanonicalRoundMessageV2Input {
  if (message.role === "assistant") {
    return {
      kind: "assistant",
      role: "assistant",
      content: message.content,
      toolCalls: (message.toolCalls ?? []).map((call) => ({
        id: call.id,
        name: call.name,
        arguments: call.arguments,
        ...(call.providerMetadata === undefined
          ? {}
          : { providerMetadata: structuredClone(call.providerMetadata) })
      }))
    };
  }
  const envelope = parseEnvelopeIfPresent(message.content);
  if (envelope === "invalid") throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  if (message.role === "user" && envelope === undefined) {
    return { kind: "user_control", role: "user", content: message.content };
  }
  if (envelope === undefined) throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  const source = envelope.source;
  const sourceChecksum = checksum(envelope.data);
  if (message.role === "tool") {
    if (!("toolCallId" in source) || message.toolCallId !== source.toolCallId) {
      throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
    }
    const kind = envelope.kind === "untrusted_remote_data" ? "remote_result" : "tool_result";
    return {
      kind,
      role: "tool",
      content: message.content,
      toolCallId: source.toolCallId,
      envelopeKind: envelope.kind,
      source: {
        refId: `${kind}:${source.toolCallId}`,
        sourceKind: kind,
        sourceRevision: source.toolCallId,
        sourceChecksum
      }
    };
  }
  if (message.role !== "user") throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  if (source.sourceKind === "recovery_summary") {
    const kind =
      source.recoveryEventKind === "context_refreshed" ||
      source.recoveryEventKind === "context_excluded"
        ? "context_notice"
        : "recovery";
    return {
      kind,
      role: "user",
      content: message.content,
      envelopeKind: "untrusted_recovery_data",
      source: {
        refId: `${kind}:${sourceChecksum.slice(0, 32)}:${String(historyIndex)}`,
        sourceKind: kind,
        sourceRevision: String(historyIndex),
        sourceChecksum
      }
    };
  }
  throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
}

export function packAgentContext(input: PackAgentContextInput): PackedAgentContext {
  const estimator = input.estimator ?? createDeterministicTokenEstimator();
  const activeSources = orderedProjectContextSources(input.contextSources);
  const excludedSources = orderedProjectContextSources(input.excludedContextSources ?? []);
  const activeCounts = activeSources.map((source) => {
    const message = materializeProjectDataSource(source);
    return { source, message, count: estimator.count(message.content, input.modelProfileId) };
  });
  const excludedCounts = excludedSources.map((source) => {
    const message = materializeProjectDataSource(source);
    return { source, count: estimator.count(message.content, input.modelProfileId) };
  });
  const countByRef = new Map(activeCounts.map((entry) => [entry.source.refId, entry.count]));
  const contextTokens = activeCounts.reduce((total, entry) => total + entry.count.tokens, 0);
  const pinnedTokens = activeSources.reduce(
    (total, source) =>
      source.selectionPolicy === "pinned"
        ? total + (countByRef.get(source.refId)?.tokens ?? 0)
        : total,
    0
  );
  const preservedExcluded = input.excludedSourceManifests ?? [];
  const sourcePrecisions = [
    ...activeCounts.map((entry) => entry.count.precision),
    ...excludedCounts.map((entry) => entry.count.precision),
    ...preservedExcluded.map((entry) => entry.precision)
  ];
  const sourceManifest = [
    ...activeCounts.map(({ source, count }) =>
      packedSourceManifest(source, "active", count.tokens, count.precision)
    ),
    ...excludedCounts.map(({ source, count }) =>
      packedSourceManifest(source, "excluded", count.tokens, count.precision)
    ),
    ...preservedExcluded.map((source) => ({ ...source, state: "excluded" as const }))
  ];
  if (new Set(sourceManifest.map((source) => source.refId)).size !== sourceManifest.length) {
    throw new Error("PACKED_AGENT_CONTEXT_INVALID");
  }
  return createPackedAgentContext({
    scope: input.profile.scope,
    contextProfileId: input.profile.profileId,
    blocks: activeCounts.map(({ source, message, count }) => ({
      refId: source.refId,
      sourceKind: source.sourceKind,
      role: "user" as const,
      content: message.content,
      tokenCount: count.tokens,
      precision: count.precision,
      truncationRange: source.materialization?.truncationRange ?? null
    })),
    sources: sourceManifest,
    tokenStats: {
      contextTokens,
      pinnedTokens,
      usedTokens: input.usedTokens,
      safeInputBudget: input.safeInputBudget,
      remainingTokens: input.remainingTokens,
      precision: aggregateContextPrecision([input.precision, ...sourcePrecisions])
    },
    createdAt: input.createdAt
  });
}

function orderedProjectContextSources(
  sources: readonly AgentContextSourceInput[]
): readonly AgentContextSourceInput[] {
  const visibleSources = sources.filter((source) => source.sourceKind !== "system_guidance");
  assertUniqueSourceRefs(visibleSources);
  const ordered = visibleSources
    .map((source, index) => ({ source, index }))
    .sort(
      (left, right) =>
        contextSourceMessageRank(left.source.sourceKind) -
          contextSourceMessageRank(right.source.sourceKind) ||
        (right.source.priority ?? defaultSourcePriority(right.source.sourceKind)) -
          (left.source.priority ?? defaultSourcePriority(left.source.sourceKind)) ||
        left.index - right.index
    )
    .map(({ source }) => source);
  return ordered;
}

function contextSourceMessageRank(sourceKind: AgentContextSourceInput["sourceKind"]): number {
  if (sourceKind === "project_conventions") return 0;
  if (sourceKind === "compaction_summary") return 1;
  if (sourceKind === "workspace_outline") return 2;
  if (sourceKind === "editor_buffer") return 4;
  return 3;
}

function packedSourceManifest(
  source: AgentContextSourceInput,
  state: PackedAgentContextSourceManifest["state"],
  tokenCount: number,
  precision: AgentContextPrecision
): PackedAgentContextSourceManifest {
  const selectionPolicy = source.selectionPolicy ?? defaultSelectionPolicy(source.sourceKind);
  return {
    refId: source.refId,
    sourceKind: source.sourceKind,
    ...(source.relativePath === undefined ? {} : { relativePath: source.relativePath }),
    ...(source.assetId === undefined ? {} : { assetId: source.assetId }),
    sourceRevision: source.sourceRevision ?? 0,
    sourceChecksum: checksum(source.content),
    tokenCount,
    precision,
    state,
    selectionReason: source.selectionReason ?? defaultSelectionReason(source.sourceKind),
    selectionPolicy,
    preferenceScope:
      source.preferenceScope ?? defaultPreferenceScope(selectionPolicy, source.sourceKind),
    priority: source.priority ?? defaultSourcePriority(source.sourceKind),
    truncationRange: source.materialization?.truncationRange ?? null
  };
}

function assertPackedContextMatchesSources(
  packed: PackedAgentContext,
  profile: AgentContextProfile,
  sources: readonly AgentContextSourceInput[]
): void {
  const orderedSources = orderedProjectContextSources(sources);
  const activeManifest = packed.sources.filter((source) => source.state === "active");
  if (
    !validatePackedAgentContext(packed) ||
    packed.contextProfileId !== profile.profileId ||
    stableSerialize(packed.scope) !== stableSerialize(profile.scope) ||
    packed.blocks.length !== orderedSources.length ||
    activeManifest.length !== orderedSources.length
  ) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  for (const [index, source] of orderedSources.entries()) {
    const block = packed.blocks[index];
    const manifest = activeManifest[index];
    const expectedMessage = materializeProjectDataSource(source);
    if (
      block === undefined ||
      manifest === undefined ||
      block.order !== index ||
      block.refId !== source.refId ||
      block.sourceKind !== source.sourceKind ||
      block.role !== expectedMessage.role ||
      block.content !== expectedMessage.content ||
      stableSerialize(manifest) !==
        stableSerialize(packedSourceManifest(source, "active", block.tokenCount, block.precision))
    ) {
      throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
    }
  }
}

function assertUniqueSourceRefs(sources: readonly AgentContextSourceInput[]): void {
  const refs = new Set<string>();
  for (const source of sources) {
    if (refs.has(source.refId)) throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
    refs.add(source.refId);
  }
}

function defaultSelectionReason(sourceKind: AgentContextSourceInput["sourceKind"]): string {
  if (sourceKind === "project_conventions" || sourceKind === "workspace_outline") {
    return "Automatically selected project context";
  }
  return "Explicit context reference";
}

function defaultSelectionPolicy(
  sourceKind: AgentContextSourceInput["sourceKind"]
): PackedAgentContextSourceManifest["selectionPolicy"] {
  return sourceKind === "project_conventions" || sourceKind === "workspace_outline"
    ? "automatic"
    : "explicit";
}

function defaultPreferenceScope(
  selectionPolicy: PackedAgentContextSourceManifest["selectionPolicy"],
  sourceKind: AgentContextSourceInput["sourceKind"]
): AgentContextPreferenceScope {
  return selectionPolicy === "automatic" &&
    (sourceKind === "project_conventions" || sourceKind === "workspace_outline")
    ? "automatic"
    : "run";
}

function defaultSourcePriority(sourceKind: AgentContextSourceInput["sourceKind"]): number {
  if (sourceKind === "editor_buffer") return 90;
  if (sourceKind === "project_conventions") return 80;
  if (sourceKind === "workspace_outline") return 60;
  return 70;
}

function stableProjectSourceIdentity(source: AgentContextSourceInput): unknown {
  const materialization = source.materialization;
  if (materialization === undefined) {
    return {
      refId: source.refId,
      sourceKind: source.sourceKind,
      contentChecksum: checksum(source.content)
    };
  }
  return materialization.kind === "project_conventions"
    ? {
        refId: source.refId,
        sourceKind: source.sourceKind,
        artifactId: materialization.artifactId,
        readerVersion: materialization.readerVersion,
        sourceIdentity: materialization.sourceIdentity,
        workspaceTrust: materialization.workspaceTrust,
        originalChecksum: materialization.originalChecksum,
        injectedChecksum: materialization.injectedChecksum
      }
    : {
        refId: source.refId,
        sourceKind: source.sourceKind,
        artifactId: materialization.artifactId,
        readerVersion: materialization.readerVersion,
        sourceIdentity: materialization.sourceIdentity,
        workspaceTrust: materialization.workspaceTrust,
        dependencyManifestChecksum: materialization.dependencyManifestChecksum,
        dependencyRevisionChecksum: materialization.dependencyRevisionChecksum,
        materializedChecksum: materialization.materializedChecksum
      };
}

export function materializeAgentConversationContext(
  messages: readonly MaterializedAgentMessage[]
): readonly MaterializedAgentMessage[] {
  if (messages.length === 0) return [];
  const parsed = parseConversationSummaryMessages(messages);
  if (parsed === undefined) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  return [
    {
      role: "user",
      content: serializeProviderVisibleUntrustedEnvelope(
        createProviderVisibleUntrustedEnvelope({
          kind: "untrusted_conversation_data",
          source: {
            sourceKind: "prior_conversation",
            summaryRevision: providerVisibleSummaryRevision(parsed)
          },
          data: JSON.stringify(parsed)
        })
      )
    }
  ];
}

/** Rebuild the persisted post-prompt history identically for hydrate and compaction budgeting. */
export function materializeAgentRunHistory(
  events: readonly AgentRunEvent[],
  afterSequence = 0
): readonly MaterializedAgentMessage[] {
  const messages: MaterializedAgentMessage[] = [];
  const restoredAssistantToolCalls = new Map<string, string>();
  const hasPlanExecutionHandoff = events.some(
    (event) =>
      event.type === "plan_execution_started" &&
      typeof event.detail?.["approvedPlanMessage"] === "string"
  );
  for (const event of events) {
    if (event.sequence <= afterSequence) continue;
    const approvedPlanMessage = event.detail?.["approvedPlanMessage"];
    if (
      (event.type === "plan_execution_started" ||
        (!hasPlanExecutionHandoff && event.type === "context_refreshed")) &&
      typeof approvedPlanMessage === "string"
    ) {
      assertControlEventMapping("plan_execution_started", "user", null);
      messages.push({ role: "user", content: approvedPlanMessage });
    }
    if (event.type === "assistant_text_completed") {
      const text = typeof event.detail?.["text"] === "string" ? event.detail["text"] : "";
      const rawCalls = event.detail?.["toolCalls"];
      const toolCalls = Array.isArray(rawCalls)
        ? rawCalls.flatMap((value) => {
            if (!isRecord(value)) return [];
            const id = value["id"];
            const name = value["name"];
            const argumentsText = value["arguments"];
            if (
              typeof id !== "string" ||
              typeof name !== "string" ||
              typeof argumentsText !== "string"
            ) {
              return [];
            }
            if (restoredAssistantToolCalls.has(id)) return [];
            restoredAssistantToolCalls.set(id, name);
            const providerMetadata = value["providerMetadata"];
            return [
              {
                id,
                name,
                arguments: argumentsText,
                ...(isRecord(providerMetadata)
                  ? { providerMetadata: providerMetadata as JsonObject }
                  : {})
              }
            ];
          })
        : [];
      if (text.length > 0 || toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: text,
          ...(toolCalls.length === 0 ? {} : { toolCalls })
        });
      }
    }
    if (event.type === "tool_completed" && typeof event.detail?.["summary"] === "string") {
      const toolCallId = event.detail["toolCallId"];
      messages.push(
        typeof toolCallId === "string" && restoredAssistantToolCalls.has(toolCallId)
          ? materializeRestoredToolResult({
              toolCallId,
              providerToolName: restoredToolName(restoredAssistantToolCalls, toolCallId),
              resultKind: "tool_completed",
              data: {
                ok: true,
                summary: event.detail["summary"],
                ...(typeof event.detail["sourceRefId"] === "string"
                  ? { sourceRefId: event.detail["sourceRefId"] }
                  : {})
              }
            })
          : materializeRecoverySummary("orphan_tool_completed", event.detail["summary"])
      );
    }
    if (event.type === "tool_failed") {
      const toolCallId = event.detail?.["toolCallId"];
      if (typeof toolCallId === "string" && restoredAssistantToolCalls.has(toolCallId)) {
        messages.push(
          materializeRestoredToolResult({
            toolCallId,
            providerToolName: restoredToolName(restoredAssistantToolCalls, toolCallId),
            resultKind: "tool_failed",
            data: {
              ok: false,
              error: { code: event.detail?.["code"] ?? "AGENT_TOOL_FAILED" }
            }
          })
        );
      }
    }
    if (event.type === "tool_approval_resolved" && event.detail?.["decision"] === "reject") {
      assertControlEventMapping("tool_approval_resolved", "tool", "untrusted_tool_data");
      const toolCallId = event.detail["toolCallId"];
      if (typeof toolCallId === "string" && restoredAssistantToolCalls.has(toolCallId)) {
        messages.push(
          materializeRestoredToolResult({
            toolCallId,
            providerToolName: restoredToolName(restoredAssistantToolCalls, toolCallId),
            resultKind: "tool_approval_rejected",
            data: {
              ok: false,
              error: {
                code:
                  typeof event.detail["resultCode"] === "string"
                    ? event.detail["resultCode"]
                    : "AGENT_TOOL_APPROVAL_REJECTED"
              }
            }
          })
        );
      }
    }
    if (event.type === "user_input_requested") {
      const toolCallId = event.detail?.["toolCallId"];
      if (typeof toolCallId === "string" && restoredAssistantToolCalls.has(toolCallId)) {
        messages.push(
          materializeRestoredToolResult({
            toolCallId,
            providerToolName: restoredToolName(restoredAssistantToolCalls, toolCallId),
            resultKind: "awaiting_user_input",
            data: {
              ok: true,
              status: "awaiting_user_input",
              ...(typeof event.detail?.["questionId"] === "string"
                ? { questionId: event.detail["questionId"] }
                : {})
            }
          })
        );
      }
    }
    if (event.type === "user_input_resolved" && typeof event.detail?.["answer"] === "string") {
      assertControlEventMapping("user_input_resolved", "user", null);
      messages.push({ role: "user", content: event.detail["answer"] });
    }
    if (event.type === "context_refreshed" || event.type === "context_excluded") {
      assertControlEventMapping(event.type, "user", "untrusted_recovery_data");
      const sourceRefs = Array.isArray(event.detail?.["sourceRefs"])
        ? event.detail["sourceRefs"].filter((value): value is string => typeof value === "string")
        : [];
      messages.push(
        materializeRecoverySummary(event.type, JSON.stringify({ kind: event.type, sourceRefs }))
      );
    }
  }
  return deepFreeze(messages);
}

function assertControlEventMapping(
  eventType: AgentControlEventTypeV20,
  role: "user" | "tool",
  envelopeKind:
    "untrusted_conversation_data" | "untrusted_tool_data" | "untrusted_recovery_data" | null
): void {
  const mapping = agentControlEventMessageMappingV20(eventType);
  if (mapping.role !== role || mapping.envelopeKind !== envelopeKind) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
}

export function createAgentPromptMaterializationArtifact(
  input: CreateAgentPromptMaterializationArtifactInput
): AgentPromptMaterializationArtifactV2 {
  assertPersistableContextSources(input.contextSources ?? []);
  let guidance: MaterializedAgentGuidanceV3;
  try {
    guidance = verifyCurrentAgentGuidance(input.guidanceMaterialization);
  } catch {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  const guidanceRefId = `system_guidance:${guidance.proof.registryKey}`;
  if (
    guidance.normalizedInput.profile.profileId !== input.profile.profileId ||
    stableSerialize(guidance.normalizedInput.profile) !== stableSerialize(input.profile) ||
    guidance.materializedGuidance !== input.systemPrompt ||
    (input.systemGuidanceRefId !== undefined && input.systemGuidanceRefId !== guidanceRefId)
  ) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  const materialization = materializeAgentPrompt({
    ...input,
    systemPrompt: guidance.materializedGuidance
  });
  const packedContextManifestChecksum = resolvePackedContextManifestChecksum(input);
  const unsigned = {
    ...materialization,
    schemaVersion: "2.0" as const,
    artifactId: promptMaterializationArtifactId(input.contextSnapshotId),
    runId: input.runId,
    contextSnapshotId: input.contextSnapshotId,
    profile: structuredClone(input.profile),
    toolCatalogRevision: input.toolCatalogRevision,
    userRequest: input.userRequest,
    systemGuidanceRefId: guidanceRefId,
    guidanceTemplateChecksum: guidance.proof.templateChecksum,
    guidanceRegistryKey: guidance.proof.registryKey,
    guidanceRendererVersion: guidance.proof.guidanceRendererVersion,
    normalizedGuidanceInput: structuredClone(guidance.normalizedInput),
    runtimeFacts: structuredClone(guidance.normalizedInput.runtimeFacts),
    writingTaskIntent: structuredClone(guidance.normalizedInput.writingTaskIntent),
    writingGenerationGuidanceVersion: guidance.proof.writingGenerationGuidanceVersion,
    providerSemanticVersionSet: structuredClone(
      guidance.normalizedInput.providerSemanticVersionSet
    ),
    guidanceProof: structuredClone(guidance.proof),
    contextSources: structuredClone(input.contextSources ?? []),
    conversationSummaryMessages: structuredClone(input.conversationSummaryMessages ?? []),
    ...(packedContextManifestChecksum === undefined ? {} : { packedContextManifestChecksum })
  };
  return deepFreeze({
    ...unsigned,
    checksum: checksum(stableSerialize(unsigned))
  });
}

/** Legacy writer used only while the Main-owned Guidance 3.0 feature flag is off. */
export function createHistoricalAgentPromptMaterializationArtifact(
  input: CreateHistoricalAgentPromptMaterializationArtifactInput
): LegacyAgentPromptMaterializationArtifactV11 {
  assertPersistableContextSources(input.contextSources ?? []);
  const systemGuidanceRefId =
    input.systemGuidanceRefId ??
    `system_guidance:${input.profile.profileId}@${AGENT_SYSTEM_GUIDANCE_VERSION}`;
  let guidanceTemplateChecksum: string;
  try {
    const guidanceRef = parseHistoricalAgentGuidanceRefId(systemGuidanceRefId);
    if (guidanceRef.profileId !== input.profile.profileId) {
      throw new Error("AGENT_GUIDANCE_REGISTRY_AUTHORITY_INVALID");
    }
    guidanceTemplateChecksum = verifyHistoricalAgentGuidance({
      registryKey: guidanceRef.registryKey,
      profileId: guidanceRef.profileId,
      version: guidanceRef.version,
      templateChecksum: checksum(input.systemPrompt),
      materializedGuidance: input.systemPrompt
    }).templateChecksum;
  } catch {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  const materialization = materializeAgentPrompt(input);
  const packedContextManifestChecksum = resolvePackedContextManifestChecksum(input);
  const unsigned = {
    ...materialization,
    schemaVersion: "1.1" as const,
    artifactId: promptMaterializationArtifactId(input.contextSnapshotId),
    runId: input.runId,
    contextSnapshotId: input.contextSnapshotId,
    profile: structuredClone(input.profile),
    toolCatalogRevision: input.toolCatalogRevision,
    userRequest: input.userRequest,
    systemGuidanceRefId,
    guidanceTemplateChecksum,
    contextSources: structuredClone(input.contextSources ?? []),
    conversationSummaryMessages: structuredClone(input.conversationSummaryMessages ?? []),
    ...(packedContextManifestChecksum === undefined ? {} : { packedContextManifestChecksum })
  };
  return deepFreeze({
    ...unsigned,
    checksum: checksum(stableSerialize(unsigned))
  });
}

export function rematerializeAgentPromptArtifact(
  prior: AgentPromptMaterializationArtifact,
  input: {
    readonly contextSnapshotId: string;
    readonly contextSources: readonly AgentContextSourceInput[];
    readonly packedContext?: PackedAgentContext;
  }
): AgentPromptMaterializationArtifact {
  const common = {
    runId: prior.runId,
    contextSnapshotId: input.contextSnapshotId,
    profile: prior.profile,
    systemPrompt: prior.systemPrompt,
    toolCatalogRevision: prior.toolCatalogRevision,
    userRequest: prior.userRequest,
    contextSources: input.contextSources,
    ...(input.packedContext === undefined ? {} : { packedContext: input.packedContext }),
    conversationSummaryMessages: prior.conversationSummaryMessages,
    systemGuidanceRefId: prior.systemGuidanceRefId
  };
  return prior.schemaVersion === "2.0"
    ? createAgentPromptMaterializationArtifact({
        ...common,
        guidanceMaterialization: {
          normalizedInput: prior.normalizedGuidanceInput,
          materializedGuidance: prior.systemPrompt,
          proof: prior.guidanceProof
        }
      })
    : createHistoricalAgentPromptMaterializationArtifact(common);
}

export function parseAgentPromptMaterializationArtifact(
  value: JsonObject
): AgentPromptMaterializationArtifact {
  try {
    return value["schemaVersion"] === "2.0"
      ? parseAgentPromptMaterializationArtifactV2(value)
      : parseLegacyAgentPromptMaterializationArtifact(value);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "AGENT_PROMPT_MATERIALIZATION_VERSION_UNSUPPORTED"
    ) {
      throw error;
    }
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
}

function parseAgentPromptMaterializationArtifactV2(
  value: JsonObject
): AgentPromptMaterializationArtifactV2 {
  const fields = [
    "schemaVersion",
    "profileId",
    "profileVersion",
    "systemPrompt",
    "toolCatalogRevision",
    "contextSources",
    "stablePrefixMessages",
    "dynamicSuffixMessages",
    "messages",
    "stablePrefixChecksum",
    "artifactId",
    "runId",
    "contextSnapshotId",
    "profile",
    "userRequest",
    "systemGuidanceRefId",
    "guidanceTemplateChecksum",
    "guidanceRegistryKey",
    "guidanceRendererVersion",
    "normalizedGuidanceInput",
    "runtimeFacts",
    "writingTaskIntent",
    "writingGenerationGuidanceVersion",
    "providerSemanticVersionSet",
    "guidanceProof",
    "conversationSummaryMessages",
    ...(value["packedContextManifestChecksum"] === undefined
      ? []
      : ["packedContextManifestChecksum"]),
    "checksum"
  ];
  if (!hasExactlyFields(value, fields)) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  const profile = parseProfile(value["profile"]);
  const runId = safeId(value["runId"]);
  const contextSnapshotId = safeId(value["contextSnapshotId"]);
  const artifactId = safeId(value["artifactId"]);
  const systemPrompt = stringValue(value["systemPrompt"]);
  const toolCatalogRevision = stringValue(value["toolCatalogRevision"]);
  const userRequest = stringValue(value["userRequest"]);
  const systemGuidanceRefId = stringValue(value["systemGuidanceRefId"]);
  const contextSources = parseContextSources(value["contextSources"]);
  const conversationSummaryMessages = parseMessages(value["conversationSummaryMessages"], "v2");
  const packedContextManifestChecksum =
    value["packedContextManifestChecksum"] === undefined
      ? undefined
      : checksumValue(value["packedContextManifestChecksum"]);
  const normalized = value["normalizedGuidanceInput"];
  const proofValue = value["guidanceProof"];
  if (
    runId === undefined ||
    contextSnapshotId === undefined ||
    artifactId !== promptMaterializationArtifactId(contextSnapshotId) ||
    systemPrompt === undefined ||
    toolCatalogRevision === undefined ||
    userRequest === undefined ||
    systemGuidanceRefId === undefined ||
    contextSources === undefined ||
    conversationSummaryMessages === undefined ||
    (value["packedContextManifestChecksum"] !== undefined &&
      packedContextManifestChecksum === undefined) ||
    !isRecord(normalized) ||
    !hasExactlyFields(normalized, [
      "profile",
      "runtimeFacts",
      "writingTaskIntent",
      "writingGenerationGuidanceVersion",
      "providerSemanticVersionSet"
    ]) ||
    !isRecord(proofValue) ||
    !hasExactlyFields(proofValue, [
      "registryKey",
      "guidanceRendererVersion",
      "templateChecksum",
      "runtimeFactsChecksum",
      "writingGenerationGuidanceVersion",
      "providerSemanticVersionSetChecksum",
      "normalizedInputChecksum",
      "materializedGuidanceChecksum"
    ])
  ) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  const proofChecksums = {
    templateChecksum: checksumValue(proofValue["templateChecksum"]),
    runtimeFactsChecksum: checksumValue(proofValue["runtimeFactsChecksum"]),
    providerSemanticVersionSetChecksum: checksumValue(
      proofValue["providerSemanticVersionSetChecksum"]
    ),
    normalizedInputChecksum: checksumValue(proofValue["normalizedInputChecksum"]),
    materializedGuidanceChecksum: checksumValue(proofValue["materializedGuidanceChecksum"])
  };
  const {
    templateChecksum,
    runtimeFactsChecksum,
    providerSemanticVersionSetChecksum,
    normalizedInputChecksum,
    materializedGuidanceChecksum
  } = proofChecksums;
  if (
    templateChecksum === undefined ||
    runtimeFactsChecksum === undefined ||
    providerSemanticVersionSetChecksum === undefined ||
    normalizedInputChecksum === undefined ||
    materializedGuidanceChecksum === undefined
  ) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  const normalizedProfile = parseProfile(normalized["profile"]);
  const runtimeFacts = parseProviderVisibleAgentRuntimeFacts(normalized["runtimeFacts"]);
  const writingTaskIntent =
    normalized["writingTaskIntent"] === null
      ? null
      : parseWritingTaskIntent(normalized["writingTaskIntent"]);
  const writingGenerationGuidanceVersion = normalized["writingGenerationGuidanceVersion"];
  if (
    writingGenerationGuidanceVersion !== "not_applicable" &&
    writingGenerationGuidanceVersion !== "2.0"
  ) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  const providerSetChecksum = providerSemanticVersionSetChecksum;
  const providerSemanticVersionSet = parseProviderSemanticVersionSetV1(
    normalized["providerSemanticVersionSet"],
    providerSetChecksum
  );
  const registryKey = stringValue(proofValue["registryKey"]);
  const guidanceRendererVersion = stringValue(proofValue["guidanceRendererVersion"]);
  const proofWritingVersion = proofValue["writingGenerationGuidanceVersion"];
  if (
    registryKey === undefined ||
    guidanceRendererVersion === undefined ||
    proofWritingVersion !== writingGenerationGuidanceVersion
  ) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  const guidanceRef = parseCurrentAgentGuidanceRefId(systemGuidanceRefId);
  const guidanceMaterialization = verifyCurrentAgentGuidance({
    normalizedInput: {
      profile: normalizedProfile,
      runtimeFacts,
      writingTaskIntent,
      writingGenerationGuidanceVersion,
      providerSemanticVersionSet
    },
    materializedGuidance: systemPrompt,
    proof: {
      registryKey: guidanceRef.registryKey,
      guidanceRendererVersion:
        guidanceRendererVersion as MaterializedAgentGuidanceProofV3["guidanceRendererVersion"],
      templateChecksum,
      runtimeFactsChecksum,
      writingGenerationGuidanceVersion,
      providerSemanticVersionSetChecksum: providerSetChecksum,
      normalizedInputChecksum,
      materializedGuidanceChecksum
    }
  });
  if (
    registryKey !== guidanceRef.registryKey ||
    stableSerialize(profile) !== stableSerialize(normalizedProfile) ||
    stableSerialize(value["runtimeFacts"]) !== stableSerialize(runtimeFacts) ||
    stableSerialize(value["writingTaskIntent"]) !== stableSerialize(writingTaskIntent) ||
    value["writingGenerationGuidanceVersion"] !== writingGenerationGuidanceVersion ||
    stableSerialize(value["providerSemanticVersionSet"]) !==
      stableSerialize(providerSemanticVersionSet) ||
    value["guidanceTemplateChecksum"] !== guidanceMaterialization.proof.templateChecksum ||
    value["guidanceRegistryKey"] !== guidanceMaterialization.proof.registryKey ||
    value["guidanceRendererVersion"] !== guidanceMaterialization.proof.guidanceRendererVersion
  ) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  const recreated = createAgentPromptMaterializationArtifact({
    runId,
    contextSnapshotId,
    profile,
    systemPrompt,
    toolCatalogRevision,
    userRequest,
    contextSources,
    conversationSummaryMessages,
    systemGuidanceRefId,
    guidanceMaterialization,
    ...(packedContextManifestChecksum === undefined ? {} : { packedContextManifestChecksum })
  });
  if (stableSerialize(value) !== stableSerialize(recreated)) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  return recreated;
}

function parseLegacyAgentPromptMaterializationArtifact(
  value: JsonObject
): LegacyAgentPromptMaterializationArtifactV11 {
  const persistedSchemaVersion = value["schemaVersion"];
  if (persistedSchemaVersion !== "1.0" && persistedSchemaVersion !== "1.1") {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_VERSION_UNSUPPORTED");
  }
  const profile = parseProfile(value["profile"]);
  const runId = safeId(value["runId"]);
  const contextSnapshotId = safeId(value["contextSnapshotId"]);
  const artifactId = safeId(value["artifactId"]);
  const systemPrompt = stringValue(value["systemPrompt"]);
  const toolCatalogRevision = stringValue(value["toolCatalogRevision"]);
  const userRequest = stringValue(value["userRequest"]);
  const systemGuidanceRefId = stringValue(value["systemGuidanceRefId"]);
  const guidanceTemplateChecksum = checksumValue(value["guidanceTemplateChecksum"]);
  const contextSources = parseContextSources(value["contextSources"]);
  const conversationSummaryMessages = parseMessages(value["conversationSummaryMessages"]);
  const packedContextManifestChecksum =
    value["packedContextManifestChecksum"] === undefined
      ? undefined
      : checksumValue(value["packedContextManifestChecksum"]);
  if (
    runId === undefined ||
    contextSnapshotId === undefined ||
    artifactId !== promptMaterializationArtifactId(contextSnapshotId) ||
    systemPrompt === undefined ||
    toolCatalogRevision === undefined ||
    userRequest === undefined ||
    systemGuidanceRefId === undefined ||
    guidanceTemplateChecksum === undefined ||
    contextSources === undefined ||
    conversationSummaryMessages === undefined ||
    (value["packedContextManifestChecksum"] !== undefined &&
      packedContextManifestChecksum === undefined)
  ) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  const recreated = createHistoricalAgentPromptMaterializationArtifact({
    runId,
    contextSnapshotId,
    profile,
    systemPrompt,
    toolCatalogRevision,
    userRequest,
    contextSources,
    conversationSummaryMessages,
    systemGuidanceRefId,
    ...(packedContextManifestChecksum === undefined ? {} : { packedContextManifestChecksum })
  });
  const persistedChecksumMatches =
    persistedSchemaVersion === "1.1"
      ? value["checksum"] === recreated.checksum
      : value["checksum"] === legacyArtifactChecksum(recreated);
  if (
    value["profileId"] !== recreated.profileId ||
    value["profileVersion"] !== recreated.profileVersion ||
    guidanceTemplateChecksum !== recreated.guidanceTemplateChecksum ||
    value["stablePrefixChecksum"] !== recreated.stablePrefixChecksum ||
    !persistedChecksumMatches ||
    stableSerialize(value["stablePrefixMessages"]) !==
      stableSerialize(recreated.stablePrefixMessages) ||
    stableSerialize(value["dynamicSuffixMessages"]) !==
      stableSerialize(recreated.dynamicSuffixMessages) ||
    stableSerialize(value["messages"]) !== stableSerialize(recreated.messages)
  ) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  return recreated;
}

export function promptMaterializationArtifactId(contextSnapshotId: string): string {
  return `prompt_${contextSnapshotId}`;
}

export function materializeProjectDataSource(
  source: AgentContextSourceInput
): MaterializedAgentMessage {
  if (source.sourceKind === "compaction_summary") {
    return {
      role: "user",
      content: serializeProviderVisibleUntrustedEnvelope(
        createProviderVisibleUntrustedEnvelope({
          kind: "untrusted_conversation_data",
          source: {
            sourceKind: "compaction",
            summaryRevision: providerVisibleSummaryRevision(source.content)
          },
          data: source.content
        })
      )
    };
  }
  if (!isProviderVisibleProjectSourceKind(source.sourceKind)) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  const envelope = createProviderVisibleUntrustedEnvelope({
    kind: "untrusted_project_data",
    source: {
      sourceKind: source.sourceKind,
      refId: source.refId,
      dirty: source.dirty,
      ...(source.relativePath === undefined ? {} : { relativePath: source.relativePath }),
      ...(source.assetId === undefined ? {} : { assetId: source.assetId })
    },
    data: source.content
  });
  return {
    role: "user",
    content: serializeProviderVisibleUntrustedEnvelope(envelope)
  };
}

function materializeRestoredToolResult(input: {
  readonly toolCallId: string;
  readonly providerToolName: string;
  readonly resultKind: string;
  readonly data: JsonObject;
}): MaterializedAgentMessage {
  return {
    role: "tool",
    toolCallId: input.toolCallId,
    content: serializeProviderVisibleUntrustedEnvelope(
      createProviderVisibleUntrustedEnvelope({
        kind: "untrusted_tool_data",
        source: {
          sourceKind: "tool_result",
          toolCallId: input.toolCallId,
          providerToolName: input.providerToolName,
          resultKind: input.resultKind
        },
        data: JSON.stringify(input.data)
      })
    )
  };
}

function materializeRecoverySummary(
  recoveryEventKind: string,
  summary: string
): MaterializedAgentMessage {
  return {
    role: "user",
    content: serializeProviderVisibleUntrustedEnvelope(
      createProviderVisibleUntrustedEnvelope({
        kind: "untrusted_recovery_data",
        source: { sourceKind: "recovery_summary", recoveryEventKind },
        data: JSON.stringify({ summary })
      })
    )
  };
}

function restoredToolName(toolCalls: ReadonlyMap<string, string>, toolCallId: string): string {
  const name = toolCalls.get(toolCallId);
  if (name === undefined) throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  return name;
}

function isProviderVisibleProjectSourceKind(
  value: AgentContextSourceInput["sourceKind"]
): value is ProviderVisibleProjectSourceKind {
  return (
    value === "project_conventions" ||
    value === "workspace_outline" ||
    value === "disk_file" ||
    value === "editor_buffer" ||
    value === "story_bible_asset"
  );
}

function resolvePackedContextManifestChecksum(input: {
  readonly packedContext?: PackedAgentContext;
  readonly packedContextManifestChecksum?: string;
}): string | undefined {
  const value =
    input.packedContextManifestChecksum ??
    (input.packedContext === undefined
      ? undefined
      : createPackedAgentContextManifest(input.packedContext).manifestChecksum);
  if (value !== undefined && !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
  return value;
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseProfile(value: unknown): AgentContextProfile {
  try {
    return parseAgentContextProfile(value);
  } catch {
    throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
  }
}

function parseContextSources(value: unknown): readonly AgentContextSourceInput[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sources: AgentContextSourceInput[] = [];
  for (const source of value) {
    if (
      !isRecord(source) ||
      typeof source["refId"] !== "string" ||
      !isSourceKind(source["sourceKind"]) ||
      typeof source["content"] !== "string" ||
      typeof source["dirty"] !== "boolean" ||
      (source["relativePath"] !== undefined && typeof source["relativePath"] !== "string") ||
      (source["assetId"] !== undefined && typeof source["assetId"] !== "string")
    ) {
      return undefined;
    }
    const materialization = source["materialization"];
    if (
      materialization !== undefined &&
      !validateAgentContextSourceMaterialization(materialization)
    ) {
      return undefined;
    }
    const parsed = source as unknown as AgentContextSourceInput;
    try {
      assertPersistableContextSources([parsed]);
    } catch {
      return undefined;
    }
    sources.push(parsed);
  }
  return sources;
}

function assertPersistableContextSources(sources: readonly AgentContextSourceInput[]): void {
  for (const source of sources) {
    if (stableProjectSourceKinds.has(source.sourceKind)) {
      createAgentContextSourceMaterializationArtifact(source);
      continue;
    }
    if (source.materialization !== undefined) {
      throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
    }
  }
}

function assertProjectSourceProfile(
  sources: readonly AgentContextSourceInput[],
  profile: AgentContextProfile
): void {
  for (const source of sources) {
    if (!stableProjectSourceKinds.has(source.sourceKind)) continue;
    if (profile.scope.kind !== "workspace" || profile.profileId === "standalone") {
      throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
    }
    const materialization = source.materialization;
    if (materialization === undefined) continue;
    if (
      materialization.sourceIdentity.workspaceId !== profile.scope.workspaceId ||
      materialization.sourceIdentity.contextProfileId !== profile.profileId ||
      (materialization.kind === "project_conventions" &&
        materialization.workspaceTrust !== "trusted")
    ) {
      throw new Error("AGENT_PROMPT_MATERIALIZATION_INVALID");
    }
  }
}

function compareStableProjectSources(
  left: AgentContextSourceInput,
  right: AgentContextSourceInput
): number {
  const order = (source: AgentContextSourceInput): number =>
    source.sourceKind === "project_conventions" ? 0 : 1;
  return (
    order(left) - order(right) ||
    (right.priority ?? defaultSourcePriority(right.sourceKind)) -
      (left.priority ?? defaultSourcePriority(left.sourceKind)) ||
    left.refId.localeCompare(right.refId)
  );
}

function parseMessages(
  value: unknown,
  mode: "legacy" | "v2" = "legacy"
): readonly MaterializedAgentMessage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const messages: MaterializedAgentMessage[] = [];
  const pairedToolCallIds = new Set<string>();
  for (const message of value) {
    if (
      !isRecord(message) ||
      (message["role"] !== "system" &&
        message["role"] !== "user" &&
        message["role"] !== "assistant" &&
        message["role"] !== "tool") ||
      typeof message["content"] !== "string" ||
      !hasAllowedMessageFields(message) ||
      (message["toolCallId"] !== undefined && typeof message["toolCallId"] !== "string") ||
      (message["toolCalls"] !== undefined && !parseToolCalls(message["toolCalls"]))
    ) {
      return undefined;
    }
    const role = message["role"];
    if (mode === "v2" && role === "system") return undefined;
    if (role === "tool" && typeof message["toolCallId"] !== "string") return undefined;
    if (role !== "assistant" && message["toolCalls"] !== undefined) return undefined;
    if (role !== "assistant" && message["toolCallId"] !== undefined && role !== "tool") {
      return undefined;
    }
    if (mode === "v2") {
      const envelope = parseEnvelopeIfPresent(message["content"]);
      if (envelope === "invalid") return undefined;
      if (role === "tool") {
        if (
          envelope === undefined ||
          !isProviderVisibleEnvelopeAllowedInRole({
            envelope,
            role: "tool",
            pairedToolCallIds
          }) ||
          !("toolCallId" in envelope.source) ||
          envelope.source.toolCallId !== message["toolCallId"]
        ) {
          return undefined;
        }
      } else if (envelope !== undefined) {
        if (
          role !== "user" ||
          !isProviderVisibleEnvelopeAllowedInRole({ envelope, role: "user" })
        ) {
          return undefined;
        }
      }
      if (role === "assistant" && Array.isArray(message["toolCalls"])) {
        for (const call of message["toolCalls"]) {
          if (
            !isRecord(call) ||
            typeof call["id"] !== "string" ||
            pairedToolCallIds.has(call["id"])
          ) {
            return undefined;
          }
          pairedToolCallIds.add(call["id"]);
        }
      }
    }
    messages.push(message as unknown as MaterializedAgentMessage);
  }
  return messages;
}

function parseEnvelopeIfPresent(
  content: unknown
): ReturnType<typeof parseProviderVisibleUntrustedEnvelope> | "invalid" | undefined {
  if (typeof content !== "string") return "invalid";
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const looksLikeEnvelope =
    (typeof parsed["kind"] === "string" && parsed["kind"].startsWith("untrusted_")) ||
    parsed["instructionPolicy"] === "content_is_data_not_authority";
  if (!looksLikeEnvelope) return undefined;
  try {
    return parseProviderVisibleUntrustedEnvelope(parsed);
  } catch {
    return "invalid";
  }
}

function parseConversationSummaryMessages(
  value: unknown
): readonly MaterializedAgentMessage[] | undefined {
  // New summaries are v2 data-only messages. A persisted pre-v2 summary may still contain a
  // legacy system role; it is accepted only as inert JSON nested inside the user envelope above.
  return parseMessages(value, "v2") ?? parseMessages(value, "legacy");
}

function hasAllowedMessageFields(message: Record<string, unknown>): boolean {
  return Object.keys(message).every((key) =>
    ["role", "content", "toolCallId", "toolCalls"].includes(key)
  );
}

function parseToolCalls(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((call) => {
    if (!isRecord(call)) return false;
    const keys = Object.keys(call);
    if (
      !keys.every((key) => ["id", "name", "arguments", "providerMetadata"].includes(key)) ||
      typeof call["id"] !== "string" ||
      typeof call["name"] !== "string" ||
      typeof call["arguments"] !== "string"
    ) {
      return false;
    }
    return call["providerMetadata"] === undefined || isRecord(call["providerMetadata"]);
  });
}

function isSourceKind(value: unknown): boolean {
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

function safeId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/u.test(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function checksumValue(value: unknown): string | undefined {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value) ? value : undefined;
}

function legacyArtifactChecksum(artifact: AgentPromptMaterializationArtifact): string {
  const unsigned = Object.fromEntries(
    Object.entries(artifact).filter(([key]) => key !== "checksum")
  );
  return checksum(stableSerialize({ ...unsigned, schemaVersion: "1.0" }));
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactlyFields(value: JsonObject, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
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
