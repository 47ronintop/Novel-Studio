import type { CreativeProjectFileSessionIdentity, NovelStudioApi } from "@novel-studio/application";
import type { PlainFileEditorProps } from "@novel-studio/ui";

import {
  createEngineeringEditorStateReporter,
  type EngineeringEditorStateReporter
} from "./engineering-editor-state-reporter.js";

export interface PlainFileEditorBridge {
  readonly scope: PlainFileEditorScope;
  getProps(): PlainFileEditorProps | undefined;
  /** The checksum of the body last confirmed as persisted by the selected file API. */
  getPersistedChecksum(): string | undefined;
  isDirty(): boolean;
  openFile(path: string): Promise<PlainFileEditorProps>;
  updateContent(content: string): PlainFileEditorProps | undefined;
  beginSave(): PlainFileEditorProps | undefined;
  save(): Promise<PlainFileEditorProps | undefined>;
  discard(): PlainFileEditorProps | undefined;
  clear(): void;
}

export type PlainFileEditorScope = "creativeProjectFile" | "engineeringWorkspaceFile";

export interface EngineeringEditorStateBinding {
  readonly rootBindingId: string;
  readonly editorInstanceId: string;
}

export type PlainFileEditorBinding =
  | {
      readonly scope: "engineeringWorkspaceFile";
      /** Omitted until Main has supplied the opaque root binding for this workspace. */
      readonly engineeringEditorState?: EngineeringEditorStateBinding;
      readonly getEngineeringEditorState?: () => EngineeringEditorStateBinding | undefined;
    }
  | {
      readonly scope: "creativeProjectFile";
      readonly identity: CreativeProjectFileSessionIdentity;
      readonly getTreeRevision: () => string | undefined;
    };

interface PlainFileEditorState {
  readonly path: string;
  readonly fileName: string;
  readonly content: string;
  readonly persistedContent: string;
  readonly checksum: string;
  readonly nodeRevision?: string;
  readonly treeRevision?: string;
  readonly readOnlyReason?: string;
  readonly saveStatus: PlainFileEditorProps["saveStatus"];
  readonly feedback?: PlainFileEditorProps["feedback"];
  readonly conflict?:
    | {
        readonly diskContent: string;
        readonly draftContent: string;
        readonly diskChecksum: string;
        readonly diskNodeRevision?: string;
        readonly diskTreeRevision?: string;
      }
    | undefined;
}

