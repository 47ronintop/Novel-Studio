# Functional Settings, Document Bar, and Status Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn settings into a workspace-level view whose visible controls all work, and replace the editor's stacked metadata rows with one VSCode-style document bar, an on-demand find/replace overlay, and a compact bottom status bar.

**Architecture:** Preserve the existing Application, preload, and repository boundaries. User appearance values continue through `NovelStudioApi.preferences`; `WorkspaceShell` gains an explicit settings branch and focused child components for settings and document chrome; chapter and ordinary-file editors share the existing find/replace engine while owning their editor focus handles. Status data is derived from the active document only and is never rendered in settings mode.

**Tech Stack:** TypeScript strict mode, React 19, Electron IPC/preload, CodeMirror 6, Vitest + jsdom, React DOM server rendering, Playwright Electron E2E, CSS custom properties with OKLCH tokens.

---

## File Ownership

- `packages/shared/src/user-preferences.ts`: persisted appearance contract.
- `packages/application/src/user-preferences-session.ts`: defaulting and legacy normalization.
- `packages/repository/src/user-preferences-repository.ts`: tolerant read and atomic write of preference snapshots.
- `apps/desktop/src/renderer/App.tsx`: live preference state, save feedback, and last non-settings Activity.
- `apps/desktop/src/renderer/renderer-app-effects.ts`: loading persisted appearance into renderer state.
- `apps/desktop/src/renderer/renderer-workspace-shell.tsx`: adapter from renderer callbacks to UI shell props.
- `packages/ui/src/settings-workspace.tsx`: settings-only workspace branch, close button, and Escape behavior.
- `packages/ui/src/model-settings-panel.tsx`: real model, appearance, and plugin controls only.
- `packages/ui/src/settings-panel-tabs.tsx`: the three valid settings categories.
- `packages/ui/src/editor-document-bar.tsx`: explicit open-document tabs and current-document commands.
- `packages/ui/src/editor-find-replace.tsx`: shared on-demand find/replace overlay and existing pure match operations.
- `packages/ui/src/chapter-editor.tsx`: chapter editor body, CodeMirror focus handle, shortcuts, and runtime warnings.
- `packages/ui/src/workspace-shell.tsx`: shell branch selection, open-document descriptors, ordinary-file editor, and status bar data.
- `packages/ui/src/workspace-shell-types.ts`: shell, appearance, and ordinary-file callback contracts.
- `packages/ui/src/styles.css`: theme/accent tokens, settings workspace, document bar, overlay, and status bar layout.

## Task 1: Migrate Appearance Preferences Without Losing Legacy Files

**Files:**
- Modify: `packages/shared/src/user-preferences.ts`
- Modify: `packages/application/src/user-preferences-session.ts`
- Modify: `packages/application/test/user-preferences-session.test.ts`
- Modify: `packages/repository/test/user-preferences-repository.test.ts`
- Modify: `packages/ui/src/model-settings-panel.tsx`
- Modify: `packages/ui/test/settings-and-studio.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/renderer-app-effects.ts`

- [ ] **Step 1: Write failing tests for new defaults, valid values, and legacy density input**

Replace appearance expectations in `packages/application/test/user-preferences-session.test.ts` and add a legacy-load case with these assertions:

```ts
expect(loaded).toMatchObject({
  ok: true,
  value: {
    appearance: {
      theme: "dark",
      accentColor: "teal"
    }
  }
});

const saved = await session.save({
  appearance: {
    theme: "light",
    accentColor: "blue"
  }
});
expect(saved).toMatchObject({
  ok: true,
  value: {
    appearance: {
      theme: "light",
      accentColor: "blue"
    }
  }
});
```

Use the following legacy appearance object in the new load test:

```ts
appearance: {
  theme: "system",
  density: "comfortable"
} as unknown as UserPreferencesSnapshot["appearance"]
```

Assert that it loads as `{ theme: "system", accentColor: "teal" }` and that shell/editor fields remain unchanged.

- [ ] **Step 2: Run the Application preference tests and verify failure**

Run:

```powershell
npm test -- packages/application/test/user-preferences-session.test.ts
```

Expected: FAIL because `accentColor` is absent and `light` is not assignable to the current theme type.

- [ ] **Step 3: Replace the shared appearance contract and normalize untrusted legacy values**

Change `UserAppearancePreferences` in `packages/shared/src/user-preferences.ts` to:

```ts
export type UserThemePreference = "dark" | "light" | "system";
export type UserAccentColorPreference = "teal" | "blue" | "amber";

export interface UserAppearancePreferences {
  readonly theme: UserThemePreference;
  readonly accentColor: UserAccentColorPreference;
}
```

In `packages/application/src/user-preferences-session.ts`, use a legacy-tolerant input and explicit guards:

```ts
type AppearancePreferenceInput = Partial<UserAppearancePreferences> & {
  readonly density?: unknown;
};

function normalizeAppearancePreferences(
  preferences: AppearancePreferenceInput
): UserAppearancePreferences {
  return {
    theme:
      preferences.theme === "light" || preferences.theme === "system"
        ? preferences.theme
        : "dark",
    accentColor:
      preferences.accentColor === "blue" || preferences.accentColor === "amber"
        ? preferences.accentColor
        : "teal"
  };
}
```

Set the default appearance to:

```ts
appearance: {
  theme: "dark",
  accentColor: "teal"
}
```

Cast persisted appearance only at the normalization boundary, not throughout the renderer:

```ts
appearance: normalizeAppearancePreferences(
  preferences.appearance as AppearancePreferenceInput
)
```

- [ ] **Step 4: Bridge renderer and settings types to the final appearance shape**

Before running a repository-wide typecheck, update renderer and settings types to the final appearance shape. In `model-settings-panel.tsx`:

