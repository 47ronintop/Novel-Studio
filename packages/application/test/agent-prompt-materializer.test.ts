import { describe, expect, it } from "vitest";
import type { JsonObject } from "@novel-studio/shared";

import {
  resolveAgentContextProfile,
  type AgentContextProfile
} from "../src/agent-context-profile.js";
import {
  createAgentPromptMaterializationArtifact,
  materializeAgentPrompt,
  parseAgentPromptMaterializationArtifact,
  rematerializeAgentPromptArtifact
} from "../src/agent-prompt-materializer.js";

const profile = resolveAgentContextProfile(
  { kind: "workspace", workspaceKind: "creativeProject", workspaceId: "project_1" },
  "execution",
  "general_file"
);

describe("Agent prompt materializer", () => {
  it("places stable project data before the request and current file in the dynamic suffix", () => {
    const output = materializeAgentPrompt({
      profile,
      systemPrompt: "trusted app prompt",
      toolCatalogRevision: "catalog_1",
      userRequest: "Edit the notes",
      conversationSummaryMessages: [{ role: "user", content: "summary" }],
      contextSources: [
        {
          refId: "outline",
          sourceKind: "workspace_outline",
          content: "notes.md",
          dirty: false
        },
        {
          refId: "current-file",
          sourceKind: "disk_file",
          relativePath: "notes.md",
          content: "current body",
          dirty: false
        }
      ]
    });

    expect(output.messages.map((message) => message.content)).toEqual([
      expect.stringContaining("workspace_outline"),
      "Edit the notes",
      "summary",
      expect.stringContaining("current body")
    ]);
    expect(output.stablePrefixMessages).toHaveLength(1);
    expect(output.dynamicSuffixMessages[0]?.content).toBe("Edit the notes");
  });

  it("does not invalidate the stable prefix for a request or current-file body change", () => {
    const create = (userRequest: string, body: string) =>
      materializeAgentPrompt({
        profile,
        systemPrompt: "trusted app prompt",
        toolCatalogRevision: "catalog_1",
        userRequest,
        contextSources: [
          {
            refId: "outline",
            sourceKind: "workspace_outline",
            content: "notes.md",
            dirty: false
          },
          {
            refId: "current-file",
            sourceKind: "disk_file",
            relativePath: "notes.md",
            content: body,
            dirty: false
          }
        ]
      });

    expect(create("first", "body one").stablePrefixChecksum).toBe(
      create("second", "body two").stablePrefixChecksum
    );
  });

  it("round-trips a frozen prompt artifact and rematerializes sources without retaining old bodies", () => {
    const artifact = createAgentPromptMaterializationArtifact({
      runId: "run_1",
      contextSnapshotId: "context_1",
      profile,
      systemPrompt: "trusted app prompt",
      toolCatalogRevision: "catalog_1",
      userRequest: "Edit the notes",
      contextSources: [
        {
          refId: "current-file",
          sourceKind: "disk_file",
          relativePath: "notes.md",
          content: "old body",
          dirty: false
        }
      ]
    });

    expect(
      parseAgentPromptMaterializationArtifact(structuredClone(artifact) as unknown as JsonObject)
    ).toEqual(artifact);

    const refreshed = rematerializeAgentPromptArtifact(artifact, {
      contextSnapshotId: "context_2",
      contextSources: [
        {
          refId: "current-file",
          sourceKind: "disk_file",
          relativePath: "notes.md",
          content: "new body",
          dirty: false
        }
      ]
    });
    expect(JSON.stringify(refreshed.messages)).toContain("new body");
    expect(JSON.stringify(refreshed.messages)).not.toContain("old body");
    expect(refreshed.stablePrefixChecksum).toBe(artifact.stablePrefixChecksum);
  });

  it("replays a frozen artifact after profile and guidance versions advance", () => {
    const historicalProfile = {
      ...profile,
      profileVersion: "99.0"
    } as unknown as AgentContextProfile;
    const artifact = createAgentPromptMaterializationArtifact({
      runId: "run_1",
      contextSnapshotId: "context_1",
      profile: historicalProfile,
      systemPrompt: "Historical app-authored guidance",
      toolCatalogRevision: "catalog_1",
      userRequest: "Edit the notes",
      systemGuidanceRefId: "system_guidance:creative_general@99.0"
    });

    expect(artifact.profileVersion).toBe("99.0");
    expect(artifact.guidanceTemplateChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(
      parseAgentPromptMaterializationArtifact(structuredClone(artifact) as unknown as JsonObject)
    ).toEqual(artifact);
  });

  it("fails closed for unknown or tampered artifact versions", () => {
    const artifact = createAgentPromptMaterializationArtifact({
      runId: "run_1",
      contextSnapshotId: "context_1",
      profile,
      systemPrompt: "trusted app prompt",
      toolCatalogRevision: "catalog_1",
      userRequest: "Edit the notes"
    });
    expect(() =>
      parseAgentPromptMaterializationArtifact({
        ...artifact,
        schemaVersion: "9.0"
      } as unknown as JsonObject)
    ).toThrow("AGENT_PROMPT_MATERIALIZATION_VERSION_UNSUPPORTED");
    expect(() =>
      parseAgentPromptMaterializationArtifact({
        ...artifact,
        systemPrompt: "tampered"
      } as unknown as JsonObject)
    ).toThrow("AGENT_PROMPT_MATERIALIZATION_INVALID");
    expect(() =>
      parseAgentPromptMaterializationArtifact({
        ...artifact,
        guidanceTemplateChecksum: "0".repeat(64)
      } as unknown as JsonObject)
    ).toThrow("AGENT_PROMPT_MATERIALIZATION_INVALID");
  });
});
