import { createHash } from "node:crypto";

import type { JsonObject } from "@novel-studio/shared";

import {
  createApprovalRuleSetProjection,
  parseApprovalRuleSetProjection,
  type ProviderVisibleApprovalRule
} from "./approval-rule-registry.js";
import {
  computeAgentToolDescriptorDigest,
  type AgentToolDescriptor,
  type AgentToolFacadeVersion
} from "./tool-registry.js";
import { validateToolText } from "./agent-tool-schema.js";
import { computeDescriptorRevision, computeProviderMappingRevision } from "./permission-summary.js";
import {
  isProviderVisibleWriteOperation,
  type ProviderVisibleWriteOperation
} from "./agent-tool-capabilities.js";

interface AgentRunToolCatalogSnapshotBase {
  readonly toolCatalogSnapshotId: string;
  readonly runId: string;
  readonly facadeVersion: AgentToolFacadeVersion;
  readonly descriptors: readonly AgentToolDescriptor[];
  readonly descriptorRevision: string;
  readonly providerMappingRevision: string;
  readonly catalogRevision: string;
  readonly createdAt: string;
}

export interface AgentRunToolCatalogSnapshotV1 extends AgentRunToolCatalogSnapshotBase {
  readonly schemaVersion: "1.0";
}

export interface AgentRunToolCatalogSnapshotV2 extends AgentRunToolCatalogSnapshotBase {
  readonly schemaVersion: "2.0";
  readonly facadeVersion: "v2";
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  readonly approvalRules: readonly ProviderVisibleApprovalRule[];
}

export type AgentRunToolCatalogSnapshot =
  AgentRunToolCatalogSnapshotV1 | AgentRunToolCatalogSnapshotV2;

export interface CreateAgentRunToolCatalogSnapshotInput {
  readonly runId: string;
  readonly facadeVersion: AgentToolFacadeVersion;
  readonly descriptors: readonly AgentToolDescriptor[];
  readonly createdAt: string;
}

export interface CreateAgentRunToolCatalogSnapshotV2Input {
  readonly runId: string;
  readonly descriptors: readonly AgentToolDescriptor[];
  readonly createdAt: string;
  readonly approvalRuleSetVersion?: string;
}

export type AgentRunToolCatalogValidation =
  | { readonly ok: true; readonly value: AgentRunToolCatalogSnapshot }
  | { readonly ok: false; readonly error: string };

const safeId = /^[A-Za-z0-9_-]{1,256}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const externalToolId =
  /^(plugin|mcp):([A-Za-z0-9][A-Za-z0-9._-]{0,63})\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/u;
const V2_FIELDS = Object.freeze([
  "schemaVersion",
  "toolCatalogSnapshotId",
  "runId",
  "facadeVersion",
  "descriptors",
  "descriptorRevision",
  "providerMappingRevision",
  "approvalRuleSetVersion",
  "approvalRuleSetChecksum",
  "approvalRules",
  "catalogRevision",
  "createdAt"
]);
const V2_DESCRIPTOR_FIELDS = Object.freeze([
  "id",
  "name",
  "providerName",
  "displayName",
  "description",
  "kind",
  "effect",
  "dataEgress",
  "destructive",
  "retrySemantics",
  "source",
  "inputSchema",
  "descriptorDigest"
]);
const PROVIDER_TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;

export function agentRunToolCatalogSnapshotId(runId: string): string {
  return `tool_catalog_${runId}`;
}

/** Historical writer retained only for legacy tests/runs. New Guidance 3.0 runs use the V2 writer. */
export function createAgentRunToolCatalogSnapshot(
  input: CreateAgentRunToolCatalogSnapshotInput
): AgentRunToolCatalogSnapshotV1 {
  const descriptors = freezeDescriptors(input.descriptors);
  if (descriptors.some((descriptor) => descriptor.writeOperation !== undefined)) {
    throw new Error("Catalog 1.0 cannot persist Catalog 2.0 operation bindings.");
  }
  const descriptorRevision = computeDescriptorRevision(descriptors);
  const providerMappingRevision = computeProviderMappingRevision(descriptors);
  const catalogRevision = computeAgentRunToolCatalogRevision(input.facadeVersion, descriptors);
  return Object.freeze({
    schemaVersion: "1.0" as const,
    toolCatalogSnapshotId: agentRunToolCatalogSnapshotId(input.runId),
    runId: input.runId,
    facadeVersion: input.facadeVersion,
    descriptors,
    descriptorRevision,
    providerMappingRevision,
    catalogRevision,
    createdAt: input.createdAt
  });
}

