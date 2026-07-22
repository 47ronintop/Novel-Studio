// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AgentComposer } from "../src/agent-composer.js";
import type { AgentComposerProps } from "../src/workspace-shell-types.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("AgentComposer", () => {
  afterEach(() => document.body.replaceChildren());

  test("renders one draft input and the approved single-row controls", () => {
    const { host } = renderComposer();

    expect(host.querySelectorAll('textarea[aria-label="Agent 请求"]')).toHaveLength(1);
    expect(host.querySelectorAll('button[aria-label="启动 Agent 运行"]')).toHaveLength(1);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="执行"]')?.textContent).toContain(
      "执行"
    );
    expect(host.querySelector('[aria-label="添加引用与执行审批"]')).not.toBeNull();
    expect(document.querySelectorAll('[aria-label="计划或执行模式"]')).toHaveLength(0);
    expect(host.querySelectorAll('[aria-label="上下文"]')).toHaveLength(0);
  });

  test("sends trimmed text with Enter, preserves Shift+Enter, and disables whitespace", () => {
    const onSend = vi.fn();
    const { host, rerender } = renderComposer({ request: "  继续检查  ", onSend });
    const input = host.querySelector<HTMLTextAreaElement>('[aria-label="Agent 请求"]');

    const sendEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true
    });
    act(() => input?.dispatchEvent(sendEvent));
    expect(sendEvent.defaultPrevented).toBe(true);
    expect(onSend).toHaveBeenCalledWith("继续检查");

    const newlineEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true
    });
    act(() => input?.dispatchEvent(newlineEvent));
    expect(newlineEvent.defaultPrevented).toBe(false);
    expect(onSend).toHaveBeenCalledTimes(1);

    rerender({ request: "   ", onSend });
    expect(host.querySelector<HTMLButtonElement>('[aria-label="启动 Agent 运行"]')?.disabled).toBe(
      true
    );
  });

  test("replaces send with one stop while active and keeps permission details readable", () => {
    const onStop = vi.fn();
    const { host } = renderComposer({ active: true, onStop });

    expect(host.querySelector('[aria-label="启动 Agent 运行"]')).toBeNull();
    expect(host.querySelectorAll('[aria-label="停止 Agent 运行"]')).toHaveLength(1);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Agent 请求"]')?.disabled).toBe(
      true
    );
    expect(host.querySelector<HTMLButtonElement>('[aria-label="执行"]')?.disabled).toBe(true);
    const permissionTrigger = host.querySelector<HTMLButtonElement>(
      '[aria-label="添加引用与执行审批"]'
    );
    expect(permissionTrigger?.disabled).toBe(false);
    act(() => permissionTrigger?.click());
    expect(
      Array.from(document.querySelectorAll<HTMLInputElement>('[name="agent-write-policy"]')).every(
        (input) => input.disabled
      )
    ).toBe(true);
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="停止 Agent 运行"]')?.click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  test("opens one Plan/Act group without changing the approval policy", () => {
    const onOperationModeChange = vi.fn();
    const onWritePolicyChange = vi.fn();
    const { host } = renderComposer({
      writePolicy: "user_preapproved_run",
      writePolicyAcknowledged: true,
      onOperationModeChange,
      onWritePolicyChange
    });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="执行"]');

    act(() =>
      trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    );
    expect(document.activeElement).toBe(document.querySelector('[data-mode-option="execution"]'));
    expect(document.querySelectorAll('[role="dialog"][aria-label="计划或执行模式"]')).toHaveLength(
      1
    );
    const modeGroup = document.querySelector('[role="group"][aria-label="计划或执行模式"]');
    expect(modeGroup?.textContent).toContain("计划");
    expect(modeGroup?.textContent).toContain("执行");
    expect(modeGroup?.textContent).not.toContain("自动");
    expect(host.querySelectorAll('[aria-label="上下文"]')).toHaveLength(0);
    expect(host.querySelector("[data-context-option]")).toBeNull();

    const automatic = document.querySelector<HTMLButtonElement>('[data-mode-option="execution"]');
    act(() =>
      automatic?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    );
    expect(document.activeElement?.textContent).toContain("计划");
    act(() => (document.activeElement as HTMLButtonElement | null)?.click());

    expect(onOperationModeChange).toHaveBeenCalledWith("planning");
    expect(onOperationModeChange).toHaveBeenCalledTimes(1);
    expect(onWritePolicyChange).not.toHaveBeenCalled();
    expect(document.querySelector('[aria-label="计划或执行模式"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("closes the mode popover with Escape and hides approval while planning", () => {
    const { host } = renderComposer({ operationMode: "planning" });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="计划"]');
    expect(host.textContent).not.toContain("每次修改前确认");
    expect(host.querySelector('[aria-label="添加引用与执行审批"]')).not.toBeNull();

    act(() => trigger?.click());
    const popover = document.querySelector<HTMLElement>('[aria-label="计划或执行模式"]');
    act(() =>
      popover?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    );
    expect(document.querySelector('[aria-label="计划或执行模式"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("keeps permission details closed by default and reveals server-owned forbidden capabilities on demand", () => {
    const onOpen = vi.fn();
    const { host } = renderComposer({ permission: permissionControl({ onOpen }) });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="添加引用与执行审批"]');

    expect(trigger).not.toBeNull();
    expect(document.querySelector('[aria-label="执行审批"]')).toBeNull();
    act(() => trigger?.click());

    expect(onOpen).toHaveBeenCalledTimes(1);
    const summary = document.querySelector<HTMLDetailsElement>('[aria-label="本次权限摘要"]');
    expect(summary?.open).toBe(false);
    expect(document.querySelector('[aria-label="执行审批"]')?.textContent).toContain("请求批准");
    expect(document.querySelector('[aria-label="执行审批"]')?.textContent).toContain("替我审批");
    expect(document.querySelectorAll(".ns-agent-permission-choice-icon")).toHaveLength(2);
    expect(document.querySelectorAll(".ns-agent-permission-choice-check")).toHaveLength(1);

    act(() => summary?.querySelector("summary")?.click());
    expect(summary?.open).toBe(true);
    expect(summary?.textContent).toContain("Shell");
    expect(summary?.textContent).toContain("Git");
    expect(summary?.textContent).toContain("网络");
    expect(summary?.textContent).toContain("propose_chapter_write");
    expect(summary?.textContent).toContain("写作上下文");
    expect(summary?.textContent).not.toContain("通用文件");
  });

  test("treats choosing preapproval as the current-run acknowledgement", () => {
    const onWritePolicyChange = vi.fn();
    const { host } = renderComposer({
      permission: permissionControl(),
      onWritePolicyChange
    });

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="添加引用与执行审批"]')?.click());
    act(() => document.querySelectorAll<HTMLInputElement>('[type="radio"]')[1]?.click());
    expect(onWritePolicyChange).toHaveBeenCalledWith("user_preapproved_run");
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();

    const onSend = vi.fn();
    const acknowledged = renderComposer({
      writePolicy: "user_preapproved_run",
      // The engine still records acknowledgement, but the Composer must never expose a second gate.
      writePolicyAcknowledged: false,
      onSend
    });
    act(() =>
      acknowledged.host.querySelector<HTMLButtonElement>('[aria-label="启动 Agent 运行"]')?.click()
    );
    expect(onSend).toHaveBeenCalledWith("检查当前章节");
  });

  test("closes an open mode popover when the run becomes active", () => {
    const { host, rerender } = renderComposer();
    act(() => host.querySelector<HTMLButtonElement>('[title="选择计划或执行模式"]')?.click());
    expect(document.querySelector('[aria-label="计划或执行模式"]')).not.toBeNull();

    rerender({ active: true });

    expect(document.querySelector('[aria-label="计划或执行模式"]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[title="选择计划或执行模式"]')?.disabled).toBe(
      true
    );
  });

  test("uses one compact footer row with a fixed command slot", () => {
    const { host } = renderComposer({ disabled: true, disabledReason: "只读会话" });
    const composer = host.querySelector('[aria-label="会话输入区"]');
    expect(composer?.querySelector(":scope > .ns-agent-conversation-composer-note")).not.toBeNull();
    expect(composer?.querySelector(":scope > .ns-agent-composer-surface")).not.toBeNull();
    expect(composer?.querySelector('[aria-label="会话工具栏"]')).not.toBeNull();
    expect(composer?.querySelector(".ns-agent-composer-footer")).not.toBeNull();
    expect(composer?.querySelector(".ns-agent-composer-config-row")).toBeNull();
    expect(composer?.querySelector(".ns-agent-composer-action-row")).toBeNull();

    const css = readFileSync(join(process.cwd(), "packages", "ui", "src", "styles.css"), "utf8");
    expect(css).toMatch(
      /\.ns-agent-conversation-composer\.ns-agent-composer\s*\{[^}]*display:\s*block/s
    );
    expect(css).toMatch(
      /\.ns-agent-composer-surface\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
    );
    expect(css).toMatch(/\.ns-agent-composer-footer\s*\{[^}]*display:\s*grid/s);
    expect(css).toMatch(
      /\.ns-agent-composer-footer\s*\{[^}]*grid-template-columns:\s*28px max-content 28px minmax\(72px, 1fr\) 30px/s
    );
    expect(css).not.toMatch(/\.ns-agent-composer-footer-leading\s*\{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/\.ns-agent-composer-command-slot\s*\{[^}]*grid-column:\s*5/s);
    expect(css).toMatch(
      /\.ns-agent-popover-layer\s*>\s*\.ns-agent-floating-popover\s*\{[^}]*position:\s*fixed/s
    );
    expect(css).toMatch(
      /\.ns-agent-composer-model-popover\s*\{[^}]*width:\s*min\(216px,\s*calc\(100vw - 16px\)\)/s
    );
  });

  test("keeps run mode and permission available when model and reference controls are absent", () => {
    const { host } = renderComposer();
    expect(host.querySelector('[aria-label^="模型与推理："]')).toBeNull();
    expect(host.querySelector('[aria-label="添加引用与执行审批"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="执行"]')).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="添加引用与执行审批"]')?.click());
    expect(document.querySelector('[aria-label="执行审批"]')).not.toBeNull();
  });

  test("selects a model profile and writes the choice through onSelect", () => {
    const onSelect = vi.fn();
    const { host } = renderComposer({
      model: {
        profiles: [
          { id: "p1", label: "GPT-Writer", provider: "openai" },
          { id: "p2", label: "Claude-Writer", provider: "anthropic" }
        ],
        selectedProfileId: "p1",
        onSelect
      }
    });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="模型与推理：GPT-Writer"]');
    expect(trigger?.textContent).toContain("GPT-Writer");
    act(() => trigger?.click());
    expect(document.querySelector('[data-model-menu="model"]')).not.toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('[data-model-menu="model"]')?.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-model-option="p2"]')?.click());
    expect(onSelect).toHaveBeenCalledWith("p2");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("includes reasoning in the model menu only when visible and reports the choice", () => {
    const model = {
      profiles: [{ id: "p1", label: "GPT-Writer", provider: "openai" }],
      selectedProfileId: "p1",
      onSelect: vi.fn()
    };
    const onSelect = vi.fn();
    const hidden = renderComposer({
      model,
      reasoning: { visible: false, values: ["low", "high"], current: "low", onSelect }
    });
    const hiddenTrigger = hidden.host.querySelector<HTMLButtonElement>(
      '[aria-label="模型与推理：GPT-Writer"]'
    );
    expect(hiddenTrigger).not.toBeNull();
    act(() => hiddenTrigger?.click());
    expect(document.querySelector('[aria-label="推理强度"]')).toBeNull();
    expect(document.querySelector('[aria-label^="推理强度："]')).toBeNull();
    act(() => hiddenTrigger?.click());

    const onSelect2 = vi.fn();
    const { host } = renderComposer({
      model,
      reasoning: {
        visible: true,
        values: ["low", "medium", "high"],
        current: "medium",
        onSelect: onSelect2
      }
    });
    const trigger = host.querySelector<HTMLButtonElement>(
      '[aria-label="模型与推理：GPT-Writer · 中"]'
    );
    expect(trigger).not.toBeNull();
    act(() => trigger?.click());
    expect(document.querySelector('[data-model-menu="reasoning"]')).not.toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('[data-model-menu="reasoning"]')?.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-reasoning-option="high"]')?.click());
    expect(onSelect2).toHaveBeenCalledWith("high");
  });

  test("drills into model and reasoning choices inside one anchored menu", () => {
    const model = {
      profiles: [
        { id: "p1", label: "GPT-Writer", provider: "openai" },
        { id: "p2", label: "Claude-Writer", provider: "anthropic" }
      ],
      selectedProfileId: "p1",
      onSelect: vi.fn()
    };
    const { host } = renderComposer({
      model,
      reasoning: {
        visible: true,
        values: ["low", "medium", "high"],
        current: "medium",
        onSelect: vi.fn()
      }
    });
    act(() => host.querySelector<HTMLButtonElement>('[aria-label^="模型与推理："]')?.click());
    const modelRow = document.querySelector<HTMLButtonElement>('[data-model-menu="model"]');
    expect(document.querySelector("[data-submenu]")).toBeNull();

    act(() => modelRow?.click());
    expect(document.querySelector('[data-submenu="model"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-submenu="model"]')).toHaveLength(1);
    act(() =>
      document.querySelector<HTMLButtonElement>('[aria-label="返回模型与推理选项"]')?.click()
    );

    const returnedReasoningRow = document.querySelector<HTMLButtonElement>(
      '[data-model-menu="reasoning"]'
    );
    act(() => returnedReasoningRow?.click());
    expect(document.querySelector('[data-submenu="reasoning"]')).not.toBeNull();
    expect(document.activeElement).toBe(document.querySelector('[data-reasoning-option="medium"]'));

    act(() =>
      document
        .querySelector<HTMLButtonElement>('[data-reasoning-option="medium"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    );
    expect(document.querySelector('[data-submenu="reasoning"]')).toBeNull();
    expect(document.activeElement).toBe(document.querySelector('[data-model-menu="reasoning"]'));
  });

  test("keeps provider-added reasoning values visible in the compact trigger and submenu", () => {
    const model = {
      profiles: [{ id: "p1", label: "GPT-5.6", provider: "openai" }],
      selectedProfileId: "p1",
      onSelect: vi.fn()
    };
    const { host } = renderComposer({
      model,
      reasoning: {
        visible: true,
        values: ["high", "max", "ultra"],
        current: "ultra",
        onSelect: vi.fn()
      }
    });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label^="模型与推理："]');
    expect(trigger?.textContent).toContain("GPT-5.6");
    expect(trigger?.textContent).not.toContain("超高");
    expect(trigger?.getAttribute("aria-label")).toContain("超高");
    act(() => trigger?.click());
    act(() => document.querySelector<HTMLButtonElement>('[data-model-menu="reasoning"]')?.click());
    expect(document.querySelector('[data-reasoning-option="max"]')?.textContent).toContain("最大");
    expect(document.querySelector('[data-reasoning-option="ultra"]')?.textContent).toContain(
      "超高"
    );
  });

  test("lists context reference chips and adds/removes through callbacks", () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const onPickFile = vi.fn();
    const { host } = renderComposer({
      references: {
        chips: [{ refId: "chapter:ch-01", label: "第一章", kind: "chapter" }],
        available: [{ refId: "file:notes.md", label: "notes.md", kind: "project_file" }],
        onAdd,
        onRemove,
        onPickFile
      }
    });
    expect(host.querySelector('[aria-label="已选引用"]')?.textContent).toContain("第一章");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="添加引用与执行审批"]')?.click());
    act(() =>
      document.querySelector<HTMLButtonElement>('[data-reference-option="file:notes.md"]')?.click()
    );
    expect(onAdd).toHaveBeenCalledWith("file:notes.md");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="添加引用与执行审批"]')?.click());
    act(() => document.querySelector<HTMLButtonElement>(".ns-agent-composer-add-file")?.click());
    expect(onPickFile).toHaveBeenCalledTimes(1);
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="移除引用 第一章"]')?.click());
    expect(onRemove).toHaveBeenCalledWith("chapter:ch-01");
  });

  test("keeps context mode and legacy quick actions out while exposing context usage", () => {
    const { host } = renderComposer({
      availableContextModes: ["general_file"],
      contextStatus: {
        state: "heavy",
        usageLabel: "120k / 128k",
        precision: "estimated",
        sources: [{ refId: "chapter:ch-01", label: "第一章", detail: "4k · 精确" }]
      },
      quickActions: [
        { id: "rewrite_selection", label: "改写当前选区", onSelect: vi.fn() },
        { id: "review_style", label: "检查文风与一致性", onSelect: vi.fn() }
      ]
    });

    expect(host.querySelector("[data-context-option]")).toBeNull();
    const contextTrigger = host.querySelector<HTMLButtonElement>(
      '[aria-label="上下文较多 · 120k / 128k"]'
    );
    expect(contextTrigger).not.toBeNull();
    act(() => contextTrigger?.click());
    const contextPopover = document.querySelector<HTMLElement>('[aria-label="上下文用量"]');
    expect(contextPopover?.textContent).toContain("120k / 128k");
    expect(contextPopover?.parentElement?.classList).toContain("ns-agent-popover-layer");
    expect(document.querySelector('[aria-label="上下文来源"]')?.textContent).toContain("第一章");
    const css = readFileSync(join(process.cwd(), "packages", "ui", "src", "styles.css"), "utf8");
    expect(css).toMatch(
      /\.ns-agent-composer-surface \.ns-agent-context-popover-root\s*\{[^}]*grid-column:\s*3/s
    );
    expect(css).toMatch(
      /\.ns-agent-composer-surface \.ns-agent-context-popover\s*\{[^}]*width:\s*min\(272px,\s*calc\(100vw\s*-\s*16px\)\)/s
    );
    expect(host.querySelector('[aria-label="Agent 快捷动作"]')).toBeNull();
  });

  test("locks grouped controls while a run is active", () => {
    const { host } = renderComposer({
      active: true,
      model: {
        profiles: [{ id: "p1", label: "GPT-Writer", provider: "openai" }],
        selectedProfileId: "p1",
        onSelect: vi.fn()
      },
      references: {
        chips: [{ refId: "chapter:ch-01", label: "第一章", kind: "chapter" }],
        available: [{ refId: "file:notes.md", label: "notes.md", kind: "project_file" }],
        onAdd: vi.fn(),
        onRemove: vi.fn()
      }
    });
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="模型与推理：GPT-Writer"]')?.disabled
    ).toBe(true);
    const addTrigger = host.querySelector<HTMLButtonElement>('[aria-label="添加引用与执行审批"]');
    expect(addTrigger?.disabled).toBe(false);
    act(() => addTrigger?.click());
    expect(
      document.querySelector<HTMLButtonElement>('[data-reference-option="file:notes.md"]')?.disabled
    ).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="移除引用 第一章"]')?.disabled).toBe(
      true
    );
  });
});

