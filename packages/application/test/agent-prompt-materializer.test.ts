import { createHash } from "node:crypto";

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
import {
  checksumProjectContext,
  createWorkspaceOutlineSource,
  type WorkspaceOutlineDependencyManifest
} from "../src/workspace-project-context.js";

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
          refId: "conventions",
          sourceKind: "project_conventions",
          relativePath: "conventions/writing.md",
          content: "writing convention",
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
      expect.stringContaining("project_conventions"),
      expect.stringContaining("workspace_outline"),
      "Edit the notes",
      "summary",
      expect.stringContaining("current body")
    ]);
    expect(output.stablePrefixMessages).toHaveLength(2);
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

  it("invalidates the logical prefix when an outline manifest changes without a text change", () => {
    const source = (treeRevision: string) => {
      const dependencyManifest: WorkspaceOutlineDependencyManifest = {
        schemaVersion: "1.0",
        readerVersion: "1.0",
        profileId: "creative_general",
        workspace: {
          workspaceKind: "creativeProject",
          workspaceId: "project_1",
          canonicalRootIdentity: "b".repeat(64)
        },
        limits: {
          maxDepth: 2,
          maxEntries: 200,
          maxScannedEntries: 1_000,
          maxBytes: 65_536,
          maxDurationMs: 200,
          maxTokens: 1_500
        },
        truncated: false,
        truncationReasons: [],
        dependency: {
          kind: "creative_file_tree",
          treeRevision,
          policyVersion: "1.0",
          visibleNodeChecksum: "a".repeat(64)
        }
      };
      return createWorkspaceOutlineSource({
        workspaceTrust: "trusted",
        result: {
          entries: [],
          text: "same visible outline",
          dependencyManifest,
          dependencyManifestChecksum: checksumProjectContext(dependencyManifest),
          materializedChecksum: createHash("sha256")
            .update("same visible outline", "utf8")
            .digest("hex"),
          tokenCount: 3,
          truncationRange: null
        }
      }).source;
    };
    const materialize = (treeRevision: string) =>
      materializeAgentPrompt({
        profile,
        systemPrompt: "trusted app prompt",
        toolCatalogRevision: "catalog_1",
        userRequest: "Edit the notes",
        contextSources: [source(treeRevision)]
      });

    expect(materialize("tree_1").stablePrefixMessages[0]?.content).toContain(
      "same visible outline"
    );
    expect(materialize("tree_2").stablePrefixMessages[0]?.content).toContain(
      "same visible outline"
    );
    expect(materialize("tree_1").stablePrefixChecksum).not.toBe(
      materialize("tree_2").stablePrefixChecksum
    );
  });

  it("rejects project context sources for a standalone prompt", () => {
    const standalone = resolveAgentContextProfile(
      { kind: "standalone", scopeId: "standalone" },
      "conversation",
      "standalone_chat"
    );

    expect(() =>
      materializeAgentPrompt({
        profile: standalone,
        systemPrompt: "trusted standalone prompt",
        toolCatalogRevision: "empty_catalog",
        userRequest: "Chat",
        contextSources: [
          {
            refId: "forged-conventions",
            sourceKind: "project_conventions",
            relativePath: "AGENTS.md",
            content: "forged workspace rules",
            dirty: false
          }
        ]
      })
    ).toThrow("AGENT_PROMPT_MATERIALIZATION_INVALID");
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