export function createAgentRunToolCatalogSnapshotV2(
  input: CreateAgentRunToolCatalogSnapshotV2Input
): AgentRunToolCatalogSnapshotV2 {
  if (!isCanonicalUtcTimestamp(input.createdAt)) {
    throw new Error("AGENT_TOOL_CATALOG_V2_INVALID");
  }
  const descriptors = freezeDescriptors(
    input.descriptors.map((candidate) => {
      const parsed = parseCatalogV2Descriptor(candidate);
      if (parsed === undefined) throw new Error("AGENT_TOOL_CATALOG_V2_INVALID");
      return parsed;
    })
  );
  const operations = validateCatalogV2OperationBindings(descriptors);
  const approvalRuleSet =
    operations.length === 0
      ? {
          version: "not_applicable",
          checksum: "not_applicable",
          rules: Object.freeze([]) as readonly ProviderVisibleApprovalRule[]
        }
      : createApprovalRuleSetProjection(operations, input.approvalRuleSetVersion);
  const descriptorRevision = computeDescriptorRevision(descriptors);
  const providerMappingRevision = computeProviderMappingRevision(descriptors);
  const catalogRevision = computeAgentRunToolCatalogRevisionV2({
    descriptors,
    approvalRuleSetVersion: approvalRuleSet.version,
    approvalRuleSetChecksum: approvalRuleSet.checksum,
    approvalRules: approvalRuleSet.rules
  });
  return deepFreeze({
    schemaVersion: "2.0" as const,
    toolCatalogSnapshotId: agentRunToolCatalogSnapshotId(input.runId),
    runId: input.runId,
    facadeVersion: "v2" as const,
    descriptors,
    descriptorRevision,
    providerMappingRevision,
    approvalRuleSetVersion: approvalRuleSet.version,
    approvalRuleSetChecksum: approvalRuleSet.checksum,
    approvalRules: approvalRuleSet.rules,
    catalogRevision,
    createdAt: input.createdAt
  });
}

export function computeAgentRunToolCatalogRevision(
  facadeVersion: AgentToolFacadeVersion,
  descriptors: readonly AgentToolDescriptor[]
): string {
  return computeLegacyCatalogRevision(
    facadeVersion,
    computeDescriptorRevision(descriptors),
    computeProviderMappingRevision(descriptors)
  );
}

export function computeAgentRunToolCatalogRevisionV2(input: {
  readonly descriptors: readonly AgentToolDescriptor[];
  readonly approvalRuleSetVersion: string;
  readonly approvalRuleSetChecksum: string;
  readonly approvalRules: readonly ProviderVisibleApprovalRule[];
}): string {
  return computeCatalogRevision({
    schemaVersion: "2.0",
    facadeVersion: "v2",
    descriptorRevision: computeDescriptorRevision(input.descriptors),
    providerMappingRevision: computeProviderMappingRevision(input.descriptors),
    approvalRuleSetVersion: input.approvalRuleSetVersion,
    approvalRuleSetChecksum: input.approvalRuleSetChecksum,
    approvalRules: input.approvalRules
  });
}

export function validateAgentRunToolCatalogSnapshot(
  value: JsonObject
): AgentRunToolCatalogValidation {
  if (value["schemaVersion"] === "1.0") return validateLegacyCatalog(value);
  if (value["schemaVersion"] === "2.0") return validateCatalogV2(value);
  return { ok: false, error: "The persisted Agent tool catalog version is unknown." };
}

