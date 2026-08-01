// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AgentContextMenu } from "../src/agent-context-menu.js";
import type { AgentComposerContextStatusControl } from "../src/workspace-shell-types.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots: Root[] = [];

describe("AgentContextMenu", () => {
  afterEach(() => {
    act(() => {
      for (const root of mountedRoots.splice(0)) root.unmount();
    });
    document.body.replaceChildren();
  });

  test("switches between source details and the actual author-context preview", () => {
    const control = createControl();
    const { host } = render(control);
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label^="上下文超出预算"]');
    expect(trigger).not.toBeNull();

    act(() => trigger?.click());
    const panel = document.querySelector<HTMLElement>('[aria-label="上下文用量"]');
    expect(panel).not.toBeNull();
    expect(
      panel?.querySelector('[data-context-tab="sources"]')?.getAttribute("aria-selected")
    ).toBe("true");
    expect(panel?.querySelector('[aria-label="上下文来源"]')?.textContent).toContain("世界规则");
    expect(panel?.textContent).toContain("排除上下文不等于禁止工具读取");
    expect(panel?.textContent).toContain("固定项超过安全输入预算");

    act(() => panel?.querySelector<HTMLButtonElement>('[data-context-tab="preview"]')?.click());
    expect(
      panel?.querySelector('[data-context-tab="preview"]')?.getAttribute("aria-selected")
    ).toBe("true");
    expect(panel?.querySelector('[aria-label="上下文来源"]')).toBeNull();
    const preview = panel?.querySelector('[aria-label="实际发送预览"]');
    expect(preview?.textContent).toContain("作者项目上下文");
    expect(preview?.textContent).toContain("城门在日落后关闭");
    expect(preview?.textContent).not.toContain("provider-secret");
    expect(preview?.textContent).not.toContain("hidden-system-instruction");
  });

  test("exposes scope, source actions, and priority changes through optional callbacks", () => {
    const onScopeChange = vi.fn<(scope: "run" | "project") => void>();
    const onPin = vi.fn<() => void>();
    const onExclude = vi.fn<() => void>();
    const onRestore = vi.fn<() => void>();
    const onPriorityChange = vi.fn<(priority: number) => void>();
    const control = createControl({
      onScopeChange,
      sourceOverrides: { onPin, onExclude, onRestore, onPriorityChange }
    });
    const { host } = render(control);
    act(() => host.querySelector<HTMLButtonElement>('[aria-label^="上下文"]')?.click());

    const scopeGroup = document.querySelector<HTMLElement>('[aria-label="上下文偏好作用域"]');
    act(() => scopeGroup?.querySelector<HTMLButtonElement>("button:last-child")?.click());
    expect(onScopeChange).toHaveBeenCalledWith("project");

    act(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="固定来源 世界规则"]')?.click()
    );
    act(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="排除来源 世界规则"]')?.click()
    );
    act(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="恢复来源 世界规则"]')?.click()
    );
    expect(onPin).toHaveBeenCalledTimes(1);
    expect(onExclude).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledTimes(1);

    const priority = document.querySelector<HTMLInputElement>(
      '[aria-label="调整 世界规则 优先级"]'
    );
    expect(priority?.type).toBe("number");
    act(() => {
      if (priority === null) throw new Error("priority input missing");
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(priority, "81");
      priority.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onPriorityChange).toHaveBeenCalledWith(81);
  });

  test("shows an unavailable preview without fabricating hidden prompt data", () => {
    const { host } = render(
      createControl({
        previewBlocks: [],
        previewUnavailableReason: "预览已过期，请重新打包。"
      })
    );
    act(() => host.querySelector<HTMLButtonElement>('[aria-label^="上下文"]')?.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-context-tab="preview"]')?.click());
    const preview = document.querySelector('[aria-label="实际发送预览"]');
    expect(preview?.textContent).toContain("预览已过期");
    expect(preview?.textContent).not.toContain("暂无可预览");
    expect(preview?.textContent).not.toContain("system");
  });

  test("labels an automatically resolved source instead of hiding its preference scope", () => {
    const { host } = render(createControl({ sourcePreferenceScope: "automatic" }));
    act(() => host.querySelector<HTMLButtonElement>('[aria-label^="上下文"]')?.click());

    const sources = document.querySelector('[aria-label="上下文来源"]');
    expect(sources?.textContent).toContain("自动选择");
    expect(sources?.textContent).toContain("自动");
  });
});

interface ControlOverrides {
  readonly onScopeChange?: (scope: "run" | "project") => void;
  readonly sourcePreferenceScope?: "automatic" | "run" | "project";
  readonly sourceOverrides?: {
    readonly onPin?: () => void;
    readonly onExclude?: () => void;
    readonly onRestore?: () => void;
    readonly onPriorityChange?: (priority: number) => void;
  };
  readonly previewBlocks?: AgentComposerContextStatusControl["previewBlocks"];
  readonly previewUnavailableReason?: string;
}

function createControl(overrides: ControlOverrides = {}): AgentComposerContextStatusControl {
  const source = {
    refId: "story_bible:rule-1",
    label: "世界规则",
    detail: "世界观 · 46 tokens",
    layerLabel: "世界观",
    selectionReason: "当前章节涉及城门规则",
    selectionPolicy: "automatic" as const,
    preferenceScope: overrides.sourcePreferenceScope ?? ("run" as const),
    priority: 35,
    state: "active" as const,
    tokenCount: 46,
    precision: "reported" as const,
    sourceChecksum: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    sourceRevision: 4,
    materializationOrder: 2,
    truncationRange: null,
    ...overrides.sourceOverrides
  };
  return {
    state: "normal",
    usageLabel: "1.2k / 8k",
    precision: "reported",
    preferenceScope: "run",
    ...(overrides.onScopeChange === undefined
      ? {}
      : { onPreferenceScopeChange: overrides.onScopeChange }),
    fixedBudgetExceeded: true,
    fixedBudgetMessage: "固定项超过安全输入预算，发送已阻止。",
    tokenStats: {
      contextTokens: 8_100,
      pinnedTokens: 8_100,
      usedTokens: 8_100,
      safeInputBudget: 8_000,
      remainingTokens: 0,
      precision: "reported"
    },
    sources: [source],
    previewPayloadChecksum: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    previewBlocks: overrides.previewBlocks ?? [
      {
        blockId: "context-block-1",
        refId: source.refId,
        label: source.label,
        content: "城门在日落后关闭。",
        order: 2,
        tokenCount: 46,
        precision: "reported",
        checksum: "feedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface",
        truncationRange: null,
        // Deliberately ignored by the UI; internal prompt data is not in the display contract.
        providerMetadata: "provider-secret",
        hiddenInstruction: "hidden-system-instruction"
      } as unknown as NonNullable<AgentComposerContextStatusControl["previewBlocks"]>[number]
    ],
    ...(overrides.previewUnavailableReason === undefined
      ? {}
      : { previewUnavailableReason: overrides.previewUnavailableReason })
  };
}

function render(control: AgentComposerContextStatusControl) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mountedRoots.push(root);
  act(() => root.render(<AgentContextMenu control={control} />));
  return { host };
}
