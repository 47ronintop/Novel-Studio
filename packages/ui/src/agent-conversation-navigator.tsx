import { Archive, ArchiveRestore, MoreHorizontal, Plus, Search } from "lucide-react";
import type { KeyboardEvent } from "react";

import type {
  AgentConversationListItemProps,
  AgentConversationNavigatorProps
} from "./workspace-shell-types.js";

export function AgentConversationNavigator(props: AgentConversationNavigatorProps) {
  const conversations = props.conversations.filter(
    (conversation) => conversation.status === props.filter
  );

  return (
    <section className="ns-agent-conversation-navigator" aria-label="Agent 会话导航">
      <header className="ns-agent-conversation-nav-header">
        <strong>会话</strong>
        <button
          aria-label="新建会话"
          className="ns-icon-button"
          disabled={props.loading}
          onClick={props.onCreate}
          title="新建会话"
          type="button"
        >
          <Plus aria-hidden="true" size={15} />
        </button>
      </header>

      <label className="ns-agent-conversation-search">
        <Search aria-hidden="true" size={14} />
        <input
          aria-label="搜索会话"
          disabled={props.loading}
          onChange={(event) => props.onSearchQueryChange(event.currentTarget.value)}
          placeholder="搜索会话"
          type="search"
          value={props.searchQuery}
        />
      </label>

      <div className="ns-agent-conversation-filters" aria-label="会话筛选" role="tablist">
        <button
          aria-label="显示活跃会话"
          aria-selected={props.filter === "active"}
          onClick={() => props.onFilterChange("active")}
          role="tab"
          type="button"
        >
          活跃
        </button>
        <button
          aria-label="显示已归档会话"
          aria-selected={props.filter === "archived"}
          onClick={() => props.onFilterChange("archived")}
          role="tab"
          type="button"
        >
          已归档
        </button>
      </div>

      {props.errorMessage === undefined ? null : (
        <p className="ns-project-feedback" data-kind="error" role="alert">
          {props.errorMessage}
        </p>
      )}

      {props.loading && conversations.length === 0 ? (
        <p className="ns-agent-conversation-empty" role="status">
          正在加载会话…
        </p>
      ) : conversations.length === 0 ? (
        <ConversationListEmpty filter={props.filter} searchQuery={props.searchQuery} />
      ) : (
        <ul className="ns-agent-conversation-list" aria-label="会话列表">
          {conversations.map((conversation) => (
            <ConversationRow
              conversation={conversation}
              key={conversation.conversationId}
              {...props}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ConversationRow(
  props: AgentConversationNavigatorProps & {
    readonly conversation: AgentConversationListItemProps;
  }
) {
  const { conversation } = props;
  const selected = conversation.conversationId === props.selectedConversationId;
  const busy = conversation.conversationId === props.busyConversationId;
  const activeRun = conversation.conversationId === props.activeConversationId;

  return (
    <li
      className="ns-agent-conversation-row"
      data-active-run={activeRun}
      data-conversation-id={conversation.conversationId}
      data-selected={selected}
    >
      <button
        {...(selected ? { "aria-current": "page" as const } : {})}
        aria-label={`选择会话：${conversation.title}`}
        className="ns-agent-conversation-select"
        data-conversation-select
        onClick={() => props.onSelect(conversation.conversationId)}
        onKeyDown={(event) => handleConversationKeyDown(event, props.onSelect)}
        tabIndex={selected ? 0 : -1}
        type="button"
      >
        <span className="ns-agent-conversation-row-heading">
          <span>{conversation.title}</span>
          <small>{conversation.updatedAtLabel}</small>
        </span>
        <span className="ns-agent-conversation-row-meta">
          {activeRun ? <span className="ns-agent-conversation-active-dot">运行中</span> : null}
          {conversation.lastRunStatusLabel === undefined ? null : (
            <span>{conversation.lastRunStatusLabel}</span>
          )}
          <span>{conversation.runCount} 次运行</span>
        </span>
        {conversation.preview === undefined ? null : <small>{conversation.preview}</small>}
      </button>

      {conversation.virtual ? (
        <span className="ns-agent-conversation-readonly" title="历史 Agent 运行为只读会话">
          只读
        </span>
      ) : conversation.status === "archived" ? (
        <button
          aria-label={`恢复会话：${conversation.title}`}
          className="ns-icon-button ns-agent-conversation-row-action"
          disabled={busy}
          onClick={() => props.onRestore(conversation.conversationId)}
          title="恢复会话"
          type="button"
        >
          <ArchiveRestore aria-hidden="true" size={14} />
        </button>
      ) : (
        <details className="ns-agent-conversation-menu">
          <summary aria-label={`会话操作：${conversation.title}`} title="会话操作">
            <MoreHorizontal aria-hidden="true" size={14} />
          </summary>
          <button
            aria-label={`归档会话：${conversation.title}`}
            disabled={busy || conversation.canArchive === false}
            onClick={() => props.onArchive(conversation.conversationId)}
            title={conversation.archiveDisabledReason ?? "归档会话"}
            type="button"
          >
            <Archive aria-hidden="true" size={13} />
            归档
          </button>
        </details>
      )}
    </li>
  );
}

function ConversationListEmpty({
  filter,
  searchQuery
}: Pick<AgentConversationNavigatorProps, "filter" | "searchQuery">) {
  const label =
    searchQuery.trim().length > 0
      ? "没有匹配的会话。"
      : filter === "archived"
        ? "没有已归档会话。"
        : "还没有会话。";
  return <p className="ns-agent-conversation-empty">{label}</p>;
}

function handleConversationKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  onSelect: (conversationId: string) => void
) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const list = event.currentTarget.closest("ul");
  const items = Array.from(
    list?.querySelectorAll<HTMLButtonElement>("[data-conversation-select]") ?? []
  );
  const currentIndex = items.indexOf(event.currentTarget);
  if (currentIndex < 0 || items.length === 0) return;

  event.preventDefault();
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? Math.min(currentIndex + 1, items.length - 1)
          : Math.max(currentIndex - 1, 0);
  const next = items[nextIndex];
  next?.focus();
  const conversationId =
    next?.closest<HTMLElement>("[data-conversation-id]")?.dataset["conversationId"];
  if (conversationId !== undefined) onSelect(conversationId);
}
