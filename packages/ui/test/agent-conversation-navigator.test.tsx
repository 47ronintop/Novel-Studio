// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AgentConversationNavigator } from "../src/agent-conversation-navigator.js";
import type { AgentConversationNavigatorProps } from "../src/workspace-shell-types.js";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const activeConversations: AgentConversationNavigatorProps["conversations"] = [
  {
    conversationId: "conv-current",
    title: "修订灯塔场景",
    status: "active",
    updatedAtLabel: "10:24",
    runCount: 3,
    lastRunStatusLabel: "已完成",
    preview: "检查角色动机和场景节奏。"
  },
  {
    conversationId: "conv-next",
    title: "第七章线索",
    status: "active",
    updatedAtLabel: "昨天",
    runCount: 1,
    lastRunStatusLabel: "等待回答"
  },
  {
    conversationId: "legacy_agent_runs",
    title: "历史 Agent 运行",
    status: "active",
    updatedAtLabel: "7 月 12 日",
    runCount: 5,
    virtual: true
  },
  {
    conversationId: "conv-archived",
    title: "已归档的节奏审阅",
    status: "archived",
    updatedAtLabel: "7 月 10 日",
    runCount: 2
  }
];

describe("AgentConversationNavigator", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  test("renders a compact active list and exposes search and new conversation actions", () => {
    const onCreate = vi.fn();
    const onSearchQueryChange = vi.fn();
    const { host } = renderNavigator({ onCreate, onSearchQueryChange });

    expect(host.querySelector('[aria-label="Agent 会话导航"]')).not.toBeNull();
    expect(host.textContent).toContain("修订灯塔场景");
    expect(host.textContent).toContain("第七章线索");
    expect(host.textContent).not.toContain("已归档的节奏审阅");
    expect(
      host.querySelector('[aria-label="选择会话：修订灯塔场景"]')?.getAttribute("aria-current")
    ).toBe("page");

    act(() => {
      const input = host.querySelector<HTMLInputElement>('[aria-label="搜索会话"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "灯塔");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="新建会话"]')?.click());

    expect(onSearchQueryChange).toHaveBeenCalledWith("灯塔");
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  test("switches filters and restores an archived conversation", () => {
    const onFilterChange = vi.fn();
    const onRestore = vi.fn();
    const { host, rerender } = renderNavigator({ onFilterChange, onRestore });

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="显示已归档会话"]')?.click());
    expect(onFilterChange).toHaveBeenCalledWith("archived");

    rerender({ filter: "archived", onFilterChange, onRestore });
    expect(host.textContent).toContain("已归档的节奏审阅");
    expect(host.textContent).not.toContain("修订灯塔场景");

    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="恢复会话：已归档的节奏审阅"]')?.click()
    );
    expect(onRestore).toHaveBeenCalledWith("conv-archived");
  });

  test("archives from the row menu and keeps the legacy virtual item read only", () => {
    const onArchive = vi.fn();
    const { host } = renderNavigator({ onArchive });

    expect(host.querySelector('[aria-label="会话操作：历史 Agent 运行"]')).toBeNull();

    act(() =>
      host
        .querySelector<HTMLElement>('[aria-label="会话操作：修订灯塔场景"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    );
    act(() =>
      host.querySelector<HTMLButtonElement>('[aria-label="归档会话：修订灯塔场景"]')?.click()
    );

    expect(onArchive).toHaveBeenCalledWith("conv-current");
  });

  test("moves selection with arrow keys using a roving tab stop", () => {
    const onSelect = vi.fn();
    const { host } = renderNavigator({ onSelect });
    const current = host.querySelector<HTMLButtonElement>('[aria-label="选择会话：修订灯塔场景"]');
    const next = host.querySelector<HTMLButtonElement>('[aria-label="选择会话：第七章线索"]');
    current?.focus();

    act(() =>
      current?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    );

    expect(document.activeElement).toBe(next);
    expect(onSelect).toHaveBeenCalledWith("conv-next");
  });

  test("renders useful empty states for new, archived, and searched lists", () => {
    const { host, rerender } = renderNavigator({ conversations: [] });
    expect(host.textContent).toContain("还没有会话");

    rerender({ conversations: [], filter: "archived" });
    expect(host.textContent).toContain("没有已归档会话");

    rerender({ conversations: [], searchQuery: "不存在" });
    expect(host.textContent).toContain("没有匹配的会话");
  });
});

function renderNavigator(overrides: Partial<AgentConversationNavigatorProps> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  let root: Root | undefined;

  const render = (nextOverrides: Partial<AgentConversationNavigatorProps> = {}) => {
    const props: AgentConversationNavigatorProps = {
      conversations: activeConversations,
      selectedConversationId: "conv-current",
      searchQuery: "",
      filter: "active",
      loading: false,
      onSearchQueryChange: () => undefined,
      onFilterChange: () => undefined,
      onCreate: () => undefined,
      onSelect: () => undefined,
      onArchive: () => undefined,
      onRestore: () => undefined,
      ...overrides,
      ...nextOverrides
    };
    act(() => {
      if (root === undefined) root = createRoot(host);
      root.render(<AgentConversationNavigator {...props} />);
    });
  };

  render();
  return { host, rerender: render };
}
