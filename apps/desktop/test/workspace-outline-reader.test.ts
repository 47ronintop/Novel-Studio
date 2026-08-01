import { ok, type Result, type UnifiedError } from "@novel-studio/shared";
import { describe, expect, test, vi } from "vitest";

import {
  DEFAULT_CREATIVE_PROJECT_FILE_POLICY,
  WorkspaceOutlineIndexRepository,
  type CreativeProjectFileTreeSnapshot,
  type WorkspaceOutlineGuardedEntryReader,
  type WorkspaceOutlineWritingIndex
} from "../../../packages/repository/src/index.js";
import {
  createDesktopWorkspaceOutlineReader,
  hasWorkspaceOutlineDependencyChanged,
  sameWorkspaceOutlineDependencyManifest
} from "../src/main/workspace-outline-reader.js";

describe("DesktopWorkspaceOutlineReader", () => {
  test("fails closed for a runtime standalone profile and never calls a project index", async () => {
    const listEntries = vi.fn(async () => ok([]));
    const reader = createDesktopWorkspaceOutlineReader({
      engineeringIndex: new WorkspaceOutlineIndexRepository({
        engineeringEntries: { listEntries }
      })
    });

    const result = await reader.read({
      ...readInput("engineering"),
      profileId: "standalone" as never
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_OUTLINE_PROFILE_INVALID" }
    });
    expect(listEntries).not.toHaveBeenCalled();
  });

  test("materializes an engineering directory skeleton from guarded metadata only", async () => {
    const reader = createDesktopWorkspaceOutlineReader({
      engineeringIndex: new WorkspaceOutlineIndexRepository({
        engineeringEntries: guardedEntries({
          "": [entry("package.json", "file"), entry("src", "directory")],
          src: [entry("src/index.ts", "file")]
        })
      })
    });

    const result = await reader.read(readInput("engineering"));

    expect(result).toMatchObject({
      ok: true,
      value: {
        entries: expect.arrayContaining([
          expect.objectContaining({ relativePath: "package.json" }),
          expect.objectContaining({ relativePath: "src/index.ts" })
        ]),
        dependencyManifest: {
          profileId: "engineering",
          dependency: { kind: "engineering_entries" }
        }
      }
    });
    if (!result.ok) return;
    expect(result.value.text).toContain("Directory skeleton:");
    expect(result.value.text).toContain('file "package.json"');
    expect(result.value.text).not.toContain("C:\\");
  });

  test("uses only the C1C creative tree snapshot and does not leak managed paths", async () => {
    const tree = vi.fn(async () => ok(creativeSnapshot()));
    const reader = createDesktopWorkspaceOutlineReader({
      creativeProjectFiles: {
        reattestTreeSnapshot: tree,
        policy: DEFAULT_CREATIVE_PROJECT_FILE_POLICY
      }
    });

    const result = await reader.read(readInput("creative_general"));

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(tree).toHaveBeenCalledTimes(1);
    expect(result.value.entries.map((entry) => entry.relativePath)).toEqual([
      "notes",
      "notes/brief.md"
    ]);
    expect(result.value.text).toContain('file "notes/brief.md"');
    expect(result.value.text).not.toContain("chapters");
    expect(result.value.dependencyManifest.dependency).toMatchObject({
      kind: "creative_file_tree",
      treeRevision: "tree:creative",
      policyVersion: "1.0"
    });
  });

  test("re-attests the C1C tree before staleness comparisons so external tree changes are visible", async () => {
    const initial = creativeSnapshot();
    const refreshed: CreativeProjectFileTreeSnapshot = {
      ...initial,
      treeRevision: "tree:creative-external-change",
      nodes: [
        {
          id: "node:notes",
          name: "notes",
          kind: "directory",
          path: "notes",
          nodeRevision: "node:notes:changed",
          children: [
            {
              id: "node:renamed",
              name: "renamed-brief.md",
              kind: "file",
              path: "notes/renamed-brief.md",
              nodeRevision: "node:renamed"
            }
          ]
        }
      ]
    };
    const snapshots = [initial, refreshed];
    const reattestTreeSnapshot = vi.fn(async () => ok(snapshots.shift()));
    const reader = createDesktopWorkspaceOutlineReader({
      creativeProjectFiles: {
        reattestTreeSnapshot,
        policy: DEFAULT_CREATIVE_PROJECT_FILE_POLICY
      }
    });
    const input = readInput("creative_general");

    const first = await reader.read(input);
    if (!first.ok) throw new Error(first.error.message);
    const current = await reader.readDependencyManifest({
      workspace: input.workspace,
      profileId: input.profileId,
      limits: input.limits
    });
    if (!current.ok) throw new Error(current.error.message);

    expect(reattestTreeSnapshot).toHaveBeenCalledTimes(2);
    expect(current.value.dependency).toMatchObject({
      kind: "creative_file_tree",
      treeRevision: "tree:creative-external-change"
    });
    expect(
      hasWorkspaceOutlineDependencyChanged(first.value.dependencyManifest, current.value)
    ).toBe(true);
  });

  test("materializes chapter and Story Bible indexes without bodies", async () => {
    const reader = createDesktopWorkspaceOutlineReader({
      writingIndex: new WorkspaceOutlineIndexRepository({
        writingMetadata: {
          readChapterIndex: async () =>
            ok({
              revision: "chapters:1",
              entries: [{ id: "chapter-01", title: "Opening", wordCount: 456 }]
            }),
          readStoryBibleIndex: async () =>
            ok({
              revision: "story:1",
              entries: [
                {
                  assetId: "character-alex",
                  title: "Alex",
                  assetType: "character",
                  summary: "This body is not an outline field"
                } as never
              ]
            })
        }
      })
    });

    const result = await reader.read(readInput("writing"));

    expect(result).toMatchObject({
      ok: true,
      value: {
        dependencyManifest: {
          dependency: {
            kind: "writing_indexes",
            chapterIndexRevision: "chapters:1",
            storyBibleIndexRevision: "story:1"
          }
        }
      }
    });
    if (!result.ok) return;
    expect(result.value.text).toContain('chapter id="chapter-01" title="Opening" wordCount=456');
    expect(result.value.text).toContain(
      'story_bible_asset id="character-alex" title="Alex" type="character"'
    );
    expect(result.value.text).not.toContain("This body is not an outline field");
  });

  test("retries a transient writing dependency timeout instead of publishing a false revision", async () => {
    const readWritingIndexes = vi
      .fn<() => Promise<Result<WorkspaceOutlineWritingIndex, UnifiedError>>>()
      .mockResolvedValueOnce(ok(timedOutWritingIndex()))
      .mockResolvedValueOnce(ok(availableWritingIndex("Opening")));
    const reader = createDesktopWorkspaceOutlineReader({
      writingIndex: { readWritingIndexes }
    });

    const result = await reader.readDependencyManifest(readDependencyInput("writing"));

    expect(result).toMatchObject({
      ok: true,
      value: {
        dependency: {
          kind: "writing_indexes",
          chapterIndexRevision: "chapters:r1",
          storyBibleIndexRevision: "story_bible:r1",
          degradedDependencies: []
        }
      }
    });
    expect(readWritingIndexes).toHaveBeenCalledTimes(2);
  });

  test("fails closed when a bounded writing dependency scan stays incomplete", async () => {
    const readWritingIndexes = vi.fn(async () => ok(timedOutWritingIndex()));
    const reader = createDesktopWorkspaceOutlineReader({
      writingIndex: { readWritingIndexes }
    });

    const result = await reader.readDependencyManifest(readDependencyInput("writing"));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "WORKSPACE_OUTLINE_DEPENDENCY_SCAN_INCOMPLETE" }
    });
    expect(readWritingIndexes).toHaveBeenCalledTimes(2);
  });

  test("keeps staleness bound to source revisions when only the rendered outline changes", async () => {
    const readWritingIndexes = vi
      .fn<() => Promise<Result<WorkspaceOutlineWritingIndex, UnifiedError>>>()
      .mockResolvedValueOnce(ok(availableWritingIndex("First rendering")))
      .mockResolvedValueOnce(ok(availableWritingIndex("Second rendering")));
    const reader = createDesktopWorkspaceOutlineReader({ writingIndex: { readWritingIndexes } });
    const input = readInput("writing");

    const materialized = await reader.read(input);
    const current = await reader.readDependencyManifest(readDependencyInput("writing"));

    if (!materialized.ok || !current.ok) throw new Error("Expected stable writing indexes");
    expect(materialized.value.text).not.toBe("Second rendering");
    expect(
      sameWorkspaceOutlineDependencyManifest(materialized.value.dependencyManifest, current.value)
    ).toBe(true);
  });

  test("uses normalized writing source paths in the dependency manifest without rendering them", async () => {
    let chapterPath = "chapters/chapter-01.md";
    let storyBiblePath = "characters/alex.json";
    const reader = createDesktopWorkspaceOutlineReader({
      writingIndex: new WorkspaceOutlineIndexRepository({
        writingMetadata: {
          readChapterIndex: async () =>
            ok({
              revision: "chapters:metadata-stable",
              entries: [
                {
                  id: "chapter-01",
                  title: "Opening",
                  wordCount: 456,
                  relativePath: chapterPath
                }
              ]
            }),
          readStoryBibleIndex: async () =>
            ok({
              revision: "story_bible:metadata-stable",
              entries: [
                {
                  assetId: "character-alex",
                  title: "Alex",
                  assetType: "character",
                  relativePath: storyBiblePath
                }
              ]
            })
        }
      })
    });
    const input = readInput("writing");

    const first = await reader.read(input);
    if (!first.ok) throw new Error(first.error.message);
    chapterPath = "chapters/opening.md";
    storyBiblePath = "characters/alex-renamed.json";
    const current = await reader.readDependencyManifest({
      workspace: input.workspace,
      profileId: input.profileId,
      limits: input.limits
    });
    if (!current.ok) throw new Error(current.error.message);

    expect(
      hasWorkspaceOutlineDependencyChanged(first.value.dependencyManifest, current.value)
    ).toBe(true);
    expect(first.value.text).not.toContain(chapterPath);
    expect(first.value.text).not.toContain(storyBiblePath);
  });

  test("caps materialized text deterministically and keeps stale comparison dependency-only", async () => {
    let currentEntries = [entry("first-long-file-name.md", "file")];
    const reader = createDesktopWorkspaceOutlineReader({
      engineeringIndex: new WorkspaceOutlineIndexRepository({
        engineeringEntries: {
          listEntries: async () => ok(guardedReadResult(currentEntries))
        }
      }),
      estimator: {
        count: (text) => ({ tokens: [...text].length, precision: "estimated" })
      }
    });
    const input = {
      ...readInput("engineering"),
      limits: { ...readInput("engineering").limits, maxTokens: 12 }
    };

    const first = await reader.read(input);
    if (!first.ok) throw new Error(first.error.message);
    expect(first.value.tokenCount).toBeLessThanOrEqual(12);
    expect(first.value.truncationRange).not.toBeNull();
    expect(first.value.dependencyManifest.truncationReasons).toContain("max_tokens");

    const firstManifest = await reader.readDependencyManifest({
      workspace: input.workspace,
      profileId: input.profileId,
      limits: input.limits
    });
    if (!firstManifest.ok) throw new Error(firstManifest.error.message);
    currentEntries = [entry("second-long-file-name.md", "file")];
    const secondManifest = await reader.readDependencyManifest({
      workspace: input.workspace,
      profileId: input.profileId,
      limits: input.limits
    });
    if (!secondManifest.ok) throw new Error(secondManifest.error.message);

    expect(sameWorkspaceOutlineDependencyManifest(firstManifest.value, secondManifest.value)).toBe(
      false
    );
    expect(hasWorkspaceOutlineDependencyChanged(firstManifest.value, secondManifest.value)).toBe(
      true
    );
  });
});

