import { describe, expect, test, vi } from "vitest";

import type { CreativeProjectFileTreeSnapshot, NovelStudioApi } from "@novel-studio/application";
import { ok } from "@novel-studio/shared";

import { createCreativeProjectFilesBridge } from "../src/renderer/creative-project-files-bridge.js";

describe("CreativeProjectFilesBridge", () => {
  test("refreshes node revision after the active-file guard saves before rename", async () => {
    const snapshots = [
      treeSnapshot("tree-before", "node-before", "notes/draft.md"),
      treeSnapshot("tree-before", "node-after-save", "notes/draft.md"),
      treeSnapshot("tree-after-rename", "node-after-rename", "notes/renamed.md")
    ];
    let refreshIndex = 0;
    const lifecycleCommands: Record<string, unknown>[] = [];
    const beforeActiveFileChange = vi.fn(async () => true);
    const api = {
      creativeProjectFiles: {
        refresh: async () => {
          const snapshot = snapshots[Math.min(refreshIndex++, snapshots.length - 1)];
          if (snapshot === undefined) throw new Error("Expected a project file tree snapshot");
          return ok(snapshot);
        },
        executeLifecycle: async (command: Record<string, unknown>) => {
          lifecycleCommands.push(command);
          return ok({});
        }
      }
    } as unknown as NovelStudioApi;
    const bridge = createCreativeProjectFilesBridge(api, { beforeActiveFileChange });

    await bridge.activate({ projectId: "project-01", workspaceId: "workspace-01" });
    expect(await bridge.requestOpenFile("notes/draft.md")).toBe(true);
    await bridge.renamePath("notes/draft.md", "notes/renamed.md");

    expect(beforeActiveFileChange).toHaveBeenLastCalledWith("rename_active_path");
    expect(lifecycleCommands).toEqual([
      expect.objectContaining({
        kind: "renamePath",
        sourcePath: "notes/draft.md",
        targetPath: "notes/renamed.md",
        expectedTreeRevision: "tree-before",
        expectedSourceRevision: "node-after-save"
      })
    ]);
    expect(bridge.getActiveFilePath()).toBe("notes/renamed.md");
  });

  test("reports active path changes after active-file lifecycle operations complete", async () => {
    const snapshots = [
      treeSnapshot("tree-before", "node-before", "notes/draft.md"),
      treeSnapshot("tree-before", "node-before", "notes/draft.md"),
      treeSnapshot("tree-after-rename", "node-after-rename", "notes/renamed.md"),
      treeSnapshot("tree-after-rename", "node-after-rename", "notes/renamed.md"),
      emptyTreeSnapshot("tree-after-delete")
    ];
    let refreshIndex = 0;
    const onActiveFilePathChange = vi.fn();
    const api = {
      creativeProjectFiles: {
        refresh: async () => {
          const snapshot = snapshots[Math.min(refreshIndex++, snapshots.length - 1)];
          if (snapshot === undefined) throw new Error("Expected a project file tree snapshot");
          return ok(snapshot);
        },
        executeLifecycle: async () => ok({})
      }
    } as unknown as NovelStudioApi;
    const bridge = createCreativeProjectFilesBridge(api, { onActiveFilePathChange });

    await bridge.activate({ projectId: "project-01", workspaceId: "workspace-01" });
    await bridge.requestOpenFile("notes/draft.md");
    await bridge.renamePath("notes/draft.md", "notes/renamed.md");
    await bridge.deletePath("notes/renamed.md");

    expect(onActiveFilePathChange).toHaveBeenNthCalledWith(1, "notes/draft.md", "open_file");
    expect(onActiveFilePathChange).toHaveBeenNthCalledWith(
      2,
      "notes/renamed.md",
      "rename_active_path"
    );
    expect(onActiveFilePathChange).toHaveBeenNthCalledWith(3, undefined, "delete_active_path");
  });

  test("does not send lifecycle mutations for a read-only source tree", async () => {
    const executeLifecycle = vi.fn(async () => ok({}));
    const api = {
      creativeProjectFiles: {
        refresh: async () =>
          ok({
            ...treeSnapshot("tree-read-only", "node-read-only", "source/notes.md"),
            workspaceLayout: "nested-folder" as const,
            mutationMode: "read-only" as const
          }),
        executeLifecycle
      }
    } as unknown as NovelStudioApi;
    const bridge = createCreativeProjectFilesBridge(api);

    await bridge.activate({ projectId: "project-01", workspaceId: "workspace-01" });
    await bridge.createTextFile("source/new.md");
    await bridge.createDirectory("source/new");
    await bridge.renamePath("source/notes.md", "source/renamed.md");
    await bridge.deletePath("source/notes.md");

    expect(bridge.getNavigatorProps()).toMatchObject({
      workspaceLayout: "nested-folder",
      mutationMode: "read-only"
    });
    expect(executeLifecycle).not.toHaveBeenCalled();
  });
});

function treeSnapshot(
  treeRevision: string,
  nodeRevision: string,
  path: string
): CreativeProjectFileTreeSnapshot {
  return {
    schemaVersion: "1.1",
    projectId: "project-01",
    workspaceId: "workspace-01",
    policyVersion: "1.0",
    workspaceLayout: "standalone",
    mutationMode: "read-write",
    treeRevision,
    visibleNodeChecksum: "a".repeat(64),
    truncated: false,
    nodes: [
      {
        id: `creative-file:${path}`,
        kind: "file",
        name: path.split("/").at(-1) ?? path,
        path,
        nodeRevision
      }
    ]
  };
}

function emptyTreeSnapshot(treeRevision: string): CreativeProjectFileTreeSnapshot {
  return {
    schemaVersion: "1.1",
    projectId: "project-01",
    workspaceId: "workspace-01",
    policyVersion: "1.0",
    workspaceLayout: "standalone",
    mutationMode: "read-write",
    treeRevision,
    visibleNodeChecksum: "b".repeat(64),
    truncated: false,
    nodes: []
  };
}
