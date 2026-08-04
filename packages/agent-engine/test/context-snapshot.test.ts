import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import * as engineExports from "../src/index.js";

describe("Agent Context Snapshot", () => {
  test("writes and strictly reads a 2.0 snapshot bound to the packed manifest and provider set", () => {
    const packed = emptyPackedContext();
    const providerSemanticVersionSet = providerVersions("not_applicable");
    const packedManifest = engineExports.createPackedAgentContextManifestV2(packed, {
      roundId: "round_01",
      sharing: { defaultsRevision: "defaults_1", runGrantRevision: "grant_1" },
      providerSemanticVersionSet
    });
    const snapshot = engineExports.createAgentContextSnapshotV2({
      contextSnapshotId: "context_v2",
      runId: "run_v2",
      scope: packed.scope,
      contextProfileId: packed.contextProfileId,
      materialization: materializationProvenanceV2(),
      createdAt: "2026-08-04T00:00:00.000Z",
      sources: [],
      roundId: "round_01",
      sharing: { defaultsRevision: "defaults_1", runGrantRevision: "grant_1" },
      providerSemanticVersionSet,
      packedContextManifest: packedManifest
    });

    expect(snapshot).toMatchObject({
      schemaVersion: "2.0",
      roundId: "round_01",
      materialization: { messageOrderVersion: "2.0" },
      providerSemanticVersionSet: {
        contextSnapshotSchemaVersion: "2.0",
        packedContextManifestSchemaVersion: "2.0",
        canonicalRoundManifestSchemaVersion: "2.0"
      }
    });
    expect(engineExports.parseAgentContextSnapshotV2(snapshot)).toEqual(snapshot);
    expect(engineExports.serializeAgentContextSnapshotV2(snapshot)).toBe(
      engineExports.serializeAgentContextSnapshotV2(
        engineExports.parseAgentContextSnapshotV2(snapshot)
      )
    );
    expect(engineExports.validateAgentContextSnapshot(snapshot as never)).toBe(true);
  });

  test("binds 2.0 packed scope, profile, source order, checksums, and excluded state", () => {
    const packed = packedContextWithSources();
    const providerSemanticVersionSet = providerVersions("1.0");
    const packedManifest = engineExports.createPackedAgentContextManifestV2(packed, {
      roundId: "round_sources",
      sharing: { defaultsRevision: "defaults_2", runGrantRevision: "grant_2" },
      providerSemanticVersionSet
    });
    const [activeSource, excludedSource] = snapshotSourceInputs();
    const common = {
      contextSnapshotId: "context_v2_sources",
      runId: "run_v2_sources",
      scope: packed.scope,
      contextProfileId: packed.contextProfileId,
      materialization: materializationProvenanceV2(),
      createdAt: "2026-08-04T00:00:00.000Z",
      sources: [activeSource, excludedSource],
      excludedSources: ["chapter_excluded"],
      roundId: "round_sources",
      sharing: { defaultsRevision: "defaults_2", runGrantRevision: "grant_2" },
      providerSemanticVersionSet,
      packedContextManifest: packedManifest
    } as const;

    const snapshot = engineExports.createAgentContextSnapshotV2(common);
    expect(snapshot.sources.map((source) => [source.refId, source.state])).toEqual([
      ["chapter_active", "active"],
      ["chapter_excluded", "excluded"]
    ]);
    expect(() =>
      engineExports.createAgentContextSnapshotV2({
        ...common,
        scope: {
          kind: "workspace",
          workspaceKind: "creativeProject",
          workspaceId: "project_other"
        }
      })
    ).toThrow("AGENT_CONTEXT_SNAPSHOT_INVALID");
    expect(() =>
      engineExports.createAgentContextSnapshotV2({
        ...common,
        sources: [{ ...activeSource, content: "Changed active chapter" }, excludedSource]
      })
    ).toThrow("AGENT_CONTEXT_SNAPSHOT_INVALID");
    expect(() =>
      engineExports.createAgentContextSnapshotV2({ ...common, excludedSources: [] })
    ).toThrow("AGENT_CONTEXT_SNAPSHOT_INVALID");
    expect(() =>
      engineExports.createAgentContextSnapshotV2({
        ...common,
        sources: [...snapshotSourceInputs()].reverse()
      })
    ).toThrow("AGENT_CONTEXT_SNAPSHOT_INVALID");
  });

  test("keeps legacy reading separate and rejects 2.0 unknown fields or binding mismatch", () => {
    const snapshot = engineExports.createAgentContextSnapshotV2({
      contextSnapshotId: "context_v2_strict",
      runId: "run_v2_strict",
      scope: { kind: "standalone", scopeId: "standalone" },
      contextProfileId: "standalone",
      materialization: materializationProvenanceV2(),
      createdAt: "2026-08-04T00:00:00.000Z",
      sources: [],
      roundId: "round_01",
      sharing: { defaultsRevision: "not_applicable", runGrantRevision: "not_applicable" },
      providerSemanticVersionSet: providerVersions("not_applicable")
    });
    expect(() =>
      engineExports.parseAgentContextSnapshotV2({ ...snapshot, schemaVersion: "9.0" })
    ).toThrow("AGENT_CONTEXT_SNAPSHOT_INVALID");
    expect(() => engineExports.parseAgentContextSnapshotV2({ ...snapshot, extra: true })).toThrow(
      "AGENT_CONTEXT_SNAPSHOT_INVALID"
    );
    expect(() =>
      engineExports.parseAgentContextSnapshotV2({
        ...snapshot,
        providerSemanticVersionSetChecksum: "f".repeat(64)
      })
    ).toThrow("AGENT_CONTEXT_SNAPSHOT_INVALID");
    expect(() => engineExports.normalizeAgentContextSnapshot(snapshot as never)).toThrow(
      "AGENT_CONTEXT_SNAPSHOT_VERSION_UNSUPPORTED"
    );

    const packed = emptyPackedContext();
    const packedV2 = engineExports.createPackedAgentContextManifestV2(packed, {
      roundId: "round_legacy_reject",
      sharing: { defaultsRevision: "defaults_1", runGrantRevision: "grant_1" },
      providerSemanticVersionSet: providerVersions("not_applicable")
    });
    const legacy = engineExports.createAgentContextSnapshot({
      contextSnapshotId: "context_legacy",
      runId: "run_legacy",
      scope: packed.scope,
      contextProfileId: packed.contextProfileId,
      materialization: materializationProvenance(),
      createdAt: "2026-08-04T00:00:00.000Z",
      sources: []
    });
    expect(
      engineExports.validateAgentContextSnapshot({
        ...legacy,
        packedContextManifest: packedV2
      } as never)
    ).toBe(false);
  });

  test("changes snapshot identity when the provider semantic version set changes", () => {
    const common = {
      contextSnapshotId: "context_v2_identity",
      runId: "run_v2_identity",
      scope: { kind: "standalone", scopeId: "standalone" } as const,
      contextProfileId: "standalone" as const,
      materialization: materializationProvenanceV2(),
      createdAt: "2026-08-04T00:00:00.000Z",
      sources: [],
      roundId: "round_01",
      sharing: { defaultsRevision: "not_applicable", runGrantRevision: "not_applicable" }
    };
    const first = engineExports.createAgentContextSnapshotV2({
      ...common,
      providerSemanticVersionSet: providerVersions("not_applicable")
    });
    const second = engineExports.createAgentContextSnapshotV2({
      ...common,
      providerSemanticVersionSet: providerVersions("1.0")
    });
    expect(second.providerSemanticVersionSetChecksum).not.toBe(
      first.providerSemanticVersionSetChecksum
    );
    expect(second.snapshotChecksum).not.toBe(first.snapshotChecksum);
  });

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

function materializationProvenanceV2() {
  return {
    schemaVersion: "2.0",
    profileVersion: "2.0",
    guidanceTemplateChecksum: "guidance-v3",
    stablePrefixChecksum: "prefix-v2",
    messageOrderVersion: "2.0"
  } as const;
}

function providerVersions(writingTaskIntentSchemaVersion: "not_applicable" | "1.0") {
  return engineExports.createProviderSemanticVersionSetV1({
    writingTaskIntentSchemaVersion,
    writingGenerationGuidanceVersion: "not_applicable",
    approvalRuleSetVersion: "not_applicable",
    approvalRuleSetChecksum: "not_applicable"
  });
}

function emptyPackedContext() {
  return engineExports.createPackedAgentContext({
    scope: { kind: "workspace", workspaceKind: "creativeProject", workspaceId: "project_01" },
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
    createdAt: "2026-08-04T00:00:00.000Z"
  });
}

function packedContextWithSources() {
  const [active, excluded] = snapshotSourceInputs();
  return engineExports.createPackedAgentContext({
    scope: { kind: "workspace", workspaceKind: "creativeProject", workspaceId: "project_01" },
    contextProfileId: "writing",
    blocks: [
      {
        refId: active.refId,
        sourceKind: active.sourceKind,
        role: "user",
        content: "packed active chapter",
        tokenCount: 5,
        precision: "estimated",
        truncationRange: null
      }
    ],
    sources: [packedSource(active, "active", 5), packedSource(excluded, "excluded", 0)],
    tokenStats: {
      contextTokens: 5,
      pinnedTokens: 0,
      usedTokens: 10,
      safeInputBudget: 1_000,
      remainingTokens: 985,
      precision: "estimated"
    },
    createdAt: "2026-08-04T00:00:00.000Z"
  });
}

function snapshotSourceInputs() {
  return [
    {
      refId: "chapter_active",
      sourceKind: "disk_file",
      relativePath: "chapters/active.md",
      content: "Active chapter",
      dirty: false,
      sourceRevision: 3
    },
    {
      refId: "chapter_excluded",
      sourceKind: "disk_file",
      relativePath: "chapters/excluded.md",
      content: "Excluded chapter",
      dirty: false,
      sourceRevision: 4
    }
  ] as const;
}

function packedSource(
  source: ReturnType<typeof snapshotSourceInputs>[number],
  state: "active" | "excluded",
  tokenCount: number
) {
  return {
    refId: source.refId,
    sourceKind: source.sourceKind,
    relativePath: source.relativePath,
    sourceRevision: source.sourceRevision,
    sourceChecksum: sha256(source.content),
    tokenCount,
    precision: "estimated" as const,
    state,
    selectionReason: "Explicit context reference",
    selectionPolicy: "explicit" as const,
    preferenceScope: "run" as const,
    priority: 70,
    truncationRange: null
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
