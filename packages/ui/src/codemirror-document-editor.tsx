import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, type ViewUpdate } from "@codemirror/view";
import { useEffect, useRef } from "react";

import type { EditorFindMode } from "./editor-find-replace.js";

export interface CodeMirrorDocumentSelection {
  readonly anchor: number;
  readonly head: number;
}

export interface CodeMirrorDocumentEditorProps {
  readonly ariaLabel: string;
  readonly body: string;
  readonly readOnly: boolean;
  readonly showLineNumbers?: boolean | undefined;
  readonly onBodyChange?: ((nextBody: string) => void) | undefined;
  readonly onEditorFocusRegister: (focus: () => void) => void;
  readonly onEditorSelectionRegister: (
    select: (selection: CodeMirrorDocumentSelection) => void
  ) => void;
  readonly onFindModeChange: (mode: Exclude<EditorFindMode, "closed">) => void;
  readonly onSelectionChange?: ((selection: CodeMirrorDocumentSelection) => void) | undefined;
}

export function CodeMirrorDocumentEditor({
  ariaLabel,
  body,
  readOnly,
  showLineNumbers = true,
  onBodyChange,
  onEditorFocusRegister,
  onEditorSelectionRegister,
  onFindModeChange,
  onSelectionChange
}: CodeMirrorDocumentEditorProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const readOnlyCompartmentRef = useRef(new Compartment());
  const suppressBodyChangeRef = useRef(false);
  const callbacksRef = useRef({
    onBodyChange,
    onEditorFocusRegister,
    onEditorSelectionRegister,
    onFindModeChange,
    onSelectionChange
  });

  useEffect(() => {
    callbacksRef.current = {
      onBodyChange,
      onEditorFocusRegister,
      onEditorSelectionRegister,
      onFindModeChange,
      onSelectionChange
    };
  }, [
    onBodyChange,
    onEditorFocusRegister,
    onEditorSelectionRegister,
    onFindModeChange,
    onSelectionChange
  ]);

  useEffect(() => {
    const parent = mountRef.current;
    if (parent === null) {
      return undefined;
    }

    const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged && !suppressBodyChangeRef.current) {
        callbacksRef.current.onBodyChange?.(update.state.doc.toString());
      }

      if (update.selectionSet) {
        const selection = update.state.selection.main;
        callbacksRef.current.onSelectionChange?.({
          anchor: selection.anchor,
          head: selection.head
        });
      }
    });
    const findReplaceKeymap = keymap.of([
      {
        key: "Mod-f",
        preventDefault: true,
        run() {
          callbacksRef.current.onFindModeChange("find");
          return true;
        }
      },
      {
        key: "Mod-h",
        preventDefault: true,
        run() {
          callbacksRef.current.onFindModeChange("replace");
          return true;
        }
      }
    ]);
    const state = EditorState.create({
      doc: body,
      extensions: [
        ...(showLineNumbers ? [lineNumbers()] : []),
        readOnlyCompartmentRef.current.of([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly)
        ]),
        EditorView.lineWrapping,
        findReplaceKeymap,
        updateListener
      ]
    });
    const view = new EditorView({ parent, state });
    viewRef.current = view;
    callbacksRef.current.onEditorFocusRegister(() => view.focus());
    callbacksRef.current.onEditorSelectionRegister((selection) => {
      const documentLength = view.state.doc.length;
      const anchor = Math.max(0, Math.min(selection.anchor, documentLength));
      const head = Math.max(0, Math.min(selection.head, documentLength));
      view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
    });

    return () => {
      callbacksRef.current.onEditorFocusRegister(() => undefined);
      callbacksRef.current.onEditorSelectionRegister(() => undefined);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) {
      return;
    }

    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly)
      ])
    });
  }, [readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null || view.state.doc.toString() === body) {
      return;
    }

    suppressBodyChangeRef.current = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: body } });
    suppressBodyChangeRef.current = false;
  }, [body]);

  return (
    <div
      aria-label={ariaLabel}
      className="ns-editor-codemirror"
      data-readonly={readOnly}
      ref={mountRef}
    />
  );
}
