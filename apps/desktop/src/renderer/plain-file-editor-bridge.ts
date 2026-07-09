import type { NovelStudioApi } from "@novel-studio/application";
import type { PlainFileEditorProps } from "@novel-studio/ui";

export interface PlainFileEditorBridge {
  getProps(): PlainFileEditorProps | undefined;
  openFile(projectRoot: string, path: string): Promise<PlainFileEditorProps>;
  updateContent(content: string): PlainFileEditorProps | undefined;
  beginSave(): PlainFileEditorProps | undefined;
  save(): Promise<PlainFileEditorProps | undefined>;
  clear(): void;
}

interface PlainFileEditorState {
  readonly projectRoot: string;
  readonly path: string;
  readonly fileName: string;
  readonly content: string;
  readonly persistedContent: string;
  readonly saveStatus: PlainFileEditorProps["saveStatus"];
  readonly feedback?: PlainFileEditorProps["feedback"];
}

export function createPlainFileEditorBridge(api: NovelStudioApi): PlainFileEditorBridge {
  let state: PlainFileEditorState | undefined;

  return {
    getProps: () => toProps(),
    async openFile(projectRoot, path) {
      const read = await api.file.readText(projectRoot, path);
      if (!read.ok) {
        state = {
          projectRoot,
          path,
          fileName: fileNameFromPath(path),
          content: "",
          persistedContent: "",
          saveStatus: "Saved",
          feedback: {
            kind: "error",
            message: read.error.message
          }
        };
        return toRequiredProps();
      }

      state = {
        projectRoot,
        path: read.value.path,
        fileName: fileNameFromPath(read.value.path),
        content: read.value.content,
        persistedContent: read.value.content,
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
        feedback: undefined
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
      const written = await api.file.writeText(
        savingState.projectRoot,
        savingState.path,
        savingState.content
      );
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

      state = {
        ...savingState,
        path: written.value.path,
        fileName: fileNameFromPath(written.value.path),
        persistedContent: savingState.content,
        saveStatus: "Saved",
        feedback: undefined
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
      ...(state.feedback === undefined ? {} : { feedback: state.feedback })
    };
  }
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}
