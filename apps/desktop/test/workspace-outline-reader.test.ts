import { ok } from "@novel-studio/shared";
import { describe, expect, test, vi } from "vitest";

import {
  DEFAULT_CREATIVE_PROJECT_FILE_POLICY,
  WorkspaceOutlineIndexRepository,
  type CreativeProjectFileTreeSnapshot,
  type WorkspaceOutlineGuardedEntryReader
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
        getTreeSnapshot: tree,
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
