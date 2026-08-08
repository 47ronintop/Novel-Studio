import { describe, expect, test } from "vitest";
import type { JsonObject } from "@novel-studio/shared";

import * as engineExports from "../src/index.js";

describe("Agent tool registry", () => {
  test("freezes standalone conversation to an empty tool catalog", () => {
    for (const facadeVersion of ["v1", "v2"] as const) {
      expect(
        engineExports.listAgentTools({
          facadeVersion,
          operationMode: "conversation",
          contextMode: "standalone_chat",
          writePolicy: "write_before_confirmation",
          capabilitySnapshot: {
            workspaceKind: "creativeProject",
            searchEnabled: true,
            fileLifecycleEnabled: true,
            controlledExecutionEnabled: true,
            gitReadEnabled: true,
            networkReadEnabled: true,
            pluginToolsEnabled: true,
            mcpToolsEnabled: true,
            featureFlagRevision: "must-not-leak"
          }
        })
      ).toEqual([]);
    }
  });

  test("exposes the exact operation and context mode matrices", () => {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"];
    expect(typeof listTools).toBe("function");
    if (typeof listTools !== "function") return;

    const names = (operationMode: string, contextMode: string, writePolicy: string) =>
      (
        listTools({ operationMode, contextMode, writePolicy }) as readonly {
          readonly name: string;
        }[]
      ).map((tool) => tool.name);

    expect(names("planning", "writing", "write_before_confirmation")).toEqual([
      "list_project_entries",
      "read_chapter",
      "read_story_bible",
      "read_project_text",
      "finish_plan",
      "request_user_input"
    ]);
    expect(names("planning", "general_file", "write_before_confirmation")).toEqual([
      "list_project_entries",
      "read_project_text",
      "finish_plan",
      "request_user_input"
    ]);
    expect(names("execution", "writing", "write_before_confirmation")).toEqual([
      "list_project_entries",
      "read_chapter",
      "read_story_bible",
      "read_project_text",
      "propose_chapter_write",
      "finish",
      "request_user_input"
    ]);
    expect(names("execution", "general_file", "write_before_confirmation")).toEqual([
      "list_project_entries",
      "read_project_text",
      "propose_file_write",
      "finish",
      "request_user_input"
    ]);
    expect(names("execution", "general_file", "user_preapproved_run")).toEqual(
      names("execution", "general_file", "write_before_confirmation")
    );
  });

  test("publishes and enforces the strict structured finish_plan contract", () => {
    const descriptor = engineExports
      .listAgentTools({
        operationMode: "planning",
        contextMode: "writing",
        writePolicy: "write_before_confirmation"
      })
      .find((tool) => tool.name === "finish_plan");
    if (descriptor === undefined) throw new Error("Missing finish_plan descriptor.");
    expect(descriptor.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: [
        "planId",
        "goal",
        "successCriteria",
        "nonGoals",
        "facts",
        "assumptions",
        "openQuestions",
        "targetRefs",
        "steps",
        "risks",
        "verification",
        "sourceRefs"
      ]
    });
    const validArguments = {
      planId: "plan-structured-01",
      goal: "Produce an executable read-only plan.",
      successCriteria: ["The target and verification path are explicit."],
      nonGoals: [],
      facts: [],
      assumptions: [],
      openQuestions: [],
      targetRefs: [{ refId: "chapter:chapter-01", intent: "Inspect the target chapter." }],
      steps: [{ stepId: "step-01", title: "Inspect", verification: "Read the chapter again." }],
      risks: [],
      verification: ["Confirm the cited chapter still exists."],
      sourceRefs: ["chapter:chapter-01"]
    };
    const validates = (argumentsValue: JsonObject) =>
      engineExports.validateAgentToolArguments({
        descriptor,
        arguments: argumentsValue,
        argumentsText: JSON.stringify(argumentsValue)
      }).ok;

    expect(validates(validArguments)).toBe(true);
    const { risks: _risks, ...missingRisks } = validArguments;
    void _risks;
    expect(validates(missingRisks)).toBe(false);
    expect(validates({ ...validArguments, targetRefs: ["chapter:chapter-01"] })).toBe(false);
    expect(validates({ ...validArguments, steps: [] })).toBe(false);
    expect(validates({ ...validArguments, verification: [] })).toBe(false);
    expect(validates({ ...validArguments, unexpected: true })).toBe(false);
  });

  test("publishes and enforces bounded proposal argument schemas", () => {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly { readonly name: string; readonly inputSchema: Record<string, unknown> }[];
    const validate = (engineExports as unknown as Record<string, unknown>)[
      "validateAgentToolArguments"
    ] as
      | ((input: {
          descriptor: { readonly name: string; readonly inputSchema: Record<string, unknown> };
          arguments: Record<string, unknown>;
          argumentsText: string;
        }) => { readonly ok: boolean })
      | undefined;
    expect(typeof validate).toBe("function");
    if (validate === undefined) return;
    const descriptor = listTools({
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation"
    }).find((tool) => tool.name === "propose_file_write");
    expect(descriptor?.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["path", "baseHash", "range", "replacement"]
    });
    if (descriptor === undefined) throw new Error("Missing proposal descriptor.");
    const validArguments = {
      path: "notes/outline.md",
      baseHash: "a".repeat(64),
      range: { unit: "character", start: 0, end: 1 },
      replacement: "x"
    };
    expect(
      validate({
        descriptor,
        arguments: validArguments,
        argumentsText: JSON.stringify(validArguments)
      })
    ).toMatchObject({ ok: true });
    expect(
      validate({
        descriptor,
        arguments: { ...validArguments, baseHash: "not-a-hash", absolutePath: "C:/escape" },
        argumentsText: "{}"
      })
    ).toMatchObject({ ok: false });
    const oversized = { ...validArguments, replacement: "x".repeat(1_048_577) };
    expect(
      validate({ descriptor, arguments: oversized, argumentsText: JSON.stringify(oversized) })
    ).toMatchObject({ ok: false });
  });

  test("documents foreshadow creation in the v1 Story Bible proposal", () => {
    const descriptor = engineExports
      .listAgentTools({
        facadeVersion: "v1",
        operationMode: "execution",
        contextMode: "writing",
        writePolicy: "write_before_confirmation",
        capabilitySnapshot: {
          workspaceKind: "creativeProject",
          searchEnabled: false,
          fileLifecycleEnabled: true,
          controlledExecutionEnabled: false,
          gitReadEnabled: false,
          networkReadEnabled: false,
          pluginToolsEnabled: false,
          mcpToolsEnabled: false,
          featureFlagRevision: "foreshadow-description-v1"
        }
      })
      .find((tool) => tool.name === "propose_story_bible_write");
    if (descriptor === undefined) throw new Error("Missing Story Bible proposal descriptor.");

    expect(descriptor.description).toContain("foreshadow");
    expect(descriptor.description).toContain("Change Set");
    const arguments_ = { assetType: "foreshadow", content: "{}" };
    expect(
      engineExports.validateAgentToolArguments({
        descriptor,
        arguments: arguments_,
        argumentsText: JSON.stringify(arguments_)
      })
    ).toMatchObject({ ok: true });
  });

  test("assigns stable non-empty digests to static descriptors", () => {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly { readonly descriptorDigest?: string }[];
    const first = listTools({
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation"
    });
    const second = listTools({
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation"
    });
    expect(first.map((tool) => tool.descriptorDigest)).toEqual(
      second.map((tool) => tool.descriptorDigest)
    );
    expect(first.every((tool) => /^[a-f0-9]{64}$/.test(tool.descriptorDigest ?? ""))).toBe(true);
  });

  test("keeps the explicit v1 facade identical to the legacy default", () => {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly { readonly name: string; readonly descriptorDigest?: string }[];
    const input = {
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation"
    };

    expect(listTools({ ...input, facadeVersion: "v1" })).toEqual(listTools(input));
  });

  test("keeps the v2 schema 1 core matrix read-only behind capability gates", () => {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly { readonly name: string }[];
    const capabilities = (searchEnabled: boolean, fileLifecycleEnabled: boolean) => ({
      workspaceKind: "creativeProject",
      searchEnabled,
      fileLifecycleEnabled,
      controlledExecutionEnabled: false,
      gitReadEnabled: false,
      networkReadEnabled: false,
      pluginToolsEnabled: false,
      mcpToolsEnabled: false,
      featureFlagRevision: "flags_v2"
    });
    const names = (
      operationMode: "planning" | "execution",
      searchEnabled: boolean,
      fileLifecycleEnabled: boolean
    ) =>
      listTools({
        facadeVersion: "v2",
        operationMode,
        contextMode: "writing",
        writePolicy: "write_before_confirmation",
        capabilitySnapshot: capabilities(searchEnabled, fileLifecycleEnabled)
      }).map((tool) => tool.name);

    expect(names("planning", true, true)).toEqual([
      "list_project_entries",
      "read_resource",
      "search_project",
      "finish_plan",
      "request_user_input"
    ]);
    expect(names("execution", false, false)).toEqual([
      "list_project_entries",
      "read_resource",
      "finish",
      "request_user_input"
    ]);
    const fullExecution = names("execution", true, true);
    expect(fullExecution).toEqual([
      "list_project_entries",
      "read_resource",
      "search_project",
      "finish",
      "request_user_input"
    ]);
    expect(fullExecution).toHaveLength(5);

    const unqualifiedEngineeringTools = listTools({
      facadeVersion: "v2",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      capabilitySnapshot: {
        ...capabilities(false, false),
        workspaceKind: "engineeringWorkspace"
      }
    }).map((tool) => tool.name);
    expect(unqualifiedEngineeringTools).not.toContain("edit_text");
  });

  test("keeps v2 network and remote MCP additions while excluding cancelled capabilities", () => {
    const compute = (engineExports as unknown as Record<string, unknown>)[
      "computeAgentToolDescriptorDigest"
    ] as (descriptor: Record<string, unknown>) => string;
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly { readonly name: string }[];
    const externalDescriptor = (kind: "plugin" | "mcp", id: string, name: string) => {
      const descriptor = {
        id: `${kind}:${id}/search`,
        name,
        providerName: name,
        displayName: `${kind} search`,
        description: `Search through ${kind}.`,
        kind: "external_tool",
        effect: "external_action",
        dataEgress: "remote_tool_arguments",
        destructive: false,
        retrySemantics: "never_automatic",
        source: { kind, id },
        inputSchema: { type: "object", additionalProperties: false, properties: {} }
      };
      return { ...descriptor, descriptorDigest: compute(descriptor) };
    };
    const names = listTools({
      facadeVersion: "v2",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      capabilitySnapshot: {
        workspaceKind: "creativeProject",
        searchEnabled: false,
        fileLifecycleEnabled: false,
        controlledExecutionEnabled: true,
        sandboxAttestationId: "cancelled-capability",
        gitReadEnabled: true,
        networkReadEnabled: true,
        pluginToolsEnabled: true,
        mcpToolsEnabled: true,
        featureFlagRevision: "flags_v2"
      },
      externalToolDescriptors: [
        externalDescriptor("plugin", "acme", "plugin__acme__search"),
        externalDescriptor("mcp", "docs", "mcp__docs__search")
      ]
    }).map((tool) => tool.name);

    expect(names).toContain("web_search");
    expect(names).toContain("fetch_url");
    expect(names).toContain("mcp__docs__search");
    expect(names).not.toContain("run_project_task");
    expect(names).not.toContain("git_status");
    expect(names).not.toContain("git_diff");
    expect(names).not.toContain("plugin__acme__search");
  });

  test("keeps schema 1 v2 read schemas while withholding mutation aliases", () => {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly {
      readonly name: string;
      readonly description?: string;
      readonly destructive?: boolean;
      readonly inputSchema: Record<string, unknown>;
    }[];
    const validate = (engineExports as unknown as Record<string, unknown>)[
      "validateAgentToolArguments"
    ] as (input: {
      descriptor: {
        readonly name: string;
        readonly inputSchema: Record<string, unknown>;
      };
      arguments: Record<string, unknown>;
      argumentsText: string;
    }) => { readonly ok: boolean };
    const descriptors = listTools({
      facadeVersion: "v2",
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      capabilitySnapshot: {
        workspaceKind: "creativeProject",
        searchEnabled: true,
        fileLifecycleEnabled: true,
        controlledExecutionEnabled: false,
        gitReadEnabled: false,
        networkReadEnabled: false,
        pluginToolsEnabled: false,
        mcpToolsEnabled: false,
        featureFlagRevision: "flags_v2"
      }
    });
    const descriptor = (name: string) => {
      const value = descriptors.find((tool) => tool.name === name);
      if (value === undefined) throw new Error(`Missing ${name} descriptor.`);
      return value;
    };
    const isValid = (name: string, arguments_: Record<string, unknown>) =>
      validate({
        descriptor: descriptor(name),
        arguments: arguments_,
        argumentsText: JSON.stringify(arguments_)
      }).ok;
    expect(isValid("read_resource", { ref: "chapter:ch_01" })).toBe(true);
    expect(isValid("read_resource", { ref: "story_bible:character.hero" })).toBe(true);
    expect(isValid("read_resource", { ref: "file:notes/outline.md" })).toBe(true);
    expect(isValid("read_resource", { ref: "notes/outline.md" })).toBe(false);

    expect(isValid("search_project", { mode: "text", query: "oath", maxResults: 200 })).toBe(true);
    expect(
      isValid("search_project", { mode: "references", ref: "chapter:ch_01", maxResults: 20 })
    ).toBe(true);
    expect(isValid("search_project", { mode: "text", ref: "chapter:ch_01" })).toBe(false);
    expect(isValid("search_project", { mode: "text", query: "oath", maxResults: 201 })).toBe(false);
    expect(
      isValid("search_project", {
        mode: "text",
        query: "oath",
        includeGlobs: Array.from({ length: 21 }, (_, index) => `${index}.md`)
      })
    ).toBe(false);

    expect(descriptors.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(["edit_text", "create_resource", "manage_path"])
    );
  });

  test("assigns stable digests to the v2 descriptor set", () => {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly { readonly descriptorDigest?: string }[];
    const input = {
      facadeVersion: "v2",
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation"
    };
    const first = listTools(input).map((tool) => tool.descriptorDigest);
    const second = listTools(input).map((tool) => tool.descriptorDigest);

    expect(first).toEqual(second);
    expect(first.every((digest) => /^[a-f0-9]{64}$/.test(digest ?? ""))).toBe(true);
  });

  test("fails closed for a dynamic descriptor whose source or digest is not attested", () => {
    const compute = (engineExports as unknown as Record<string, unknown>)[
      "computeAgentToolDescriptorDigest"
    ] as (descriptor: Record<string, unknown>) => string;
    const validate = (engineExports as unknown as Record<string, unknown>)[
      "validateExternalToolDescriptors"
    ] as (descriptors: readonly Record<string, unknown>[]) => { readonly ok: boolean };
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly { readonly name: string }[];
    const descriptor = {
      id: "plugin:acme/summarise",
      name: "plugin__acme__summarise",
      providerName: "plugin__acme__summarise",
      displayName: "Summarise",
      description: "Summarise a selected document.",
      kind: "external_tool",
      effect: "external_action",
      dataEgress: "remote_tool_arguments",
      destructive: false,
      retrySemantics: "idempotency_key_required",
      source: { kind: "plugin", id: "acme" },
      inputSchema: { type: "object", additionalProperties: false, properties: {} }
    };
    const attested = { ...descriptor, descriptorDigest: compute(descriptor) };
    expect(validate([attested])).toMatchObject({ ok: true });
    expect(validate([{ ...attested, source: { kind: "mcp", id: "acme" } }])).toMatchObject({
      ok: false
    });
    expect(validate([{ ...attested, descriptorDigest: "0".repeat(64) }])).toMatchObject({
      ok: false
    });

    const names = listTools({
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      capabilitySnapshot: {
        workspaceKind: "engineeringWorkspace",
        searchEnabled: false,
        fileLifecycleEnabled: false,
        controlledExecutionEnabled: false,
        gitReadEnabled: false,
        networkReadEnabled: false,
        pluginToolsEnabled: true,
        mcpToolsEnabled: false,
        featureFlagRevision: "flags_01"
      },
      externalToolDescriptors: [{ ...attested, descriptorDigest: "0".repeat(64) }]
    }).map((tool) => tool.name);
    expect(names).not.toContain("plugin__acme__summarise");
  });

  test("rejects a dynamic tool directory above the provider-safe global limit", () => {
    const compute = (engineExports as unknown as Record<string, unknown>)[
      "computeAgentToolDescriptorDigest"
    ] as (descriptor: Record<string, unknown>) => string;
    const validate = (engineExports as unknown as Record<string, unknown>)[
      "validateExternalToolDescriptors"
    ] as (descriptors: readonly Record<string, unknown>[]) => {
      readonly ok: boolean;
      readonly error?: string;
    };
    const maximum = (engineExports as unknown as Record<string, unknown>)[
      "MAX_EXTERNAL_TOOL_DESCRIPTORS"
    ] as number;
    const descriptors = Array.from({ length: maximum + 1 }, (_, index) => {
      const descriptor = {
        id: `mcp:server/tool_${String(index)}`,
        name: `mcp__server__tool_${String(index)}`,
        providerName: `mcp__server__tool_${String(index)}`,
        displayName: `Tool ${String(index)}`,
        description: "Remote MCP tool.",
        kind: "external_tool",
        effect: "external_action",
        dataEgress: "remote_tool_arguments",
        destructive: false,
        retrySemantics: "never_automatic",
        source: { kind: "mcp", id: "server" },
        inputSchema: { type: "object", additionalProperties: false, properties: {} }
      };
      return { ...descriptor, descriptorDigest: compute(descriptor) };
    });

    expect(validate(descriptors)).toMatchObject({
      ok: false,
      error: expect.stringContaining(`${String(maximum)} tool limit`)
    });
  });

  test("applies plugin and MCP capability switches independently", () => {
    const compute = (engineExports as unknown as Record<string, unknown>)[
      "computeAgentToolDescriptorDigest"
    ] as (descriptor: Record<string, unknown>) => string;
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly { readonly name: string }[];
    const externalDescriptor = (kind: "plugin" | "mcp", id: string, name: string) => {
      const descriptor = {
        id: `${kind}:${id}/search`,
        name,
        providerName: name,
        displayName: `${kind} search`,
        description: `Search through ${kind}.`,
        kind: "external_tool",
        effect: "external_action",
        dataEgress: "remote_tool_arguments",
        destructive: false,
        retrySemantics: "never_automatic",
        source: { kind, id },
        inputSchema: { type: "object", additionalProperties: false, properties: {} }
      };
      return { ...descriptor, descriptorDigest: compute(descriptor) };
    };
    const descriptors = [
      externalDescriptor("plugin", "acme", "plugin__acme__search"),
      externalDescriptor("mcp", "docs", "mcp__docs__search")
    ];
    const namesFor = (pluginToolsEnabled: boolean, mcpToolsEnabled: boolean) =>
      listTools({
        operationMode: "execution",
        contextMode: "general_file",
        writePolicy: "write_before_confirmation",
        capabilitySnapshot: {
          workspaceKind: "engineeringWorkspace",
          searchEnabled: false,
          fileLifecycleEnabled: false,
          controlledExecutionEnabled: false,
          gitReadEnabled: false,
          networkReadEnabled: false,
          pluginToolsEnabled,
          mcpToolsEnabled,
          featureFlagRevision: "flags_01"
        },
        externalToolDescriptors: descriptors
      }).map((tool) => tool.name);

    expect(namesFor(true, false)).toContain("plugin__acme__search");
    expect(namesFor(true, false)).not.toContain("mcp__docs__search");
    expect(namesFor(false, true)).not.toContain("plugin__acme__search");
    expect(namesFor(false, true)).toContain("mcp__docs__search");
  });

  test("does not upgrade Catalog 2.0 mutations from the legacy lifecycle switch", () => {
    const legacyCapabilities = {
      workspaceKind: "creativeProject" as const,
      searchEnabled: false,
      fileLifecycleEnabled: true,
      writingOperations: [],
      workspaceFileOperations: [],
      controlledExecutionEnabled: false,
      gitReadEnabled: false,
      networkReadEnabled: false,
      pluginToolsEnabled: false,
      mcpToolsEnabled: false,
      featureFlagRevision: "legacy-lifecycle-only"
    };
    const catalogV2Tools = (
      contextMode: "writing" | "general_file",
      workspaceKind: "creativeProject" | "engineeringWorkspace"
    ) =>
      engineExports.listAgentTools({
        facadeVersion: "v2",
        catalogSchemaVersion: "2.0",
        operationMode: "execution",
        contextMode,
        writePolicy: "write_before_confirmation",
        capabilitySnapshot: { ...legacyCapabilities, workspaceKind }
      });

    for (const [contextMode, workspaceKind] of [
      ["writing", "creativeProject"],
      ["general_file", "creativeProject"],
      ["general_file", "engineeringWorkspace"]
    ] as const) {
      const catalogV2 = catalogV2Tools(contextMode, workspaceKind);
      expect(catalogV2.filter((tool) => tool.effect === "propose")).toEqual([]);
      expect(catalogV2.map((tool) => tool.name)).not.toContain("manage_path");
    }

    expect(
      engineExports
        .listAgentTools({
          facadeVersion: "v2",
          operationMode: "execution",
          contextMode: "general_file",
          writePolicy: "write_before_confirmation",
          capabilitySnapshot: legacyCapabilities
        })
        .map((tool) => tool.name)
    ).not.toContain("manage_path");
  });

  test("keeps v2 facade schema 1 read-only even when legacy mutation switches are set", () => {
    const tools = engineExports.listAgentTools({
      facadeVersion: "v2",
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      capabilitySnapshot: {
        workspaceKind: "creativeProject",
        searchEnabled: true,
        fileLifecycleEnabled: true,
        storyBibleStructuredToolsEnabled: true,
        writingOperations: ["chapter_replace", "story_bible_patch"],
        workspaceFileOperations: ["replace_file", "create_file"],
        controlledExecutionEnabled: false,
        gitReadEnabled: false,
        networkReadEnabled: false,
        pluginToolsEnabled: false,
        mcpToolsEnabled: false,
        featureFlagRevision: "v2-schema-1-no-mutation"
      }
    });

    expect(tools.filter((tool) => tool.effect === "propose" || tool.effect === "execute")).toEqual(
      []
    );
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "list_project_entries",
        "read_resource",
        "list_story_bible",
        "read_story_bible",
        "search_project"
      ])
    );
    expect(tools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining([
        "edit_text",
        "create_resource",
        "manage_path",
        "create_story_bible",
        "patch_story_bible",
        "set_story_bible_status",
        "restore_story_bible"
      ])
    );
  });

  test("uses profile-specific Catalog 2.0 schemas without aggregate mutation tools", () => {
    const baseCapabilities = {
      searchEnabled: false,
      fileLifecycleEnabled: false,
      controlledExecutionEnabled: false,
      gitReadEnabled: false,
      networkReadEnabled: false,
      pluginToolsEnabled: false,
      mcpToolsEnabled: false,
      featureFlagRevision: "catalog-v2-profile-schemas"
    };
    const options = {
      facadeVersion: "v2" as const,
      catalogSchemaVersion: "2.0" as const,
      operationMode: "execution" as const,
      writePolicy: "write_before_confirmation" as const
    };
    const baseHash = "a".repeat(64);
    const range = { unit: "character", start: 0, end: 1 };
    const isValid = (
      descriptor: ReturnType<typeof engineExports.listAgentTools>[number],
      arguments_: JsonObject
    ) =>
      engineExports.validateAgentToolArguments({
        descriptor,
        arguments: arguments_,
        argumentsText: JSON.stringify(arguments_)
      }).ok;
    const requireDescriptor = (
      descriptors: readonly ReturnType<typeof engineExports.listAgentTools>[number][],
      name: string
    ) => {
      const descriptor = descriptors.find((candidate) => candidate.name === name);
      if (descriptor === undefined) throw new Error(`Missing ${name} descriptor.`);
      return descriptor;
    };

    const writing = engineExports.listAgentTools({
      ...options,
      contextMode: "writing",
      capabilitySnapshot: {
        ...baseCapabilities,
        workspaceKind: "creativeProject",
        writingOperations: [
          "chapter_replace",
          "chapter_create",
          "story_bible_create",
          "story_bible_patch",
          "story_bible_status",
          "story_bible_restore"
        ],
        workspaceFileOperations: []
      }
    });
    const writingNames = writing.map((tool) => tool.name);
    expect(writingNames).toContain("edit_text");
    expect(writingNames).toContain("create_resource");
    expect(writingNames).toContain("create_story_bible");
    expect(writingNames).toContain("patch_story_bible");
    expect(writingNames).toContain("set_story_bible_status");
    expect(writingNames).toContain("restore_story_bible");
    expect(writingNames).not.toContain("manage_path");
    expect(writingNames).not.toContain("propose_chapter_write");
    expect(writingNames).not.toContain("propose_chapter_create");
    expect(writingNames).not.toContain("propose_story_bible_write");
    expect(isValid(requireDescriptor(writing, "read_resource"), { ref: "chapter:ch_01" })).toBe(
      true
    );
    expect(isValid(requireDescriptor(writing, "read_resource"), { ref: "file:notes.md" })).toBe(
      false
    );
    expect(
      isValid(requireDescriptor(writing, "edit_text"), {
        ref: "chapter:ch_01",
        baseHash,
        range,
        replacement: "Updated"
      })
    ).toBe(true);
    expect(
      isValid(requireDescriptor(writing, "edit_text"), {
        ref: "file:notes.md",
        baseHash,
        range,
        replacement: "Updated"
      })
    ).toBe(false);
    expect(
      isValid(requireDescriptor(writing, "create_resource"), {
        kind: "chapter",
        title: "Opening"
      })
    ).toBe(true);
    expect(
      isValid(requireDescriptor(writing, "create_resource"), {
        kind: "file",
        path: "notes/new.md",
        content: "Draft"
      })
    ).toBe(false);
    expect(requireDescriptor(writing, "create_resource").description).toContain("章节");
    expect(requireDescriptor(writing, "create_resource").description).not.toMatch(
      /Story Bible|file:/u
    );
    expect(requireDescriptor(writing, "create_story_bible").description).toContain(
      "describe_story_bible_type"
    );

    const patchStoryBible = requireDescriptor(writing, "patch_story_bible");
    const statusStoryBible = requireDescriptor(writing, "set_story_bible_status");
    const restoreStoryBible = requireDescriptor(writing, "restore_story_bible");
    const patchArguments = {
      assetId: "hero",
      baseRevision: 1,
      operations: [{ op: "replace", path: "/title", value: "Hero" }]
    };
    const statusArguments = { assetId: "hero", baseRevision: 1, status: "archived" };
    const restoreArguments = { assetId: "hero", baseRevision: 2 };
    expect(isValid(patchStoryBible, patchArguments)).toBe(false);
    expect(isValid(patchStoryBible, { ...patchArguments, baseChecksum: baseHash })).toBe(true);
    expect(isValid(statusStoryBible, statusArguments)).toBe(false);
    expect(isValid(statusStoryBible, { ...statusArguments, baseChecksum: baseHash })).toBe(true);
    expect(isValid(restoreStoryBible, restoreArguments)).toBe(false);
    expect(isValid(restoreStoryBible, { ...restoreArguments, baseChecksum: baseHash })).toBe(true);

    const creative = engineExports.listAgentTools({
      ...options,
      contextMode: "general_file",
      capabilitySnapshot: {
        ...baseCapabilities,
        workspaceKind: "creativeProject",
        writingOperations: [],
        workspaceFileOperations: ["replace_file", "create_file", "move_file", "delete_file"]
      }
    });
    const creativeNames = creative.map((tool) => tool.name);
    expect(
      creative
        .filter((tool) => tool.effect === "propose")
        .map((tool) => ({
          name: tool.name,
          writeOperation: tool.writeOperation,
          destructive: tool.destructive
        }))
    ).toEqual([
      { name: "edit_text", writeOperation: "replace_file", destructive: false },
      { name: "create_resource", writeOperation: "create_file", destructive: false },
      { name: "propose_file_move", writeOperation: "move_file", destructive: true },
      { name: "propose_file_delete", writeOperation: "delete_file", destructive: true }
    ]);
    expect(creativeNames).not.toContain("manage_path");
    expect(creativeNames).not.toContain("propose_file_write");
    expect(creativeNames).not.toContain("propose_file_create");
    expect(creativeNames).not.toContain("propose_directory_create");
    expect(
      isValid(requireDescriptor(creative, "edit_text"), {
        ref: "file:notes.md",
        baseHash,
        range,
        replacement: "Updated"
      })
    ).toBe(true);
    expect(
      isValid(requireDescriptor(creative, "edit_text"), {
        ref: "chapter:ch_01",
        baseHash,
        range,
        replacement: "Updated"
      })
    ).toBe(false);
    expect(
      isValid(requireDescriptor(creative, "create_resource"), {
        kind: "file",
        ref: "file:notes/new.md",
        content: "Draft"
      })
    ).toBe(true);
    expect(
      isValid(requireDescriptor(creative, "propose_file_move"), {
        sourceRef: "file:notes/old.md",
        targetRef: "file:notes/new.md",
        baseHash
      })
    ).toBe(true);
    expect(
      isValid(requireDescriptor(creative, "propose_file_move"), {
        sourcePath: "notes/old.md",
        targetRef: "file:notes/new.md",
        baseHash
      })
    ).toBe(false);
    expect(
      isValid(requireDescriptor(creative, "propose_file_delete"), {
        ref: "file:notes/old.md",
        baseHash
      })
    ).toBe(true);
    expect(
      isValid(requireDescriptor(creative, "create_resource"), {
        kind: "file",
        path: "notes/new.md",
        content: "Draft"
      })
    ).toBe(false);
    expect(
      isValid(requireDescriptor(creative, "propose_file_move"), {
        sourceRef: "file:notes/old.md",
        targetPath: "notes/new.md",
        baseHash
      })
    ).toBe(false);
    expect(
      isValid(requireDescriptor(creative, "propose_file_delete"), {
        relativePath: "notes/old.md",
        baseHash
      })
    ).toBe(false);
    expect(
      isValid(requireDescriptor(creative, "create_resource"), {
        kind: "file",
        ref: "notes/new.md",
        content: "Draft"
      })
    ).toBe(false);
    expect(
      isValid(requireDescriptor(creative, "propose_file_move"), {
        sourceRef: "notes/old.md",
        targetRef: "file:notes/new.md",
        baseHash
      })
    ).toBe(false);
    expect(
      isValid(requireDescriptor(creative, "propose_file_delete"), {
        ref: "chapter:ch_01",
        baseHash
      })
    ).toBe(false);
    expect(
      isValid(requireDescriptor(creative, "propose_file_delete"), {
        relativePath: "notes/old.md",
        baseHash,
        recursive: true
      })
    ).toBe(false);

    const engineering = engineExports.listAgentTools({
      ...options,
      contextMode: "general_file",
      capabilitySnapshot: {
        ...baseCapabilities,
        workspaceKind: "engineeringWorkspace",
        writingOperations: [],
        workspaceFileOperations: [
          "replace_file",
          "create_file",
          "move_file",
          "delete_file",
          "create_directory"
        ]
      }
    });
    const engineeringNames = engineering.map((tool) => tool.name);
    expect(engineeringNames).toEqual(
      expect.arrayContaining(["propose_file_write", "propose_file_create"])
    );
    expect(engineeringNames).not.toEqual(
      expect.arrayContaining([
        "propose_file_move",
        "propose_file_delete",
        "propose_directory_create"
      ])
    );
    expect(engineeringNames).not.toContain("edit_text");
    expect(engineeringNames).not.toContain("create_resource");
    expect(engineeringNames).not.toContain("manage_path");
    expect(
      engineering.filter((tool) => tool.effect === "propose").map((tool) => tool.writeOperation)
    ).toEqual(["replace_file", "create_file"]);
  });

  test("qualifies the four chapter lifecycle tools independently with strict schemas", () => {
    const lifecycleOperations = [
      "chapter_rename",
      "chapter_reorder",
      "chapter_status",
      "chapter_restore"
    ] as const;
    const baseInput = {
      facadeVersion: "v2" as const,
      catalogSchemaVersion: "2.0" as const,
      operationMode: "execution" as const,
      contextMode: "writing" as const,
      writePolicy: "write_before_confirmation" as const,
      capabilitySnapshot: {
        workspaceKind: "creativeProject" as const,
        searchEnabled: false,
        fileLifecycleEnabled: false,
        writingOperations: lifecycleOperations,
        workspaceFileOperations: [],
        controlledExecutionEnabled: false,
        gitReadEnabled: false,
        networkReadEnabled: false,
        pluginToolsEnabled: false,
        mcpToolsEnabled: false,
        featureFlagRevision: "chapter-lifecycle-catalog"
      }
    };
    const catalog = engineExports.listAgentTools(baseInput);
    const lifecycle = catalog.filter((tool) => tool.effect === "propose");
    expect(
      lifecycle.map(({ name, kind, effect, writeOperation, destructive }) => ({
        name,
        kind,
        effect,
        writeOperation,
        destructive
      }))
    ).toEqual([
      {
        name: "rename_chapter",
        kind: "file_tool",
        effect: "propose",
        writeOperation: "chapter_rename",
        destructive: false
      },
      {
        name: "reorder_chapter",
        kind: "file_tool",
        effect: "propose",
        writeOperation: "chapter_reorder",
        destructive: true
      },
      {
        name: "set_chapter_status",
        kind: "file_tool",
        effect: "propose",
        writeOperation: "chapter_status",
        destructive: true
      },
      {
        name: "restore_chapter",
        kind: "file_tool",
        effect: "propose",
        writeOperation: "chapter_restore",
        destructive: false
      }
    ]);

    const names = catalog.map((tool) => tool.name);
    expect(names).not.toEqual(
      expect.arrayContaining([
        "manage_path",
        "propose_chapter_write",
        "propose_chapter_create",
        "propose_story_bible_write"
      ])
    );
    expect(
      engineExports
        .listAgentTools({ ...baseInput, operationMode: "planning" })
        .filter((tool) => tool.effect === "propose")
    ).toEqual([]);
    expect(
      engineExports
        .listAgentTools({ ...baseInput, contextMode: "general_file" })
        .filter((tool) => tool.effect === "propose")
    ).toEqual([]);

    for (const [operation, expectedName] of [
      ["chapter_rename", "rename_chapter"],
      ["chapter_reorder", "reorder_chapter"],
      ["chapter_status", "set_chapter_status"],
      ["chapter_restore", "restore_chapter"]
    ] as const) {
      expect(
        engineExports
          .listAgentTools({
            ...baseInput,
            capabilitySnapshot: {
              ...baseInput.capabilitySnapshot,
              writingOperations: [operation]
            }
          })
          .filter((tool) => tool.effect === "propose")
          .map((tool) => tool.name)
      ).toEqual([expectedName]);
    }

    const isValid = (name: string, arguments_: JsonObject) => {
      const descriptor = catalog.find((tool) => tool.name === name);
      if (descriptor === undefined) throw new Error(`Missing ${name} descriptor.`);
      return engineExports.validateAgentToolArguments({
        descriptor,
        arguments: arguments_,
        argumentsText: JSON.stringify(arguments_)
      }).ok;
    };
    const base = { chapterRef: "chapter:ch_01", baseRevision: 3 };
    expect(isValid("rename_chapter", { ...base, title: "A new title" })).toBe(true);
    expect(isValid("rename_chapter", { ...base, title: "   " })).toBe(false);
    expect(isValid("rename_chapter", { ...base, title: "Title", path: "chapters/ch_01.md" })).toBe(
      false
    );
    expect(
      isValid("reorder_chapter", {
        ...base,
        beforeChapterRef: "chapter:ch_00",
        afterChapterRef: "chapter:ch_02",
        targetVolumeRef: "story_bible:outline.volume-01"
      })
    ).toBe(true);
    expect(isValid("reorder_chapter", { ...base, order: 7 })).toBe(false);
    expect(isValid("reorder_chapter", { ...base, beforeChapterRef: "ch_00" })).toBe(false);
    for (const status of ["draft", "revision", "review", "done", "archived", "deleted"]) {
      expect(isValid("set_chapter_status", { ...base, status })).toBe(true);
    }
    expect(isValid("set_chapter_status", { ...base, status: "active" })).toBe(false);
    expect(isValid("restore_chapter", base)).toBe(true);
    expect(isValid("restore_chapter", { ...base, status: "draft" })).toBe(false);
    expect(isValid("restore_chapter", { chapterRef: "file:ch_01", baseRevision: 3 })).toBe(false);
    expect(
      isValid("restore_chapter", {
        chapterRef: `chapter:${"a".repeat(129)}`,
        baseRevision: 3
      })
    ).toBe(false);
  });

  test("exposes the dedicated read-only list_chapters contract only in Catalog 2.0 writing", () => {
    const baseInput = {
      facadeVersion: "v2" as const,
      catalogSchemaVersion: "2.0" as const,
      operationMode: "planning" as const,
      contextMode: "writing" as const,
      writePolicy: "write_before_confirmation" as const,
      capabilitySnapshot: {
        workspaceKind: "creativeProject" as const,
        searchEnabled: false,
        fileLifecycleEnabled: false,
        controlledExecutionEnabled: false,
        gitReadEnabled: false,
        networkReadEnabled: false,
        pluginToolsEnabled: false,
        mcpToolsEnabled: false,
        featureFlagRevision: "list-chapters-contract"
      }
    };
    const catalog = engineExports.listAgentTools(baseInput);
    const listChapters = catalog.find((tool) => tool.name === "list_chapters");
    expect(listChapters).toMatchObject({
      name: "list_chapters",
      providerName: "list_chapters",
      kind: "file_tool",
      effect: "read",
      destructive: false,
      retrySemantics: "safe"
    });
    expect(listChapters?.writeOperation).toBeUndefined();
    expect(listChapters?.description).toContain("includeDeleted");
    expect(catalog.map((tool) => tool.name)).not.toContain("list_project_entries");
    expect(listChapters?.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        statuses: {
          type: "array",
          maxItems: 6,
          uniqueItems: true,
          items: {
            enum: ["draft", "revision", "review", "done", "archived", "deleted"]
          }
        },
        cursor: { type: "string", minLength: 1, maxLength: 4096 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        includeDeleted: { type: "boolean" }
      }
    });
    if (listChapters === undefined) throw new Error("Expected list_chapters descriptor.");

    const validate = (arguments_: Record<string, unknown>) =>
      engineExports.validateAgentToolArguments({
        descriptor: listChapters,
        arguments: arguments_ as JsonObject,
        argumentsText: JSON.stringify(arguments_)
      }).ok;
    expect(validate({ statuses: ["draft", "deleted"], cursor: "cursor_01", limit: 25 })).toBe(true);
    expect(validate({ includeDeleted: true })).toBe(true);
    expect(validate({ statuses: ["unknown"] })).toBe(false);
    expect(validate({ limit: 0 })).toBe(false);
    expect(validate({ includeDeleted: "yes" })).toBe(false);
    expect(validate({ unexpected: true })).toBe(false);

    expect(
      engineExports
        .listAgentTools({
          ...baseInput,
          catalogSchemaVersion: "2.0",
          contextMode: "general_file"
        })
        .map((tool) => tool.name)
    ).not.toContain("list_chapters");
    expect(
      engineExports
        .listAgentTools({ ...baseInput, catalogSchemaVersion: "1.0" })
        .map((tool) => tool.name)
    ).not.toContain("list_chapters");
  });

  test("publishes only B7 engineering replace/create with opaque app-owned refs", () => {
    const catalog = engineExports.listAgentTools({
      facadeVersion: "v2",
      catalogSchemaVersion: "2.0",
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation",
      capabilitySnapshot: {
        workspaceKind: "engineeringWorkspace",
        searchEnabled: true,
        fileLifecycleEnabled: true,
        writingOperations: [],
        // A compromised caller may try to smuggle Batch 8 operations into the snapshot. The
        // Engineering catalog itself remains a second, fail-closed boundary for Batch 7.
        workspaceFileOperations: [
          "replace_file",
          "create_file",
          "move_file",
          "delete_file",
          "create_directory"
        ],
        controlledExecutionEnabled: false,
        gitReadEnabled: false,
        networkReadEnabled: false,
        pluginToolsEnabled: false,
        mcpToolsEnabled: false,
        featureFlagRevision: "engineering-b7-contract"
      }
    });
    const proposalNames = catalog
      .filter((tool) => tool.effect === "propose")
      .map((tool) => tool.name);
    expect(proposalNames).toEqual(["propose_file_write", "propose_file_create"]);
    expect(proposalNames).not.toEqual(
      expect.arrayContaining([
        "propose_file_move",
        "propose_file_delete",
        "propose_directory_create"
      ])
    );

    const replace = catalog.find((tool) => tool.name === "propose_file_write");
    const create = catalog.find((tool) => tool.name === "propose_file_create");
    if (replace === undefined || create === undefined) {
      throw new Error("Expected B7 engineering proposal descriptors.");
    }
    const valid = (descriptor: typeof replace, arguments_: Record<string, unknown>): boolean =>
      engineExports.validateAgentToolArguments({
        descriptor,
        arguments: arguments_ as JsonObject,
        argumentsText: JSON.stringify(arguments_)
      }).ok;
    const fileRef = `engineering_file_ref:${"a".repeat(32)}`;
    const parentRef = `engineering_directory_ref:${"b".repeat(32)}`;

    expect(
      valid(replace, {
        fileRef,
        range: { unit: "character", start: 0, end: 3 },
        replacement: "new"
      })
    ).toBe(true);
    expect(
      valid(replace, {
        fileRef,
        baseHash: "c".repeat(64),
        range: { unit: "character", start: 0, end: 3 },
        replacement: "new"
      })
    ).toBe(false);
    expect(
      valid(replace, {
        path: "src/main.ts",
        range: { unit: "character", start: 0, end: 3 },
        replacement: "new"
      })
    ).toBe(false);
    expect(valid(create, { parentRef, name: "new.ts", candidate: "export {};\n" })).toBe(true);
    for (const forbidden of [
      "absolutePath",
      "root",
      "cwd",
      "glob",
      "recursive",
      "force",
      "overwrite",
      "token",
      "journal",
      "quarantine",
      "shell",
      "git"
    ]) {
      expect(
        valid(create, {
          parentRef,
          name: "new.ts",
          candidate: "export {};\n",
          [forbidden]: true
        })
      ).toBe(false);
    }
    expect(valid(create, { parentRef, name: "../new.ts", candidate: "x" })).toBe(false);
    expect(valid(create, { parentRef, name: "nested/new.ts", candidate: "x" })).toBe(false);
  });
});
