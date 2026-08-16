import { describe, expect, test } from "vitest";

import * as engineExports from "../src/index.js";

describe("Agent run tool catalog snapshots", () => {
  function descriptors() {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly Record<string, unknown>[];
    return listTools({
      facadeVersion: "v2",
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation"
    });
  }

  function snapshot() {
    const create = (engineExports as unknown as Record<string, unknown>)[
      "createAgentRunToolCatalogSnapshot"
    ] as (input: Record<string, unknown>) => Record<string, unknown>;
    return create({
      runId: "run_catalog_01",
      facadeVersion: "v2",
      descriptors: descriptors(),
      createdAt: "2026-07-26T00:00:00.000Z"
    });
  }

  test("derives deterministic revisions from the facade and descriptor contents", () => {
    const create = (engineExports as unknown as Record<string, unknown>)[
      "createAgentRunToolCatalogSnapshot"
    ] as (input: Record<string, unknown>) => Record<string, unknown>;
    const first = snapshot();
    const second = create({
      runId: "run_catalog_01",
      facadeVersion: "v2",
      descriptors: descriptors(),
      createdAt: "2026-07-27T00:00:00.000Z"
    });

    expect(first["descriptorRevision"]).toMatch(/^[a-f0-9]{64}$/);
    expect(first["providerMappingRevision"]).toMatch(/^[a-f0-9]{64}$/);
    expect(first["catalogRevision"]).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatchObject({
      descriptorRevision: first["descriptorRevision"],
      providerMappingRevision: first["providerMappingRevision"],
      catalogRevision: first["catalogRevision"]
    });
  });

  test("rejects descriptor, descriptor revision, and provider mapping tampering", () => {
    const validate = (engineExports as unknown as Record<string, unknown>)[
      "validateAgentRunToolCatalogSnapshot"
    ] as (value: Record<string, unknown>) => { readonly ok: boolean };
    const original = snapshot();
    const originalDescriptors = original["descriptors"] as Record<string, unknown>[];
    const tamperedDescriptor = {
      ...original,
      descriptors: [
        { ...originalDescriptors[0], description: "tampered" },
        ...originalDescriptors.slice(1)
      ]
    };

    expect(validate(original)).toMatchObject({ ok: true });
    expect(validate(tamperedDescriptor)).toMatchObject({ ok: false });
    expect(validate({ ...original, descriptorRevision: "0".repeat(64) })).toMatchObject({
      ok: false
    });
    expect(validate({ ...original, providerMappingRevision: "0".repeat(64) })).toMatchObject({
      ok: false
    });
  });

  test("strictly round-trips Catalog 2.0 and rejects envelope, rule, and revision tampering", () => {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly Record<string, unknown>[];
    const create = (engineExports as unknown as Record<string, unknown>)[
      "createAgentRunToolCatalogSnapshotV2"
    ] as (input: Record<string, unknown>) => Record<string, unknown>;
    const validate = (engineExports as unknown as Record<string, unknown>)[
      "validateAgentRunToolCatalogSnapshot"
    ] as (value: Record<string, unknown>) => { readonly ok: boolean; readonly value?: unknown };
    const catalog = create({
      runId: "run_catalog_v2_01",
      descriptors: listTools({
        facadeVersion: "v2",
        catalogSchemaVersion: "2.0",
        operationMode: "execution",
        contextMode: "writing",
        writePolicy: "write_before_confirmation",
        capabilitySnapshot: {
          workspaceKind: "creativeProject",
          searchEnabled: false,
          fileLifecycleEnabled: false,
          writingOperations: ["chapter_replace", "chapter_create", "story_bible_create"],
          workspaceFileOperations: [],
          storyBibleStructuredToolsEnabled: true,
          controlledExecutionEnabled: false,
          gitReadEnabled: false,
          networkReadEnabled: false,
          pluginToolsEnabled: false,
          mcpToolsEnabled: false,
          featureFlagRevision: "catalog_v2_rules"
        }
      }),
      createdAt: "2026-08-02T00:00:00.000Z"
    });
    const persisted = JSON.parse(JSON.stringify(catalog)) as Record<string, unknown>;

    expect(catalog).toMatchObject({ schemaVersion: "2.0", facadeVersion: "v2" });
    expect(validate(persisted)).toMatchObject({ ok: true, value: catalog });
    expect(validate({ ...persisted, unexpected: true })).toMatchObject({ ok: false });
    expect(validate({ ...persisted, catalogRevision: "0".repeat(64) })).toMatchObject({
      ok: false
    });
    expect(validate({ ...persisted, approvalRuleSetChecksum: "0".repeat(64) })).toMatchObject({
      ok: false
    });

    const persistedDescriptors = persisted["descriptors"] as readonly Record<string, unknown>[];
    expect(
      validate({
        ...persisted,
        descriptors: [
          { ...persistedDescriptors[0], unexpectedDescriptorField: true },
          ...persistedDescriptors.slice(1)
        ]
      })
    ).toMatchObject({ ok: false });
    const computeDigest = (engineExports as unknown as Record<string, unknown>)[
      "computeAgentToolDescriptorDigest"
    ] as (descriptor: Record<string, unknown>) => string;
    const invalidKindDescriptor = {
      ...persistedDescriptors[0],
      kind: "unknown_kind"
    };
    expect(() =>
      create({
        runId: "run_catalog_v2_invalid_descriptor",
        descriptors: [
          {
            ...invalidKindDescriptor,
            descriptorDigest: computeDigest(invalidKindDescriptor)
          },
          ...persistedDescriptors.slice(1)
        ],
        createdAt: "2026-08-02T00:00:00.000Z"
      })
    ).toThrow("AGENT_TOOL_CATALOG_V2_INVALID");

    const rules = persisted["approvalRules"] as readonly Record<string, unknown>[];
    expect(
      validate({
        ...persisted,
        approvalRules: rules.map((rule) =>
          rule["operation"] === "chapter_replace"
            ? { operation: "chapter_replace", reviewMode: "always_human" }
            : rule
        )
      })
    ).toMatchObject({ ok: false });
  });

  test("binds every Catalog 2.0 mutation descriptor to exactly one approval rule", () => {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly Record<string, unknown>[];
    const create = (engineExports as unknown as Record<string, unknown>)[
      "createAgentRunToolCatalogSnapshotV2"
    ] as (input: Record<string, unknown>) => Record<string, unknown>;
    const catalog = create({
      runId: "run_catalog_v2_rules",
      descriptors: listTools({
        facadeVersion: "v2",
        catalogSchemaVersion: "2.0",
        operationMode: "execution",
        contextMode: "general_file",
        writePolicy: "write_before_confirmation",
        capabilitySnapshot: {
          workspaceKind: "engineeringWorkspace",
          searchEnabled: false,
          fileLifecycleEnabled: false,
          writingOperations: [],
          workspaceFileOperations: ["replace_file", "create_file"],
          controlledExecutionEnabled: false,
          gitReadEnabled: false,
          networkReadEnabled: false,
          pluginToolsEnabled: false,
          mcpToolsEnabled: false,
          featureFlagRevision: "catalog_v2_mutations"
        }
      }),
      createdAt: "2026-08-02T00:01:00.000Z"
    });
    const descriptors = catalog["descriptors"] as readonly Record<string, unknown>[];
    const mutationOperations = descriptors
      .filter((descriptor) => descriptor["effect"] === "propose")
      .map((descriptor) => descriptor["writeOperation"]);
    const approvalRules = catalog["approvalRules"] as readonly Record<string, unknown>[];

    expect(mutationOperations).toEqual(["replace_file", "create_file"]);
    expect(approvalRules.map((rule) => rule["operation"])).toEqual(mutationOperations);
    for (const operation of mutationOperations) {
      expect(approvalRules.filter((rule) => rule["operation"] === operation)).toHaveLength(1);
    }
  });

  test("round-trips a namespaced MCP descriptor in Catalog 2.0", () => {
    const computeDigest = (engineExports as unknown as Record<string, unknown>)[
      "computeAgentToolDescriptorDigest"
    ] as (descriptor: Record<string, unknown>) => string;
    const create = (engineExports as unknown as Record<string, unknown>)[
      "createAgentRunToolCatalogSnapshotV2"
    ] as (input: Record<string, unknown>) => Record<string, unknown>;
    const validate = (engineExports as unknown as Record<string, unknown>)[
      "validateAgentRunToolCatalogSnapshot"
    ] as (value: Record<string, unknown>) => { readonly ok: boolean };
    const base = {
      id: "mcp:trusted/send_message",
      name: "mcp__trusted__send_message",
      providerName: "mcp__trusted__send_message",
      displayName: "Send message",
      description: "Send a message through the trusted MCP server.",
      kind: "external_tool",
      effect: "external_action",
      dataEgress: "remote_tool_arguments",
      destructive: false,
      retrySemantics: "never_automatic",
      source: { kind: "mcp", id: "trusted" },
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["message"],
        properties: { message: { type: "string", minLength: 1 } }
      }
    };
    const descriptor = { ...base, descriptorDigest: computeDigest(base) };
    const catalog = create({
      runId: "run_catalog_v2_mcp",
      descriptors: [descriptor],
      createdAt: "2026-08-16T00:00:00.000Z"
    });

    expect(validate(JSON.parse(JSON.stringify(catalog)) as Record<string, unknown>)).toMatchObject({
      ok: true
    });
    expect(() =>
      create({
        runId: "run_catalog_v2_mcp_wrong_source",
        descriptors: [
          {
            ...descriptor,
            source: { kind: "mcp", id: "other" },
            descriptorDigest: computeDigest({ ...base, source: { kind: "mcp", id: "other" } })
          }
        ],
        createdAt: "2026-08-16T00:00:00.000Z"
      })
    ).toThrow("AGENT_TOOL_CATALOG_V2_INVALID");
  });

  test("normalizes no-mutation Catalog 2.0 runs to a not-applicable approval projection", () => {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly Record<string, unknown>[];
    const create = (engineExports as unknown as Record<string, unknown>)[
      "createAgentRunToolCatalogSnapshotV2"
    ] as (input: Record<string, unknown>) => Record<string, unknown>;
    const validate = (engineExports as unknown as Record<string, unknown>)[
      "validateAgentRunToolCatalogSnapshot"
    ] as (value: Record<string, unknown>) => { readonly ok: boolean };
    const catalog = create({
      runId: "run_catalog_v2_planning",
      descriptors: listTools({
        facadeVersion: "v2",
        catalogSchemaVersion: "2.0",
        operationMode: "planning",
        contextMode: "writing",
        writePolicy: "write_before_confirmation",
        capabilitySnapshot: {
          workspaceKind: "creativeProject",
          searchEnabled: false,
          fileLifecycleEnabled: false,
          writingOperations: ["chapter_replace"],
          workspaceFileOperations: [],
          controlledExecutionEnabled: false,
          gitReadEnabled: false,
          networkReadEnabled: false,
          pluginToolsEnabled: false,
          mcpToolsEnabled: false,
          featureFlagRevision: "catalog_v2_planning"
        }
      }),
      createdAt: "2026-08-02T00:02:00.000Z"
    });

    expect(catalog).toMatchObject({
      approvalRuleSetVersion: "not_applicable",
      approvalRuleSetChecksum: "not_applicable",
      approvalRules: []
    });
    expect(
      validate({
        ...catalog,
        approvalRuleSetVersion: "novel-studio-core@1.0"
      })
    ).toMatchObject({ ok: false });
  });

  test("keeps Catalog 1.0 v2 descriptors read-only as legacy data", () => {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly Record<string, unknown>[];
    const createLegacy = (engineExports as unknown as Record<string, unknown>)[
      "createAgentRunToolCatalogSnapshot"
    ] as (input: Record<string, unknown>) => Record<string, unknown>;
    const validate = (engineExports as unknown as Record<string, unknown>)[
      "validateAgentRunToolCatalogSnapshot"
    ] as (value: Record<string, unknown>) => { readonly ok: boolean; readonly value?: unknown };
    const capabilitySnapshot = {
      workspaceKind: "creativeProject",
      searchEnabled: false,
      fileLifecycleEnabled: true,
      controlledExecutionEnabled: false,
      gitReadEnabled: false,
      networkReadEnabled: false,
      pluginToolsEnabled: false,
      mcpToolsEnabled: false,
      featureFlagRevision: "legacy_catalog"
    };
    const legacy = createLegacy({
      runId: "run_catalog_legacy_v2",
      facadeVersion: "v2",
      descriptors: listTools({
        facadeVersion: "v2",
        operationMode: "execution",
        contextMode: "general_file",
        writePolicy: "write_before_confirmation",
        capabilitySnapshot
      }),
      createdAt: "2026-08-02T00:03:00.000Z"
    });
    const legacyNames = (legacy["descriptors"] as readonly Record<string, unknown>[]).map(
      (descriptor) => descriptor["name"]
    );

    expect(legacy).toMatchObject({ schemaVersion: "1.0", facadeVersion: "v2" });
    // Catalog 1.0 has no authenticated per-operation approval binding.  It remains
    // parseable for historical runs, but the current schema-1 v2 profile must not
    // issue broad legacy mutation aliases for newly created runs.
    expect(legacyNames).not.toContain("manage_path");
    expect(
      (legacy["descriptors"] as readonly Record<string, unknown>[]).every(
        (descriptor) => descriptor["writeOperation"] === undefined
      )
    ).toBe(true);
    expect(validate(JSON.parse(JSON.stringify(legacy)))).toMatchObject({ ok: true, value: legacy });

    const currentNames = listTools({
      facadeVersion: "v2",
      catalogSchemaVersion: "2.0",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      capabilitySnapshot: {
        ...capabilitySnapshot,
        workspaceFileOperations: ["replace_file", "create_file"]
      }
    }).map((descriptor) => descriptor["name"]);
    expect(currentNames).not.toContain("manage_path");
  });
});
