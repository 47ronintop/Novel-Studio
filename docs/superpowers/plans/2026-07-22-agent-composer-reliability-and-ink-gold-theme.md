# Agent Composer Reliability and Ink-Gold Theme Implementation Plan

**Goal:** Restore a dependable right-side Agent composer: every control can be opened and used, Plan/Act is separate from write approval, configured models either start successfully or report a precise actionable reason, and Settings gains a restrained Chinese ink-and-gold appearance theme.

**Approved Composer Layout:**

```text
[ + ] [Plan / Act v] [context icon]                 [model and reasoning v] [send]
```

The toolbar is always one row. It must not wrap, reduce its control font size, overlap controls, or hide a control behind the input. Write approval is deliberately moved into the `+` menu. Plan/Act remains visible because it changes the meaning of the next send.

**Architecture:** Keep the Agent Engine contracts authoritative. The renderer owns only presentation and user intent, the main/Application layers resolve model facts and capability readiness, and the existing `Result`/`UnifiedError` contract carries user-safe diagnostics. Reuse the current React/Electron/CSS structure; do not add a second composer, a second Agent panel, or a new permission system.

## Scope Lock

In scope:

- Fix all composer popovers that are clipped by the compact footer, including `+`, model/reasoning, context, and permission content.
- Replace the incorrect `planning / readonly / automatic` UI abstraction with independent Plan/Act and approval controls.
- Keep the approved single-row order above at normal and narrow right-panel widths.
- Make model-start failures distinguish no selected profile, missing model facts, insufficient context window, and unsupported capabilities.
- Add a backward-compatible way to resolve context-window facts for real provider models that omit metadata from `/models`.
- Add the `ink-gold` appearance preference and test its persistence, contrast, and visible application.

Out of scope:

- Changing Agent transaction, Change Set, Version Group, recovery, undo, or approval-gate semantics.
- Adding permanent unrestricted access, shell tools, Git tools, or network permissions.
- Replacing the provider adapter stack or automatically assuming every OpenAI-compatible endpoint supports Agent tool calls.
- Adding a full-page decorative illustration, animated ink effects, or a second mobile-only composer layout.

## Confirmed Problems

| Problem | Evidence | Required correction |
| --- | --- | --- |
| `+` and model menus appear empty or sit under the input | `packages/ui/src/styles.css` applies `overflow: hidden` to `.ns-agent-composer-footer-leading`, while its child menus open upward with `position: absolute` | Remove the clipping relationship and make the shared popover placement escape all composer overflow boundaries. |
| “只读” is not actually read-only | `packages/ui/src/agent-composer.tsx` maps execution plus `write_before_confirmation` to `readonly` | Present the real two-axis state: Plan/Act and approval policy. |
| The Agent cannot start with a generic provider/model error | Renderer uses the same message for a missing profile and for server capability preflight; `/models` often lacks `context_window`, which currently becomes `0` | Preserve and render structured diagnostics; resolve context-window facts without globally guessing a value. |
| Appearance cannot select the requested Chinese theme | `UserThemePreference`, preference normalization, settings buttons, and CSS currently handle only `dark`, `light`, and `system` | Add one stable `ink-gold` value end-to-end while retaining all old preferences. |

## UX and State Contract

### Composer Toolbar

The DOM should expose one stable toolbar grid, in this visual order:

```text
reference/menu | mode | context status | flexible model selector | command slot
```

- `+` opens an upward floating menu. It contains context-reference actions first and, when the selected mode is Act, a clearly separated approval section.
- The approval section has two radio choices: `请求批准` maps to `write_before_confirmation`; `替我审批` maps to `user_preapproved_run` and requires an explicit acknowledgement for the current run.
- `Plan / Act` is a visible two-option menu and maps only to `operationMode` (`planning` or `execution`). Selecting Plan does not overwrite the stored Act approval preference. Plan sends always use the existing read-only planning semantics.
- The context control is an icon button with an accessible name and tooltip. It shows normal/heavy/error state through the existing `AgentContextMenu` behavior, not through a permanent text label.
- The model control remains a combined model-and-reasoning menu. Its visible label may ellipsize, but its accessible name retains the full model and reasoning value.
- The send/stop command slot has a fixed size and never shrinks.

### Narrow-Width Rules

The single-row grid must use explicit tracks rather than flex wrapping:

```css
grid-template-columns: 28px max-content 28px minmax(72px, 1fr) 30px;
```

- Use the existing panel minimum width and container queries to retain a 72px model slot at approximately 280px panel width.
- Mode and send controls keep their full hit target and 12-13px control typography.
- The model label is the only flexible, ellipsized item. At widths below the supported secondary-panel minimum, collapse the panel through the existing shell behavior rather than wrapping the composer or shrinking text.
- Menus open upward and are clamped to the viewport. They must not overlap the send button or be hidden behind the textarea.

### State Mapping

