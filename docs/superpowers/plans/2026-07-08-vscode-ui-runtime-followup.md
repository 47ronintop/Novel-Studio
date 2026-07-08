# VSCode UI Runtime Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the editor runtime rendering gap, make AI model controls resilient to model discovery failure, verify ambiguous AI-panel footer UI, and move settings visuals closer to native VSCode settings.

**Architecture:** Keep the existing application/session state model intact and make targeted UI changes in `packages/ui`. Use real DOM/component tests for runtime-sensitive behavior and Playwright/browser screenshots for visual acceptance.

**Tech Stack:** React 19, TypeScript, Vitest, Vite/Electron renderer, CodeMirror 6, CSS in `packages/ui/src/styles.css`.

---

## Verified Assessment

- Problem 1 is valid. `packages/ui/src/chapter-editor.tsx` renders a `<textarea>` unconditionally even when `runtime.runtimeId === "codemirror"`. The existing test only checks `data-runtime-id`, not `.cm-editor`.
- Problem 2 is valid. `packages/ui/src/workspace-shell-ai.tsx` gates the entire `.ns-ai-model-controls` block on `modelDiscovery.status === "loaded"` and non-empty models, so discovery failure hides both model selection and reasoning controls.
- Problem 3 needs live inspection. Static markup shows many labeled blocks, but the request specifically asks for the real bottom-of-panel rendering and a screenshot before deciding whether to change.
- Problem 4 is valid. Current settings CSS gives `.model-settings-nav` and `.model-settings-card` visible bordered card treatment; that conflicts with the requested VSCode settings visual language.
- Problem 5 is a design principle for this pass. Apply restrained, dense, IDE-like styling to touched UI only.
- Problem 6 is reasonable but lower priority. `workspace-navigator.tsx` and `.ns-navigator-*` CSS already have structure; it needs density/icon/chevron refinement after 1-4 pass.

## Task 1: Real CodeMirror Rendering

**Files:**
- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/package.json`
- Modify: `package-lock.json`
- Test: `packages/ui/test/chapter-editor.test.tsx`
- Possibly modify: `vitest.config.mjs` if real DOM tests require a browser-like environment

- [ ] Add `@codemirror/state` and `@codemirror/view` as `@novel-studio/ui` dependencies, or move a renderer-owned mount callback into UI props if avoiding a UI dependency is preferred.
- [ ] Replace the unconditional textarea block with a runtime branch: CodeMirror for `runtimeId === "codemirror"`, textarea fallback for missing/textarea runtime.
- [ ] Implement a small `CodeMirrorChapterEditor` component using `useRef` and `useEffect` to create/destroy `EditorView`.
- [ ] Wire CodeMirror document changes to `onBodyChange`, selection updates to `onSelectionChange`, read-only state when `onBodyChange` is absent, and `Ctrl/Cmd+H` to find/replace.
- [ ] Style `.cm-editor`, `.cm-scroller`, `.cm-gutters`, `.cm-line`, and focus state to match the current editor font variables and VSCode-like dark UI.
- [ ] Add a real DOM test that renders `ChapterEditor` with `runtimeId: "codemirror"` and asserts `.cm-editor` exists and `textarea` does not exist.
- [ ] Keep a textarea fallback test that asserts textarea exists when runtime is missing or `"textarea"`.
- [ ] Run focused tests: `npx vitest run packages/ui/test/chapter-editor.test.tsx`.
- [ ] Run typecheck: `npm run typecheck`.
- [ ] Start the app, open an actual chapter, and visually verify line numbers, editor font, cursor, selection, typing, and fallback behavior.
- [ ] Commit: `git commit -m "fix(ui): mount codemirror editor runtime"`.
- [ ] Record `git log -1 --oneline --stat`.

## Task 2: AI Model Popover and Discovery Failure Fallback

**Files:**
- Modify: `packages/ui/src/workspace-shell-ai.tsx`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/ui/test/ai-writing-workflow.test.tsx`

