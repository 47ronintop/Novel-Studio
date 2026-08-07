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
import type { AgentProjectFilesChangedEvent } from "../src/renderer/agent-run-bridge.js";

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

  test("reloads a clean creative file after Agent apply and preserves a dirty draft", async () => {
    let diskContent = "Before\n";
    let nodeRevision = "node-before";
    let listener: ((event: AgentProjectFilesChangedEvent) => void) | undefined;
    const reads: string[] = [];
    const api = {
      creativeProjectFiles: {
        async refresh() {
          return ok(treeSnapshot(`tree-${nodeRevision}`, nodeRevision, "notes/draft.md"));
        },
        async readTextFile(input: { readonly path: string }) {
          reads.push(diskContent);
          return ok({
            path: input.path,
            content: diskContent,
            checksum: `sha256:${nodeRevision}`,
            nodeRevision
          });
        }
      }
    } as unknown as NovelStudioApi;
    let runtime: WorkspaceFileEditorRuntime | undefined;

    function Harness() {
      runtime = useWorkspaceFileEditorRuntime({
        api,
        agentRunBridge: {
          subscribeProjectFilesChanged(next) {
            listener = next;
            return () => {
              if (listener === next) listener = undefined;
            };
          }
        },
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
    if (files === undefined || editorBridge === undefined || listener === undefined) {
      throw new Error("Expected creative file bridges and Agent listener to be initialized");
    }
    await act(async () => {
      expect(await files.requestOpenFile("notes/draft.md")).toBe(true);
      runtime?.setCreativeFileEditor(await editorBridge.openFile("notes/draft.md"));
    });

    diskContent = "After Agent\n";
    nodeRevision = "node-after";
    await act(async () => {
      listener?.(projectFilesChangedEvent());
      await flushMicrotasks();
    });
    expect(runtime?.fileEditor).toMatchObject({
      path: "notes/draft.md",
      content: "After Agent\n",
      dirty: false
    });

    act(() => {
      runtime?.fileEditor?.onContentChange?.("Local draft\n");
    });
    diskContent = "After second Agent write\n";
    nodeRevision = "node-second";
    await act(async () => {
      listener?.(projectFilesChangedEvent());
      await flushMicrotasks();
    });

    expect(reads).toEqual(["Before\n", "After Agent\n"]);
    expect(runtime?.fileEditor).toMatchObject({ content: "Local draft\n", dirty: true });
  });

  test("moves a clean Agent-updated editor to its target and clears it after deletion", async () => {
    let currentPath = "notes/draft.md";
    let listener: ((event: AgentProjectFilesChangedEvent) => void) | undefined;
    const readPaths: string[] = [];
    const api = {
      creativeProjectFiles: {
        async refresh() {
          return ok(
            currentPath === ""
              ? emptyTreeSnapshot("tree-deleted")
              : treeSnapshot(`tree:${currentPath}`, `node:${currentPath}`, currentPath)
          );
        },
        async readTextFile(input: { readonly path: string }) {
          readPaths.push(input.path);
          return ok({
            path: input.path,
            content: input.path === "notes/renamed.md" ? "Renamed\n" : "Draft\n",
            checksum: `sha256:${input.path}`,
            nodeRevision: `node:${input.path}`
          });
        }
      }
    } as unknown as NovelStudioApi;
    let runtime: WorkspaceFileEditorRuntime | undefined;

    function Harness() {
      runtime = useWorkspaceFileEditorRuntime({
        api,
        agentRunBridge: {
          subscribeProjectFilesChanged(next) {
            listener = next;
            return () => {
              if (listener === next) listener = undefined;
            };
          }
        },
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
    if (files === undefined || editorBridge === undefined || listener === undefined) {
      throw new Error("Expected creative file bridges and Agent listener to be initialized");
    }
    await act(async () => {
      expect(await files.requestOpenFile("notes/draft.md")).toBe(true);
      runtime?.setCreativeFileEditor(await editorBridge.openFile("notes/draft.md"));
    });

    currentPath = "notes/renamed.md";
    await act(async () => {
      listener?.(projectFilesChangedEvent(["notes/draft.md", "notes/renamed.md"]));
      await flushMicrotasks();
    });

    expect(readPaths).toEqual(["notes/draft.md", "notes/renamed.md"]);
    expect(runtime?.creativeProjectFiles?.activeFilePath).toBe("notes/renamed.md");
    expect(runtime?.fileEditor).toMatchObject({
      path: "notes/renamed.md",
      content: "Renamed\n",
      dirty: false
    });
    expect(runtime?.activeCreativeFileRef).toMatchObject({
      kind: "project_file",
      relativePath: "notes/renamed.md"
    });

    currentPath = "";
    await act(async () => {
      listener?.(projectFilesChangedEvent(["notes/renamed.md"]));
      await flushMicrotasks();
    });

    expect(runtime?.creativeProjectFiles?.activeFilePath).toBeUndefined();
    expect(runtime?.fileEditor).toBeUndefined();
    expect(runtime?.activeCreativeFileRef).toBeNull();
  });

  test("keeps the latest tree snapshot when Agent file-change refreshes overlap", async () => {
    let diskContent = "Before\n";
    let refreshCount = 0;
    let resolveFirstExternalRefresh:
      ((snapshot: CreativeProjectFileTreeSnapshot) => void) | undefined;
    let listener: ((event: AgentProjectFilesChangedEvent) => void) | undefined;
    const api = {
      creativeProjectFiles: {
        async refresh() {
          refreshCount += 1;
          if (refreshCount === 1) {
            return ok(treeSnapshot("tree-before", "node-before", "notes/draft.md"));
          }
          if (refreshCount === 2) {
            return ok(
              await new Promise<CreativeProjectFileTreeSnapshot>((resolve) => {
                resolveFirstExternalRefresh = resolve;
              })
            );
          }
          return ok(treeSnapshot("tree-latest", "node-latest", "notes/draft.md"));
        },
        async readTextFile(input: { readonly path: string }) {
          return ok({
            path: input.path,
            content: diskContent,
            checksum: `sha256:${diskContent}`,
            nodeRevision: "node-latest"
          });
        }
      }
    } as unknown as NovelStudioApi;
    let runtime: WorkspaceFileEditorRuntime | undefined;

    function Harness() {
      runtime = useWorkspaceFileEditorRuntime({
        api,
        agentRunBridge: {
          subscribeProjectFilesChanged(next) {
            listener = next;
            return () => {
              if (listener === next) listener = undefined;
            };
          }
        },
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
    if (files === undefined || editorBridge === undefined || listener === undefined) {
      throw new Error("Expected creative file bridges and Agent listener to be initialized");
    }
    await act(async () => {
      expect(await files.requestOpenFile("notes/draft.md")).toBe(true);
      runtime?.setCreativeFileEditor(await editorBridge.openFile("notes/draft.md"));
    });

    await act(async () => {
      listener?.(projectFilesChangedEvent(["notes/draft.md"]));
      await flushMicrotasks();
    });
    if (resolveFirstExternalRefresh === undefined) {
      throw new Error("Expected the first Agent refresh to be pending");
    }

    await act(async () => {
      diskContent = "Latest\n";
      listener?.(projectFilesChangedEvent(["notes/draft.md"]));
      resolveFirstExternalRefresh?.(emptyTreeSnapshot("tree-stale"));
      await flushMicrotasks(12);
    });

    expect(runtime?.creativeProjectFiles?.nodes).toMatchObject([{ path: "notes/draft.md" }]);
    expect(runtime?.creativeProjectFiles?.activeFilePath).toBe("notes/draft.md");
    expect(runtime?.fileEditor).toMatchObject({ content: "Latest\n", dirty: false });
  });
});

async function flushMicrotasks(count = 6): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

function projectFilesChangedEvent(
  relativePaths: readonly string[] = ["notes/draft.md"]
): AgentProjectFilesChangedEvent {
  return {
    projectId: "workspace-01",
    reason: "agent-change-set-apply",
    versionGroupId: "vg-01",
    relativePaths
  };
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