function readInput(profileId: "engineering" | "creative_general" | "writing") {
  return {
    workspace: {
      workspaceKind:
        profileId === "engineering"
          ? ("engineeringWorkspace" as const)
          : ("creativeProject" as const),
      workspaceId: "workspace-01",
      canonicalRootIdentity: "canonical-root-identity"
    },
    profileId,
    limits: {
      maxDepth: 2,
      maxEntries: 200,
      maxScannedEntries: 1_000,
      maxBytes: 64 * 1_024,
      maxDurationMs: 1_000,
      maxTokens: 1_500
    },
    modelProfileId: "test-model"
  } as const;
}

function readDependencyInput(profileId: "engineering" | "creative_general" | "writing") {
  const input = readInput(profileId);
  return {
    workspace: input.workspace,
    profileId: input.profileId,
    limits: input.limits
  };
}

function timedOutWritingIndex(): WorkspaceOutlineWritingIndex {
  return {
    entries: [],
    limits: {
      maxDepth: 2,
      maxEntries: 200,
      maxScannedEntries: 1_000,
      maxBytes: 64 * 1_024,
      maxDurationMs: 1_000
    },
    truncated: true,
    truncationReasons: ["max_duration"],
    omittedEntryCount: 0,
    chapterIndexRevision: "chapters:missing",
    chapterIndexChecksum: "chapter-timeout",
    storyBibleIndexRevision: null,
    storyBibleIndexChecksum: null,
    degradedDependencies: ["chapters", "story_bible"],
    incompleteDependencies: ["chapters", "story_bible"]
  };
}

