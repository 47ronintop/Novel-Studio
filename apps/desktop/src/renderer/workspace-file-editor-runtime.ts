import type {
  DesktopShellState,
  NovelStudioApi,
  UserPreferencesSaveInput
} from "@novel-studio/application";
import type { ContextDraftRef } from "@novel-studio/agent-engine";
import {
  DEFAULT_EDITOR_PREFERENCES,
  type ChapterEditorProps,
  type CreativeProjectFilesNavigatorProps,
  type EditorPreferences,
  type PlainFileEditorProps
} from "@novel-studio/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { ChapterEditorBridge } from "./chapter-editor-bridge.js";
import type { AgentRunBridge } from "./agent-run-bridge.js";
import {
  createCreativeProjectFilesBridge,
  type CreativeProjectFilesBridge
} from "./creative-project-files-bridge.js";
import {
  createPlainFileEditorBridge,
  type EngineeringEditorStateBinding,
  type PlainFileEditorBridge,
  type PlainFileEditorScope
} from "./plain-file-editor-bridge.js";
import type { ProjectWorkflowBridge } from "./project-workflow-bridge.js";
import type { EngineeringWorkspaceBridge } from "./engineering-workspace-bridge.js";
import {
  guardDirtyPlainFile,
  guardDirtyPlainFileEditors,
  type PlainFileEditorUpdate
} from "./workspace-file-editor-guard.js";

export interface WorkspaceFileEditorRuntimeOptions {
  readonly api: NovelStudioApi | undefined;
  /** Main-issued opaque identity for engineering editor liveness reports. */
  readonly engineeringEditorState?: EngineeringEditorStateBinding;
  readonly engineeringWorkspaceBridge?: Pick<EngineeringWorkspaceBridge, "refreshEngineeringTree">;
  readonly agentRunBridge?: Pick<AgentRunBridge, "subscribeProjectFilesChanged"> | undefined;
  readonly activeCreativeProjectId: string | undefined;
  readonly activeCreativeWorkspaceId: string | undefined;
  readonly creativeExpandedPathIds: readonly string[];
  readonly creativeWorkspaceActive: boolean;
  readonly chapterBridge: Pick<ChapterEditorBridge, "load"> | undefined;
  readonly projectWorkflowBridge: Pick<ProjectWorkflowBridge, "getProps"> | undefined;
  readonly persistUserPreferences: (input: UserPreferencesSaveInput) => void;
  readonly setChapterEditor: (editor: ChapterEditorProps | undefined) => void;
}

export interface WorkspaceFileEditorRuntime {
  readonly fileEditor: PlainFileEditorProps | undefined;
  readonly fileEditorScope: PlainFileEditorScope | undefined;
  readonly plainFileBridge: PlainFileEditorBridge | undefined;
  readonly creativePlainFileBridgeRef: MutableRefObject<PlainFileEditorBridge | undefined>;
  readonly creativeProjectFilesBridge: CreativeProjectFilesBridge | undefined;
  readonly creativeProjectFiles: CreativeProjectFilesNavigatorProps | undefined;
  readonly editorPreferences: EditorPreferences;
  readonly setEditorPreferences: Dispatch<SetStateAction<EditorPreferences>>;
  readonly onEditorPreferencesChange: (preferences: EditorPreferences) => void;
  readonly onFocusModeToggle: () => void;
  readonly focusModeToggleRef: MutableRefObject<() => void>;
  readonly activeCreativeFileRef: Extract<
    ContextDraftRef,
    { readonly kind: "project_file" }
  > | null;
  readonly setEngineeringFileEditor: (editor: PlainFileEditorProps | undefined) => void;
  readonly setCreativeFileEditor: (editor: PlainFileEditorProps | undefined) => void;
  readonly clearFileEditor: () => void;
  readonly clearCreativeFile: () => void;
  readonly clearWorkspaceFileEditors: () => void;
  readonly guardCreativeFile: () => Promise<boolean>;
  readonly guardWorkspaceFileEditors: () => Promise<boolean>;
}

export interface CreativeProjectFileShellBindings {
  readonly navigator: CreativeProjectFilesNavigatorProps | undefined;
  readonly onNavigatorModeSelect: (mode: DesktopShellState["creativeNavigatorMode"]) => void;
}