export function createPlainFileEditorBridge(
  api: NovelStudioApi,
  binding: PlainFileEditorBinding = { scope: "engineeringWorkspaceFile" }
): PlainFileEditorBridge {
  let state: PlainFileEditorState | undefined;
  const engineeringReporter =
    binding.scope === "engineeringWorkspaceFile"
      ? createEngineeringEditorStateReporter(api)
      : undefined;

  return {
    scope: binding.scope,
    getProps: () => toProps(),
    getPersistedChecksum: () => state?.checksum,
    isDirty: () => state !== undefined && state.content !== state.persistedContent,
    async openFile(path) {
      if (state !== undefined && engineeringReporter !== undefined) {
        await disconnectEngineeringEditor(engineeringReporter);
      }
      const read = await readBoundTextFile(api, binding, path);
      if (!read.ok) {
        throw new Error(read.message);
      }

      state = {
        path: read.document.path,
        fileName: fileNameFromPath(read.document.path),
        content: read.document.content,
        persistedContent: read.document.content,
        checksum: read.document.checksum,
        ...(read.document.nodeRevision === undefined
          ? {}
          : { nodeRevision: read.document.nodeRevision }),
        ...(read.document.treeRevision === undefined
          ? {}
          : { treeRevision: read.document.treeRevision }),
        ...(read.document.readOnlyReason === undefined
          ? {}
          : { readOnlyReason: read.document.readOnlyReason }),
        saveStatus: "Saved"
      };
      const editorReport = openEngineeringEditor(engineeringReporter, binding, state);
      if (editorReport !== undefined) {
        const editorStatus = await editorReport;
        if (editorStatus.status === "unknown") throw new Error(editorStatus.code);
      }
      return toRequiredProps();
    },
    updateContent(content) {
      if (state === undefined) {
        return undefined;
      }
      if (state.readOnlyReason !== undefined) return toProps();

      state = {
        ...state,
        content,
        saveStatus: content === state.persistedContent ? "Saved" : "Unsaved",
        feedback: undefined,
        ...(state.conflict === undefined
          ? {}
          : { conflict: { ...state.conflict, draftContent: content } })
      };
      reportEngineeringEditor(engineeringReporter, binding, state);
      return toProps();
    },
    beginSave() {
      if (state === undefined) {
        return undefined;
      }
      if (state.readOnlyReason !== undefined) return toProps();

      state = {
        ...state,
        saveStatus: "Saving"
      };
      reportEngineeringEditor(engineeringReporter, binding, state);
      return toProps();
    },
    async save() {
      if (state === undefined) {
        return undefined;
      }
      if (state.readOnlyReason !== undefined) return toProps();

      const savingState = state;
      const written = await saveBoundTextFile(api, binding, savingState);
      if (written === undefined) {
        state = {
          ...savingState,
          saveStatus: "Unsaved",
          feedback: {
            kind: "error",
            message: "项目文件树已变化，请刷新后重试。"
          }
        };
        reportEngineeringEditor(engineeringReporter, binding, state);
        return toProps();
      }
      if (!written.ok) {
        state = {
          ...savingState,
          saveStatus: "Unsaved",
          feedback: {
            kind: "error",
            message: written.message
          }
        };
        reportEngineeringEditor(engineeringReporter, binding, state);
        return toProps();
      }

      if (written.outcome.kind === "conflict") {
        if (binding.scope === "creativeProjectFile" && written.outcome.current === undefined) {
          state = {
            ...savingState,
            saveStatus: "Unsaved",
            feedback: {
              kind: "error",
              message: "项目文件已在外部变化，请刷新文件树后重试。"
            }
          };
          reportEngineeringEditor(engineeringReporter, binding, state);
          return toProps();
        }
        const current = written.outcome.current;
        if (current === undefined) {
          state = {
            ...savingState,
            saveStatus: "Unsaved",
            feedback: { kind: "error", message: "文件已在外部变化，请重新打开后重试。" }
          };
          reportEngineeringEditor(engineeringReporter, binding, state);
          return toProps();
        }
        state = {
          ...savingState,
          saveStatus: "Unsaved",
          feedback: undefined,
          conflict: {
            diskContent: current.content,
            draftContent: savingState.content,
            diskChecksum: current.checksum,
            ...(current.nodeRevision === undefined
              ? {}
              : { diskNodeRevision: current.nodeRevision }),
            ...(current.treeRevision === undefined
              ? {}
              : { diskTreeRevision: current.treeRevision })
          }
        };
        reportEngineeringEditor(engineeringReporter, binding, state);
        return toProps();
      }

      const savedDocument = written.outcome.document;

      state = replaceFileRevisions(
        {
          ...savingState,
          path: savedDocument.path,
          fileName: fileNameFromPath(savedDocument.path),
          content: savedDocument.content,
          persistedContent: savedDocument.content,
          checksum: savedDocument.checksum,
          saveStatus: "Saved",
          feedback: undefined,
          conflict: undefined
        },
        savedDocument
      );
      reportEngineeringEditor(engineeringReporter, binding, state);
      return toProps();
    },
    discard() {
      if (state === undefined) return undefined;
      state = {
        ...state,
        content: state.persistedContent,
        saveStatus: "Saved",
        feedback: undefined,
        conflict: undefined
      };
      reportEngineeringEditor(engineeringReporter, binding, state);
      return toProps();
    },
    clear() {
      state = undefined;
      if (engineeringReporter !== undefined) void disconnectEngineeringEditor(engineeringReporter);
    }
  };

  function toRequiredProps(): PlainFileEditorProps {
    const props = toProps();
    if (props === undefined) {
      throw new Error("Plain file editor state is unavailable.");
    }
    return props;
  }

  function toProps(): PlainFileEditorProps | undefined {
    if (state === undefined) {
      return undefined;
    }

    return {
      path: state.path,
      fileName: state.fileName,
      content: state.content,
      dirty: state.content !== state.persistedContent,
      saveStatus: state.saveStatus,
      ...(state.readOnlyReason === undefined ? {} : { readOnlyReason: state.readOnlyReason }),
      ...(state.feedback === undefined ? {} : { feedback: state.feedback }),
      ...(state.conflict === undefined
        ? {}
        : {
            conflict: {
              diskContent: state.conflict.diskContent,
              draftContent: state.conflict.draftContent,
              diskChecksum: state.conflict.diskChecksum
            },
            onReloadFromDisk: reloadFromDisk,
            onKeepDraft: keepDraft
          })
    };
  }

  function reloadFromDisk(): void {
    if (state?.conflict === undefined) return;
    const conflict = state.conflict;
    state = replaceFileRevisions(
      {
        ...state,
        content: conflict.diskContent,
        persistedContent: conflict.diskContent,
        checksum: conflict.diskChecksum,
        saveStatus: "Saved",
        conflict: undefined,
        feedback: undefined
      },
      {
        nodeRevision: conflict.diskNodeRevision,
        treeRevision: conflict.diskTreeRevision
      }
    );
    reportEngineeringEditor(engineeringReporter, binding, state);
  }

  function keepDraft(): void {
    if (state?.conflict === undefined) return;
    const conflict = state.conflict;
    state = replaceFileRevisions(
      {
        ...state,
        persistedContent: conflict.diskContent,
        checksum: conflict.diskChecksum,
        saveStatus: "Unsaved",
        conflict: undefined,
        feedback: undefined
      },
      {
        nodeRevision: conflict.diskNodeRevision,
        treeRevision: conflict.diskTreeRevision
      }
    );
    reportEngineeringEditor(engineeringReporter, binding, state);
  }
}