```ts
export interface ModelSettingsAppearancePreferences extends UserAppearancePreferences {
  readonly editor?: EditorPreferences;
}
```

Replace the current density control with the three accent values and add `light` to the theme list:

```ts
const themes = ["dark", "light", "system"] as const;
const accents = ["teal", "blue", "amber"] as const;
```

Update `App.tsx` state to use `UserAppearancePreferences` directly:

```ts
const [appearancePreferences, setAppearancePreferences] = useState<UserAppearancePreferences>({
  theme: "dark",
  accentColor: "teal"
});
```

Update the corresponding setter type in `renderer-app-effects.ts`. Replace settings tests that pass `density` with `accentColor` and assert all three theme values and swatches are rendered. This is the minimum compile bridge; Task 3 removes the remaining display-only sections and preview markup.

- [ ] **Step 5: Update the repository round-trip fixture to the new shape**

In `packages/repository/test/user-preferences-repository.test.ts`, use:

```ts
appearance: {
  theme: "light",
  accentColor: "amber"
}
```

After reading the file, assert:

```ts
expect(readBack).toEqual(written);
expect(raw).toContain('"accentColor": "amber"');
expect(raw).not.toContain('"density"');
```

- [ ] **Step 6: Run preference and appearance tests, then typecheck the repository**

Run:

```powershell
npm test -- packages/application/test/user-preferences-session.test.ts packages/repository/test/user-preferences-repository.test.ts
npm test -- packages/ui/test/settings-and-studio.test.tsx
npm run typecheck
```

Expected: all tests PASS and TypeScript exits with code 0.

- [ ] **Step 7: Commit the preference migration**

```powershell
git add packages/shared/src/user-preferences.ts packages/application/src/user-preferences-session.ts packages/application/test/user-preferences-session.test.ts packages/repository/test/user-preferences-repository.test.ts packages/ui/src/model-settings-panel.tsx packages/ui/test/settings-and-studio.test.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/renderer-app-effects.ts
git commit -m "feat: migrate appearance preferences"
```

## Task 2: Make Appearance Controls Affect the Whole Workbench

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/renderer-app-effects.ts`
- Modify: `apps/desktop/src/renderer/renderer-workspace-shell.tsx`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/model-settings-panel.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/test/workspace-shell.test.tsx`
- Modify: `apps/desktop/test/app-shell-support.test.ts`

- [ ] **Step 1: Write failing shell tests for theme and accent attributes**

Add this case to `packages/ui/test/workspace-shell.test.tsx`:

```tsx
test("applies persisted theme and accent preferences to the workbench root", () => {
  const application = createDesktopApplication();
  const html = renderToStaticMarkup(
    <WorkspaceShell
      appearancePreferences={{ theme: "light", accentColor: "amber" }}
      shellState={application.getShellState()}
      commands={application.listCommands()}
      commandPaletteOpen={false}
    />
  );

  expect(html).toContain('data-theme="light"');
  expect(html).toContain('data-accent="amber"');
});
```

- [ ] **Step 2: Run the shell test and verify failure**

Run:

```powershell
npm test -- packages/ui/test/workspace-shell.test.tsx
```

Expected: FAIL because `WorkspaceShellProps` has no `appearancePreferences` and the shell hard-codes `data-theme="dark"`.

- [ ] **Step 3: Thread the appearance contract from App to WorkspaceShell**

Add to `WorkspaceShellProps` and `RendererWorkspaceShellProps`:

```ts
readonly appearancePreferences?: UserAppearancePreferences | undefined;
```

Import `UserAppearancePreferences` from `@novel-studio/shared`. Pass the prop through `RendererWorkspaceShell` and render the shell root as:

```tsx
const appearance = appearancePreferences ?? {
  theme: "dark" as const,
  accentColor: "teal" as const
};

<div
  className="ns-shell"
  data-accent={appearance.accentColor}
  data-focus-mode={focusMode}
  data-theme={appearance.theme}
>
```

Pass `appearancePreferences` from `App.tsx` to `RendererWorkspaceShell`.

- [ ] **Step 4: Add live dark/light/system and accent token scopes**

Keep semantic state colors stable and override only workbench neutrals and primary colors in `packages/ui/src/styles.css`:

```css
.ns-shell[data-theme="light"] {
  --ns-bg: oklch(0.97 0.004 240);
  --ns-surface: oklch(0.94 0.006 240);
  --ns-surface-raised: oklch(0.9 0.008 240);
  --ns-border: oklch(0.78 0.012 240);
  --ns-ink: oklch(0.22 0.012 240);
  --ns-muted: oklch(0.45 0.014 240);
}

.ns-shell[data-accent="blue"] {
  --ns-primary: oklch(0.62 0.15 250);
  --ns-primary-strong: oklch(0.72 0.14 250);
}

.ns-shell[data-accent="amber"] {
  --ns-primary: oklch(0.7 0.13 75);
  --ns-primary-strong: oklch(0.78 0.13 75);
}

@media (prefers-color-scheme: light) {
  .ns-shell[data-theme="system"] {
    --ns-bg: oklch(0.97 0.004 240);
    --ns-surface: oklch(0.94 0.006 240);
    --ns-surface-raised: oklch(0.9 0.008 240);
    --ns-border: oklch(0.78 0.012 240);
    --ns-ink: oklch(0.22 0.012 240);
    --ns-muted: oklch(0.45 0.014 240);
  }
}
```

Do not override `--ns-danger`, `--ns-warning`, `--ns-success`, or `--ns-info` in accent scopes.

- [ ] **Step 5: Persist appearance with explicit success/failure feedback**

In `App.tsx`, add:

