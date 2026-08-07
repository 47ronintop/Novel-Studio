import { describe, expect, test } from "vitest";
import {
  createDefaultCapabilitySnapshot,
  type AgentToolCapabilitySnapshot
} from "../src/agent-tool-capabilities.js";
import { listAgentTools } from "../src/tool-registry.js";

describe("AgentToolCapabilitySnapshot", () => {
  test("createDefaultCapabilitySnapshot produces a v1.0-compatible all-off snapshot", () => {
    const snap = createDefaultCapabilitySnapshot();
    expect(snap.workspaceKind).toBe("creativeProject");
    expect(snap.searchEnabled).toBe(false);
    expect(snap.fileLifecycleEnabled).toBe(false);
    expect(snap.storyBibleStructuredToolsEnabled).toBe(false);
    expect(snap.controlledExecutionEnabled).toBe(false);
    expect(snap.gitReadEnabled).toBe(false);
    expect(snap.networkReadEnabled).toBe(false);
    expect(snap.pluginToolsEnabled).toBe(false);
    expect(snap.mcpToolsEnabled).toBe(false);
    expect(snap.featureFlagRevision).toBe("v1.0-default");
  });

  test("createDefaultCapabilitySnapshot with workspaceKind override", () => {
    const snap = createDefaultCapabilitySnapshot("engineeringWorkspace");
    expect(snap.workspaceKind).toBe("engineeringWorkspace");
  });

  test("snapshot is frozen (immutable)", () => {
    const snap = createDefaultCapabilitySnapshot();
    expect(() => {
      (snap as unknown as Record<string, unknown>)["searchEnabled"] = true;
    }).toThrow();
  });

  test("listAgentTools without capabilitySnapshot preserves v1.0 matrices", () => {
    const names = (operationMode: string, contextMode: string) =>
      listAgentTools({
        operationMode: operationMode as "planning" | "execution",
        contextMode: contextMode as "writing" | "general_file",
        writePolicy: "write_before_confirmation"
      }).map((t) => t.name);

    expect(names("planning", "writing")).toEqual([
      "list_project_entries",
      "read_chapter",
      "read_story_bible",
      "read_project_text",
      "finish_plan",
      "request_user_input"
    ]);
    expect(names("planning", "general_file")).toEqual([
      "list_project_entries",
      "read_project_text",
      "finish_plan",
      "request_user_input"
    ]);
    expect(names("execution", "writing")).toEqual([
      "list_project_entries",
      "read_chapter",
      "read_story_bible",
      "read_project_text",
      "propose_chapter_write",
      "finish",
      "request_user_input"
    ]);
    expect(names("execution", "general_file")).toEqual([
      "list_project_entries",
      "read_project_text",
      "propose_file_write",
      "finish",
      "request_user_input"
    ]);
  });

  test("listAgentTools with all-off default snapshot produces identical v1.0 matrices", () => {
    const cap = createDefaultCapabilitySnapshot();
    const withSnap = (operationMode: string, contextMode: string) =>
      listAgentTools({
        operationMode: operationMode as "planning" | "execution",
        contextMode: contextMode as "writing" | "general_file",
        writePolicy: "write_before_confirmation",
        capabilitySnapshot: cap
      }).map((t) => t.name);
    const withoutSnap = (operationMode: string, contextMode: string) =>
      listAgentTools({
        operationMode: operationMode as "planning" | "execution",
        contextMode: contextMode as "writing" | "general_file",
        writePolicy: "write_before_confirmation"
      }).map((t) => t.name);

    for (const [op, ctx] of [
      ["planning", "writing"],
      ["planning", "general_file"],
      ["execution", "writing"],
      ["execution", "general_file"]
    ] as const) {
      expect(withSnap(op, ctx)).toEqual(withoutSnap(op, ctx));
    }
  });

  test("listAgentTools with searchEnabled adds search tools to all four mode combos", () => {
    const cap: AgentToolCapabilitySnapshot = {
      ...createDefaultCapabilitySnapshot(),
      searchEnabled: true,
      featureFlagRevision: "phase-a-test"
    };
    for (const [op, ctx] of [
      ["planning", "writing"],
      ["planning", "general_file"],
      ["execution", "writing"],
      ["execution", "general_file"]
    ] as const) {
      const names = listAgentTools({
        operationMode: op,
        contextMode: ctx,
        writePolicy: "write_before_confirmation",
        capabilitySnapshot: cap
      }).map((t) => t.name);
      expect(names).toContain("search_project_text");
      expect(names).toContain("find_project_references");
    }
  });

  test("exposes structured Story Bible reads in planning and writes only in writing execution", () => {
    const cap: AgentToolCapabilitySnapshot = {
      ...createDefaultCapabilitySnapshot(),
      storyBibleStructuredToolsEnabled: true,
      writingOperations: [
        "story_bible_create",
        "story_bible_patch",
        "story_bible_status",
        "story_bible_restore"
      ],
      featureFlagRevision: "story-bible-v1.1-test"
    };
    const names = (
      operationMode: "planning" | "execution",
      contextMode: "writing" | "general_file"
    ) =>
      listAgentTools({
        facadeVersion: "v2",
        catalogSchemaVersion: "2.0",
        operationMode,
        contextMode,
        writePolicy: "write_before_confirmation",
        capabilitySnapshot: cap
      }).map((tool) => tool.name);

    expect(names("planning", "writing")).toEqual(
      expect.arrayContaining([
        "describe_story_bible_type",
        "list_story_bible",
        "read_story_bible",
        "get_story_bible_references"
      ])
    );
    expect(names("planning", "writing")).not.toContain("patch_story_bible");
    expect(names("execution", "writing")).toEqual(
      expect.arrayContaining([
        "create_story_bible",
        "patch_story_bible",
        "set_story_bible_status",
        "restore_story_bible"
      ])
    );
    expect(names("execution", "general_file")).not.toContain("read_story_bible");
    expect(names("execution", "general_file")).not.toContain("patch_story_bible");
  });

  test("new descriptor fields are populated for core tools", () => {
    const tools = listAgentTools({
      operationMode: "execution",
      contextMode: "general_file",
      writePolicy: "write_before_confirmation"
    });
    const fileWrite = tools.find((t) => t.name === "propose_file_write");
    expect(fileWrite).toBeDefined();
    expect(fileWrite?.id).toBe("propose_file_write");
    expect(fileWrite?.providerName).toBe("propose_file_write");
    expect(typeof fileWrite?.displayName).toBe("string");
    expect(typeof fileWrite?.description).toBe("string");
    expect(fileWrite?.kind).toBe("file_tool");
    expect(fileWrite?.effect).toBe("propose");
    expect(fileWrite?.dataEgress).toBe("none");
    expect(fileWrite?.destructive).toBe(false);
    expect(fileWrite?.retrySemantics).toBe("safe");
    expect(fileWrite?.source).toEqual({ kind: "core", id: "propose_file_write" });
  });
});
