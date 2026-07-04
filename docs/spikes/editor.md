# Editor Spike

Status: Accepted for M5
Date: 2026-07-04

## Decision

Use CodeMirror 6 for the Novel Studio chapter editor and diff review foundation.

M5 will implement the editor vertical slice behind an Application DTO and Repository-backed
chapter save path. The initial UI may use a controlled React text surface while the
CodeMirror runtime dependency is installed and wired in a later M5 slice. The public boundary
must already match the intended CodeMirror integration: a string document value, explicit
change events, save commands routed through Application, and diff candidates that remain
suggestion-only until the user confirms.

## Requirements

- Markdown-first prose editing for long chapters.
- Dirty, saving, saved, and recovery-visible states.
- Keyboard-first operation, including command palette integration.
- UI cannot read or write project files directly.
- Save, restore, and AI apply flows must go through Application and Repository.
- Version previews and AI suggestions need diff review before any write.
- Editor implementation must remain replaceable behind local UI props and Application DTOs.

## Options Compared

### CodeMirror 6

Strengths:

- Modular package model allows a small Markdown-focused editor instead of a full code IDE.
- Functional state and transaction model fits React state boundaries and testable update flow.
- Viewport rendering is designed for large documents and avoids rendering the full document.
- Extensions cover keymaps, history, gutters, decorations, language support, linting, and custom
  editor behavior without forcing a monolithic shell.
- `@codemirror/merge` provides side-by-side and unified diff primitives, including changed chunks,
  accept/reject controls, and presentable diff utilities.

Risks:

- Requires deliberate extension assembly; a minimal editor is too primitive for production.
- Browser use requires a bundler/module loader, so the desktop app needs a renderer build step
  before the real CodeMirror component can ship.
- Novel Studio must own Markdown/frontmatter validation; CodeMirror should not become a business
  rules layer.

### Monaco

Strengths:

- Mature standalone editor with a built-in diff editor.
- Strong code-editing ergonomics, actions, context keys, layout APIs, and accessible diff
  navigation.
- Familiar to users coming from VS Code.

Risks:

- Heavier and more code-IDE-oriented than the v1 chapter writing surface needs.
- Markdown/prose customization is possible but less aligned with Novel Studio's long-form authoring
  and low-distraction editor direction.
- More likely to pull UI behavior toward VS Code compatibility rather than Novel Studio's
  writing-focused workflow.

## Recommendation

CodeMirror 6 is the better default for Novel Studio v1 because the core document is Markdown prose,
not source code. Its extension model lets the product add only the editing, history, Markdown,
frontmatter, and diff behaviors needed for an authoring IDE. Monaco remains a fallback only if
CodeMirror fails large-chapter performance or diff review requirements in later smoke testing.

## M5 Implementation Boundary

M5 should not couple Repository code to CodeMirror APIs. The boundary is:

```text
Editor UI
-> Application chapter DTOs
-> Chapter service/use case
-> Repository chapter read/write/history/recovery
-> Storage
```

The editor component receives:

- `chapterId`
- `title`
- `content`
- `saveStatus`
- `versionHistory`
- optional `diffPreview`
- callbacks for edit, save, preview version, restore version, and apply suggestion

Only the Application layer may decide when a save is valid, when a snapshot is created, and when a
Repository write occurs.

## Diff UX

Version preview and AI suggestions use the same principle: preview first, write only after explicit
user action.

- Version restore creates a `before-rollback` snapshot before writing restored content.
- AI suggestion review creates no write by default.
- Applying an AI suggestion later must create a `before-ai-apply` snapshot before writing content.
- The UI must label suggestions as suggestions, not saved project state.

## Sources Checked

- CodeMirror system guide: https://codemirror.net/docs/guide/
- CodeMirror reference manual, including merge APIs: https://codemirror.net/docs/ref/#merge
- Monaco diff editor API: https://microsoft.github.io/monaco-editor/typedoc/functions/editor.createDiffEditor.html
- Monaco standalone diff editor interface: https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor.IStandaloneDiffEditor.html