```ts
const [appearanceFeedback, setAppearanceFeedback] = useState<
  { readonly kind: "info" | "error"; readonly message: string } | undefined
>();

const handleAppearancePreferencesChange = useCallback(
  (preferences: UserAppearancePreferences) => {
    setAppearancePreferences(preferences);
    setAppearanceFeedback(undefined);
    if (api === undefined) {
      setAppearanceFeedback({
        kind: "error",
        message: "外观已在本次会话生效，但无法写入用户偏好。"
      });
      return;
    }

    void api.preferences.save({ appearance: preferences }).then((result) => {
      setAppearanceFeedback(
        result.ok
          ? undefined
          : {
              kind: "error",
              message: "外观已在本次会话生效，但未能保存到本地。"
            }
      );
    });
  },
  [api]
);
```

Replace the inline appearance callback in `interactiveSettings` with this callback. Add this prop to `ModelSettingsPanelProps` now so the task remains type-correct:

```ts
readonly appearanceFeedback?:
  | { readonly kind: "info" | "error"; readonly message: string }
  | undefined;
```

Render it next to the appearance heading with `role="alert"` for errors. Pass it from `interactiveSettings`.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```powershell
npm test -- packages/ui/test/workspace-shell.test.tsx apps/desktop/test/app-shell-support.test.ts
npm run typecheck
```

Expected: tests PASS and TypeScript exits with code 0.

- [ ] **Step 7: Commit live appearance behavior**

```powershell
git add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/renderer-app-effects.ts apps/desktop/src/renderer/renderer-workspace-shell.tsx packages/ui/src/workspace-shell-types.ts packages/ui/src/workspace-shell.tsx packages/ui/src/model-settings-panel.tsx packages/ui/src/styles.css packages/ui/test/workspace-shell.test.tsx apps/desktop/test/app-shell-support.test.ts
git commit -m "feat: apply persisted workbench appearance"
```

## Task 3: Remove Nonfunctional Settings and Keep Three Real Categories

**Files:**
- Modify: `packages/ui/src/settings-panel-tabs.tsx`
- Modify: `packages/ui/src/model-settings-panel.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/test/settings-and-studio.test.tsx`
- Modify: `apps/desktop/src/renderer/settings-bridge.ts`
- Modify: `apps/desktop/test/settings-bridge.test.ts`

- [ ] **Step 1: Replace old settings assertions with a strict visible-feature inventory**

Add the following test to `packages/ui/test/settings-and-studio.test.tsx`:

```tsx
test("renders only functional model appearance and plugin settings", () => {
  const html = renderToStaticMarkup(
    <ModelSettingsPanel
      {...createModelSettingsPanelProps()}
      activeSection="appearance"
      appearancePreferences={{ theme: "dark", accentColor: "teal" }}
      editorPreferences={{ fontFamily: "serif", fontSize: 16, lineHeight: 1.8 }}
    />
  );

  expect(html).toContain("模型");
  expect(html).toContain("外观");
  expect(html).toContain("插件");
  expect(html).toContain('aria-label="浅色主题"');
  expect(html).toContain('aria-label="强调色 蓝色"');
  expect(html).not.toContain(">写作</button>");
  expect(html).not.toContain(">高级</button>");
  expect(html).not.toContain("界面密度");
  expect(html).not.toContain("编辑器外观预览");
  expect(html).not.toContain("自动保存与历史");
});
```

- [ ] **Step 2: Run settings tests and verify failure**

Run:

```powershell
npm test -- packages/ui/test/settings-and-studio.test.tsx apps/desktop/test/settings-bridge.test.ts
```

Expected: FAIL because the old navigation and display-only sections still render.

- [ ] **Step 3: Reduce the section type and bridge state**

Change `SettingsPanelSection` to:

```ts
export type SettingsPanelSection = "models" | "appearance" | "plugins";
export type SettingsPanelActiveSection = SettingsPanelSection;
```

Use only these entries:

```ts
const settingsSections = [
  { id: "models", label: "模型" },
  { id: "appearance", label: "外观" },
  { id: "plugins", label: "插件" }
] as const satisfies readonly {
  readonly id: SettingsPanelSection;
  readonly label: string;
}[];
```

Keep `activeSection` initialized to `"models"` in `settings-bridge.ts`; delete tests that select `writing`, `editor`, or `advanced` and assert the three valid sections instead.

- [ ] **Step 4: Remove display-only functions and preview markup**

Remove `ModelSettingsWritingPreferences`, `writingPreferences`, `LegacyWritingSummarySection`, `WritingSettingsSection`, `EditorSettingsSection`, and `AdvancedSettingsSection`. Default the active section to `"models"` and render exactly one content section. Keep the real theme/accent controls introduced in Task 1.

Confirm accent buttons use both a visible swatch and accessible name:

```tsx
<div className="model-settings-swatches" aria-label="外观强调色">
  {accents.map((accentColor) => (
    <button
      aria-label={`强调色 ${accentLabel(accentColor)}`}
      aria-pressed={preferences.accentColor === accentColor}
      data-accent={accentColor}
      key={accentColor}
      onClick={() => updateAppearance({ accentColor })}
      type="button"
    >
      <span aria-hidden="true" className="model-settings-swatch" />
      <span>{accentLabel(accentColor)}</span>
    </button>
  ))}
</div>
```

Delete `.model-appearance-preview*` and density styles. Keep stable 28px swatches, visible focus, and `aria-pressed` styling without gradients.

- [ ] **Step 5: Keep security copy attached to the API Key field**

Keep the API Key `ModelField` note limited to this factual text:

```text
粘贴真实 API Key；保存后写入桌面端安全存储，settings.json 只保留 secret:// 引用。留空会继续使用已保存密钥。
```

Do not render a separate “隐私与安全” section.

- [ ] **Step 6: Run settings tests and commit**

Run:

```powershell
npm test -- packages/ui/test/settings-and-studio.test.tsx apps/desktop/test/settings-bridge.test.ts
npm run typecheck
```

