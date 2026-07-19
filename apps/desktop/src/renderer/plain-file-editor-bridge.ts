import type { NovelStudioApi } from "@novel-studio/application";
import type { PlainFileEditorProps } from "@novel-studio/ui";

export interface PlainFileEditorBridge {
  getProps(): PlainFileEditorProps | undefined;
  openFile(path: string): Promise<PlainFileEditorProps>;
  updateContent(content: string): PlainFileEditorProps | undefined;
  beginSave(): PlainFileEditorProps | undefined;
  save(): Promise<PlainFileEditorProps | undefined>;
  clear(): void;
}

interface PlainFileEditorState {
  readonly path: string;
  readonly fileName: string;
  readonly content: string;
  readonly persistedContent: string;
  readonly checksum: string;
  readonly saveStatus: PlainFileEditorProps["saveStatus"];
  readonly feedback?: PlainFileEditorProps["feedback"];
  readonly conflict?: {
    readonly diskContent: string;
    readonly draftContent: string;
    readonly diskChecksum: string;
  } | undefined;
}

export function createPlainFileEditorBridge(api: NovelStudioApi): PlainFileEditorBridge {
  let state: PlainFileEditorState | undefined;

  return {
    getProps: () => toProps(),
    async openFile(path) {
      const read = await api.workspace.readTextFile(path);
      if (!read.ok) {
        state = {
          path,
          fileName: fileNameFromPath(path),
          content: "",
          persistedContent: "",
          checksum: "",
          saveStatus: "Saved",
          feedback: {
            kind: "error",
            message: read.error.message
          }
        };
        return toRequiredProps();
      }

      state = {
        path: read.value.path,
        fileName: fileNameFromPath(read.value.path),
        content: read.value.content,
        persistedContent: read.value.content,
        checksum: read.value.checksum,
        saveStatus: "Saved"
      };
      return toRequiredProps();
    },
    updateContent(content) {
      if (state === undefined) {
        return undefined;
      }

      state = {
        ...state,
        content,
        saveStatus: content === state.persistedContent ? "Saved" : "Unsaved",
        feedback: undefined,
        ...(state.conflict === undefined
          ? {}
          : { conflict: { ...state.conflict, draftContent: content } })
      };
      return toProps();
    },
    beginSave() {
      if (state === undefined) {
        return undefined;
      }

      state = {
        ...state,
        saveStatus: "Saving"
      };
      return toProps();
    },
    async save() {
      if (state === undefined) {
        return undefined;
      }

      const savingState = state;
      const written = await api.workspace.saveTextFile({
        path: savingState.path,
        content: savingState.content,
        expectedChecksum: savingState.checksum
      });
      if (!written.ok) {
        state = {
          ...savingState,
          saveStatus: "Unsaved",
          feedback: {
            kind: "error",
            message: written.error.message
          }
        };
        return toProps();
      }

      if (written.value.kind === "conflict") {
        state = {
          ...savingState,
          saveStatus: "Unsaved",
          feedback: undefined,
          conflict: {
            diskContent: written.value.current.content,
            draftContent: savingState.content,
            diskChecksum: written.value.current.checksum
          }
        };
        return toProps();
      }

      state = {
        ...savingState,
        path: written.value.document.path,
        fileName: fileNameFromPath(written.value.document.path),
        content: written.value.document.content,
        persistedContent: written.value.document.content,
        checksum: written.value.document.checksum,
        saveStatus: "Saved",
        feedback: undefined,
        conflict: undefined
      };
      return toProps();
    },
    clear() {
      state = undefined;
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
      ...(state.feedback === undefined ? {} : { feedback: state.feedback }),
      ...(state.conflict === undefined
        ? {}
        : {
            conflict: state.conflict,
            onReloadFromDisk: reloadFromDisk,
            onKeepDraft: keepDraft
          })
    };
  }

  function reloadFromDisk(): void {
    if (state?.conflict === undefined) return;
    const conflict = state.conflict;
    state = {
      ...state,
      content: conflict.diskContent,
      persistedContent: conflict.diskContent,
      checksum: conflict.diskChecksum,
      saveStatus: "Saved",
      conflict: undefined,
      feedback: undefined
    };
  }

  function keepDraft(): void {
    if (state?.conflict === undefined) return;
    const conflict = state.conflict;
    state = {
      ...state,
      persistedContent: conflict.diskContent,
      checksum: conflict.diskChecksum,
      saveStatus: "Unsaved",
      conflict: undefined,
      feedback: undefined
    };
  }
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}