export function createCreativeProjectFileShellBindings(input: {
  readonly navigator: CreativeProjectFilesNavigatorProps | undefined;
  readonly bridge: CreativeProjectFilesBridge | undefined;
  readonly expandedPathIds: readonly string[];
  readonly fileEditorScope: PlainFileEditorScope | undefined;
  readonly onExpandedPathIdsChange: (pathIds: readonly string[]) => void;
  readonly onFileOpen: (path: string) => void;
  readonly onNavigatorModeSelect: (mode: DesktopShellState["creativeNavigatorMode"]) => void;
  readonly guardCreativeFile: () => Promise<boolean>;
  readonly clearCreativeFile: () => void;
  readonly onReturnToWriting: () => void;
}): CreativeProjectFileShellBindings {
  return {
    navigator:
      input.navigator === undefined
        ? undefined
        : {
            ...input.navigator,
            expandedPathIds: input.expandedPathIds,
            onExpandedPathIdsChange: (pathIds) => {
              input.bridge?.setExpandedPathIds(pathIds);
              input.onExpandedPathIdsChange(pathIds);
            },
            onFileOpen: input.onFileOpen
          },
    onNavigatorModeSelect: (mode) => {
      if (mode === "files" || input.fileEditorScope !== "creativeProjectFile") {
        input.onNavigatorModeSelect(mode);
        return;
      }
      void input.guardCreativeFile().then((allowed) => {
        if (!allowed) return;
        input.clearCreativeFile();
        input.onNavigatorModeSelect(mode);
        if (mode === "writing") input.onReturnToWriting();
      });
    }
  };
}