function validateLegacyCatalog(value: JsonObject): AgentRunToolCatalogValidation {
  const envelope = validateCatalogEnvelope(value, "1.0");
  if (!envelope.ok) return envelope;
  if (envelope.descriptors.some((descriptor) => descriptor.writeOperation !== undefined)) {
    return { ok: false, error: "The legacy Agent tool catalog contains a V2 operation binding." };
  }
  const descriptorRevision = computeDescriptorRevision(envelope.descriptors);
  const providerMappingRevision = computeProviderMappingRevision(envelope.descriptors);
  const catalogRevision = computeLegacyCatalogRevision(
    envelope.facadeVersion,
    descriptorRevision,
    providerMappingRevision
  );
  if (
    value["descriptorRevision"] !== descriptorRevision ||
    value["providerMappingRevision"] !== providerMappingRevision ||
    value["catalogRevision"] !== catalogRevision
  ) {
    return { ok: false, error: "The persisted Agent tool catalog revision is invalid." };
  }
  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: "1.0",
      toolCatalogSnapshotId: envelope.snapshotId,
      runId: envelope.runId,
      facadeVersion: envelope.facadeVersion,
      descriptors: envelope.descriptors,
      descriptorRevision,
      providerMappingRevision,
      catalogRevision,
      createdAt: envelope.createdAt
    })
  };
}

function validateCatalogV2(value: JsonObject): AgentRunToolCatalogValidation {
  if (!hasExactlyFields(value, V2_FIELDS)) {
    return { ok: false, error: "The persisted Agent tool catalog 2.0 envelope is invalid." };
  }
  const envelope = validateCatalogEnvelope(value, "2.0");
  if (!envelope.ok) return envelope;
  if (envelope.facadeVersion !== "v2") {
    return { ok: false, error: "Catalog 2.0 requires the v2 Provider facade." };
  }
  let operations: readonly ProviderVisibleWriteOperation[];
  try {
    operations = validateCatalogV2OperationBindings(envelope.descriptors);
  } catch {
    return { ok: false, error: "The Agent tool catalog operation bindings are invalid." };
  }
  let approvalRuleSet: {
    readonly version: string;
    readonly checksum: string;
    readonly rules: readonly ProviderVisibleApprovalRule[];
  };
  try {
    approvalRuleSet =
      operations.length === 0
        ? value["approvalRuleSetVersion"] === "not_applicable" &&
          value["approvalRuleSetChecksum"] === "not_applicable" &&
          Array.isArray(value["approvalRules"]) &&
          value["approvalRules"].length === 0
          ? {
              version: "not_applicable",
              checksum: "not_applicable",
              rules: Object.freeze([])
            }
          : (() => {
              throw new Error("invalid empty approval projection");
            })()
        : parseApprovalRuleSetProjection(
            {
              version: value["approvalRuleSetVersion"],
              checksum: value["approvalRuleSetChecksum"],
              rules: value["approvalRules"]
            },
            operations
          );
  } catch {
    return { ok: false, error: "The Agent tool catalog approval rule set is invalid." };
  }
  const descriptorRevision = computeDescriptorRevision(envelope.descriptors);
  const providerMappingRevision = computeProviderMappingRevision(envelope.descriptors);
  const catalogRevision = computeAgentRunToolCatalogRevisionV2({
    descriptors: envelope.descriptors,
    approvalRuleSetVersion: approvalRuleSet.version,
    approvalRuleSetChecksum: approvalRuleSet.checksum,
    approvalRules: approvalRuleSet.rules
  });
  if (
    value["descriptorRevision"] !== descriptorRevision ||
    value["providerMappingRevision"] !== providerMappingRevision ||
    value["catalogRevision"] !== catalogRevision
  ) {
    return { ok: false, error: "The persisted Agent tool catalog revision is invalid." };
  }
  return {
    ok: true,
    value: deepFreeze({
      schemaVersion: "2.0",
      toolCatalogSnapshotId: envelope.snapshotId,
      runId: envelope.runId,
      facadeVersion: "v2",
      descriptors: envelope.descriptors,
      descriptorRevision,
      providerMappingRevision,
      approvalRuleSetVersion: approvalRuleSet.version,
      approvalRuleSetChecksum: approvalRuleSet.checksum,
      approvalRules: approvalRuleSet.rules,
      catalogRevision,
      createdAt: envelope.createdAt
    })
  };
}

type CatalogEnvelopeValidation =
  | {
      readonly ok: true;
      readonly snapshotId: string;
      readonly runId: string;
      readonly facadeVersion: AgentToolFacadeVersion;
      readonly descriptors: readonly AgentToolDescriptor[];
      readonly createdAt: string;
    }
  | { readonly ok: false; readonly error: string };

