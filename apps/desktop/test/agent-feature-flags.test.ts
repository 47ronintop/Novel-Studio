import { describe, expect, test } from "vitest";
import {
  DEFAULT_AGENT_FEATURE_FLAGS,
  createAgentFeatureFlags
} from "../../../apps/desktop/src/main/agent-feature-flags.js";

describe("AgentFeatureFlags", () => {
  test("default flags are all false", () => {
    const flags = DEFAULT_AGENT_FEATURE_FLAGS;
    expect(flags.phaseA_searchEnabled).toBe(false);
    expect(flags.phaseB_fileLifecycleEnabled).toBe(false);
    expect(flags.phaseD_networkReadEnabled).toBe(false);
    expect(flags.phaseE_remoteMcpEnabled).toBe(false);
    expect(flags.revision).toBe("v1.0-default");
  });

  test("createAgentFeatureFlags with no overrides equals default", () => {
    const flags = createAgentFeatureFlags();
    expect(flags).toEqual(DEFAULT_AGENT_FEATURE_FLAGS);
  });

  test("phaseE remote MCP requires phaseD network", () => {
    const flags = createAgentFeatureFlags({ phaseE_remoteMcpEnabled: true });
    expect(flags.phaseE_remoteMcpEnabled).toBe(false);

    const flags2 = createAgentFeatureFlags({
      phaseD_networkReadEnabled: true,
      phaseE_remoteMcpEnabled: true
    });
    expect(flags2.phaseE_remoteMcpEnabled).toBe(true);
  });

  test("phaseA search can be enabled independently", () => {
    const flags = createAgentFeatureFlags({ phaseA_searchEnabled: true });
    expect(flags.phaseA_searchEnabled).toBe(true);
    expect(flags.phaseB_fileLifecycleEnabled).toBe(false);
  });

  test("createAgentFeatureFlags result is frozen", () => {
    const flags = createAgentFeatureFlags({ phaseA_searchEnabled: true });
    expect(() => {
      (flags as unknown as Record<string, unknown>)["phaseA_searchEnabled"] = false;
    }).toThrow();
  });
});
