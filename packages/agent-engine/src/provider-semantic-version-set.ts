import { createHash } from "node:crypto";

import { resolveRegisteredApprovalRuleSet } from "./approval-rule-registry.js";

export const PROVIDER_SEMANTIC_VERSION_SET_SCHEMA_VERSION = "1.0" as const;

export interface ProviderSemanticVersionSetV1 {
  readonly schemaVersion: typeof PROVIDER_SEMANTIC_VERSION_SET_SCHEMA_VERSION;
  readonly systemGuidanceVersion: "3.0";
  readonly promptArtifactSchemaVersion: "2.0";
  readonly toolCatalogSchemaVersion: "2.0";
  readonly messageOrderVersion: "2.0";
  readonly untrustedEnvelopeSchemaVersion: "2.0";
  readonly runtimeFactsSchemaVersion: "1.0";
  readonly writingTaskIntentSchemaVersion: "not_applicable" | "1.0";
  readonly writingGenerationGuidanceVersion: "not_applicable" | "2.0";
  readonly contextSnapshotSchemaVersion: "2.0";
  readonly packedContextManifestSchemaVersion: "2.0";
  readonly canonicalRoundManifestSchemaVersion: "2.0";
  readonly permissionSummarySchemaVersion: "2.0";
  readonly approvalRuleSchemaVersion: "1.0";
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
}

export interface CreateProviderSemanticVersionSetV1Input {
  readonly writingTaskIntentSchemaVersion: ProviderSemanticVersionSetV1["writingTaskIntentSchemaVersion"];
  readonly writingGenerationGuidanceVersion: ProviderSemanticVersionSetV1["writingGenerationGuidanceVersion"];
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
}

const FIELD_NAMES = Object.freeze([
  "schemaVersion",
  "systemGuidanceVersion",
  "promptArtifactSchemaVersion",
  "toolCatalogSchemaVersion",
  "messageOrderVersion",
  "untrustedEnvelopeSchemaVersion",
  "runtimeFactsSchemaVersion",
  "writingTaskIntentSchemaVersion",
  "writingGenerationGuidanceVersion",
  "contextSnapshotSchemaVersion",
  "packedContextManifestSchemaVersion",
  "canonicalRoundManifestSchemaVersion",
  "permissionSummarySchemaVersion",
  "approvalRuleSchemaVersion",
  "approvalRuleSetVersion",
  "approvalRuleSetChecksum"
] as const);

const CHECKSUM = /^[a-f0-9]{64}$/u;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/u;

export function createProviderSemanticVersionSetV1(
  input: CreateProviderSemanticVersionSetV1Input
): ProviderSemanticVersionSetV1 {
  assertApprovalRuleSetIdentity(input.approvalRuleSetVersion, input.approvalRuleSetChecksum);
  if (
    (input.writingTaskIntentSchemaVersion !== "not_applicable" &&
      input.writingTaskIntentSchemaVersion !== "1.0") ||
    (input.writingGenerationGuidanceVersion !== "not_applicable" &&
      input.writingGenerationGuidanceVersion !== "2.0") ||
    (input.writingGenerationGuidanceVersion === "2.0" &&
      input.writingTaskIntentSchemaVersion !== "1.0")
  ) {
    throw new Error("PROVIDER_SEMANTIC_VERSION_SET_INVALID");
  }
  return deepFreeze({
    schemaVersion: PROVIDER_SEMANTIC_VERSION_SET_SCHEMA_VERSION,
    systemGuidanceVersion: "3.0",
    promptArtifactSchemaVersion: "2.0",
    toolCatalogSchemaVersion: "2.0",
    messageOrderVersion: "2.0",
    untrustedEnvelopeSchemaVersion: "2.0",
    runtimeFactsSchemaVersion: "1.0",
    writingTaskIntentSchemaVersion: input.writingTaskIntentSchemaVersion,
    writingGenerationGuidanceVersion: input.writingGenerationGuidanceVersion,
    contextSnapshotSchemaVersion: "2.0",
    packedContextManifestSchemaVersion: "2.0",
    canonicalRoundManifestSchemaVersion: "2.0",
    permissionSummarySchemaVersion: "2.0",
    approvalRuleSchemaVersion: "1.0",
    approvalRuleSetVersion: input.approvalRuleSetVersion,
    approvalRuleSetChecksum: input.approvalRuleSetChecksum
  });
}