Expected: all tests PASS and TypeScript exits with code 0.

```powershell
git add packages/ui/src/settings-panel-tabs.tsx packages/ui/src/model-settings-panel.tsx packages/ui/src/styles.css packages/ui/src/index.ts packages/ui/test/settings-and-studio.test.tsx apps/desktop/src/renderer/settings-bridge.ts apps/desktop/test/settings-bridge.test.ts
git commit -m "feat: keep only functional settings"
```

## Task 4: Render Settings as a Workspace-Level View

**Files:**
- Create: `packages/ui/src/settings-workspace.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/test/workspace-shell.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/renderer-workspace-shell.tsx`

- [ ] **Step 1: Write failing tests for the explicit settings branch and close behavior**

Add to `packages/ui/test/workspace-shell.test.tsx`:

```tsx
test("renders settings as a workspace-level view without editor chrome", () => {
  const application = createDesktopApplication();
  const html = renderToStaticMarkup(
    <WorkspaceShell
      shellState={{ ...application.getShellState(), activeActivity: "settings" }}
      commands={application.listCommands()}
      commandPaletteOpen={false}
      settings={createSettingsProps()}
      onSettingsClose={() => undefined}
    />
  );

  expect(html).toContain('data-region="settings-workspace"');
  expect(html).toContain('aria-label="关闭设置"');
  expect(html).toContain('aria-label="打开命令面板"');
  expect(html).not.toContain('data-region="activity-bar"');
  expect(html).not.toContain('data-region="editor-area"');
  expect(html).not.toContain('data-region="ai-panel"');
  expect(html).not.toContain('data-region="bottom-panel"');
  expect(html).not.toContain('data-region="status-bar"');
  expect(html).not.toContain('aria-label="切换 Split View"');
});
```

Add a jsdom interaction test that clicks `关闭设置` and dispatches `KeyboardEvent("keydown", { key: "Escape" })`; assert one callback per action.

- [ ] **Step 2: Run the shell test and verify failure**

Run:

```powershell
npm test -- packages/ui/test/workspace-shell.test.tsx
```

Expected: FAIL because settings still render through `ActivityEmptyState` inside the editor grid.

- [ ] **Step 3: Create SettingsWorkspace with close and Escape semantics**

Create `packages/ui/src/settings-workspace.tsx`:

```tsx
import { X } from "lucide-react";
import { useEffect } from "react";
import { ModelSettingsPanel, type ModelSettingsPanelProps } from "./model-settings-panel.js";

export interface SettingsWorkspaceProps {
  readonly settings?: ModelSettingsPanelProps | undefined;
  readonly onClose?: (() => void) | undefined;
}

export function SettingsWorkspace({ settings, onClose }: SettingsWorkspaceProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <main className="ns-settings-workspace" data-region="settings-workspace">
      <button
        aria-label="关闭设置"
        className="ns-icon-button ns-settings-close"
        onClick={onClose}
        title="关闭设置"
        type="button"
      >
        <X aria-hidden="true" size={16} />
      </button>
      {settings === undefined ? (
        <section aria-label="设置不可用" className="ns-settings-unavailable">
          <h1>设置</h1>
          <p>当前项目尚未加载设置数据。</p>
        </section>
      ) : (
        <ModelSettingsPanel {...settings} />
      )}
    </main>
  );
}
```

Export it from `packages/ui/src/index.ts`.

- [ ] **Step 4: Branch WorkspaceShell before creating the editor grid**

Add `onSettingsClose?: () => void` to `WorkspaceShellProps`. After the shared title bar, render either `SettingsWorkspace` or the current workbench grid. Hide `.ns-layout-controls` while settings is active. Render `CommandPalette` after the branch so it remains global. Do not render `StatusBar` in the settings branch.

Remove the `activityId === "settings"` branch from `ActivityEmptyState`.

- [ ] **Step 5: Restore the last non-settings Activity from every settings entry path**

In `App.tsx`, add:

```ts
const lastNonSettingsActivityRef = useRef<ActivityId>("workspace");

const applyActivity = useCallback((activityId: ActivityId) => {
  setShellState((current) => {
    if (activityId === "settings" && current.activeActivity !== "settings") {
      lastNonSettingsActivityRef.current = current.activeActivity;
    } else if (activityId !== "settings") {
      lastNonSettingsActivityRef.current = activityId;
    }
    return { ...current, activeActivity: activityId };
  });
}, []);

const handleSettingsClose = useCallback(() => {
  applyActivity(lastNonSettingsActivityRef.current ?? "workspace");
}, [applyActivity]);
```

Use the same ref update before applying successful command results whose `activeActivity` is `settings`; this covers command-palette entry in addition to the activity button. Pass `handleSettingsClose` through `RendererWorkspaceShell`.

Do not persist the temporary settings Activity in `UserShellPreferences`; existing `shellPreferencesFromState` already excludes it.

- [ ] **Step 6: Add responsive workspace styling**

Add a settings-only grid row and scrolling surface:

```css
.ns-shell[data-settings-mode="true"] {
  grid-template-rows: 38px minmax(0, 1fr);
}

.ns-settings-workspace {
  background: var(--ns-bg);
  min-height: 0;
  overflow: auto;
  position: relative;
}

.ns-settings-close {
  position: sticky;
  float: right;
  right: 16px;
  top: 12px;
  z-index: 2;
}
```

At `max-width: 720px`, make `.model-settings-nav` horizontal, remove its right border, enable horizontal overflow, and keep `.model-settings-grid` single-column.

- [ ] **Step 7: Run settings workspace tests and commit**

Run:

```powershell
npm test -- packages/ui/test/workspace-shell.test.tsx packages/ui/test/settings-and-studio.test.tsx
npm run typecheck
```

Expected: all tests PASS and TypeScript exits with code 0.

