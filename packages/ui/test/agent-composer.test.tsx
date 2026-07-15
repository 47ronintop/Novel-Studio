// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AgentComposer } from "../src/agent-composer.js";
import type { AgentComposerProps } from "../src/workspace-shell-types.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

    const sendEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
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
    expect(host.querySelector<HTMLButtonElement>('[aria-label="启动 Agent 运行"]')?.disabled).toBe(true);
  });

  test("replaces send with one stop while active and keeps draft controls readable but disabled", () => {
    const onStop = vi.fn();
    const { host } = renderComposer({ active: true, onStop });

    expect(host.querySelector('[aria-label="启动 Agent 运行"]')).toBeNull();
    expect(host.querySelectorAll('[aria-label="停止 Agent 运行"]')).toHaveLength(1);
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Agent 请求"]')?.disabled).toBe(true);
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
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="选择运行方式和上下文"]');

    act(() => trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(document.activeElement).toBe(host.querySelector('[data-mode-option="execution"]'));
    expect(host.querySelectorAll('[aria-label="运行方式"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="运行方式"]')?.textContent).toContain("执行");
    expect(host.querySelector('[aria-label="运行方式"]')?.textContent).toContain("规划（只读）");
    expect(host.querySelectorAll('[aria-label="上下文"]')).toHaveLength(1);
    expect(host.querySelector('[aria-label="上下文"]')?.textContent).toContain("写作");
    expect(host.querySelector('[aria-label="上下文"]')?.textContent).toContain("通用文件");

    const execution = host.querySelector<HTMLButtonElement>('[data-mode-option="execution"]');
    act(() => execution?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
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
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="选择运行方式和上下文"]');
    expect(host.textContent).toContain("只读规划");
    expect(host.textContent).not.toContain("每次修改前确认");

    act(() => trigger?.click());
    const popover = host.querySelector<HTMLElement>('[aria-label="运行方式与上下文"]');
    act(() => popover?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[aria-label="运行方式与上下文"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  test("shows the two execution write policies", () => {
    const { host } = renderComposer();
    expect(host.textContent).toContain("每次修改前确认");
    expect(host.textContent).toContain("本次运行自动修改");
  });

  test("closes an open mode popover when the run becomes active", () => {
    const { host, rerender } = renderComposer();
    act(() =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="选择运行方式和上下文"]')
        ?.click()
    );
    expect(host.querySelector('[aria-label="运行方式与上下文"]')).not.toBeNull();

    rerender({ active: true });

    expect(host.querySelector('[aria-label="运行方式与上下文"]')).toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="选择运行方式和上下文"]')?.disabled
    ).toBe(true);
  });

  test("uses a single-column surface with wrapping toolbar and a fixed command slot", () => {
    const { host } = renderComposer({ disabled: true, disabledReason: "只读会话" });
    const composer = host.querySelector('[aria-label="会话输入区"]');
    expect(composer?.querySelector(":scope > .ns-agent-conversation-composer-note")).not.toBeNull();
    expect(composer?.querySelector(":scope > .ns-agent-composer-surface")).not.toBeNull();

    const css = readFileSync(join(process.cwd(), "packages", "ui", "src", "styles.css"), "utf8");
    expect(css).toMatch(/\.ns-agent-conversation-composer\.ns-agent-composer\s*\{[^}]*display:\s*block/s);
    expect(css).toMatch(/\.ns-agent-composer-surface\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(css).toMatch(/\.ns-agent-composer-toolbar\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(/\.ns-agent-composer-command-slot\s*\{[^}]*flex:\s*0 0 32px/s);
    expect(css).toMatch(/\.ns-agent-composer-mode-popover\s*\{[^}]*position:\s*absolute/s);
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
