import { Compartment, EditorState } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorView, keymap, lineNumbers, type ViewUpdate } from "@codemirror/view";
import { useEffect, useRef } from "react";

import { editorLanguageExtension, type EditorLanguage } from "./editor-language.js";
import type { EditorFindMode } from "./editor-find-replace.js";

const editorHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.comment, tags.docComment],
    class: "ns-editor-token-comment"
  },
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.definitionKeyword,
      tags.moduleKeyword,
      tags.operatorKeyword
    ],
    class: "ns-editor-token-keyword"
  },
  {
    tag: [tags.string, tags.docString, tags.character, tags.attributeValue],
    class: "ns-editor-token-string"
  },
  {
    tag: [tags.number, tags.integer, tags.float],
    class: "ns-editor-token-number"
  },
  {
    tag: [tags.bool, tags.atom, tags.null],
    class: "ns-editor-token-atom"
  },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    class: "ns-editor-token-function"
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    class: "ns-editor-token-type"
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    class: "ns-editor-token-property"
  },
  {
    tag: [tags.operator, tags.arithmeticOperator, tags.logicOperator, tags.compareOperator],
    class: "ns-editor-token-operator"
  },
  {
    tag: [tags.punctuation, tags.separator, tags.bracket],
    class: "ns-editor-token-punctuation"
  },
  {
    tag: [
      tags.heading,
      tags.heading1,
      tags.heading2,
      tags.heading3,
      tags.heading4,
      tags.heading5,
      tags.heading6
    ],
    class: "ns-editor-token-heading"
  },
  {
    tag: tags.emphasis,
    class: "ns-editor-token-emphasis"
  },
  {
    tag: tags.strong,
    class: "ns-editor-token-strong"
  },
  {
    tag: [tags.link, tags.url],
    class: "ns-editor-token-link"
  },
  {
    tag: [tags.monospace, tags.meta, tags.documentMeta, tags.annotation],
    class: "ns-editor-token-meta"
  },
  {
    tag: tags.invalid,
    class: "ns-editor-token-invalid"
  }
]);

export interface CodeMirrorDocumentSelection {
  readonly anchor: number;
  readonly head: number;
}

export interface CodeMirrorDocumentEditorProps {
  readonly ariaLabel: string;
  readonly body: string;
  readonly language?: EditorLanguage | undefined;
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
  language = "plain",
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
  const languageCompartmentRef = useRef(new Compartment());
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
        languageCompartmentRef.current.of([
          editorLanguageExtension(language),
          syntaxHighlighting(editorHighlightStyle)
        ]),
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
      effects: languageCompartmentRef.current.reconfigure([
        editorLanguageExtension(language),
        syntaxHighlighting(editorHighlightStyle)
      ])
    });
  }, [language]);

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
