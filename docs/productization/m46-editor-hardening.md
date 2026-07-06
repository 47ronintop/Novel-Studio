# M46 Editor Hardening

Version: 1.0 | Status: Complete | Last Updated: 2026-07-06

## Goal

M46 hardens the current chapter editor without replacing it with CodeMirror yet. It closes the immediate M35 editor gap by making large-document behavior, document metrics, diff summary, and shortcut conflicts observable and testable.

## Scope

- Add editor document metrics for line, word, and character counts.
- Add large-document mode for chapters above the current line threshold.
- Cap decorative gutter line rendering for large documents to avoid unnecessary DOM growth.
- Add a compact diff summary for insert/delete/replace counts.
- Add a normalized shortcut conflict matrix helper for renderer commands.

## Non-Goals

- CodeMirror 6 replacement.
- Full rich Markdown editing.
- Side-by-side visual diff editor.
- User-editable shortcut registry.

## Data Flow

Chapter body and diff preview
-> `ChapterEditor` pure calculations
-> metrics, large-document flag, capped gutter rows, diff summary
-> UI rendering and renderer tests

Shortcut declarations
-> normalized shortcut signatures
-> conflict matrix
-> future command palette/settings validation

## Acceptance

- Large chapters expose line/word/character metrics.
- Large-document mode is visible in DOM state and UI.
- Decorative gutter line numbers are capped at the defined maximum.
- Diff preview includes insert/delete/replace summary counts.
- Shortcut conflicts are detected after normalization of equivalent accelerator spellings.

## Changelog

- v1.0 - Completed editor hardening signals and shortcut conflict matrix.