function validateCatalogEnvelope(
  value: JsonObject,
  schemaVersion: "1.0" | "2.0"
): CatalogEnvelopeValidation {
  const runId = value["runId"];
  const snapshotId = value["toolCatalogSnapshotId"];
  const facadeVersion = value["facadeVersion"];
  const descriptorsValue = value["descriptors"];
  const createdAt = value["createdAt"];
  if (
    value["schemaVersion"] !== schemaVersion ||
    typeof runId !== "string" ||
    !safeId.test(runId) ||
    snapshotId !== agentRunToolCatalogSnapshotId(runId) ||
    (facadeVersion !== "v1" && facadeVersion !== "v2") ||
    !Array.isArray(descriptorsValue) ||
    typeof createdAt !== "string" ||
    !Number.isFinite(Date.parse(createdAt)) ||
    (schemaVersion === "2.0" && !isCanonicalUtcTimestamp(createdAt))
  ) {
    return { ok: false, error: "The persisted Agent tool catalog envelope is invalid." };
  }
  const descriptors: AgentToolDescriptor[] = [];
  const ids = new Set<string>();
  const providerNames = new Set<string>();
  for (const candidate of descriptorsValue) {
    if (!isJsonObject(candidate)) {
      return {
        ok: false,
        error: "The persisted Agent tool catalog contains an invalid descriptor."
      };
    }
    const descriptor =
      schemaVersion === "2.0"
        ? parseCatalogV2Descriptor(candidate)
        : (candidate as unknown as AgentToolDescriptor);
    if (descriptor === undefined) {
      return {
        ok: false,
        error: "The persisted Agent tool catalog contains an invalid descriptor."
      };
    }
    const id = descriptor.id ?? descriptor.name;
    const providerName = descriptor.providerName ?? descriptor.name;
    if (
      typeof id !== "string" ||
      typeof descriptor.name !== "string" ||
      typeof providerName !== "string" ||
      typeof descriptor.descriptorDigest !== "string" ||
      !sha256.test(descriptor.descriptorDigest) ||
      ids.has(id) ||
      providerNames.has(providerName) ||
      computeAgentToolDescriptorDigest(descriptor) !== descriptor.descriptorDigest
    ) {
      return { ok: false, error: "The persisted Agent tool descriptor attestation is invalid." };
    }
    ids.add(id);
    providerNames.add(providerName);
    descriptors.push(descriptor);
  }
  return {
    ok: true,
    snapshotId: snapshotId as string,
    runId,
    facadeVersion,
    descriptors: freezeDescriptors(descriptors),
    createdAt
  };
}