function reportEngineeringEditor(
  reporter: EngineeringEditorStateReporter | undefined,
  binding: PlainFileEditorBinding,
  state: PlainFileEditorState
): void {
  if (reporter === undefined || binding.scope !== "engineeringWorkspaceFile") return;
  const identity = engineeringEditorStateBinding(binding);
  if (identity === undefined) return;
  const snapshot = {
    rootBindingId: identity.rootBindingId,
    relativePath: state.path,
    editorInstanceId: identity.editorInstanceId,
    dirty: state.content !== state.persistedContent,
    bufferContent: state.content
  };
  void reporter.report(snapshot).then(() => undefined);
}

function openEngineeringEditor(
  reporter: EngineeringEditorStateReporter | undefined,
  binding: PlainFileEditorBinding,
  state: PlainFileEditorState
): ReturnType<EngineeringEditorStateReporter["open"]> | undefined {
  if (reporter === undefined || binding.scope !== "engineeringWorkspaceFile") return undefined;
  const identity = engineeringEditorStateBinding(binding);
  if (identity === undefined) return undefined;
  return reporter.open({
    rootBindingId: identity.rootBindingId,
    relativePath: state.path,
    editorInstanceId: identity.editorInstanceId,
    dirty: state.content !== state.persistedContent,
    bufferContent: state.content
  });
}

function engineeringEditorStateBinding(
  binding: Extract<PlainFileEditorBinding, { readonly scope: "engineeringWorkspaceFile" }>
): EngineeringEditorStateBinding | undefined {
  return binding.getEngineeringEditorState?.() ?? binding.engineeringEditorState;
}

async function disconnectEngineeringEditor(
  reporter: EngineeringEditorStateReporter | undefined
): Promise<void> {
  if (reporter === undefined) return;
  await reporter.disconnect();
}

interface BoundFileDocument {
  readonly path: string;
  readonly content: string;
  readonly checksum: string;
  readonly readOnlyReason?: string;
  readonly nodeRevision?: string;
  readonly treeRevision?: string;
}

type BoundFileSaveOutcome =
  | { readonly kind: "saved"; readonly document: BoundFileDocument }
  | {
      readonly kind: "conflict";
      readonly current?: BoundFileDocument;
    };

async function readBoundTextFile(
  api: NovelStudioApi,
  binding: PlainFileEditorBinding,
  path: string
): Promise<
  | { readonly ok: true; readonly document: BoundFileDocument }
  | { readonly ok: false; readonly message: string }
