/**
 * Task 0.2 — EffectiveCapabilityState tracks which capabilities remain valid in the current
 * session. It is immutable except via explicit revocation (only downgrade is allowed).
 * Permission Summary is the historical record of what was approved at run start;
 * EffectiveCapabilityState reflects what is currently still valid.
 */
import type { AgentToolCapabilitySnapshot, AgentWorkspaceKind } from "./agent-tool-capabilities.js";

export type CapabilityRevocationReason =
  | "feature_flag_disabled"
  | "attestation_expired"
  | "attestation_drift"
  | "connection_lost"
  | "policy_drift"
  | "app_restart"
  | "run_ended"
  | "user_revoked";

export interface RevokedCapability {
  readonly capability: string;
  readonly reason: CapabilityRevocationReason;
  readonly revokedAt: string;
  readonly effectiveCapabilityRevision: string;
}

/**
 * Mutable-by-revocation view of the capabilities for a session. Only downgrade is allowed;
 * a revoked capability can never be re-granted without a fresh Permission Summary.
 * `revision` increments on every revocation so callers can detect state changes cheaply.
 */
export interface EffectiveCapabilityState {
  readonly workspaceKind: AgentWorkspaceKind;
  readonly capabilitySnapshot: AgentToolCapabilitySnapshot;
  /** Monotonically increasing within a session; starts at 1. */
  readonly revision: number;
  /** Capabilities that were available at run start but have since been revoked. */
  readonly revokedCapabilities: readonly RevokedCapability[];
  /** Whether tool calls are still permissible (false if run ended or all capabilities revoked). */
  readonly active: boolean;
}

/** Create the initial effective capability state from a capability snapshot. */
export function createEffectiveCapabilityState(
  snapshot: AgentToolCapabilitySnapshot,
  initialRevision = 1
): EffectiveCapabilityState {
  return Object.freeze<EffectiveCapabilityState>({
    workspaceKind: snapshot.workspaceKind,
    capabilitySnapshot: snapshot,
    revision: initialRevision,
    revokedCapabilities: Object.freeze([]),
    active: true
  });
}

/**
 * Produce a new EffectiveCapabilityState with the given capability revoked.
 * A no-op if the capability is already revoked. Never adds capabilities.
 */
export function revokeCapability(
  state: EffectiveCapabilityState,
  capability: string,
  reason: CapabilityRevocationReason,
  revokedAt: string
): EffectiveCapabilityState {
  if (state.revokedCapabilities.some((rc) => rc.capability === capability)) {
    return state;
  }
  const nextRevision = state.revision + 1;
  const revoked: RevokedCapability = Object.freeze({
    capability,
    reason,
    revokedAt,
    effectiveCapabilityRevision: String(nextRevision)
  });
  return Object.freeze<EffectiveCapabilityState>({
    ...state,
    revision: nextRevision,
    revokedCapabilities: Object.freeze([...state.revokedCapabilities, revoked])
  });
}

/**
 * Mark the session ended — no further tool calls are valid after this.
 * Retains the revocation history for audit purposes.
 */
export function deactivateCapabilityState(
  state: EffectiveCapabilityState,
  reason: CapabilityRevocationReason,
  revokedAt: string
): EffectiveCapabilityState {
  if (!state.active) return state;
  return Object.freeze<EffectiveCapabilityState>({
    ...state,
    revision: state.revision + 1,
    active: false,
    revokedCapabilities: Object.freeze([
      ...state.revokedCapabilities,
      Object.freeze({
        capability: "all",
        reason,
        revokedAt,
        effectiveCapabilityRevision: String(state.revision + 1)
      })
    ])
  });
}

/** Check whether a specific capability is still effective. */
export function isCapabilityEffective(
  state: EffectiveCapabilityState,
  capability: string
): boolean {
  if (!state.active) return false;
  return !state.revokedCapabilities.some((rc) => rc.capability === capability || rc.capability === "all");
}
