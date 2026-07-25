/**
 * Task 0.1 — Provider name mapping for Agent tool descriptors.
 * Maps canonical tool IDs to the names sent to the model provider (ASCII-safe, no collisions).
 * For static core tools the canonical ID is already provider-safe; dynamic tools may need munging.
 */
import { createHash } from "node:crypto";

import type { CoreAgentToolName } from "@novel-studio/agent-engine";

/** Max length for a single providerName (provider-imposed; conservative across providers). */
export const PROVIDER_NAME_MAX_LENGTH = 64;

/** Pattern required for all providerName values. */
const PROVIDER_NAME_SAFE = /^[A-Za-z0-9_-]+$/;

export interface ProviderNameMapping {
  /** Canonical internal tool ID (may contain colons and slashes for namespaced tools). */
  readonly canonicalId: string;
  /** Name sent to the model provider — ASCII-safe, no collisions within a run. */
  readonly providerName: string;
}

/**
 * Immutable bidirectional directory bound to a single Agent run.  The lookup maps remain private
 * so consumers cannot mutate a Map after the revision has been attested in Permission Summary.
 */
export interface FrozenProviderNameMapping {
  readonly entries: readonly ProviderNameMapping[];
  readonly revision: string;
  providerNameFor(canonicalId: string): string | undefined;
  canonicalIdFor(providerName: string): string | undefined;
  hasCanonicalId(canonicalId: string): boolean;
  hasProviderName(providerName: string): boolean;
}

/**
 * Compute the provider-safe name for a static core tool.
 * Core tool names already satisfy the safe pattern so no mangling is needed.
 */
export function coreToolProviderName(name: CoreAgentToolName): string {
  return name;
}

/**
 * Mangle a namespaced dynamic tool canonical ID into a provider-safe name.
 * Example: "plugin:acme/summarise" → "plugin__acme__summarise"
 * The mangled name is deterministic and reversible via the run's frozen mapping.
 */
export function mangleToolId(canonicalId: string): string {
  return canonicalId.replace(/[^A-Za-z0-9_-]/g, "__").slice(0, PROVIDER_NAME_MAX_LENGTH);
}

export type CollisionCheckResult =
  { readonly ok: true } | { readonly ok: false; readonly collision: string };

/**
 * Verify that all providerName values in a mapping set are unique.
 * Returns the first collision found, or ok when clean.
 */
export function checkProviderNameCollisions(
  mappings: readonly ProviderNameMapping[]
): CollisionCheckResult {
  const seen = new Map<string, string>();
  const canonicalIds = new Set<string>();
  for (const mapping of mappings) {
    if (!mapping.canonicalId || canonicalIds.has(mapping.canonicalId)) {
      return {
        ok: false,
        collision: `canonicalId "${mapping.canonicalId}" is missing or appears more than once.`
      };
    }
    if (!PROVIDER_NAME_SAFE.test(mapping.providerName)) {
      return {
        ok: false,
        collision: `providerName "${mapping.providerName}" for tool "${mapping.canonicalId}" is not provider-safe.`
      };
    }
    if (mapping.providerName.length > PROVIDER_NAME_MAX_LENGTH) {
      return {
        ok: false,
        collision: `providerName "${mapping.providerName}" exceeds ${PROVIDER_NAME_MAX_LENGTH} chars.`
      };
    }
    const existing = seen.get(mapping.providerName);
    if (existing !== undefined) {
      return {
        ok: false,
        collision: `providerName "${mapping.providerName}" is shared by "${existing}" and "${mapping.canonicalId}".`
      };
    }
    seen.set(mapping.providerName, mapping.canonicalId);
    canonicalIds.add(mapping.canonicalId);
  }
  return { ok: true };
}

/**
 * Build a frozen providerName mapping for the current run from a set of tool descriptors.
 * Throws if any collision is detected — this must be resolved before run start.
 */
export function buildFrozenProviderNameMapping(
  descriptors: readonly { readonly id: string; readonly providerName: string }[]
): ReadonlyMap<string, string> {
  const frozen = freezeProviderNameMapping(descriptors);
  return new Map(frozen.entries.map((entry) => [entry.canonicalId, entry.providerName]));
}

/** Build the immutable bidirectional mapping that run-control-plane code must retain per run. */
export function freezeProviderNameMapping(
  descriptors: readonly { readonly id: string; readonly providerName: string }[]
): FrozenProviderNameMapping {
  const mappings: ProviderNameMapping[] = descriptors.map((d) => ({
    canonicalId: d.id,
    providerName: d.providerName
  }));
  const collision = checkProviderNameCollisions(mappings);
  if (!collision.ok) {
    throw new Error(`Tool provider name collision detected: ${collision.collision}`);
  }
  const entries = Object.freeze(
    mappings
      .map((mapping) => Object.freeze({ ...mapping }))
      .sort((left, right) => left.canonicalId.localeCompare(right.canonicalId))
  );
  const canonicalToProvider = new Map(
    entries.map((entry) => [entry.canonicalId, entry.providerName])
  );
  const providerToCanonical = new Map(
    entries.map((entry) => [entry.providerName, entry.canonicalId])
  );
  const revision = createHash("sha256")
    .update(JSON.stringify(entries.map((entry) => [entry.canonicalId, entry.providerName])), "utf8")
    .digest("hex");
  return Object.freeze({
    entries,
    revision,
    providerNameFor: (canonicalId: string) => canonicalToProvider.get(canonicalId),
    canonicalIdFor: (providerName: string) => providerToCanonical.get(providerName),
    hasCanonicalId: (canonicalId: string) => canonicalToProvider.has(canonicalId),
    hasProviderName: (providerName: string) => providerToCanonical.has(providerName)
  });
}
