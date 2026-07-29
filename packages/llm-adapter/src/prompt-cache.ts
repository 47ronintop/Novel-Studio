import { createHash } from "node:crypto";

import type {
  LlmCacheInputTokenSemantics,
  LlmPromptCacheBypassReason,
  LlmPromptCacheMode,
  LlmPromptCacheRequest,
  LlmRequest,
  LlmUsage
} from "./types.js";

const CHECKSUM = /^[a-f0-9]{64}$/u;

export interface ResolvedLlmPromptCacheRequest {
  readonly active: boolean;
  readonly config?: LlmPromptCacheRequest;
  readonly bypassReason?: LlmPromptCacheBypassReason;
}

export interface LlmPromptCacheUsageEvidence {
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly cacheEligibleInputTokens?: number;
  readonly cacheInputTokenSemantics: LlmCacheInputTokenSemantics;
  readonly physicalPrefixChecksum?: string;
}

export function resolveLlmPromptCacheRequest(
  request: LlmRequest,
  supportedMode: LlmPromptCacheMode
): ResolvedLlmPromptCacheRequest {
  const config = request.promptCache;
  if (config === undefined) return { active: false };
  if (config.mode === "none") {
    return { active: false, config, bypassReason: config.bypassReason ?? "policy_none" };
  }
  if (config.mode !== supportedMode) {
    return { active: false, config, bypassReason: "unsupported_provider" };
  }
  if (!isValidConfig(config, request.messages.length)) {
    return { active: false, config, bypassReason: "identity_unverified" };
  }
  if (config.bypassReason !== undefined) {
    return { active: false, config, bypassReason: config.bypassReason };
  }
  if (
    config.eligibleInputTokens !== undefined &&
    config.eligibleInputTokens < config.minimumCacheableTokens
  ) {
    return { active: false, config, bypassReason: "below_minimum_tokens" };
  }
  if (supportedMode === "explicit_resource" && !isOpaqueResourceRef(config.resourceRef)) {
    return { active: false, config, bypassReason: "resource_unavailable" };
  }
  return { active: true, config };
}

export function checksumProviderPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function withLlmPromptCacheUsage(
  usage: LlmUsage,
  resolution: ResolvedLlmPromptCacheRequest,
  evidence: LlmPromptCacheUsageEvidence
): LlmUsage {
  const config = resolution.config;
  if (config !== undefined && !resolution.active) {
    return {
      ...usage,
      ...(config.eligibleInputTokens === undefined
        ? {}
        : { cacheEligibleInputTokens: config.eligibleInputTokens }),
      cacheOutcome: "bypass",
      cacheBypassReason: resolution.bypassReason ?? "cache_error",
      cacheUsageStatus: "unavailable",
      cacheInputTokenSemantics: evidence.cacheInputTokenSemantics
    };
  }

  const hasReadEvidence = evidence.cacheReadTokens !== undefined;
  const hasWriteEvidence = evidence.cacheWriteTokens !== undefined;
  const hasEligibleEvidence = evidence.cacheEligibleInputTokens !== undefined;
  const hasUsageEvidence = hasReadEvidence || hasWriteEvidence || hasEligibleEvidence;
  if (config === undefined && !hasUsageEvidence) return usage;

  const outcome =
    hasReadEvidence && (evidence.cacheReadTokens ?? 0) > 0
      ? "hit"
      : hasReadEvidence || hasWriteEvidence
        ? "miss"
        : "unknown";

  return {
    ...usage,
    ...(hasReadEvidence ? { cachedTokens: evidence.cacheReadTokens } : {}),
    ...(hasReadEvidence ? { cacheReadTokens: evidence.cacheReadTokens } : {}),
    ...(hasWriteEvidence ? { cacheWriteTokens: evidence.cacheWriteTokens } : {}),
    ...(evidence.cacheEligibleInputTokens === undefined
      ? {}
      : { cacheEligibleInputTokens: evidence.cacheEligibleInputTokens }),
    cacheOutcome: outcome,
    cacheUsageStatus: hasUsageEvidence ? "actual" : "unavailable",
    cacheInputTokenSemantics: evidence.cacheInputTokenSemantics,
    ...(resolution.active && evidence.physicalPrefixChecksum !== undefined
      ? { cachePhysicalPrefixChecksum: evidence.physicalPrefixChecksum }
      : {})
  };
}

export function rejectLlmPromptCacheRequest(
  resolution: ResolvedLlmPromptCacheRequest,
  bypassReason: LlmPromptCacheBypassReason
): ResolvedLlmPromptCacheRequest {
  return resolution.config === undefined
    ? resolution
    : { active: false, config: resolution.config, bypassReason };
}

export function isSha256Checksum(value: unknown): value is string {
  return typeof value === "string" && CHECKSUM.test(value);
}

function isValidConfig(config: LlmPromptCacheRequest, messageCount: number): boolean {
  return (
    config.policyVersion.trim().length > 0 &&
    isSha256Checksum(config.identityChecksum) &&
    (config.connectionIdentityChecksum === undefined ||
      isSha256Checksum(config.connectionIdentityChecksum)) &&
    (config.accountIsolationChecksum === undefined ||
      isSha256Checksum(config.accountIsolationChecksum)) &&
    isSha256Checksum(config.logicalPrefixChecksum) &&
    Number.isSafeInteger(config.stablePrefixMessageCount) &&
    config.stablePrefixMessageCount > 0 &&
    config.stablePrefixMessageCount <= messageCount &&
    Number.isSafeInteger(config.minimumCacheableTokens) &&
    config.minimumCacheableTokens >= 0 &&
    (config.eligibleInputTokens === undefined ||
      (Number.isSafeInteger(config.eligibleInputTokens) && config.eligibleInputTokens >= 0)) &&
    (config.ttlSeconds === undefined ||
      (Number.isSafeInteger(config.ttlSeconds) && config.ttlSeconds > 0)) &&
    (config.physicalPrefixChecksum === undefined ||
      isSha256Checksum(config.physicalPrefixChecksum)) &&
    (config.resourceWriteTokens === undefined ||
      (Number.isSafeInteger(config.resourceWriteTokens) && config.resourceWriteTokens >= 0))
  );
}

function isOpaqueResourceRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !hasControlCharacter(value)
  );
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
