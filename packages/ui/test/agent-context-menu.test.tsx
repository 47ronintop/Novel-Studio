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
    const sources = panel?.querySelector('[aria-label="上下文来源"]');
    expect(sources?.textContent).toContain("世界规则");
    expect(sources?.textContent).toContain("世界观 · 46 tokens");
    expect(sources?.textContent).not.toContain("当前章节涉及城门规则");
    expect(sources?.textContent).not.toContain("自动选择");
    expect(sources?.textContent).not.toContain("优先级");
    expect(sources?.textContent).not.toContain("修订");
    expect(sources?.textContent).not.toContain("顺序");
    expect(sources?.textContent).not.toContain("校验");
    expect(panel?.textContent).not.toContain("固定 8100");
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

  test("keeps scope and essential source actions without the priority editor", () => {
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

    expect(document.querySelector('[aria-label="调整 世界规则 优先级"]')).toBeNull();
    expect(onPriorityChange).not.toHaveBeenCalled();
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

  test("renders the exact Main-owned first-round target, guidance, tools, and sources", () => {
    const { host } = render(createControl({ sendPreview: exactSendPreview() }));
    act(() => host.querySelector<HTMLButtonElement>('[aria-label^="上下文"]')?.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-context-tab="preview"]')?.click());

    const preview = document.querySelector('[aria-label="实际发送预览"]');
    expect(preview?.textContent).toContain("OpenAI");
    expect(preview?.textContent).toContain("GPT Test");
    expect(preview?.textContent).toContain("Writing account");
    expect(preview?.textContent).toContain("System Guidance 3.0");
    expect(preview?.textContent).toContain("SYSTEM AUTHORITY BODY");
    expect(preview?.textContent).toContain("list_chapters");
    expect(preview?.textContent).toContain("additionalProperties");
    expect(preview?.textContent).toContain("PROJECT CONVENTIONS BODY");
    expect(preview?.textContent).toContain("未保存");
    expect(preview?.textContent).toContain("已截断");
    expect(preview?.textContent).toContain("Provider 账户身份");
    expect(preview?.textContent).not.toContain("城门在日落后关闭");
  });

  test("hides automatic-selection internals from the compact source row", () => {
    const { host } = render(createControl({ sourcePreferenceScope: "automatic" }));
    act(() => host.querySelector<HTMLButtonElement>('[aria-label^="上下文"]')?.click());

    const sources = document.querySelector('[aria-label="上下文来源"]');
    expect(sources?.textContent).toContain("世界规则");
    expect(sources?.textContent).not.toContain("自动选择");
    expect(sources?.textContent).not.toContain("自动");
  });

  test("keeps context refresh and compaction as separate actions", () => {
    const onRefresh = vi.fn();
    const onCompact = vi.fn();
    const { host } = render({ ...createControl(), onRefresh, onCompact });
    act(() => host.querySelector<HTMLButtonElement>('[aria-label^="上下文"]')?.click());

    const refresh = document.querySelector<HTMLButtonElement>(
      'button[title^="重新读取当前项目资料"]'
    );
    const compact = document.querySelector<HTMLButtonElement>('button[aria-label="压缩上下文"]');
    expect(refresh?.textContent).toContain("刷新上下文");
    expect(compact?.textContent).toContain("压缩上下文");
    expect(compact?.disabled).toBe(false);
    act(() => compact?.click());
    expect(onCompact).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
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
  readonly sendPreview?: AgentComposerContextStatusControl["sendPreview"];
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
      : { previewUnavailableReason: overrides.previewUnavailableReason }),
    ...(overrides.sendPreview === undefined ? {} : { sendPreview: overrides.sendPreview })
  };
}

function exactSendPreview(): NonNullable<AgentComposerContextStatusControl["sendPreview"]> {
  return {
    schemaVersion: "2.0",
    previewId: "preview_01",
    createdAt: "2026-08-04T00:00:00.000Z",
    expiresAt: "2026-08-04T00:05:00.000Z",
    canonicalPayloadChecksum: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    target: {
      providerLabel: "OpenAI",
      modelLabel: "GPT Test",
      connectionLabel: "Writing account",
      adapterPolicyLabel: "Chat Completions"
    },
    guidance: {
      version: "3.0",
      profileId: "writing",
      runtimeFacts: { operationMode: "planning", workspaceKind: "creativeProject" },
      content: "SYSTEM AUTHORITY BODY"
    },
    tools: [
      {
        name: "list_chapters",
        description: "List chapters",
        inputSchema: { type: "object", additionalProperties: false, properties: {} }
      }
    ],
    sources: [
      {
        sourceRef: "project:conventions",
        label: "Project conventions",
        kind: "project_conventions",
        content: "PROJECT CONVENTIONS BODY",
        tokenCount: 18,
        tokenPrecision: "reported",
        dirty: true,
        truncated: true,
        selectionState: "pinned",
        grantSource: "run_grant"
      }
    ],
    retainedLocalProvenanceKinds: ["canonical_root_identity", "provider_account_identity"],
    providerNativeSemanticChecksum:
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
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
