// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";

import type { CreativeProjectFileTreeSnapshot, NovelStudioApi } from "@novel-studio/application";
import { ok } from "@novel-studio/shared";

import {
  type WorkspaceFileEditorRuntime,
  useWorkspaceFileEditorRuntime
} from "../src/renderer/workspace-file-editor-runtime.js";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("useWorkspaceFileEditorRuntime", () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  test("reloads a renamed active creative file and clears it after deletion", async () => {
    const snapshots = [
      treeSnapshot("tree-before", "node-before", "notes/draft.md"),
      treeSnapshot("tree-before", "node-before", "notes/draft.md"),
      treeSnapshot("tree-after-rename", "node-after-rename", "notes/renamed.md"),
      treeSnapshot("tree-after-rename", "node-after-rename", "notes/renamed.md"),
      emptyTreeSnapshot("tree-after-delete")
    ];
    let refreshIndex = 0;
    const readPaths: string[] = [];
    const api = {
      creativeProjectFiles: {
        async refresh() {
          const snapshot = snapshots[Math.min(refreshIndex++, snapshots.length - 1)];
          if (snapshot === undefined) throw new Error("Expected a creative file tree snapshot");
          return ok(snapshot);
        },
        async executeLifecycle() {
          return ok({});
        },
        async readTextFile(input: { readonly path: string }) {
          readPaths.push(input.path);
          return ok({
            path: input.path,
            content: input.path === "notes/renamed.md" ? "Renamed\n" : "Draft\n",
            checksum: `sha256:${input.path}`,
            nodeRevision: input.path === "notes/renamed.md" ? "node-after-rename" : "node-before"
          });
        }
      }
    } as unknown as NovelStudioApi;
    let runtime: WorkspaceFileEditorRuntime | undefined;

    function Harness() {
      runtime = useWorkspaceFileEditorRuntime({
        api,
        activeCreativeProjectId: "project-01",
        activeCreativeWorkspaceId: "workspace-01",
        creativeExpandedPathIds: [],
        creativeWorkspaceActive: true,
        chapterBridge: undefined,
        projectWorkflowBridge: undefined,
        persistUserPreferences: () => undefined,
        setChapterEditor: () => undefined
      });
      return null;
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Harness />);
      await flushMicrotasks();
    });

    const files = runtime?.creativeProjectFilesBridge;
    const editorBridge = runtime?.creativePlainFileBridgeRef.current;
    if (files === undefined || editorBridge === undefined) {
      throw new Error("Expected creative file bridges to be initialized");
    }

    await act(async () => {
      expect(await files.requestOpenFile("notes/draft.md")).toBe(true);
      runtime?.setCreativeFileEditor(await editorBridge.openFile("notes/draft.md"));
    });
    expect(runtime?.fileEditor).toMatchObject({ path: "notes/draft.md", content: "Draft\n" });

    await act(async () => {
      await files.renamePath("notes/draft.md", "notes/renamed.md");
      await flushMicrotasks();
    });

    expect(readPaths).toEqual(["notes/draft.md", "notes/renamed.md"]);
    expect(runtime?.fileEditorScope).toBe("creativeProjectFile");
    expect(runtime?.fileEditor).toMatchObject({
      path: "notes/renamed.md",
      content: "Renamed\n"
    });
    expect(runtime?.activeCreativeFileRef).toMatchObject({
      kind: "project_file",
      relativePath: "notes/renamed.md"
    });

    await act(async () => {
      await files.deletePath("notes/renamed.md");
      await flushMicrotasks();
    });

    expect(runtime?.fileEditor).toBeUndefined();
    expect(runtime?.fileEditorScope).toBeUndefined();
    expect(runtime?.activeCreativeFileRef).toBeNull();
  });
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function treeSnapshot(
  treeRevision: string,
  nodeRevision: string,
  path: string
): CreativeProjectFileTreeSnapshot {
  return {
    schemaVersion: "1.0",
    projectId: "project-01",
    workspaceId: "workspace-01",
    policyVersion: "1.0",
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
    schemaVersion: "1.0",
    projectId: "project-01",
    workspaceId: "workspace-01",
    policyVersion: "1.0",
    treeRevision,
    visibleNodeChecksum: "b".repeat(64),
    truncated: false,
    nodes: []
  };
}
