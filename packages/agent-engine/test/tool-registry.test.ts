import { describe, expect, test } from "vitest";

import * as engineExports from "../src/index.js";

describe("Agent tool registry", () => {
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

  test("publishes the compact v2 core matrix behind capability gates", () => {
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
      "edit_text",
      "finish",
      "request_user_input"
    ]);
    const fullExecution = names("execution", true, true);
    expect(fullExecution).toEqual([
      "list_project_entries",
      "read_resource",
      "search_project",
      "edit_text",
      "create_resource",
      "manage_path",
      "finish",
      "request_user_input"
    ]);
    expect(fullExecution).toHaveLength(8);

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

  test("publishes strict v2 schemas and validates every discriminated branch", () => {
    const listTools = (engineExports as unknown as Record<string, unknown>)["listAgentTools"] as (
      input: Record<string, unknown>
    ) => readonly {
      readonly name: string;
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
    const range = { unit: "character", start: 0, end: 1 };
    const baseHash = "a".repeat(64);

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

    expect(
      isValid("edit_text", {
        ref: "story_bible:character.hero",
        baseHash,
        range,
        replacement: "Updated"
      })
    ).toBe(true);
    expect(
      isValid("edit_text", {
        ref: "file:notes.md",
        baseHash: "bad",
        range,
        replacement: "Updated"
      })
    ).toBe(false);

    expect(isValid("create_resource", { kind: "chapter", title: "Opening" })).toBe(true);
    expect(
      isValid("create_resource", {
        kind: "story_bible",
        assetType: "character.hero",
        content: "{}"
      })
    ).toBe(true);
    expect(
      isValid("create_resource", { kind: "file", path: "notes/new.md", content: "Draft" })
    ).toBe(true);
    expect(
      isValid("create_resource", { kind: "chapter", title: "Opening", path: "escape.md" })
    ).toBe(false);

    expect(
      isValid("manage_path", {
        operation: "move_file",
        sourceRef: "file:notes/old.md",
        targetPath: "notes/new.md",
        baseHash
      })
    ).toBe(true);
    expect(
      isValid("manage_path", {
        operation: "delete_file",
        ref: "file:notes/old.md",
        baseHash
      })
    ).toBe(true);
    expect(isValid("manage_path", { operation: "create_directory", path: "notes/archive" })).toBe(
      true
    );
    expect(
      isValid("manage_path", {
        operation: "delete_file",
        ref: "chapter:ch_01",
        baseHash
      })
    ).toBe(false);
    expect(descriptor("manage_path").destructive).toBe(true);
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
});