```powershell
git add packages/ui/src/settings-workspace.tsx packages/ui/src/index.ts packages/ui/src/workspace-shell-types.ts packages/ui/src/workspace-shell.tsx packages/ui/src/styles.css packages/ui/test/workspace-shell.test.tsx apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/renderer-workspace-shell.tsx
git commit -m "feat: open settings as a workspace view"
```

## Task 5: Replace Chapter Lists and Toolbars with One Real Document Bar

**Files:**
- Create: `packages/ui/src/editor-document-bar.tsx`
- Create: `packages/ui/test/editor-document-bar.test.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/workspace-shell-types.ts`
- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/test/chapter-editor.test.tsx`
- Modify: `packages/ui/test/workspace-shell.test.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/test/project-workflow.e2e.ts`

- [ ] **Step 1: Write failing document-bar component tests**

Create `packages/ui/test/editor-document-bar.test.tsx` with:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { EditorDocumentBar } from "../src/editor-document-bar.js";

describe("EditorDocumentBar", () => {
  test("renders real open documents and only available commands", () => {
    const html = renderToStaticMarkup(
      <EditorDocumentBar
        tabs={[
          { id: "chapter:ch_opening", label: "开篇.md", active: true, dirty: false },
          { id: "file:notes/scene.md", label: "scene.md", active: false, dirty: true }
        ]}
        dirty={false}
        saving={false}
        onSave={() => undefined}
        onFind={() => undefined}
      />
    );

    expect(html).toContain("开篇.md");
    expect(html).toContain("scene.md");
    expect(html).toContain('aria-label="保存当前文档"');
    expect(html).toContain('aria-label="查找当前文档"');
    expect(html).not.toContain('aria-label="切换专注模式"');
  });
});
```

- [ ] **Step 2: Update shell tests to reject the all-chapters fallback**

In `workspace-shell.test.tsx`, render three chapter summaries with `openChapterTabIds: ["ch_opening"]`. Assert `开篇.md` is present and `第二章.md`/`第三章.md` are absent. Render without `openChapterTabIds` and assert no chapter tabs are fabricated.

- [ ] **Step 3: Run document and shell tests to verify failure**

Run:

```powershell
npm test -- packages/ui/test/editor-document-bar.test.tsx packages/ui/test/workspace-shell.test.tsx packages/ui/test/chapter-editor.test.tsx
```

Expected: FAIL because `EditorDocumentBar` does not exist, labels lack `.md`, and the shell falls back to all chapters.

- [ ] **Step 4: Create the shared document bar contract**

Create `packages/ui/src/editor-document-bar.tsx` with these exported types:

```ts
export interface EditorDocumentTab {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly dirty: boolean;
  readonly onSelect?: (() => void) | undefined;
  readonly onClose?: (() => void) | undefined;
}

export interface EditorDocumentBarProps {
  readonly tabs: readonly EditorDocumentTab[];
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly onSave?: (() => void) | undefined;
  readonly onFind?: (() => void) | undefined;
  readonly onFocusModeToggle?: (() => void) | undefined;
  readonly selectionAction?:
    | { readonly label: string; readonly onInvoke: () => void }
    | undefined;
}
```

Render tabs on the left and icon buttons (`Save`, `Search`, `Maximize2`) on the right. Render close only when `onClose` exists. Save stays visible when `onSave` exists but is disabled while clean or saving. Do not render any command without its callback.

- [ ] **Step 5: Build explicit open-document descriptors in WorkspaceEditorSurface**

Replace the current fallback:

```ts
const openChapterTabIds = projectWorkflow?.openChapterTabIds ?? [];
```

Map chapter labels with:

```ts
export function chapterDocumentLabel(title: string): string {
  return title.toLocaleLowerCase().endsWith(".md") ? title : `${title}.md`;
}
```

When `fileEditor` exists, append one active ordinary-file tab using `fileEditor.fileName`; chapter tabs remain visible but inactive. Add `onClose?: () => void` to `PlainFileEditorProps`. In `App.tsx`, implement close by calling `plainFileBridge.clear()`, clearing `fileEditor`, and reloading the active chapter if one exists.

Wrap tab selection/close handlers so they close the find overlay before invoking bridge callbacks in Task 6.

- [ ] **Step 6: Remove editor-internal headers and the old EditorToolbar component usage**

Delete the chapter `.ns-editor-header`, `.ns-editor-metrics`, and top save button from `chapter-editor.tsx`. Delete the ordinary-file header and placeholder find row from `workspace-shell.tsx`. Stop rendering `EditorToolbar` in both editors.

Keep `calculateWritingMetrics`, `DEFAULT_EDITOR_PREFERENCES`, and `editorFontFamilyValue`; remove the `EditorToolbar` export and delete `packages/ui/test/editor-toolbar.test.tsx` only after its metrics test has moved to a new `editor-metrics.test.ts` file.

- [ ] **Step 7: Style one flat document bar**

Replace pill-like `.ns-tabs/.ns-tab` styling with a stable 34px bar. Active tabs use the content surface and a 1px bottom/outline distinction, inactive tabs use the toolbar surface, dirty state uses a small dot, and close buttons appear for active or hovered tabs. Do not use rounded cards or wide shadows.

- [ ] **Step 8: Run document-bar tests and commit**

Run:

```powershell
npm test -- packages/ui/test/editor-document-bar.test.tsx packages/ui/test/editor-metrics.test.ts packages/ui/test/chapter-editor.test.tsx packages/ui/test/workspace-shell.test.tsx
npm run typecheck
```

Expected: all tests PASS and TypeScript exits with code 0.