function parseCatalogV2Descriptor(value: unknown): AgentToolDescriptor | undefined {
  if (!isJsonObject(value)) return undefined;
  const expectedFields =
    value["effect"] === "propose"
      ? [...V2_DESCRIPTOR_FIELDS, "writeOperation"]
      : V2_DESCRIPTOR_FIELDS;
  if (!hasExactlyFields(value, expectedFields)) return undefined;
  const id = value["id"];
  const name = value["name"];
  const providerName = value["providerName"];
  const displayName = value["displayName"];
  const description = value["description"];
  const kind = value["kind"];
  const effect = value["effect"];
  const dataEgress = value["dataEgress"];
  const retrySemantics = value["retrySemantics"];
  const source = value["source"];
  const inputSchema = value["inputSchema"];
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    id.length > 256 ||
    typeof name !== "string" ||
    !PROVIDER_TOOL_NAME.test(name) ||
    typeof providerName !== "string" ||
    !PROVIDER_TOOL_NAME.test(providerName) ||
    typeof displayName !== "string" ||
    typeof description !== "string" ||
    ![
      "file_tool",
      "search_tool",
      "command_tool",
      "vcs_tool",
      "network_tool",
      "external_tool",
      "protocol_action"
    ].includes(String(kind)) ||
    !["read", "propose", "execute", "external_read", "external_action", "control"].includes(
      String(effect)
    ) ||
    !["none", "provider_query", "remote_tool_arguments"].includes(String(dataEgress)) ||
    typeof value["destructive"] !== "boolean" ||
    !["safe", "idempotency_key_required", "never_automatic"].includes(String(retrySemantics)) ||
    !isJsonObject(source) ||
    !hasExactlyFields(source, ["kind", "id"]) ||
    (source["kind"] !== "core" && source["kind"] !== "plugin" && source["kind"] !== "mcp") ||
    typeof source["id"] !== "string" ||
    source["id"].length === 0 ||
    source["id"].length > 256 ||
    !isJsonObject(inputSchema) ||
    !validateToolText(displayName, 256, "displayName").ok ||
    !validateToolText(description, 2_048, "description").ok ||
    typeof value["descriptorDigest"] !== "string" ||
    !sha256.test(value["descriptorDigest"])
  ) {
    return undefined;
  }
  if (source["kind"] === "core") {
    if (
      source["id"] !== id ||
      name !== id ||
      providerName !== name ||
      dataEgress !== (effect === "external_read" ? "provider_query" : "none")
    ) {
      return undefined;
    }
  } else {
    const externalIdentity = externalToolId.exec(id);
    if (
      externalIdentity === null ||
      externalIdentity[1] !== source["kind"] ||
      externalIdentity[2] !== source["id"] ||
      name !== providerName ||
      kind !== "external_tool" ||
      (effect !== "external_read" && effect !== "external_action") ||
      dataEgress !== "remote_tool_arguments"
    ) {
      return undefined;
    }
  }
  if (
    (effect === "propose" && !isProviderVisibleWriteOperation(value["writeOperation"])) ||
    (effect !== "propose" && value["writeOperation"] !== undefined)
  ) {
    return undefined;
  }
  return value as unknown as AgentToolDescriptor;
}

function validateCatalogV2OperationBindings(
  descriptors: readonly AgentToolDescriptor[]
): readonly ProviderVisibleWriteOperation[] {
  const operations: ProviderVisibleWriteOperation[] = [];
  for (const descriptor of descriptors) {
    if (descriptor.effect === "propose") {
      if (!isProviderVisibleWriteOperation(descriptor.writeOperation)) {
        throw new Error("AGENT_TOOL_OPERATION_UNMAPPED");
      }
      operations.push(descriptor.writeOperation);
    } else if (descriptor.writeOperation !== undefined) {
      throw new Error("AGENT_TOOL_OPERATION_INVALID");
    }
  }
  if (new Set(operations).size !== operations.length) {
    throw new Error("AGENT_TOOL_OPERATION_DUPLICATE");
  }
  return operations;
}

function computeCatalogRevision(input: {
  readonly schemaVersion: "1.0" | "2.0";
  readonly facadeVersion: AgentToolFacadeVersion;
  readonly descriptorRevision: string;
  readonly providerMappingRevision: string;
  readonly approvalRuleSetVersion?: string;
  readonly approvalRuleSetChecksum?: string;
  readonly approvalRules?: readonly ProviderVisibleApprovalRule[];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.schemaVersion,
        input.facadeVersion,
        input.descriptorRevision,
        input.providerMappingRevision,
        input.approvalRuleSetVersion ?? null,
        input.approvalRuleSetChecksum ?? null,
        input.approvalRules ?? null
      ]),
      "utf8"
    )
    .digest("hex");
}

function computeLegacyCatalogRevision(
  facadeVersion: AgentToolFacadeVersion,
  descriptorRevision: string,
  providerMappingRevision: string
): string {
  return createHash("sha256")
    .update(JSON.stringify([facadeVersion, descriptorRevision, providerMappingRevision]), "utf8")
    .digest("hex");
}

function freezeDescriptors(
  descriptors: readonly AgentToolDescriptor[]
): readonly AgentToolDescriptor[] {
  return Object.freeze(
    descriptors.map((descriptor) =>
      Object.freeze({
        ...descriptor,
        ...(descriptor.source === undefined
          ? {}
          : { source: Object.freeze({ ...descriptor.source }) }),
        inputSchema: deepFreezeJson(structuredClone(descriptor.inputSchema))
      })
    )
  );
}

function deepFreezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function hasExactlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function deepFreeze<T>(value: T): T {
  return deepFreezeJson(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanonicalUtcTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
