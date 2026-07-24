import { describe, expect, test } from "vitest";
import {
  createEffectiveCapabilityState,
  revokeCapability,
  deactivateCapabilityState,
  isCapabilityEffective
} from "../src/effective-capability-state.js";
import { createDefaultCapabilitySnapshot } from "../src/agent-tool-capabilities.js";

describe("EffectiveCapabilityState", () => {
  const snap = createDefaultCapabilitySnapshot();

  test("creates active state from snapshot", () => {
    const state = createEffectiveCapabilityState(snap);
    expect(state.active).toBe(true);
    expect(state.revision).toBe(1);
    expect(state.revokedCapabilities).toHaveLength(0);
    expect(state.workspaceKind).toBe("creativeProject");
  });

  test("isCapabilityEffective returns true for non-revoked capability", () => {
    const state = createEffectiveCapabilityState(snap);
    expect(isCapabilityEffective(state, "search")).toBe(true);
  });

  test("revokeCapability returns new state with revoked entry", () => {
    const state = createEffectiveCapabilityState(snap);
    const next = revokeCapability(state, "search", "feature_flag_disabled", "2026-07-24T00:00:00Z");
    expect(next.revision).toBe(2);
    expect(next.revokedCapabilities).toHaveLength(1);
    expect(next.revokedCapabilities[0]?.capability).toBe("search");
    expect(next.revokedCapabilities[0]?.reason).toBe("feature_flag_disabled");
    expect(isCapabilityEffective(next, "search")).toBe(false);
  });

  test("revokeCapability is idempotent for already-revoked capability", () => {
    const state = createEffectiveCapabilityState(snap);
    const once = revokeCapability(state, "search", "feature_flag_disabled", "2026-07-24T00:00:00Z");
    const twice = revokeCapability(once, "search", "attestation_expired", "2026-07-24T00:01:00Z");
    expect(twice.revision).toBe(once.revision);
    expect(twice.revokedCapabilities).toHaveLength(1);
  });

  test("revokeCapability does not modify original state", () => {
    const state = createEffectiveCapabilityState(snap);
    revokeCapability(state, "search", "feature_flag_disabled", "2026-07-24T00:00:00Z");
    expect(state.revokedCapabilities).toHaveLength(0);
    expect(state.revision).toBe(1);
  });

  test("deactivateCapabilityState marks state inactive", () => {
    const state = createEffectiveCapabilityState(snap);
    const inactive = deactivateCapabilityState(state, "run_ended", "2026-07-24T00:00:00Z");
    expect(inactive.active).toBe(false);
    expect(inactive.revision).toBe(2);
    expect(isCapabilityEffective(inactive, "any_capability")).toBe(false);
  });

  test("deactivateCapabilityState is idempotent when already inactive", () => {
    const state = createEffectiveCapabilityState(snap);
    const once = deactivateCapabilityState(state, "run_ended", "2026-07-24T00:00:00Z");
    const twice = deactivateCapabilityState(once, "run_ended", "2026-07-24T00:01:00Z");
    expect(twice.revision).toBe(once.revision);
  });

  test("revoking multiple capabilities increments revision each time", () => {
    const state = createEffectiveCapabilityState(snap);
    const s1 = revokeCapability(state, "search", "feature_flag_disabled", "2026-07-24T00:00:00Z");
    const s2 = revokeCapability(s1, "network", "attestation_expired", "2026-07-24T00:00:00Z");
    expect(s2.revision).toBe(3);
    expect(s2.revokedCapabilities).toHaveLength(2);
  });
});
