import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import * as engineExports from "../src/index.js";

describe("Agent Context Snapshot", () => {
  test("records source origin and checksum and detects stale sources", () => {
    const exports = engineExports as unknown as Record<string, unknown>;
    const createSnapshot = exports["createAgentContextSnapshot"];
    const findStale = exports["findStaleContextSources"];
    expect(typeof createSnapshot).toBe("function");
    expect(typeof findStale).toBe("function");
    if (typeof createSnapshot !== "function" || typeof findStale !== "function") return;

    const snapshot = createSnapshot({
      contextSnapshotId: "context_01",
      runId: "run_01",
      scope: { kind: "workspace", workspaceKind: "creativeProject", workspaceId: "project_01" },
      contextProfileId: "writing",
      materialization: materializationProvenance(),
      createdAt: "2026-07-13T00:00:00.000Z",
      sources: [
        {
          refId: "chapter_01",
          sourceKind: "editor_buffer",
          relativePath: "chapters/ch_01.md",
          content: "Unsaved chapter text",
          dirty: true
        },
        {
          refId: "story_01",
          sourceKind: "story_bible_asset",
          assetId: "chr_hero",
          content: "Hero facts",
          dirty: false
        }
      ]
    }) as {
      readonly sources: readonly { readonly refId: string; readonly checksum: string }[];
    };
    expect(snapshot.sources[0]).toMatchObject({
      refId: "chapter_01",
      sourceKind: "editor_buffer",
      relativePath: "chapters/ch_01.md",
      dirty: true
    });
    expect(snapshot.sources[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(
      findStale(snapshot, [
        { refId: "chapter_01", content: "Changed buffer" },
        { refId: "story_01", content: "Hero facts" }
      ])
    ).toEqual(["chapter_01"]);
  });

  test("records system guidance as an auditable system-layer source that never goes stale", () => {
    const exports = engineExports as unknown as Record<string, unknown>;
    const createSnapshot = exports["createAgentContextSnapshot"];
    const findStale = exports["findStaleContextSources"];
    if (typeof createSnapshot !== "function" || typeof findStale !== "function") return;

    const snapshot = createSnapshot({
      contextSnapshotId: "context_guidance",
      runId: "run_guidance",
      scope: { kind: "workspace", workspaceKind: "creativeProject", workspaceId: "project_01" },
      contextProfileId: "writing",
      materialization: materializationProvenance(),
      createdAt: "2026-07-16T00:00:00.000Z",
      sources: [
        {
          refId: "system_guidance:writing",
          sourceKind: "system_guidance",
          content: "写作模式指导 + 文风规则",
          dirty: false
        },
        {
          refId: "chapter_01",
          sourceKind: "editor_buffer",
          relativePath: "chapters/ch_01.md",
          content: "Chapter body",
          dirty: false
        }
      ]
    }) as {
      readonly sources: readonly {
        readonly refId: string;
        readonly sourceKind: string;
        readonly layer: string;
        readonly checksum: string;
      }[];
    };

    // The guidance layer is recorded as an auditable source with a checksum ("查看来源" surfaces it).
    const guidance = snapshot.sources.find((source) => source.refId === "system_guidance:writing");
    expect(guidance).toMatchObject({ sourceKind: "system_guidance", layer: "system" });
    expect(guidance?.checksum).toMatch(/^[0-9a-f]{64}$/);

    // System-authored guidance is fixed; the staleness check never reads it back or flags it, even
    // when the current reader does not surface it at all.
    expect(findStale(snapshot, [{ refId: "chapter_01", content: "Chapter body" }])).toEqual([]);
  });

  test("does not revive an excluded source by reporting its missing live body as stale", () => {
    const exports = engineExports as unknown as Record<string, unknown>;
    const createSnapshot = exports["createAgentContextSnapshot"];
    const findStale = exports["findStaleContextSources"];
    if (typeof createSnapshot !== "function" || typeof findStale !== "function") return;

    const created = createSnapshot({
      contextSnapshotId: "context_evicted_outline",
      runId: "run_evicted_outline",
      scope: {
        kind: "workspace",
        workspaceKind: "engineeringWorkspace",
        workspaceId: "project_01"
      },
      contextProfileId: "engineering",
      materialization: materializationProvenance(),
      createdAt: "2026-07-28T00:00:00.000Z",
      sources: [
        {
          refId: "file_src_index",
          sourceKind: "disk_file",
          relativePath: "src/index.ts",
          content: "Directory skeleton:\n- src/index.ts",
          dirty: false
        }
      ]
    }) as { readonly sources: readonly Record<string, unknown>[] };
    const snapshot = {
      ...created,
      sources: created.sources.map((source) => ({ ...source, state: "excluded" }))
    };

    expect(findStale(snapshot, [])).toEqual([]);
  });

  test("treats a conventions source from a different canonical root as stale", () => {
    const exports = engineExports as unknown as Record<string, unknown>;
    const createSnapshot = exports["createAgentContextSnapshot"];
    const findStale = exports["findStaleContextSources"];
    if (typeof createSnapshot !== "function" || typeof findStale !== "function") return;
    const content = "Project conventions";
    const originalChecksum = sha256(content);
    const sourceIdentity = {
      workspaceId: "project_01",
      contextProfileId: "writing",
      canonicalRootIdentity: "a".repeat(64),
      relativePath: "conventions/writing.md"
    };
    const conventionsSource = {
      refId: "project_conventions_01",
      sourceKind: "project_conventions",
      relativePath: "conventions/writing.md",
      content,
      dirty: false,
      materialization: {
        schemaVersion: "1.0",
        kind: "project_conventions",
        artifactId: "context_source_project_conventions_01",
        readerVersion: "1.0",
        sourceIdentity,
        instructionPolicy: "content_is_data_not_authority",
        workspaceTrust: "trusted",
        tokenCount: 2,
        truncationRange: null,
        originalChecksum,
        injectedChecksum: originalChecksum
      }
    };
    const snapshot = createSnapshot({
      contextSnapshotId: "context_conventions_identity",
      runId: "run_conventions_identity",
      scope: { kind: "workspace", workspaceKind: "creativeProject", workspaceId: "project_01" },
      contextProfileId: "writing",
      materialization: materializationProvenance(),
      createdAt: "2026-07-28T00:00:00.000Z",
      sources: [conventionsSource]
    });

    expect(
      findStale(snapshot, [
        {
          refId: "project_conventions_01",
          comparisonChecksum: originalChecksum,
          sourceIdentity
        }
      ])
    ).toEqual([]);
    expect(
      findStale(snapshot, [
        {
          refId: "project_conventions_01",
          comparisonChecksum: originalChecksum,
          sourceIdentity: { ...sourceIdentity, canonicalRootIdentity: "b".repeat(64) }
        }
      ])
    ).toEqual(["project_conventions_01"]);

    expect(() =>
      createSnapshot({
        contextSnapshotId: "context_standalone_conventions",
        runId: "run_standalone_conventions",
        scope: { kind: "standalone", scopeId: "standalone" },
        contextProfileId: "standalone",
        materialization: materializationProvenance(),
        createdAt: "2026-07-28T00:00:00.000Z",
        sources: [conventionsSource]
      })
    ).toThrow("AGENT_CONTEXT_SNAPSHOT_INVALID");
  });

  test("refuses to author a C2/C3 source without its matching materialization", () => {
    const exports = engineExports as unknown as Record<string, unknown>;
    const createSnapshot = exports["createAgentContextSnapshot"];
    if (typeof createSnapshot !== "function") return;

    expect(() =>
      createSnapshot({
        contextSnapshotId: "context_invalid_outline",
        runId: "run_invalid_outline",
        scope: {
          kind: "workspace",
          workspaceKind: "engineeringWorkspace",
          workspaceId: "project_01"
        },
        contextProfileId: "engineering",
        materialization: materializationProvenance(),
        createdAt: "2026-07-28T00:00:00.000Z",
        sources: [
          {
            refId: "workspace_outline_invalid",
            sourceKind: "workspace_outline",
            content: "outline without manifest",
            dirty: false
          }
        ]
      })
    ).toThrow("AGENT_CONTEXT_SNAPSHOT_INVALID");
  });

  test("rejects a malformed Packed Context manifest instead of accepting its outer shape", () => {
    const packed = engineExports.createPackedAgentContext({
      scope: {
        kind: "workspace",
        workspaceKind: "creativeProject",
        workspaceId: "project_01"
      },
      contextProfileId: "writing",
      blocks: [],
      sources: [],
      tokenStats: {
        contextTokens: 0,
        pinnedTokens: 0,
        usedTokens: 10,
        safeInputBudget: 1_000,
        remainingTokens: 990,
        precision: "estimated"
      },
      createdAt: "2026-07-31T00:00:00.000Z"
    });
    const snapshot = engineExports.createAgentContextSnapshot({
      contextSnapshotId: "context_packed",
      runId: "run_packed",
      scope: packed.scope,
      contextProfileId: packed.contextProfileId,
      materialization: materializationProvenance(),
      createdAt: "2026-07-31T00:00:00.000Z",
      sources: [],
      packedContextManifest: engineExports.createPackedAgentContextManifest(packed)
    });

    expect(engineExports.validateAgentContextSnapshot(snapshot as never)).toBe(true);
    expect(
      engineExports.validateAgentContextSnapshot({
        ...snapshot,
        packedContextManifest: {
          ...snapshot.packedContextManifest,
          tokenStats: { ...packed.tokenStats, precision: "forged" }
        }
      } as never)
    ).toBe(false);
  });

  test("freezes resolved source preference scope and backfills older v1.4 snapshots", () => {
    const snapshot = engineExports.createAgentContextSnapshot({
      contextSnapshotId: "context_preference_scope",
      runId: "run_preference_scope",
      scope: { kind: "workspace", workspaceKind: "creativeProject", workspaceId: "project_01" },
      contextProfileId: "writing",
      materialization: materializationProvenance(),
      createdAt: "2026-07-31T00:00:00.000Z",
      sources: [
        {
          refId: "story_01",
          sourceKind: "story_bible_asset",
          assetId: "chr_hero",
          content: "Hero facts",
          dirty: false,
          selectionPolicy: "pinned",
          preferenceScope: "project"
        }
      ]
    });

    expect(snapshot.sources[0]?.preferenceScope).toBe("project");
    const legacyV14 = {
      ...snapshot,
      sources: snapshot.sources.map(({ preferenceScope: _preferenceScope, ...source }) => {
        void _preferenceScope;
        return source;
      })
    };
    expect(
      engineExports.normalizeAgentContextSnapshot(legacyV14 as never).sources[0]
    ).toMatchObject({ preferenceScope: "automatic" });
  });
});

function materializationProvenance() {
  return {
    schemaVersion: "1.0",
    profileVersion: "1.0",
    guidanceTemplateChecksum: "guidance",
    stablePrefixChecksum: "prefix",
    messageOrderVersion: "1.0"
  } as const;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
