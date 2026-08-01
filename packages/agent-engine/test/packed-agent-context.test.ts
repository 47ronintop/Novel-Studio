import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  createPackedAgentContext,
  createPackedAgentContextManifest,
  rebuildPackedAgentContextFromManifest,
  validatePackedAgentContextManifest,
  type PackedAgentContextManifestV10,
  type PackedAgentContextManifestV11
} from "../src/index.js";

describe("Packed Agent Context history", () => {
  test("rebuilds a complete manifest from frozen source and block material", () => {
    const packed = packedContext();
    const manifest = createPackedAgentContextManifest(packed);

    expect(manifest).toMatchObject({
      schemaVersion: "1.2",
      scope: packed.scope,
      contextProfileId: "writing",
      sources: packed.sources,
      excludedSources: ["story:excluded"],
      createdAt: "2026-07-31T00:00:00.000Z"
    });
    expect(manifest.manifestChecksum).toHaveLength(64);
    expect(validatePackedAgentContextManifest(manifest)).toBe(true);

    const rebuilt = rebuildPackedAgentContextFromManifest({
      manifest,
      sources: [
        {
          refId: "chapter:active",
          sourceKind: "editor_buffer",
          sourceRevision: 7,
          sourceContent: "chapter source",
          blockContent: "wrapped chapter source"
        }
      ]
    });

    expect(rebuilt).toEqual({ status: "available", packedContext: packed });
  });

  test("reports old manifests as explicitly unavailable", () => {
    const current = createPackedAgentContextManifest(packedContext());
    const legacy: PackedAgentContextManifestV10 = {
      schemaVersion: "1.0",
      packedContextId: current.packedContextId,
      payloadChecksum: current.payloadChecksum,
      blocks: current.blocks,
      tokenStats: current.tokenStats
    };

    expect(validatePackedAgentContextManifest(legacy)).toBe(true);
    expect(rebuildPackedAgentContextFromManifest({ manifest: legacy, sources: [] })).toEqual({
      status: "unavailable",
      reason: "legacy_manifest"
    });
    const v11: PackedAgentContextManifestV11 = {
      schemaVersion: "1.1",
      packedContextId: current.packedContextId,
      payloadChecksum: current.payloadChecksum,
      scope: current.scope,
      contextProfileId: current.contextProfileId,
      blocks: current.blocks,
      sources: current.sources,
      excludedSources: current.excludedSources,
      tokenStats: current.tokenStats,
      createdAt: current.createdAt
    };
    expect(rebuildPackedAgentContextFromManifest({ manifest: v11, sources: [] })).toEqual({
      status: "unavailable",
      reason: "legacy_manifest"
    });
  });

  test("distinguishes missing history from stale source and block checksums", () => {
    const manifest = createPackedAgentContextManifest(packedContext());

    expect(rebuildPackedAgentContextFromManifest({ manifest, sources: [] })).toEqual({
      status: "unavailable",
      reason: "source_material_missing"
    });
    expect(
      rebuildPackedAgentContextFromManifest({
        manifest,
        sources: [
          {
            refId: "chapter:active",
            sourceKind: "editor_buffer",
            sourceRevision: 7,
            sourceContent: "changed source",
            blockContent: "wrapped chapter source"
          }
        ]
      })
    ).toEqual({ status: "stale", reason: "source_manifest_mismatch" });
    expect(
      rebuildPackedAgentContextFromManifest({
        manifest,
        sources: [
          {
            refId: "chapter:active",
            sourceKind: "editor_buffer",
            sourceRevision: 7,
            sourceContent: "chapter source",
            blockContent: "changed wrapped source"
          }
        ]
      })
    ).toEqual({ status: "stale", reason: "block_content_mismatch" });
  });

  test("rejects non-canonical block/source/exclusion relationships", () => {
    const manifest = createPackedAgentContextManifest(packedContext());

    expect(
      validatePackedAgentContextManifest({
        ...manifest,
        blocks: manifest.blocks.map((block) => ({ ...block, order: 1 }))
      })
    ).toBe(false);
    expect(
      validatePackedAgentContextManifest({
        ...manifest,
        sources: manifest.sources.map((source) =>
          source.state === "active" ? { ...source, tokenCount: source.tokenCount + 1 } : source
        )
      })
    ).toBe(false);
    expect(validatePackedAgentContextManifest({ ...manifest, excludedSources: [] })).toBe(false);
  });

  test("makes coordinated audit-metadata tampering stale without changing payload identity", () => {
    const manifest = createPackedAgentContextManifest(packedContext());
    const tampered = {
      ...manifest,
      sources: manifest.sources.map((source) =>
        source.state === "active"
          ? {
              ...source,
              tokenCount: source.tokenCount + 1,
              truncationRange: {
                unit: "unicode_code_point" as const,
                start: 0,
                end: 1,
                originalEnd: 1
              }
            }
          : { ...source, selectionReason: "Changed exclusion selection" }
      ),
      blocks: manifest.blocks.map((block) => ({
        ...block,
        tokenCount: block.tokenCount + 1,
        truncationRange: {
          unit: "unicode_code_point" as const,
          start: 0,
          end: 1,
          originalEnd: 1
        }
      }))
    };

    expect(tampered.payloadChecksum).toBe(manifest.payloadChecksum);
    expect(
      rebuildPackedAgentContextFromManifest({
        manifest: tampered,
        sources: [
          {
            refId: "chapter:active",
            sourceKind: "editor_buffer",
            sourceRevision: 7,
            sourceContent: "chapter source",
            blockContent: "wrapped chapter source"
          }
        ]
      })
    ).toMatchObject({ status: "stale" });
  });

  test("treats extra frozen source evidence as stale", () => {
    const manifest = createPackedAgentContextManifest(packedContext());

    expect(
      rebuildPackedAgentContextFromManifest({
        manifest,
        sources: [
          {
            refId: "chapter:active",
            sourceKind: "editor_buffer",
            sourceRevision: 7,
            sourceContent: "chapter source",
            blockContent: "wrapped chapter source"
          },
          {
            refId: "file:unexpected",
            sourceKind: "disk_file",
            sourceRevision: 1,
            sourceContent: "unexpected",
            blockContent: "unexpected"
          }
        ]
      })
    ).toEqual({ status: "stale", reason: "source_manifest_mismatch" });
  });
});