- [ ] Introduce a derived current model object using `workflow.selectedModelName`, discovered model metadata when available, and a manual fallback label when discovery failed or returned empty.
- [ ] Render `.ns-ai-model-controls` unconditionally when a current model name can be derived.
- [ ] Replace native model `<select>` with a compact trigger button near the AI instruction box.
- [ ] Add a popover panel showing current model with check mark, short description/status, reasoning effort row when the selected model exposes `reasoningStrength.status === "available"`, and a collapsible “more models” list when discovered alternatives exist.
- [ ] Do not add voice or microphone controls.
- [ ] Ensure discovery failure still shows current model and a concise fallback note, not an empty area.
- [ ] Add tests for loaded discovery, fallback discovery, and empty/missing discovery. The fallback test must assert the trigger is visible and there is no native model `select`.
- [ ] Run: `npx vitest run packages/ui/test/ai-writing-workflow.test.tsx`.
- [ ] Browser-check with a custom endpoint that makes `/models` fail; verify the model trigger and popover remain visible.
- [ ] Commit: `git commit -m "fix(ui): keep ai model controls visible without discovery"`.

## Task 3: AI Panel Bottom Inspection

**Files:**
- Possibly modify: `packages/ui/src/workspace-shell-ai.tsx`
- Possibly modify: `packages/ui/src/styles.css`
- Test only if a real unlabeled element is fixed: `packages/ui/test/ai-writing-workflow.test.tsx`

- [ ] Start the app and open the AI panel in normal and compact/right-panel modes.
- [ ] Capture screenshot(s) of the bottom area with model controls, instruction box, action row, and any status/context/history blocks visible.
- [ ] Inspect all visible bottom elements for clear label or icon+text explanation.
- [ ] If every element is labeled but visually weak, do not change behavior; report that with the screenshot.
- [ ] If an unlabeled or unclear element exists, add clear text or icon+text labeling and add a regression test around the visible label.
- [ ] Commit only if code changes are made.

## Task 4: VSCode-like Settings Page

**Files:**
- Modify: `packages/ui/src/model-settings-panel.tsx`
- Modify: `packages/ui/src/settings-panel-tabs.tsx`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/ui/test/settings-and-studio.test.tsx`

- [ ] Preserve the existing v3 stacked field layout and overflow fixes.
- [ ] Remove per-section card border/background treatment from setting items and major sections.
- [ ] Reframe each setting field as `Category: Setting Name`, followed by small muted description, then the control.
- [ ] Update `ModelField` to accept category/description metadata or derive the title text in each call site.
- [ ] Convert the left settings tabs into a VSCode-like category list: compact rows, subtle tree/indent marker, clear hover, selected row background/indicator.
- [ ] Add a top “搜索设置” input in the settings header area.
- [ ] Implement filtering against setting titles/descriptions if time allows in this pass; otherwise ship the visual search field disabled only if explicitly documented as non-blocking.
- [ ] Update tests to assert no obvious card wrapper expectation remains and that settings titles/descriptions render in the new hierarchy.
- [ ] Run: `npx vitest run packages/ui/test/settings-and-studio.test.tsx`.
- [ ] Browser-check settings at desktop and narrow widths.
- [ ] Commit: `git commit -m "style(ui): align settings with vscode settings layout"`.

## Task 6: Navigator File Tree Polish

**Files:**
- Modify: `packages/ui/src/workspace-navigator.tsx`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/ui/test/workspace-navigator.test.tsx`

- [ ] Add chevrons for expandable sections/items using existing `lucide-react` icons.
- [ ] Add lightweight type icons for chapter, timeline, story bible, search, and plugin/resource items.
- [ ] Tighten row height, spacing, and hover/selected states toward VSCode explorer density.
- [ ] Keep keyboard/click behavior unchanged.
- [ ] Add tests for chevron/type-icon rendering and active row state.
- [ ] Run: `npx vitest run packages/ui/test/workspace-navigator.test.tsx`.
- [ ] Commit: `git commit -m "style(ui): refine navigator tree density"`.

## Final Verification

- [ ] Run `npm run test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Open the app and capture screenshots for editor, AI panel fallback model popover, AI panel bottom area, settings page, and navigator.
- [ ] Provide final `git log -1` output after the last commit and list any tasks intentionally deferred.
