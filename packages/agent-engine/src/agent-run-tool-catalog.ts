import { createHash } from "node:crypto";

import type { JsonObject } from "@novel-studio/shared";

import {
  computeAgentToolDescriptorDigest,
  type AgentToolDescriptor,
  type AgentToolFacadeVersion
} from "./tool-registry.js";
import { computeDescriptorRevision, computeProviderMappingRevision } from "./permission-summary.js";

export interface AgentRunToolCatalogSnapshot {
  readonly schemaVersion: "1.0";
  readonly toolCatalogSnapshotId: string;
  readonly runId: string;
  readonly facadeVersion: AgentToolFacadeVersion;
  readonly descriptors: readonly AgentToolDescriptor[];
  readonly descriptorRevision: string;
  readonly providerMappingRevision: string;
  readonly catalogRevision: string;
  readonly createdAt: string;
}

export interface CreateAgentRunToolCatalogSnapshotInput {
  readonly runId: string;
  readonly facadeVersion: AgentToolFacadeVersion;
  readonly descriptors: readonly AgentToolDescriptor[];
  readonly createdAt: string;
}

export type AgentRunToolCatalogValidation =
  | { readonly ok: true; readonly value: AgentRunToolCatalogSnapshot }
  | { readonly ok: false; readonly error: string };

const safeId = /^[A-Za-z0-9_-]{1,256}$/u;
const sha256 = /^[a-f0-9]{64}$/u;

export function agentRunToolCatalogSnapshotId(runId: string): string {
  return `tool_catalog_${runId}`;
}

export function createAgentRunToolCatalogSnapshot(
  input: CreateAgentRunToolCatalogSnapshotInput
): AgentRunToolCatalogSnapshot {
  const descriptors = freezeDescriptors(input.descriptors);
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

export function computeAgentRunToolCatalogRevision(
  facadeVersion: AgentToolFacadeVersion,
  descriptors: readonly AgentToolDescriptor[]
): string {
  return computeCatalogRevision({
    facadeVersion,
    descriptorRevision: computeDescriptorRevision(descriptors),
    providerMappingRevision: computeProviderMappingRevision(descriptors)
  });
}

export function validateAgentRunToolCatalogSnapshot(
  value: JsonObject
): AgentRunToolCatalogValidation {
  const runId = value["runId"];
  const snapshotId = value["toolCatalogSnapshotId"];
  const facadeVersion = value["facadeVersion"];
  const descriptorsValue = value["descriptors"];
  const createdAt = value["createdAt"];
  if (
    value["schemaVersion"] !== "1.0" ||
    typeof runId !== "string" ||
    !safeId.test(runId) ||
    snapshotId !== agentRunToolCatalogSnapshotId(runId) ||
    (facadeVersion !== "v1" && facadeVersion !== "v2") ||
    !Array.isArray(descriptorsValue) ||
    typeof createdAt !== "string" ||
    !Number.isFinite(Date.parse(createdAt))
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
    const descriptor = candidate as unknown as AgentToolDescriptor;
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

  const frozenDescriptors = freezeDescriptors(descriptors);
  const descriptorRevision = computeDescriptorRevision(frozenDescriptors);
  const providerMappingRevision = computeProviderMappingRevision(frozenDescriptors);
  const catalogRevision = computeCatalogRevision({
    facadeVersion,
    descriptorRevision,
    providerMappingRevision
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
    value: Object.freeze({
      schemaVersion: "1.0",
      toolCatalogSnapshotId: snapshotId,
      runId,
      facadeVersion,
      descriptors: frozenDescriptors,
      descriptorRevision,
      providerMappingRevision,
      catalogRevision,
      createdAt
    })
  };
}

function computeCatalogRevision(input: {
  readonly facadeVersion: AgentToolFacadeVersion;
  readonly descriptorRevision: string;
  readonly providerMappingRevision: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.facadeVersion,
        input.descriptorRevision,
        input.providerMappingRevision
      ]),
      "utf8"
    )
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

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
