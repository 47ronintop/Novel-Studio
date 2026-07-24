import { describe, expect, test } from "vitest";
import {
  checkProviderNameCollisions,
  mangleToolId,
  buildFrozenProviderNameMapping
} from "../src/agent-tool-provider-mapping.js";

describe("checkProviderNameCollisions", () => {
  test("returns ok for unique names", () => {
    const result = checkProviderNameCollisions([
      { canonicalId: "search_project_text", providerName: "search_project_text" },
      { canonicalId: "find_project_references", providerName: "find_project_references" }
    ]);
    expect(result.ok).toBe(true);
  });

  test("detects collision", () => {
    const result = checkProviderNameCollisions([
      { canonicalId: "tool_a", providerName: "same_name" },
      { canonicalId: "tool_b", providerName: "same_name" }
    ]);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; collision: string }).collision).toMatch(/same_name/);
  });

  test("rejects non-provider-safe name", () => {
    const result = checkProviderNameCollisions([
      { canonicalId: "plugin:acme/tool", providerName: "plugin:acme/tool" }
    ]);
    expect(result.ok).toBe(false);
  });

  test("rejects name exceeding max length", () => {
    const result = checkProviderNameCollisions([
      { canonicalId: "tool", providerName: "a".repeat(65) }
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("mangleToolId", () => {
  test("replaces colons and slashes", () => {
    expect(mangleToolId("plugin:acme/summarise")).toBe("plugin__acme__summarise");
  });

  test("truncates to 64 chars", () => {
    const id = "plugin:" + "x".repeat(100);
    expect(mangleToolId(id).length).toBeLessThanOrEqual(64);
  });

  test("leaves ASCII-safe IDs unchanged", () => {
    expect(mangleToolId("search_project_text")).toBe("search_project_text");
  });
});

describe("buildFrozenProviderNameMapping", () => {
  test("builds map from descriptors", () => {
    const map = buildFrozenProviderNameMapping([
      { id: "search_project_text", providerName: "search_project_text" },
      { id: "find_project_references", providerName: "find_project_references" }
    ]);
    expect(map.get("search_project_text")).toBe("search_project_text");
    expect(map.size).toBe(2);
  });

  test("throws on collision", () => {
    expect(() =>
      buildFrozenProviderNameMapping([
        { id: "tool_a", providerName: "same" },
        { id: "tool_b", providerName: "same" }
      ])
    ).toThrow(/collision/i);
  });
});