function packedContext() {
  return createPackedAgentContext({
    scope: {
      kind: "workspace",
      workspaceKind: "creativeProject",
      workspaceId: "project_01"
    },
    contextProfileId: "writing",
    blocks: [
      {
        refId: "chapter:active",
        sourceKind: "editor_buffer",
        role: "user",
        content: "wrapped chapter source",
        tokenCount: 6,
        precision: "estimated",
        truncationRange: null
      }
    ],
    sources: [
      {
        refId: "chapter:active",
        sourceKind: "editor_buffer",
        sourceRevision: 7,
        sourceChecksum: checksum("chapter source"),
        tokenCount: 6,
        precision: "estimated",
        state: "active",
        selectionReason: "Current chapter",
        selectionPolicy: "pinned",
        preferenceScope: "run",
        priority: 90,
        truncationRange: null
      },
      {
        refId: "story:excluded",
        sourceKind: "story_bible_asset",
        assetId: "character_hero",
        sourceRevision: 3,
        sourceChecksum: checksum("excluded source"),
        tokenCount: 4,
        precision: "estimated",
        state: "excluded",
        selectionReason: "Project preference",
        selectionPolicy: "automatic",
        preferenceScope: "project",
        priority: 70,
        truncationRange: null
      }
    ],
    tokenStats: {
      contextTokens: 6,
      pinnedTokens: 6,
      usedTokens: 20,
      safeInputBudget: 1_000,
      remainingTokens: 980,
      precision: "estimated"
    },
    createdAt: "2026-07-31T00:00:00.000Z"
  });
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