export function useWorkspaceFileEditorRuntime(
  options: WorkspaceFileEditorRuntimeOptions
): WorkspaceFileEditorRuntime {
  const {
    api,
    agentRunBridge,
    activeCreativeProjectId,
    activeCreativeWorkspaceId,
    creativeExpandedPathIds,
    creativeWorkspaceActive,
    chapterBridge,
    projectWorkflowBridge,
    persistUserPreferences,
    setChapterEditor
  } = options;
  const [editorPreferences, setEditorPreferences] = useState<EditorPreferences>(
    DEFAULT_EDITOR_PREFERENCES
  );
  const focusModeToggleRef = useRef<() => void>(() => undefined);
  const onFocusModeToggle = useCallback(() => focusModeToggleRef.current(), []);
  const onEditorPreferencesChange = useCallback(
    (preferences: EditorPreferences) => {
      setEditorPreferences(preferences);
      persistUserPreferences({ editor: preferences });
    },
    [persistUserPreferences]
  );
  const [fileEditor, setFileEditor] = useState<PlainFileEditorProps | undefined>();
  const [fileEditorScope, setFileEditorScope] = useState<PlainFileEditorScope | undefined>();
  const fileEditorScopeRef = useRef<PlainFileEditorScope | undefined>(undefined);
  fileEditorScopeRef.current = fileEditorScope;
  const creativeExpandedPathIdsRef = useRef<readonly string[]>([]);
  creativeExpandedPathIdsRef.current = creativeExpandedPathIds;
  const engineeringEditorStateRef = useRef<EngineeringEditorStateBinding | undefined>(undefined);
  engineeringEditorStateRef.current = options.engineeringEditorState;
  const creativePlainFileBridgeRef = useRef<PlainFileEditorBridge | undefined>(undefined);
  const creativeProjectFilesBridgeRef = useRef<CreativeProjectFilesBridge | undefined>(undefined);
  const creativeProjectFilesSyncRef = useRef(0);
  const creativeProjectFilesRefreshRef = useRef<Promise<void>>(Promise.resolve());
  const engineeringMutationSyncRef = useRef(0);
  const decorateFileEditorRef = useRef<
    (
      bridge: PlainFileEditorBridge,
      editor: PlainFileEditorProps | undefined
    ) => PlainFileEditorProps | undefined
  >((_bridge, editor) => editor);
  const updateVisibleFileEditor = useCallback<PlainFileEditorUpdate>((bridge, editor) => {
    if (fileEditorScopeRef.current !== bridge.scope) return;
    setFileEditor(decorateFileEditorRef.current(bridge, editor));
  }, []);
  const clearFileEditor = useCallback(() => {
    fileEditorScopeRef.current = undefined;
    setFileEditor(undefined);
    setFileEditorScope(undefined);
  }, []);
  const [plainFileBridge] = useState(() =>
    api === undefined
      ? undefined
      : createPlainFileEditorBridge(api, {
          scope: "engineeringWorkspaceFile",
          getEngineeringEditorState: () => engineeringEditorStateRef.current
        })
  );
  const [creativeProjectFilesBridge] = useState<CreativeProjectFilesBridge | undefined>(() =>
    api === undefined
      ? undefined
      : createCreativeProjectFilesBridge(api, {
          beforeActiveFileChange: () =>
            guardDirtyPlainFile(creativePlainFileBridgeRef.current, updateVisibleFileEditor),
          onActiveFilePathChange: (path, reason) => {
            if (reason === "open_file") return;

            const editorBridge = creativePlainFileBridgeRef.current;
            editorBridge?.clear();
            if (fileEditorScopeRef.current === "creativeProjectFile") clearFileEditor();

            if (
              reason !== "rename_active_path" ||
              path === undefined ||
              editorBridge === undefined
            ) {
              return;
            }

            void editorBridge.openFile(path).then(
              (next) => {
                if (
                  creativePlainFileBridgeRef.current !== editorBridge ||
                  creativeProjectFilesBridgeRef.current?.getActiveFilePath() !== path
                ) {
                  return;
                }
                fileEditorScopeRef.current = "creativeProjectFile";
                setFileEditorScope("creativeProjectFile");
                setFileEditor(decorateFileEditorRef.current(editorBridge, next));
              },
              () => {
                if (
                  creativePlainFileBridgeRef.current === editorBridge &&
                  creativeProjectFilesBridgeRef.current?.getActiveFilePath() === path
                ) {
                  creativeProjectFilesBridgeRef.current.clearActiveFile();
                }
              }
            );
          }
        })
  );
  creativeProjectFilesBridgeRef.current = creativeProjectFilesBridge;
  const [creativeProjectFiles, setCreativeProjectFiles] = useState<
    CreativeProjectFilesNavigatorProps | undefined
  >();

  const clearCreativeFile = useCallback(() => {
    creativePlainFileBridgeRef.current?.clear();
    creativeProjectFilesBridge?.clearActiveFile();
    if (fileEditorScopeRef.current === "creativeProjectFile") {
      clearFileEditor();
    }
  }, [clearFileEditor, creativeProjectFilesBridge]);

  useEffect(() => {
    if (
      api === undefined ||
      creativeProjectFilesBridge === undefined ||
      activeCreativeProjectId === undefined ||
      activeCreativeWorkspaceId === undefined
    ) {
      creativePlainFileBridgeRef.current?.clear();
      creativePlainFileBridgeRef.current = undefined;
      creativeProjectFilesBridge?.clear();
      setCreativeProjectFiles(undefined);
      if (fileEditorScopeRef.current === "creativeProjectFile") clearFileEditor();
      return;
    }

    const identity = {
      projectId: activeCreativeProjectId,
      workspaceId: activeCreativeWorkspaceId
    };
    const editorBridge = createPlainFileEditorBridge(api, {
      scope: "creativeProjectFile",
      identity,
      getTreeRevision: () => creativeProjectFilesBridge.getSnapshot()?.treeRevision
    });
    creativePlainFileBridgeRef.current = editorBridge;
    const unsubscribe = creativeProjectFilesBridge.subscribe(() => {
      setCreativeProjectFiles(creativeProjectFilesBridge.getNavigatorProps());
    });
    void creativeProjectFilesBridge
      .activate(identity, creativeExpandedPathIdsRef.current)
      .then(setCreativeProjectFiles);

    return () => {
      unsubscribe();
      editorBridge.clear();
      if (creativePlainFileBridgeRef.current === editorBridge) {
        creativePlainFileBridgeRef.current = undefined;
      }
    };
  }, [
    activeCreativeProjectId,
    activeCreativeWorkspaceId,
    api,
    clearFileEditor,
    creativeProjectFilesBridge
  ]);

  useEffect(() => {
    if (
      agentRunBridge === undefined ||
      activeCreativeWorkspaceId === undefined ||
      creativeProjectFilesBridge === undefined
    ) {
      return;
    }
    let active = true;
    const unsubscribe = agentRunBridge.subscribeProjectFilesChanged((event) => {
      if (event.projectId !== activeCreativeWorkspaceId) return;
      const sync = ++creativeProjectFilesSyncRef.current;
      const editorBridge = creativePlainFileBridgeRef.current;
      const editor = editorBridge?.getProps();
      const previousSnapshot = creativeProjectFilesBridge.getSnapshot();
      const affected =
        editor !== undefined &&
        event.relativePaths.some((relativePath) =>
          projectFilePathAffected(editor.path, relativePath)
        );

      const synchronize = async () => {
        await creativeProjectFilesBridge.refresh();
        if (
          !active ||
          sync !== creativeProjectFilesSyncRef.current ||
          creativePlainFileBridgeRef.current !== editorBridge
        ) {
          return;
        }
        if (editorBridge === undefined || editor === undefined || !affected) return;
        if (editorBridge.getProps()?.path !== editor.path || editorBridge.isDirty()) {
          updateVisibleFileEditor(editorBridge, editorBridge.getProps());
          return;
        }
        const snapshot = creativeProjectFilesBridge.getSnapshot();
        const movedPath = projectFileMovedPath({
          activePath: editor.path,
          relativePaths: event.relativePaths,
          previousSnapshot,
          snapshot
        });
        if (movedPath !== undefined) {
          const opened = await creativeProjectFilesBridge.requestOpenFile(movedPath);
          if (
            !active ||
            sync !== creativeProjectFilesSyncRef.current ||
            !opened ||
            creativePlainFileBridgeRef.current !== editorBridge ||
            editorBridge.getProps()?.path !== editor.path ||
            creativeProjectFilesBridge.getActiveFilePath() !== movedPath
          ) {
            return;
          }
          try {
            const reloaded = await editorBridge.openFile(movedPath);
            if (
              !active ||
              sync !== creativeProjectFilesSyncRef.current ||
              creativePlainFileBridgeRef.current !== editorBridge ||
              creativeProjectFilesBridge.getActiveFilePath() !== movedPath
            ) {
              return;
            }
            updateVisibleFileEditor(editorBridge, reloaded);
          } catch {
            if (
              active &&
              sync === creativeProjectFilesSyncRef.current &&
              creativePlainFileBridgeRef.current === editorBridge &&
              creativeProjectFilesBridge.getActiveFilePath() === movedPath
            ) {
              creativeProjectFilesBridge.clearActiveFile();
            }
          }
          return;
        }
        if (!projectFileExists(snapshot, editor.path)) {
          if (creativeProjectFilesBridge.getActiveFilePath() === editor.path) {
            creativeProjectFilesBridge.clearActiveFile();
          }
          return;
        }
        try {
          const reloaded = await editorBridge.openFile(editor.path);
          if (
            !active ||
            sync !== creativeProjectFilesSyncRef.current ||
            creativePlainFileBridgeRef.current !== editorBridge ||
            editorBridge.getProps()?.path !== editor.path ||
            creativeProjectFilesBridge.getActiveFilePath() !== editor.path
          ) {
            return;
          }
          updateVisibleFileEditor(editorBridge, reloaded);
        } catch {
          if (
            active &&
            sync === creativeProjectFilesSyncRef.current &&
            creativePlainFileBridgeRef.current === editorBridge &&
            creativeProjectFilesBridge.getActiveFilePath() === editor.path
          ) {
            creativeProjectFilesBridge.clearActiveFile();
          }
        }
      };
      const queued = creativeProjectFilesRefreshRef.current.then(synchronize, synchronize);
      creativeProjectFilesRefreshRef.current = queued.catch(() => undefined);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [
    activeCreativeWorkspaceId,
    agentRunBridge,
    creativeProjectFilesBridge,
    updateVisibleFileEditor
  ]);

  useEffect(() => {
    const engineeringWorkspaceBridge = options.engineeringWorkspaceBridge;
    if (api === undefined || engineeringWorkspaceBridge === undefined) return;

    let active = true;
    const unsubscribe = api.workspace.onEngineeringMutationSync((request) => {
      const sync = ++engineeringMutationSyncRef.current;
      const editor = plainFileBridge?.getProps();
      const affected =
        editor !== undefined && request.relativePaths.some((path) => path === editor.path);

      void (async () => {
        let status: "synchronized" | "failed" = "failed";
        try {
          const refreshed = await engineeringWorkspaceBridge.refreshEngineeringTree();
          if (
            refreshed.status !== "ready" ||
            !active ||
            sync !== engineeringMutationSyncRef.current
          ) {
            return;
          }
          if (!affected) {
            status = "synchronized";
            return;
          }
          if (
            plainFileBridge === undefined ||
            editor === undefined ||
            plainFileBridge.getProps()?.path !== editor.path ||
            plainFileBridge.isDirty()
          ) {
            return;
          }

          const reloaded = await plainFileBridge.openFile(editor.path);
          if (
            !active ||
            sync !== engineeringMutationSyncRef.current ||
            plainFileBridge.getProps()?.path !== editor.path ||
            plainFileBridge.isDirty() ||
            reloaded.path !== editor.path
          ) {
            return;
          }
          updateVisibleFileEditor(plainFileBridge, reloaded);
          status = "synchronized";
        } catch {
          status = "failed";
        } finally {
          void api.workspace
            .completeEngineeringMutationSync({
              schemaVersion: "2.0",
              requestId: request.requestId,
              status
            })
            .catch(() => undefined);
        }
      })();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api, options.engineeringWorkspaceBridge, plainFileBridge, updateVisibleFileEditor]);

  const activeCreativeFileRef = useMemo<Extract<
    ContextDraftRef,
    { readonly kind: "project_file" }
  > | null>(
    () =>
      creativeWorkspaceActive &&
      fileEditorScope === "creativeProjectFile" &&
      fileEditor !== undefined
        ? (() => {
            const expectedChecksum = creativePlainFileBridgeRef.current?.getPersistedChecksum();
            return {
              kind: "project_file" as const,
              refId: `file:${fileEditor.path}`,
              relativePath: fileEditor.path,
              label: fileEditor.fileName,
              ...(expectedChecksum === undefined ? {} : { expectedChecksum })
            };
          })()
        : null,
    [creativeWorkspaceActive, fileEditor, fileEditorScope]
  );

  const guardCreativeFile = useCallback(
    () => guardDirtyPlainFile(creativePlainFileBridgeRef.current, updateVisibleFileEditor),
    [updateVisibleFileEditor]
  );
  const guardWorkspaceFileEditors = useCallback(
    () =>
      guardDirtyPlainFileEditors([
        { bridge: creativePlainFileBridgeRef.current, update: updateVisibleFileEditor },
        { bridge: plainFileBridge, update: updateVisibleFileEditor }
      ]),
    [plainFileBridge, updateVisibleFileEditor]
  );

  const decorateFileEditor = useCallback(
    (
      bridge: PlainFileEditorBridge,
      nextFileEditor: PlainFileEditorProps | undefined
    ): PlainFileEditorProps | undefined => {
      if (nextFileEditor === undefined) return undefined;

      return {
        ...nextFileEditor,
        editorPreferences,
        ...(nextFileEditor.readOnlyReason === undefined
          ? {
              onContentChange: (content: string) => {
                setFileEditor(decorateFileEditor(bridge, bridge.updateContent(content)));
              },
              onSave: () => {
                const saving = bridge.beginSave();
                if (saving !== undefined) {
                  setFileEditor(decorateFileEditor(bridge, saving));
                }
                void bridge.save().then(async (saved) => {
                  if (bridge.scope === "creativeProjectFile") {
                    await creativeProjectFilesBridge?.refresh();
                  }
                  setFileEditor(decorateFileEditor(bridge, saved));
                });
              }
            }
          : {}),
        onClose: () => {
          void guardDirtyPlainFile(bridge, updateVisibleFileEditor).then((allowed) => {
            if (!allowed) return;
            if (bridge.scope === "creativeProjectFile") {
              clearCreativeFile();
            } else {
              bridge.clear();
              clearFileEditor();
            }
            if (
              chapterBridge !== undefined &&
              projectWorkflowBridge?.getProps().activeChapterId !== undefined
            ) {
              void chapterBridge.load().then(setChapterEditor);
            }
          });
        },
        onReloadFromDisk: () => {
          nextFileEditor.onReloadFromDisk?.();
          setFileEditor(decorateFileEditor(bridge, bridge.getProps()));
        },
        onKeepDraft: () => {
          nextFileEditor.onKeepDraft?.();
          setFileEditor(decorateFileEditor(bridge, bridge.getProps()));
        },
        onEditorPreferencesChange,
        onFocusModeToggle
      };
    },
    [
      chapterBridge,
      clearCreativeFile,
      clearFileEditor,
      creativeProjectFilesBridge,
      editorPreferences,
      onEditorPreferencesChange,
      onFocusModeToggle,
      projectWorkflowBridge,
      setChapterEditor,
      updateVisibleFileEditor
    ]
  );
  decorateFileEditorRef.current = decorateFileEditor;

  const setEngineeringFileEditor = useCallback(
    (next: PlainFileEditorProps | undefined) => {
      fileEditorScopeRef.current = next === undefined ? undefined : "engineeringWorkspaceFile";
      setFileEditorScope(next === undefined ? undefined : "engineeringWorkspaceFile");
      setFileEditor(
        plainFileBridge === undefined ? undefined : decorateFileEditor(plainFileBridge, next)
      );
    },
    [decorateFileEditor, plainFileBridge]
  );
  const setCreativeFileEditor = useCallback(
    (next: PlainFileEditorProps | undefined) => {
      const bridge = creativePlainFileBridgeRef.current;
      fileEditorScopeRef.current = next === undefined ? undefined : "creativeProjectFile";
      setFileEditorScope(next === undefined ? undefined : "creativeProjectFile");
      setFileEditor(bridge === undefined ? undefined : decorateFileEditor(bridge, next));
    },
    [decorateFileEditor]
  );
  const clearWorkspaceFileEditors = useCallback(() => {
    plainFileBridge?.clear();
    creativePlainFileBridgeRef.current?.clear();
    creativeProjectFilesBridge?.clear();
    clearFileEditor();
  }, [clearFileEditor, creativeProjectFilesBridge, plainFileBridge]);

  return {
    fileEditor,
    fileEditorScope,
    plainFileBridge,
    creativePlainFileBridgeRef,
    creativeProjectFilesBridge,
    creativeProjectFiles,
    editorPreferences,
    setEditorPreferences,
    onEditorPreferencesChange,
    onFocusModeToggle,
    focusModeToggleRef,
    activeCreativeFileRef,
    setEngineeringFileEditor,
    setCreativeFileEditor,
    clearFileEditor,
    clearCreativeFile,
    clearWorkspaceFileEditors,
    guardCreativeFile,
    guardWorkspaceFileEditors
  };
}

function projectFilePathAffected(activePath: string, changedPath: string): boolean {
  const active = activePath.replace(/\\/g, "/");
  const changed = changedPath.replace(/\\/g, "/");
  return active === changed || active.startsWith(`${changed}/`);
}

function projectFileMovedPath(input: {
  readonly activePath: string;
  readonly relativePaths: readonly string[];
  readonly previousSnapshot: ReturnType<CreativeProjectFilesBridge["getSnapshot"]>;
  readonly snapshot: ReturnType<CreativeProjectFilesBridge["getSnapshot"]>;
}): string | undefined {
  if (projectFileExists(input.snapshot, input.activePath)) return undefined;

  for (let index = 0; index < input.relativePaths.length - 1; index += 1) {
    const sourcePath = input.relativePaths[index];
    const targetPath = input.relativePaths[index + 1];
    if (
      sourcePath === undefined ||
      targetPath === undefined ||
      !projectFilePathAffected(input.activePath, sourcePath)
    ) {
      continue;
    }
    const candidate = `${targetPath}${input.activePath.slice(sourcePath.length)}`;
    if (
      projectFileExists(input.snapshot, candidate) &&
      !projectFileExists(input.previousSnapshot, candidate)
    ) {
      return candidate;
    }
  }
  return undefined;
}

function projectFileExists(
  snapshot: ReturnType<CreativeProjectFilesBridge["getSnapshot"]>,
  path: string
): boolean {
  return snapshot?.nodes.some((node) => projectFileNodeExists(node, path)) ?? false;
}

function projectFileNodeExists(
  node: NonNullable<ReturnType<CreativeProjectFilesBridge["getSnapshot"]>>["nodes"][number],
  path: string
): boolean {
  return (
    (node.kind === "file" && node.path === path) ||
    node.children?.some((child) => projectFileNodeExists(child, path)) === true
  );
}
