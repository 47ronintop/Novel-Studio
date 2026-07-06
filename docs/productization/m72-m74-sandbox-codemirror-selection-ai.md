# M72-M74 Productization Record

Version: 1.0 | Status: Complete | Date: 2026-07-06

## Milestones

- M72 Plugin Sandbox Fixture Worker.
- M73 CodeMirror DOM View Mount Spike.
- M74 Selection-aware AI Application Flow.

## Product Outcome

This batch moves three previously deferred runtime paths forward while preserving Novel Studio's safety boundaries:

- Plugin sandbox execution gains a deterministic fixture worker adapter with timeout and output-size enforcement, without running arbitrary third-party code.
- CodeMirror gains an explicit DOM mount plan contract behind the existing adapter boundary, while textarea remains the default editor.
- Selection-aware AI preview moves from renderer-only proposed text drafts to an Application-backed preview generation path that returns a structured diff and requires later user approval before any apply.

## Guardrails

- M72 does not execute untrusted plugin source, spawn OS processes, grant network/filesystem/model/shell permissions, or install marketplace plugins.
- M73 does not switch the default editor, does not mount CodeMirror automatically, and does not bypass the renderer editor runtime boundary.
- M74 does not write chapter content, does not call models directly from renderer code, and does not auto-apply selection rewrites.

## Changelog

- v1.0: Initial M72-M74 productization record.