| Visible choice | Persisted intent | Resulting behavior |
| --- | --- | --- |
| Plan | `operationMode: "planning"` | Read-only planning flow; no write approval choice is active. |
| Act + 请求批准 | `operationMode: "execution"`, `writePolicy: "write_before_confirmation"` | Each generated Change Set still waits for the existing human confirmation flow. |
| Act + 替我审批 | `operationMode: "execution"`, `writePolicy: "user_preapproved_run"`, current-run acknowledgement | Existing automatic-write path applies only to this run and keeps diffs, validation, and version points. |

## Implementation Tasks

### Task 1: Establish a non-clipping floating-popover primitive

**Files**

- Modify: `packages/ui/src/agent-popover.tsx`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/ui/test/agent-composer.test.tsx`
- Test: `apps/desktop/test/agent-conversations.e2e.ts`

1. Add focused UI tests for each trigger (`+`, model/reasoning, context, approval) that assert the opened panel has a non-zero visible bounding box above the composer at 280px and 320px panel widths.
2. Change `AgentPopover` to render its open panel in a shared floating layer using a viewport-relative position derived from the trigger rectangle. Preserve Escape close, focus restoration, `aria-expanded`, and the existing roving keyboard behavior.
3. Prefer upward placement for composer controls; clamp the panel inside the visible viewport and fall back downward only when the upward space is insufficient.
4. Remove `.ns-agent-composer-footer-leading { overflow: hidden; }`. Keep truncation on the model trigger text itself, never on an ancestor that owns a popup.
5. Update CSS container-width rules so menus remain readable without relying on the inline ancestor's container query. Verify the composer stays above scrollable conversation content without obscuring its own trigger.

**Acceptance**

- Clicking `+` exposes its menu and all menu items can receive pointer and keyboard focus.
- Clicking model/reasoning exposes a visible menu at the bottom of a 280px panel.
- Opening one composer popup does not create a second permanent input, reposition the toolbar, or change the message-scroll position.

### Task 2: Restore independent Plan/Act and approval controls

**Files**

- Modify: `packages/ui/src/agent-composer.tsx`
- Modify: `packages/ui/src/agent-permission-menu.tsx`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Modify: `packages/ui/src/styles.css`
- Test: `packages/ui/test/agent-composer.test.tsx`
- Test: `apps/desktop/test/agent-run-bridge.test.ts`
- Test: `apps/desktop/test/agent-conversations.e2e.ts`

1. Delete the presentation-only `ComposerRunMode = planning | readonly | automatic` mapping. Do not rename Act-with-confirmation to “只读”.
2. Render a visible mode trigger with only `计划` and `执行`. It invokes `onOperationModeChange` and does not mutate approval policy as a side effect.
3. Move `AgentPermissionMenu` into the `+` menu as the approval subsection. In Plan it is absent or disabled as not applicable; in Act it preserves the current approval choice.
4. Keep the existing per-run acknowledgement requirement for `user_preapproved_run`. Switching from Act to Plan clears a pending acknowledgement for safety, but does not overwrite the remembered approval choice; returning to Act shows that choice and requires acknowledgement again for a new run.
5. Update accessible labels, keyboard arrow navigation, visible focus states, and tooltips. The composer must expose one `Plan/Act` trigger, one `+` trigger, one context trigger, one model trigger, and one send/stop slot.

**Acceptance**

- Plan is visibly selected and produces a planning run with no write permission control.
- Act plus 请求批准 produces the existing approval gate.
- Act plus 替我审批 produces the existing current-run preapproval behavior only after explicit acknowledgement.
- Switching modes never silently turns a confirmed write path into a mislabeled “只读” path or loses the selected model/context.

### Task 3: Make model-start readiness actionable and reliable

**Files**

- Modify: `apps/desktop/src/renderer/agent-run-bridge.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/agent-run-runtime.ts`
- Modify: `packages/application/src/agent-model-capabilities.ts`
- Modify: `packages/application/src/model-settings-session.ts`
- Modify: `packages/application/src/model-discovery-session.ts`
- Modify: `packages/ui/src/model-settings-panel.tsx`
- Modify: `apps/desktop/src/renderer/settings-bridge.ts`
- Modify: `packages/schemas/schema/settings.schema.json`
- Test: `apps/desktop/test/agent-run-bridge.test.ts`
- Test: `packages/application/test/agent-model-capabilities.test.ts`
- Test: `packages/application/test/model-settings-session.test.ts`
- Test: `apps/desktop/test/m95-real-provider-runtime.test.ts`

1. Split the renderer's generic pre-send error into a no-profile error and a server-returned capability error. Retain the safe `UnifiedError.code`, `suggestedAction`, and `missingCapabilities` data instead of displaying only `error.message`.
2. Add an optional positive `contextWindow` value to a model profile and Settings draft. It describes the profile's configured model, not `maxTokens`, which remains the output-token limit.
3. Resolve context-window facts in this order:
   1. explicit metadata for the selected discovered model;
   2. profile `contextWindow` when the selected model is that profile's configured model;
   3. a maintained catalog entry for an official, unambiguous provider/model pair;
   4. a typed `AGENT_MODEL_CAPABILITY_UNSUPPORTED` error naming `contextWindow`.
4. Do not add a universal 128k fallback and do not lower the 8k requirement merely to suppress the error. Unknown OpenAI-compatible models must be configured or reported as unverified.
5. Keep model capability resolution server-authoritative. Where provider/model support for streaming, tools, or structured arguments is unknown, report that exact missing capability rather than setting a universal `true` value in the renderer.
6. Repair stale selected/default profile handling: validate that a selected/default profile exists before composing a run draft, show an explicit Settings action when none exists, and never select an arbitrary profile without user intent.
7. Surface the resulting readiness feedback next to the composer and the model selector. It must not expose API keys, raw provider bodies, or full paths.

**Acceptance**

- A real model whose `/models` entry lacks `context_window` can start when its configured context window or catalog entry satisfies the required budget.
- An unknown model remains blocked with an explanation that identifies the missing fact and directs the user to the correct settings field.
- No selected profile produces a distinct, localized error before `prepareStart` is called.
- A model that genuinely lacks a required capability remains blocked; this work must not bypass preflight.

### Task 4: Add the ink-gold Chinese appearance preference

**Files**

- Modify: `packages/shared/src/user-preferences.ts`
- Modify: `packages/application/src/user-preferences-session.ts`
- Modify: `packages/ui/src/model-settings-panel.tsx`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Test: `packages/application/test/user-preferences-session.test.ts`
- Test: `packages/ui/test/settings-and-studio.test.tsx`
- Test: `packages/ui/test/workspace-shell.test.tsx`
- Test: `apps/desktop/test/settings-editor-chrome.e2e.ts`

1. Extend `UserThemePreference` with the stable value `ink-gold`. Preserve existing `dark`, `light`, and `system` behavior.
2. Update preference normalization so legacy or unknown values still fall back safely, while a persisted `ink-gold` value round-trips unchanged.
3. Add one appearance segmented-control option named `水墨鎏金` and make it immediately preview and persist through the existing preferences API.
4. Add a `[data-theme="ink-gold"]` token scope. Use low-saturation rice-paper surfaces, graphite ink text, cool gray-green secondary tones, and muted cinnabar/gold accents. Define a small `--ns-gilded-accent` linear gradient for selected tabs, active underlines, and primary action edges only.
5. Do not cover the shell in a gold gradient, add decorative gradient orbs, or reduce text contrast for the theme effect. Keep normal control shapes and IDE density.
6. Verify focus outlines, warnings, success colors, disabled states, and selected composer controls against their backgrounds rather than relying on the dark/light tokens by accident.

**Acceptance**

- Settings shows four choices: 深色, 浅色, 跟随系统, 水墨鎏金.
- Selecting 水墨鎏金 immediately sets `.ns-shell[data-theme="ink-gold"]` and persists after restart.
- Standard text, focus indicators, model controls, and send controls pass the existing functional contrast checks.

### Task 5: Run focused and cross-surface verification

Run focused tests as each task lands, then run the narrow cross-surface suite:

```powershell
npm test -- packages/ui/test/agent-composer.test.tsx apps/desktop/test/agent-run-bridge.test.ts packages/application/test/agent-model-capabilities.test.ts packages/application/test/model-settings-session.test.ts packages/application/test/user-preferences-session.test.ts
npm run typecheck
npm run lint
```

Then run the affected Electron tests, including screenshots at normal and narrow side-panel widths:

```powershell
npx playwright test apps/desktop/test/agent-conversations.e2e.ts apps/desktop/test/settings-editor-chrome.e2e.ts
```

The E2E assertions must test actual visible geometry, not merely the existence of popup DOM. For every composer popup, assert its bounding rectangle intersects the viewport, has positive dimensions, and is not clipped by the composer surface. Capture the 280px, 320px, and default-width composer after opening the `+` menu and model menu.

## Final Acceptance Matrix

| Scenario | Expected result |
| --- | --- |
| 280px Agent panel | One toolbar row; no font shrink, overlap, or wrap; model label ellipsizes before mode or send does. |
| `+` menu | Opens visibly above the composer; can add references and change Act approval policy. |
| Plan | Visible in the toolbar; server receives `planning`; no write choice is active. |
| Act + 请求批准 | Visible Act mode; existing Change Set confirmation flow remains intact. |
| Act + 替我审批 | Explicit current-run acknowledgement; no permanent permission escalation. |
| No model profile | Localized message identifies missing configuration and points to Settings. |
| Model missing context metadata | User can configure a verified context window or receives a specific capability explanation. |
| Ink-gold theme | Applies and persists without reducing contrast or changing behavior of dark/light/system themes. |
| Regression safety | One composer, one send/stop slot, unchanged Change Set/recovery/undo semantics. |

## Completion Definition

The right-side Agent has a stable, uncluttered, one-line composer whose visible mode is always clear and whose approval policy is available from the `+` menu. Every popup is interactable regardless of panel width. A valid configured model starts an Agent run; an invalid or unverified model tells the user exactly what must be configured. Settings offers a polished but restrained 水墨鎏金 theme alongside the existing theme choices. Existing safety gates for planning, Change Sets, approvals, versioning, recovery, and undo remain unchanged.