function renderComposer(overrides: Partial<AgentComposerProps> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  let root: Root | undefined;
  const render = (next: Partial<AgentComposerProps> = {}) => {
    const props: AgentComposerProps = {
      request: "检查当前章节",
      operationMode: "execution",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      writePolicyAcknowledged: false,
      active: false,
      onRequestChange: () => undefined,
      onOperationModeChange: () => undefined,
      onContextModeChange: () => undefined,
      onWritePolicyChange: () => undefined,
      onSend: () => undefined,
      onStop: () => undefined,
      ...overrides,
      ...next
    };
    act(() => {
      root ??= createRoot(host);
      root.render(<AgentComposer {...props} />);
    });
  };
  render();
  return { host, rerender: render };
}

function permissionControl(
  overrides: Partial<NonNullable<AgentComposerProps["permission"]>> = {}
): NonNullable<AgentComposerProps["permission"]> {
  return {
    loading: false,
    approvalSource: "not_approved",
    onOpen: () => undefined,
    summary: {
      schemaVersion: "1.0",
      permissionSummaryId: "permission-summary-01",
      projectId: "project-01",
      runDraftId: "draft-01",
      contextMode: "writing",
      writePolicy: "write_before_confirmation",
      toolRegistryRevision: "registry-01",
      rootFingerprint: "f".repeat(64),
      readCapabilities: ["read_chapter", "read_project_text"],
      proposalCapabilities: ["propose_chapter_write"],
      forbiddenCapabilities: [
        "shell",
        "git",
        "network",
        "delete",
        "move",
        "rename",
        "create_directory"
      ],
      checksum: "c".repeat(64),
      generatedAt: "2026-07-17T00:00:00.000Z"
    },
    ...overrides
  };
}