```powershell
git add packages/ui/src/editor-document-bar.tsx packages/ui/test/editor-document-bar.test.tsx packages/ui/src/index.ts packages/ui/src/workspace-shell.tsx packages/ui/src/workspace-shell-types.ts packages/ui/src/chapter-editor.tsx packages/ui/src/styles.css packages/ui/test/editor-metrics.test.ts packages/ui/test/chapter-editor.test.tsx packages/ui/test/workspace-shell.test.tsx apps/desktop/src/renderer/App.tsx packages/ui/src/editor-toolbar.tsx packages/ui/test/editor-toolbar.test.tsx
git commit -m "feat: add a real editor document bar"
```

## Task 6: Convert Find/Replace into a Shared On-Demand Overlay

**Files:**
- Modify: `packages/ui/src/editor-find-replace.tsx`
- Modify: `packages/ui/src/editor-document-bar.tsx`
- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/test/editor-find-replace.test.ts`
- Create: `packages/ui/test/editor-find-replace-ui.test.tsx`
- Modify: `packages/ui/test/chapter-editor.test.tsx`
- Modify: `packages/ui/test/workspace-shell.test.tsx`

- [ ] **Step 1: Write failing UI tests for modes, close, and replacement row**

Create `packages/ui/test/editor-find-replace-ui.test.tsx` and mount `EditorFindReplace` in jsdom. Use this prop contract:

```tsx
<EditorFindReplace
  body="Moon over moon."
  mode="replace"
  onBodyChange={(body) => bodies.push(body)}
  onModeChange={(mode) => modes.push(mode)}
  onRequestEditorFocus={() => focusCalls.push("focus")}
  onSelectionChange={() => undefined}
/>
```

Assert that replace mode renders `查找内容`, `替换为`, `关闭查找替换`, and `全部替换`. Click close and expect `modes` to equal `["closed"]` and one focus call. Dispatch Escape from the overlay and assert the same behavior.

- [ ] **Step 2: Run the find tests and verify failure**

Run:

```powershell
npm test -- packages/ui/test/editor-find-replace.test.ts packages/ui/test/editor-find-replace-ui.test.tsx packages/ui/test/chapter-editor.test.tsx packages/ui/test/workspace-shell.test.tsx
```

Expected: FAIL because the overlay lacks mode, close, Escape, and focus restoration props.

- [ ] **Step 3: Replace the boolean API with an explicit mode**

Export:

```ts
export type EditorFindMode = "closed" | "find" | "replace";

