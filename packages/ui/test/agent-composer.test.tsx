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

  test("renders one draft input and one compact mode trigger without permanent groups", () => {
    const { host } = renderComposer();

    expect(host.querySelectorAll('textarea[aria-label="Agent 请求"]')).toHaveLength(1);
    expect(host.querySelectorAll('button[aria-label="启动 Agent 运行"]')).toHaveLength(1);
    expect(host.querySelectorAll("button").item(0).textContent).toContain("执行 · 写作");
    expect(host.querySelectorAll('[aria-label="运行方式"]')).toHaveLength(0);
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

  test("replaces send with one stop while active and keeps draft controls readable but disabled", () => {
    const onStop = vi.fn();
    const { host } = renderComposer({ active: true, onStop });

    expect(host.querySelector('[aria-label="启动 Agent 运行"]')).toBeNull();
    expect(host.querySelectorAll('[aria-label="停止 Agent 运行"]')).toHaveLength(1);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Agent 请求"]')?.disabled).toBe(
      true
    );
    expect(host.textContent).toContain("执行 · 写作");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="停止 Agent 运行"]')?.click());
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  test("opens two labelled groups and selects modes with keyboard focus return", () => {
    const onOperationModeChange = vi.fn();
    const onWritePolicyChange = vi.fn();
    const onWritePolicyAcknowledgedChange = vi.fn();
    const { host } = renderComposer({
      writePolicy: "user_preapproved_run",
      writePolicyAcknowledged: true,
      onOperationModeChange,
      onWritePolicyChange,
      onWritePolicyAcknowledgedChange
    });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="执行 · 写作"]');

    act(() =>
      trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    );
    expect(document.activeElement).toBe(host.querySelector('[data-mode-option="execution"]'));
    expect(host.querySelectorAll('[aria-label="运行方式"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="运行方式"]')?.textContent).toContain("执行");
    expect(host.querySelector('[aria-label="运行方式"]')?.textContent).toContain("规划（只读）");
    expect(host.querySelectorAll('[aria-label="上下文"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="上下文"]')?.textContent).toContain("写作");
    expect(host.querySelector('[aria-label="上下文"]')?.textContent).toContain("通用文件");

    const execution = host.querySelector<HTMLButtonElement>('[data-mode-option="execution"]');
    act(() =>
      execution?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))
    );
    expect(document.activeElement?.textContent).toContain("规划（只读）");
    const selectEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true
    });
    act(() => document.activeElement?.dispatchEvent(selectEvent));

    expect(selectEvent.defaultPrevented).toBe(true);
    expect(onOperationModeChange).toHaveBeenCalledWith("planning");
    expect(onOperationModeChange).toHaveBeenCalledTimes(1);
    expect(onWritePolicyChange).toHaveBeenCalledWith("write_before_confirmation");
    expect(onWritePolicyAcknowledgedChange).toHaveBeenCalledWith(false);
    expect(host.querySelector('[aria-label="运行方式"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("closes the mode popover with Escape and exposes planning as read only", () => {
    const { host } = renderComposer({ operationMode: "planning" });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="规划 · 写作"]');
    expect(host.textContent).toContain("只读规划");
    expect(host.textContent).not.toContain("每次修改前确认");
    expect(host.querySelector('[aria-label^="修改权限："]')).toBeNull();

    act(() => trigger?.click());
    const popover = host.querySelector<HTMLElement>('[aria-label="运行方式与上下文"]');
    act(() =>
      popover?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    );
    expect(host.querySelector('[aria-label="运行方式与上下文"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("keeps permission details closed by default and reveals server-owned forbidden capabilities on demand", () => {
    const onOpen = vi.fn();
    const { host } = renderComposer({ permission: permissionControl({ onOpen }) });
    const trigger = host.querySelector<HTMLButtonElement>(
      '[aria-label="修改权限：每次修改前确认"]'
    );

    expect(trigger).not.toBeNull();
    expect(host.querySelector('[aria-label="修改权限与摘要"]')).toBeNull();
    act(() => trigger?.click());

    expect(onOpen).toHaveBeenCalledTimes(1);
    const summary = host.querySelector<HTMLDetailsElement>('[aria-label="本次权限摘要"]');
    expect(summary?.open).toBe(false);
    expect(host.querySelector('[aria-label="修改权限与摘要"]')?.textContent).toContain(
      "每次修改前确认"
    );
    expect(host.querySelector('[aria-label="修改权限与摘要"]')?.textContent).toContain(
      "本次运行自动修改"
    );

    act(() => summary?.querySelector("summary")?.click());
    expect(summary?.open).toBe(true);
    expect(summary?.textContent).toContain("Shell");
    expect(summary?.textContent).toContain("Git");
    expect(summary?.textContent).toContain("网络");
    expect(summary?.textContent).toContain("propose_chapter_write");
  });

  test("requires explicit risk acknowledgement before an automatic-modification run can start", () => {
    const onWritePolicyAcknowledgedChange = vi.fn();
    const { host } = renderComposer({
      writePolicy: "user_preapproved_run",
      writePolicyAcknowledged: false,
      permission: permissionControl(),
      onWritePolicyAcknowledgedChange
    });

    expect(host.querySelector<HTMLButtonElement>('[aria-label="启动 Agent 运行"]')?.disabled).toBe(
      true
    );
    act(() =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="修改权限：本次运行自动修改"]')
        ?.click()
    );
    const acknowledgement = host.querySelector<HTMLInputElement>(
      '[aria-label="确认本次运行自动修改风险"]'
    );
    expect(acknowledgement).not.toBeNull();
    expect(host.querySelector('[aria-label="修改权限与摘要"]')?.textContent).toContain(
      "每次实际写入仍会生成差异、校验并创建版本点"
    );
    act(() => acknowledgement?.click());
    expect(onWritePolicyAcknowledgedChange).toHaveBeenCalledWith(true);
  });

  test("closes an open mode popover when the run becomes active", () => {
    const { host, rerender } = renderComposer();
    act(() => host.querySelector<HTMLButtonElement>('[title="选择运行方式和上下文"]')?.click());
    expect(host.querySelector('[aria-label="运行方式与上下文"]')).not.toBeNull();

    rerender({ active: true });

    expect(host.querySelector('[aria-label="运行方式与上下文"]')).toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[title="选择运行方式和上下文"]')?.disabled).toBe(
      true
    );
  });

  test("uses a single-column surface with wrapping toolbar and a fixed command slot", () => {
    const { host } = renderComposer({ disabled: true, disabledReason: "只读会话" });
    const composer = host.querySelector('[aria-label="会话输入区"]');
    expect(composer?.querySelector(":scope > .ns-agent-conversation-composer-note")).not.toBeNull();
    expect(composer?.querySelector(":scope > .ns-agent-composer-surface")).not.toBeNull();

    const css = readFileSync(join(process.cwd(), "packages", "ui", "src", "styles.css"), "utf8");
    expect(css).toMatch(
      /\.ns-agent-conversation-composer\.ns-agent-composer\s*\{[^}]*display:\s*block/s
    );
    expect(css).toMatch(
      /\.ns-agent-composer-surface\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s
    );
    expect(css).toMatch(/\.ns-agent-composer-toolbar\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(/\.ns-agent-composer-command-slot\s*\{[^}]*flex:\s*0 0 32px/s);
    expect(css).toMatch(/\.ns-agent-composer-mode-popover\s*\{[^}]*position:\s*absolute/s);
  });

  test("does not render grouped controls when their sub-objects are absent", () => {
    const { host } = renderComposer();
    expect(host.querySelector('[aria-label^="模型："]')).toBeNull();
    expect(host.querySelector('[aria-label^="推理强度："]')).toBeNull();
    expect(host.querySelector('[aria-label="添加上下文引用"]')).toBeNull();
    expect(host.querySelector(".ns-agent-context-trigger")).toBeNull();
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
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="模型：GPT-Writer"]');
    expect(trigger?.textContent).toContain("GPT-Writer");
    act(() => trigger?.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-model-option="p2"]')?.click());
    expect(onSelect).toHaveBeenCalledWith("p2");
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  test("shows the reasoning selector only when visible and reports the choice", () => {
    const onSelect = vi.fn();
    const hidden = renderComposer({
      reasoning: { visible: false, values: ["low", "high"], current: "low", onSelect }
    });
    expect(hidden.host.querySelector('[aria-label^="推理强度："]')).toBeNull();

    const onSelect2 = vi.fn();
    const { host } = renderComposer({
      reasoning: { visible: true, values: ["low", "medium", "high"], current: "medium", onSelect: onSelect2 }
    });
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="推理强度：中"]');
    expect(trigger).not.toBeNull();
    act(() => trigger?.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-reasoning-option="high"]')?.click());
    expect(onSelect2).toHaveBeenCalledWith("high");
  });

  test("lists context reference chips and adds/removes through callbacks", () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const { host } = renderComposer({
      references: {
        chips: [{ refId: "chapter:ch-01", label: "第一章", kind: "chapter" }],
        available: [{ refId: "file:notes.md", label: "notes.md", kind: "project_file" }],
        onAdd,
        onRemove
      }
    });
    expect(host.querySelector(".ns-agent-composer-reference-chips")?.textContent).toContain(
      "第一章"
    );
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="添加上下文引用"]')?.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-reference-option="file:notes.md"]')?.click());
    expect(onAdd).toHaveBeenCalledWith("file:notes.md");
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="移除引用 第一章"]')?.click());
    expect(onRemove).toHaveBeenCalledWith("chapter:ch-01");
  });

  test("keeps the context status button quiet in the normal state", () => {
    const { host } = renderComposer({
      contextStatus: {
        state: "normal",
        usageLabel: "12k / 128k",
        precision: "reported",
        sources: [{ refId: "chapter:ch-01", label: "第一章", detail: "4k · 精确" }]
      }
    });
    const trigger = host.querySelector<HTMLButtonElement>(".ns-agent-context-trigger");
    expect(trigger?.textContent).toContain("上下文");
    expect(trigger?.classList.contains("ns-agent-context-trigger-attention")).toBe(false);
  });

  test("announces heavy/failed context states and triggers compact", () => {
    const onCompact = vi.fn();
    const { host } = renderComposer({
      contextStatus: {
        state: "heavy",
        usageLabel: "120k / 128k",
        precision: "estimated",
        sources: [{ refId: "file:draft.md", label: "draft.md", detail: "100k · 估算" }],
        onCompact
      }
    });
    const trigger = host.querySelector<HTMLButtonElement>(".ns-agent-context-trigger-attention");
    expect(trigger?.textContent).toContain("上下文较多");
    act(() => trigger?.click());
    expect(host.querySelector('[aria-label="上下文用量"]')?.textContent).toContain("120k / 128k");
    act(() => host.querySelector<HTMLButtonElement>(".ns-agent-context-actions button")?.click());
    expect(onCompact).toHaveBeenCalledTimes(1);
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
    expect(host.querySelector<HTMLButtonElement>('[aria-label="模型：GPT-Writer"]')?.disabled).toBe(
      true
    );
    expect(host.querySelector<HTMLButtonElement>('[aria-label="添加上下文引用"]')?.disabled).toBe(
      true
    );
    expect(host.querySelector<HTMLButtonElement>('[aria-label="移除引用 第一章"]')?.disabled).toBe(
      true
    );
  });

  test("limits context modes and keeps selection actions beside the composer controls", () => {
    const rewrite = vi.fn();
    const style = vi.fn();
    const { host } = renderComposer({
      availableContextModes: ["general_file"],
      quickActions: [
        { id: "rewrite_selection", label: "改写当前选区", onSelect: rewrite },
        { id: "review_style", label: "检查文风与一致性", onSelect: style }
      ]
    });

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="执行 · 写作"]')?.click());
    expect(host.querySelector('[data-context-option="writing"]')).toBeNull();
    expect(host.querySelector('[data-context-option="general_file"]')).not.toBeNull();
    expect(host.querySelectorAll('[aria-label="Agent 快捷动作"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="改写当前选区"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="检查文风与一致性"]')).not.toBeNull();

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="改写当前选区"]')?.click());
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="检查文风与一致性"]')?.click());
    expect(rewrite).toHaveBeenCalledOnce();
    expect(style).toHaveBeenCalledOnce();
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
      onWritePolicyAcknowledgedChange: () => undefined,
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
      forbiddenCapabilities: ["shell", "git", "network", "delete", "move", "rename", "create_directory"],
      checksum: "c".repeat(64),
      generatedAt: "2026-07-17T00:00:00.000Z"
    },
    ...overrides
  };
}