function availableWritingIndex(renderedTitle: string): WorkspaceOutlineWritingIndex {
  return {
    entries: [
      {
        kind: "chapter",
        id: "chapter-01",
        label: renderedTitle,
        wordCount: 100
      }
    ],
    limits: {
      maxDepth: 2,
      maxEntries: 200,
      maxScannedEntries: 1_000,
      maxBytes: 64 * 1_024,
      maxDurationMs: 1_000
    },
    truncated: false,
    truncationReasons: [],
    omittedEntryCount: 0,
    chapterIndexRevision: "chapters:r1",
    chapterIndexChecksum: "chapter-source-checksum",
    storyBibleIndexRevision: "story_bible:r1",
    storyBibleIndexChecksum: "story-bible-source-checksum",
    degradedDependencies: [],
    incompleteDependencies: []
  };
}

function guardedEntries(
  values: Readonly<
    Record<
      string,
      readonly {
        readonly name: string;
        readonly relativePath: string;
        readonly kind: "directory" | "file";
      }[]
    >
  >
): WorkspaceOutlineGuardedEntryReader {
  return {
    listEntries: async (relativeDirectory) => ok(guardedReadResult(values[relativeDirectory] ?? []))
  };
}

function guardedReadResult(
  entries: readonly {
    readonly name: string;
    readonly relativePath: string;
    readonly kind: "directory" | "file";
  }[]
) {
  return {
    entries,
    scannedEntries: entries.length,
    scannedBytes: entries.reduce(
      (total, entry) => total + Buffer.byteLength(`${entry.kind}\0${entry.relativePath}`, "utf8"),
      0
    ),
    truncationReasons: [] as const
  };
}

function entry(
  relativePath: string,
  kind: "directory" | "file"
): { readonly name: string; readonly relativePath: string; readonly kind: "directory" | "file" } {
  return { name: relativePath.split("/").at(-1) ?? relativePath, relativePath, kind };
}

function creativeSnapshot(): CreativeProjectFileTreeSnapshot {
  return {
    schemaVersion: "1.0",
    projectId: "project-01",
    workspaceId: "workspace-01",
    policyVersion: "1.0",
    treeRevision: "tree:creative",
    nodes: [
      {
        id: "node:notes",
        name: "notes",
        kind: "directory",
        path: "notes",
        nodeRevision: "node:notes",
        children: [
          {
            id: "node:brief",
            name: "brief.md",
            kind: "file",
            path: "notes/brief.md",
            nodeRevision: "node:brief"
          }
        ]
      },
      {
        id: "node:chapters",
        name: "chapters",
        kind: "directory",
        path: "chapters",
        nodeRevision: "node:chapters"
      }
    ],
    truncated: false,
    truncationReasons: [],
    dependencyManifestChecksum: "a".repeat(64)
  };
}