export interface EditorFindReplaceProps {
  readonly body: string;
  readonly mode: EditorFindMode;
  readonly onBodyChange?: ((nextBody: string) => void) | undefined;
  readonly onModeChange?: ((mode: EditorFindMode) => void) | undefined;
  readonly onRequestEditorFocus?: (() => void) | undefined;
  readonly onSelectionChange?:
    | ((selection: { readonly anchor: number; readonly head: number }) => void)
    | undefined;
}
```

Return `null` for `closed`. Use a query input ref and focus it in `useEffect` whenever mode becomes `find` or `replace`. Implement one `close()` function that sets `closed` and requests editor focus.

- [ ] **Step 4: Render a two-row editor overlay**

First row order: replace expand/collapse button, query input, match count, previous, next, case-sensitive toggle, close. Second row renders only when mode is `replace` and contains replacement input, replace-current, replace-all.

Use Lucide `ChevronRight/ChevronDown`, `ChevronUp`, `ChevronDown`, `CaseSensitive`, `Replace`, `ReplaceAll`, and `X`. Every icon button must have `title` and matching `aria-label`.

On keydown, close only for Escape. Do not intercept Enter behavior outside the overlay.

- [ ] **Step 5: Connect document-bar click and editor shortcuts to one mode state**

In `WorkspaceEditorSurface`, hold:

```ts
const [findMode, setFindMode] = useState<EditorFindMode>("closed");
```

The document-bar search button sets `find`. Add these optional props to `ChapterEditorProps`:

```ts
readonly findMode?: EditorFindMode | undefined;
readonly onFindModeChange?: ((mode: EditorFindMode) => void) | undefined;
```

Pass `findMode` and `setFindMode` from `WorkspaceEditorSurface` into `ChapterEditor`. Pass the same pair as local parameters to `PlainFileEditor`; do not create a second mode state inside either editor. Each editor renders its own `EditorFindReplace`, which lets it supply its private focus handle without exposing CodeMirror or textarea instances to the shell.

Wrapped tab select/close callbacks set `closed` before invoking project callbacks. Reset to `closed` in a `useEffect` keyed by `activeChapterId` and `fileEditor?.path`.

Change the CodeMirror keymap callback to receive a mode:

```ts
readonly onFindReplaceOpen: (mode: Exclude<EditorFindMode, "closed">) => void;
```

Bind `Mod-f` to `find` and `Mod-h` to `replace`. In the textarea fallback and ordinary-file textarea, handle the same shortcuts and call `preventDefault()`.

- [ ] **Step 6: Restore focus to CodeMirror or textarea**

In `ChapterEditor`, store a focus function:

```ts
const editorFocusRef = useRef<() => void>(() => undefined);
```

Pass a registration callback to `CodeMirrorChapterEditor`; after creating its `EditorView`, register `() => view.focus()` and reset the handle on cleanup. For textarea, assign `() => textarea.focus()` through its ref callback. Pass `editorFocusRef.current` to `EditorFindReplace` through a stable callback.

Use the same textarea focus approach inside `PlainFileEditor`.

- [ ] **Step 7: Position the overlay without changing editor height**

Make `.ns-editor-surface` and `.ns-editor-layout` positioning contexts. Style:

```css
.ns-editor-find-replace {
  background: var(--ns-surface-raised);
  border: 1px solid var(--ns-border);
  border-radius: 4px;
  display: grid;
  gap: 4px;
  max-width: calc(100% - 16px);
  padding: 4px;
  position: absolute;
  right: 8px;
  top: 8px;
  width: 420px;
  z-index: 30;
}
```

Use fixed grid tracks for each row so icons cannot resize the overlay. At `max-width: 520px`, set `left: 8px; right: 8px; width: auto;` and keep inputs `min-width: 0`.

- [ ] **Step 8: Run shared find tests and commit**

Run:

```powershell
npm test -- packages/ui/test/editor-find-replace.test.ts packages/ui/test/editor-find-replace-ui.test.tsx packages/ui/test/chapter-editor.test.tsx packages/ui/test/workspace-shell.test.tsx
npm run typecheck
```

Expected: all tests PASS and TypeScript exits with code 0.

```powershell
git add packages/ui/src/editor-find-replace.tsx packages/ui/src/editor-document-bar.tsx packages/ui/src/chapter-editor.tsx packages/ui/src/workspace-shell.tsx packages/ui/src/styles.css packages/ui/test/editor-find-replace.test.ts packages/ui/test/editor-find-replace-ui.test.tsx packages/ui/test/chapter-editor.test.tsx packages/ui/test/workspace-shell.test.tsx
git commit -m "feat: add on-demand editor find replace"
```

- [ ] **Step 9: Update Electron selectors for the new document bar**

In `apps/desktop/test/project-workflow.e2e.ts`, replace old tab and save selectors with the final accessible names:

```ts
await expect(page.getByRole("tab", { name: "第一章.md" })).toBeVisible();
await page.getByRole("button", { name: "保存当前文档" }).click();
```

Add an interaction smoke after a chapter is open:

```ts
await page.getByRole("button", { name: "查找当前文档" }).click();
await expect(page.getByLabel("查找替换")).toBeVisible();
await page.keyboard.press("Escape");
await expect(page.getByLabel("查找替换")).toHaveCount(0);
```

Run:

```powershell
npx playwright test apps/desktop/test/project-workflow.e2e.ts
```

Expected: PASS with the new document bar and overlay selectors.

- [ ] **Step 10: Commit the E2E selector update**

```powershell
git add apps/desktop/test/project-workflow.e2e.ts
git commit -m "test: cover document bar find workflow"
```

## Task 7: Move Real Document State into the Bottom Status Bar

**Files:**
- Modify: `apps/desktop/src/renderer/editor-runtime.ts`
- Modify: `apps/desktop/test/editor-runtime.test.ts`
- Modify: `packages/ui/src/chapter-editor.tsx`
- Modify: `packages/ui/src/workspace-shell.tsx`
- Modify: `packages/ui/src/styles.css`
- Modify: `packages/ui/test/chapter-editor.test.tsx`
- Modify: `packages/ui/test/workspace-shell.test.tsx`

- [ ] **Step 1: Write failing runtime tests for real line/column data**

In `apps/desktop/test/editor-runtime.test.ts`, mount a runtime with body `"First\nSecond line"`, update selection to `{ anchor: 8, head: 8 }`, and assert:

```ts
expect(buildChapterEditorRuntimeProps(handle.getSnapshot())).toMatchObject({
  cursorPositionLabel: "行 2，列 3"
});
```

For `{ anchor: 0, head: 5 }`, assert:

```ts
expect(buildChapterEditorRuntimeProps(handle.getSnapshot())).toMatchObject({
  cursorPositionLabel: "已选择 5 字"
});
```

- [ ] **Step 2: Write failing shell tests for compact active-document status**

Render a chapter editor with `body: "她走进雨里。\nA quiet room waits."` and runtime cursor label. Assert the status bar contains `已保存`, `9 字`, `约 1 分钟阅读`, `行 2，列 3`, and `Markdown`; assert it does not contain the chapter title, AI status, CodeMirror label, or default shortcuts.

Render settings mode and assert no status bar. Render no chapter/file editor and assert no `Markdown`, word count, reading time, or cursor label.

- [ ] **Step 3: Run runtime and shell tests to verify failure**

Run:

```powershell
npm test -- apps/desktop/test/editor-runtime.test.ts packages/ui/test/chapter-editor.test.tsx packages/ui/test/workspace-shell.test.tsx
```

Expected: FAIL because cursor position is not exposed and status bar still shows chapter/AI metadata.

- [ ] **Step 4: Add cursorPositionLabel to the runtime UI contract**

Add to `ChapterEditorRuntimeProps`:

```ts
readonly cursorPositionLabel: string;
```

In `editor-runtime.ts`, add:

```ts
function formatCursorPosition(snapshot: EditorRuntimeSnapshot): string {
  const selection = snapshot.selection;
  if (selection !== undefined && selection.anchor !== selection.head) {
    return `已选择 ${Math.abs(selection.head - selection.anchor)} 字`;
  }
  const offset = selection?.head ?? 0;
  const prefix = snapshot.body.slice(0, offset);
  const lines = prefix.split("\n");
  return `行 ${lines.length}，列 ${(lines.at(-1)?.length ?? 0) + 1}`;
}
```

Set `cursorPositionLabel: formatCursorPosition(snapshot)` in `buildChapterEditorRuntimeProps`.

- [ ] **Step 5: Stop rendering runtime metadata above the editor**

Replace `ChapterEditorRuntime` with a warning-only component that returns `null` when `runtime.warnings.length === 0` and otherwise renders the warning list. Do not render adapter, mode, range, autosave, shortcuts, migration, or diff runtime labels.

The selection AI action now comes from `runtime.selectionAiPreviewCommand` through `EditorDocumentBar`; render it only when the command has no disabled reason and `onSelectionAiPreview` exists.

- [ ] **Step 6: Derive active document status in WorkspaceShell**

Use `calculateWritingMetrics` for chapter and ordinary-file bodies. Track ordinary-file selection in `WorkspaceShell` as `{ anchor, head }`, update it from the textarea `select`, `click`, and `keyup` events, and format it with a shared `formatDocumentCursorLabel(body, selection)` helper.

Render:

```tsx
<footer aria-label="状态栏" className="ns-status-bar" data-region="status-bar">
  <div className="ns-status-bar-left">
    <span>{activeSaveStatus}</span>
  </div>
  <div className="ns-status-bar-right">
    <span>{metrics.wordCountLabel}</span>
    <span>{metrics.readingTimeLabel}</span>
    <span>{cursorPositionLabel}</span>
    <span>{documentMode}</span>
  </div>