export function parseProviderSemanticVersionSetV1(
  value: unknown,
  expectedChecksum?: string
): ProviderSemanticVersionSetV1 {
  if (!isRecord(value) || !hasExactlyFields(value, FIELD_NAMES)) {
    throw new Error("PROVIDER_SEMANTIC_VERSION_SET_INVALID");
  }
  const parsed = createProviderSemanticVersionSetV1({
    writingTaskIntentSchemaVersion: value["writingTaskIntentSchemaVersion"] as
      "not_applicable" | "1.0",
    writingGenerationGuidanceVersion: value["writingGenerationGuidanceVersion"] as
      "not_applicable" | "2.0",
    approvalRuleSetVersion: stringValue(value["approvalRuleSetVersion"]),
    approvalRuleSetChecksum: stringValue(value["approvalRuleSetChecksum"])
  });
  if (
    value["schemaVersion"] !== parsed.schemaVersion ||
    value["systemGuidanceVersion"] !== parsed.systemGuidanceVersion ||
    value["promptArtifactSchemaVersion"] !== parsed.promptArtifactSchemaVersion ||
    value["toolCatalogSchemaVersion"] !== parsed.toolCatalogSchemaVersion ||
    value["messageOrderVersion"] !== parsed.messageOrderVersion ||
    value["untrustedEnvelopeSchemaVersion"] !== parsed.untrustedEnvelopeSchemaVersion ||
    value["runtimeFactsSchemaVersion"] !== parsed.runtimeFactsSchemaVersion ||
    value["contextSnapshotSchemaVersion"] !== parsed.contextSnapshotSchemaVersion ||
    value["packedContextManifestSchemaVersion"] !== parsed.packedContextManifestSchemaVersion ||
    value["canonicalRoundManifestSchemaVersion"] !== parsed.canonicalRoundManifestSchemaVersion ||
    value["permissionSummarySchemaVersion"] !== parsed.permissionSummarySchemaVersion ||
    value["approvalRuleSchemaVersion"] !== parsed.approvalRuleSchemaVersion ||
    (expectedChecksum !== undefined &&
      providerSemanticVersionSetChecksum(parsed) !== expectedChecksum)
  ) {
    throw new Error("PROVIDER_SEMANTIC_VERSION_SET_INVALID");
  }
  return parsed;
}

export function serializeProviderSemanticVersionSetV1(value: ProviderSemanticVersionSetV1): string {
  const parsed = parseProviderSemanticVersionSetV1(value);
  return JSON.stringify(parsed);
}

export function providerSemanticVersionSetChecksum(value: ProviderSemanticVersionSetV1): string {
  return createHash("sha256")
    .update(serializeProviderSemanticVersionSetV1(value), "utf8")
    .digest("hex");
}

function assertApprovalRuleSetIdentity(version: string, checksum: string): void {
  const notApplicable = version === "not_applicable" && checksum === "not_applicable";
  if (!notApplicable && (!VERSION.test(version) || !CHECKSUM.test(checksum))) {
    throw new Error("PROVIDER_SEMANTIC_VERSION_SET_INVALID");
  }
  if ((version === "not_applicable") !== (checksum === "not_applicable")) {
    throw new Error("PROVIDER_SEMANTIC_VERSION_SET_INVALID");
  }
  if (!notApplicable) {
    try {
      resolveRegisteredApprovalRuleSet(version, checksum);
    } catch {
      throw new Error("PROVIDER_SEMANTIC_VERSION_SET_INVALID");
    }
  }
}

function hasExactlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("PROVIDER_SEMANTIC_VERSION_SET_INVALID");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
