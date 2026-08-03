import { describe, expect, test } from "vitest";
import {
  computeProviderMappingRevision,
  createDefaultCapabilitySnapshot,
  listAgentTools
} from "@novel-studio/agent-engine";

import {
  checkProviderNameCollisions,
  freezeProviderNameMapping,
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
      { canonicalId: "tool", providerName: "a".repeat(64) }
    ]);
    expect(result.ok).toBe(false);
  });
});

describe("mangleToolId", () => {
  test("replaces colons and slashes", () => {
    expect(mangleToolId("plugin:acme/summarise")).toBe("plugin__acme__summarise");
  });

  test("truncates to the cross-provider limit", () => {
    const id = "plugin:" + "x".repeat(100);
    expect(mangleToolId(id).length).toBeLessThanOrEqual(63);
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

  test("exposes a stable bidirectional frozen mapping revision", () => {
    const mapping = freezeProviderNameMapping([
      { id: "plugin:acme/summarise", providerName: "plugin__acme__summarise" },
      { id: "mcp:docs/search", providerName: "mcp__docs__search" }
    ]);
    expect(mapping.providerNameFor("plugin:acme/summarise")).toBe("plugin__acme__summarise");
    expect(mapping.canonicalIdFor("mcp__docs__search")).toBe("mcp:docs/search");
    expect(mapping.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(mapping)).toBe(true);
  });

  test("rejects duplicate canonical ids even with different provider names", () => {
    expect(() =>
      freezeProviderNameMapping([
        { id: "plugin:acme/summarise", providerName: "first" },
        { id: "plugin:acme/summarise", providerName: "second" }
      ])
    ).toThrow(/collision/i);
  });

  test("binds the revision to the frozen Catalog 2.0 canonical/provider directory", () => {
    const descriptors = listAgentTools({
      facadeVersion: "v2",
      catalogSchemaVersion: "2.0",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      capabilitySnapshot: createDefaultCapabilitySnapshot("engineeringWorkspace")
    });
    const entries = descriptors.map((descriptor) => ({
      id: descriptor.id ?? descriptor.name,
      providerName: descriptor.providerName ?? descriptor.name
    }));
    const mapping = freezeProviderNameMapping(entries);
    const reordered = freezeProviderNameMapping([...entries].reverse());
    const remapped = freezeProviderNameMapping(
      entries.map((descriptor) =>
        descriptor.id === "read_resource"
          ? { ...descriptor, providerName: "read_resource_alias" }
          : descriptor
      )
    );

    expect(mapping.revision).toBe(computeProviderMappingRevision(descriptors));
    expect(reordered.revision).toBe(mapping.revision);
    expect(remapped.revision).not.toBe(mapping.revision);
    expect(mapping.providerNameFor("read_resource")).toBe("read_resource");
    expect(remapped.providerNameFor("read_resource")).toBe("read_resource_alias");
  });

  test("detaches the attested mapping from later caller mutations", () => {
    const descriptors = [{ id: "plugin:acme/summarise", providerName: "plugin__acme__summarise" }];
    const mapping = freezeProviderNameMapping(descriptors);
    const descriptor = descriptors[0];
    if (descriptor === undefined) throw new Error("Missing mapping fixture descriptor.");
    descriptor.providerName = "plugin__acme__rewritten";

    expect(mapping.entries).toEqual([
      { canonicalId: "plugin:acme/summarise", providerName: "plugin__acme__summarise" }
    ]);
    expect(mapping.providerNameFor("plugin:acme/summarise")).toBe("plugin__acme__summarise");
  });
});