> {
  if (binding.scope === "creativeProjectFile") {
    const read = await api.creativeProjectFiles.readTextFile({ ...binding.identity, path });
    if (!read.ok) return { ok: false, message: read.error.message };
    const treeRevision = binding.getTreeRevision();
    return {
      ok: true,
      document: {
        path: read.value.path,
        content: read.value.content,
        checksum: read.value.checksum,
        nodeRevision: read.value.nodeRevision,
        ...(treeRevision === undefined ? {} : { treeRevision })
      }
    };
  }
  const read = await api.workspace.readTextFile(path);
  return read.ok
    ? {
        ok: true,
        document: {
          path: read.value.path,
          content: read.value.content,
          checksum: read.value.checksum,
          ...(read.value.readOnlyReason === undefined
            ? {}
            : { readOnlyReason: read.value.readOnlyReason })
        }
      }
    : { ok: false, message: read.error.message };
}

async function saveBoundTextFile(
  api: NovelStudioApi,
  binding: PlainFileEditorBinding,
  state: PlainFileEditorState
): Promise<
  | { readonly ok: true; readonly outcome: BoundFileSaveOutcome }
  | { readonly ok: false; readonly message: string }
  | undefined
> {
  if (binding.scope === "creativeProjectFile") {
    const treeRevision = binding.getTreeRevision() ?? state.treeRevision;
    if (state.nodeRevision === undefined || treeRevision === undefined) return undefined;
    const written = await api.creativeProjectFiles.saveTextFile({
      ...binding.identity,
      path: state.path,
      content: state.content,
      expectedTreeRevision: treeRevision,
      expectedNodeRevision: state.nodeRevision,
      expectedChecksum: state.checksum
    });
    if (!written.ok) return { ok: false, message: written.error.message };
    if (written.value.kind === "conflict") {
      return {
        ok: true,
        outcome: {
          kind: "conflict",
          ...(written.value.current === undefined
            ? {}
            : {
                current: {
                  path: written.value.current.path,
                  content: written.value.current.content,
                  checksum: written.value.current.checksum,
                  nodeRevision: written.value.current.nodeRevision,
                  treeRevision: written.value.treeRevision
                }
              })
        }
      };
    }
    return {
      ok: true,
      outcome: {
        kind: "saved",
        document: {
          path: written.value.document.path,
          content: written.value.document.content,
          checksum: written.value.document.checksum,
          nodeRevision: written.value.document.nodeRevision,
          treeRevision: written.value.treeRevision
        }
      }
    };
  }

  const written = await api.workspace.saveTextFile({
    path: state.path,
    content: state.content,
    expectedChecksum: state.checksum
  });
  if (!written.ok) return { ok: false, message: written.error.message };
  return written.value.kind === "conflict"
    ? {
        ok: true,
        outcome: {
          kind: "conflict",
          current: {
            path: written.value.current.path,
            content: written.value.current.content,
            checksum: written.value.current.checksum,
            ...(written.value.current.readOnlyReason === undefined
              ? {}
              : { readOnlyReason: written.value.current.readOnlyReason })
          }
        }
      }
    : {
        ok: true,
        outcome: {
          kind: "saved",
          document: {
            path: written.value.document.path,
            content: written.value.document.content,
            checksum: written.value.document.checksum,
            ...(written.value.document.readOnlyReason === undefined
              ? {}
              : { readOnlyReason: written.value.document.readOnlyReason })
          }
        }
      };
}

function replaceFileRevisions(
  state: PlainFileEditorState,
  revisions: {
    readonly nodeRevision?: string | undefined;
    readonly treeRevision?: string | undefined;
  }
): PlainFileEditorState {
  const { nodeRevision: _nodeRevision, treeRevision: _treeRevision, ...withoutRevisions } = state;
  void _nodeRevision;
  void _treeRevision;
  return {
    ...withoutRevisions,
    ...(revisions.nodeRevision === undefined ? {} : { nodeRevision: revisions.nodeRevision }),
    ...(revisions.treeRevision === undefined ? {} : { treeRevision: revisions.treeRevision })
  };
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}