</footer>
```

Return only existing workspace state when there is no active document; do not substitute `未命名章节` or `Markdown`.

- [ ] **Step 7: Make the status bar visually secondary and overflow-safe**

Set it to 22-24px high, 11px type, left/right groups with `margin-left: auto` on the right, 10px gaps, and ellipsis for individual spans. At narrow widths hide reading time before hiding cursor or document mode. Keep the bar outside the editor scroll area.

- [ ] **Step 8: Run status tests and commit**

Run:

```powershell
npm test -- apps/desktop/test/editor-runtime.test.ts packages/ui/test/chapter-editor.test.tsx packages/ui/test/workspace-shell.test.tsx
npm run typecheck
```

Expected: all tests PASS and TypeScript exits with code 0.

```powershell
git add apps/desktop/src/renderer/editor-runtime.ts apps/desktop/test/editor-runtime.test.ts packages/ui/src/chapter-editor.tsx packages/ui/src/workspace-shell.tsx packages/ui/src/styles.css packages/ui/test/chapter-editor.test.tsx packages/ui/test/workspace-shell.test.tsx
git commit -m "feat: move editor state to the status bar"
```

## Task 8: Full Regression and Visual Acceptance

**Files:**
- Modify only when verification finds a defect: files already listed in Tasks 1-7
- Test: `apps/desktop/test/project-workflow.e2e.ts`
- Test: `apps/desktop/test/beta-startup.e2e.ts`
- Create: `apps/desktop/test/settings-editor-chrome.e2e.ts`

- [ ] **Step 1: Run the complete focused acceptance set**

```powershell
npm test -- packages/application/test/user-preferences-session.test.ts packages/repository/test/user-preferences-repository.test.ts packages/ui/test/settings-and-studio.test.tsx packages/ui/test/editor-document-bar.test.tsx packages/ui/test/editor-metrics.test.ts packages/ui/test/editor-find-replace.test.ts packages/ui/test/editor-find-replace-ui.test.tsx packages/ui/test/chapter-editor.test.tsx packages/ui/test/workspace-shell.test.tsx apps/desktop/test/settings-bridge.test.ts apps/desktop/test/app-shell-support.test.ts apps/desktop/test/editor-runtime.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run the full repository gates**

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: Vitest PASS, TypeScript exits 0, Vite build exits 0, and `git diff --check` prints no errors. Existing Vite chunk-size or browser-externalization warnings may remain, but no new warning is accepted without documenting its source.

- [ ] **Step 3: Run Electron writing-path smoke tests**

```powershell
npx playwright test apps/desktop/test/project-workflow.e2e.ts apps/desktop/test/beta-startup.e2e.ts
```

Expected: both Electron specs PASS.

- [ ] **Step 4: Add a real Electron visual-acceptance spec**

Create `apps/desktop/test/settings-editor-chrome.e2e.ts`. Launch Electron with a temporary default project and user-data root, then use `electronApp.browserWindow(page)` to resize the real window:

```ts
await browserWindow.evaluate((window) => window.setSize(1440, 900));
```

Cover these states with assertions and `page.screenshot({ path, fullPage: true })`:

- Desktop workspace, chapter open, find closed: one `文档栏`, no `查找替换`.
- Desktop replace overlay: `Ctrl+H`, visible overlay, no change to `.ns-editor-panes` bounding-box top.
- Desktop settings: click the settings activity, settings workspace visible, editor/AI/status regions absent.
- Desktop light/blue: select light theme and blue accent, verify shell data attributes.
- Narrow 760x720 workspace: document tab and overlay remain inside editor bounds.
- Narrow settings: category list is horizontal and settings content width is positive.

Write screenshots under `test-results/settings-editor-chrome/`. In the test, compare `boundingBox()` values to assert the overlay is inside the editor surface and does not alter the editor-pane top coordinate.

- [ ] **Step 5: Run the Electron visual-acceptance spec**

```powershell
npm run build
npx playwright test apps/desktop/test/settings-editor-chrome.e2e.ts
```

Expected: PASS and six non-empty PNG files under `test-results/settings-editor-chrome/`.

- [ ] **Step 6: Inspect screenshots and computed theme semantics**

Open every PNG with the local image viewer. Verify no overlap, no clipped button labels, no blank editor canvas, no fixed find row when closed, and no status bar in settings mode.

Use `page.evaluate` in the E2E test to read computed colors for body text/background, muted text/background, selected tab, focused button, and each accent swatch. Add assertions that error/warning/success token values remain identical before and after switching `data-accent`. Calculate contrast in the test helper and require at least 4.5:1 for normal functional text.

- [ ] **Step 7: Fix only acceptance defects and rerun the smallest affected gate**

For each visual or behavioral defect, add or tighten the nearest automated test first, make the smallest implementation change, rerun that test, then rerun `npm run typecheck`. Do not refactor unrelated shell or workflow code during this step.

- [ ] **Step 8: Commit the visual spec and final acceptance fixes**

If verification required changes:

```powershell
git add packages/ui apps/desktop/src/renderer apps/desktop/test/settings-editor-chrome.e2e.ts apps/desktop/test/project-workflow.e2e.ts packages/application packages/repository packages/shared
git commit -m "fix: finish settings and editor chrome acceptance"
```

If no verification change was required, do not create an empty commit.
