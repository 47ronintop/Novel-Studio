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
