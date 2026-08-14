import {
  Archive,
  ArchiveRestore,
  Bot,
  ChevronDown,
  CornerUpLeft,
  History,
  MessageSquare,
  MoreHorizontal,
  Plus
} from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type UIEvent } from "react";

import { AgentComposer } from "./agent-composer.js";
import { AgentActivitySummary } from "./agent-activity-summary.js";
import { AgentCapabilitySummary } from "./agent-capability-summary.js";
import { AgentConversationHistoryDrawer } from "./agent-conversation-history-drawer.js";
import { AgentRunPanel } from "./agent-run-panel.js";
import { AgentPopover } from "./agent-popover.js";
import { formatConversationTimestamp } from "./agent-conversation-navigator.js";
import type {
  AgentConversationMainReview,
  AgentConversationDetailProps,
  AgentConversationViewProps
} from "./workspace-shell-types.js";

export function AgentConversationView(props: AgentConversationViewProps) {
  const conversation = props.conversation;
  const contextSummary = visibleContextSummary(conversation?.contextSummary);
  const capability = props.agentRun?.capability ?? props.composer?.capability;
  // A live run owns the authoritative capability facts; keep the composer focused on drafting.
  const composer =
    props.composer === undefined || props.agentRun?.capability === undefined
      ? props.composer
      : withoutComposerCapability(props.composer);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const conversationViewRef = useRef<HTMLElement>(null);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const closeHistory = useCallback(() => {
    setHistoryOpen(false);
    historyButtonRef.current?.focus();
  }, []);
  const historyButton =
    props.navigator === undefined ? null : (
      <button
        ref={historyButtonRef}
        aria-label="历史会话"
        className="ns-icon-button"
        onClick={() => setHistoryOpen(true)}
        title="历史会话"
        type="button"
      >
        <History aria-hidden="true" size={15} />
      </button>
    );
  const historyDrawer =
    historyOpen && props.navigator !== undefined ? (
      <AgentConversationHistoryDrawer navigator={props.navigator} onClose={closeHistory} />
    ) : null;

  const messageVersion = [
    conversation?.conversationId ?? "",
    conversation?.turns.length ?? 0,
    props.agentRun?.runId ?? "",
    props.agentRun?.status ?? "",
    props.agentRun?.userRequest ?? "",
    props.agentRun?.assistantText ?? "",
    props.agentRun?.events.length ?? 0
  ].join("\u0000");

  useLayoutEffect(() => {
    stickToBottomRef.current = true;
  }, [conversation?.conversationId]);

  useLayoutEffect(() => {
    if (!stickToBottomRef.current) return;
    const view = conversationViewRef.current;
    const end = conversationEndRef.current;
    if (end?.scrollIntoView !== undefined) {
      end.scrollIntoView({ behavior: "auto", block: "end" });
    } else if (view !== null) {
      view.scrollTop = view.scrollHeight;
    }
  }, [messageVersion]);

  const handleConversationScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const view = event.currentTarget;
    stickToBottomRef.current = view.scrollHeight - view.scrollTop - view.clientHeight <= 48;
  }, []);

  if (conversation === undefined) {
    const composerDisabledReason = props.loading
      ? "正在准备会话…"
      : (props.composer?.disabledReason ?? "打开工作区后，Agent 会在这里保持可用。");
    return (
      <section
        ref={conversationViewRef}
        className="ns-agent-conversation-view"
        aria-label="Agent 会话主视图"
        onScroll={handleConversationScroll}
      >
        <header className="ns-agent-conversation-view-header ns-agent-conversation-view-header-empty">
          <div>
            <h1>Agent</h1>
            <span>当前工作区会话</span>
          </div>
          {historyButton}
        </header>
        {props.errorMessage === undefined ? null : (
          <p className="ns-project-feedback" data-kind="error" role="alert">
            {props.errorMessage}
          </p>
        )}
        <div className="ns-agent-conversation-view-empty ns-agent-conversation-view-empty-preparing">
          <strong>{props.loading ? "正在准备会话…" : "Agent"}</strong>
          <p>{props.loading ? "正在恢复当前工作区的会话与上下文。" : composerDisabledReason}</p>
        </div>
        {composer === undefined ? null : (
          <AgentComposer
            {...composer}
            disabled={true}
            disabledReason={composerDisabledReason}
          />
        )}
        {historyDrawer}
      </section>
    );
  }

  const disabledReason = conversationComposerDisabledReason(props, conversation);

  return (
    <section
      ref={conversationViewRef}
      className="ns-agent-conversation-view"
      aria-label="Agent 会话主视图"
      onScroll={handleConversationScroll}
    >
      <header className="ns-agent-conversation-view-header">
        <button
          aria-label={`会话：${conversation.title}，点击查看历史`}
          className="ns-agent-conversation-title-trigger"
          onClick={() => setHistoryOpen(true)}
          title="点击切换会话"
          type="button"
        >
          <MessageSquare aria-hidden="true" size={13} />
          <span className="ns-agent-conversation-title-prefix">Agent 会话</span>
          {conversation.title.length > 0 && (
            <span className="ns-agent-conversation-title-name">·{conversation.title}</span>
          )}
          <ChevronDown aria-hidden="true" size={12} />
        </button>
        <div className="ns-agent-conversation-header-actions">
          <button
            aria-label="新建会话"
            className="ns-icon-button"
            disabled={props.createDisabled === true}
            onClick={props.onCreate}
            title="新建会话"
            type="button"
          >
            <Plus aria-hidden="true" size={15} />
          </button>
          {historyButton}
          {conversation.virtual ? null : (
            <AgentPopover
              disabled={conversation.status !== "archived" && conversation.canArchive === false}
              panelClassName="ns-agent-conversation-header-menu-panel"
              rootClassName="ns-agent-conversation-header-menu"
              triggerClassName="ns-icon-button"
              triggerContent={<MoreHorizontal aria-hidden="true" size={15} />}
              triggerLabel="会话操作"
              triggerTitle="会话操作"
              panelLabel="会话操作"
            >
              {({ close }) => (
                <button
                  aria-label={
                    conversation.status === "archived"
                      ? `恢复会话：${conversation.title}`
                      : `归档会话：${conversation.title}`
                  }
                  onClick={() => {
                    if (conversation.status === "archived") {
                      props.onRestore(conversation.conversationId);
                    } else {
                      props.onArchive(conversation.conversationId);
                    }
                    close();
                  }}
                  type="button"
                >
                  {conversation.status === "archived" ? (
                    <ArchiveRestore aria-hidden="true" size={13} />
                  ) : (
                    <Archive aria-hidden="true" size={13} />
                  )}
                  {conversation.status === "archived" ? "恢复会话" : "归档会话"}
                </button>
              )}
            </AgentPopover>
          )}
        </div>
      </header>

      {props.errorMessage === undefined ? null : (
        <p className="ns-project-feedback" data-kind="error" role="alert">
          {props.errorMessage}
        </p>
      )}

      {props.composer !== undefined ||
      props.agentRun !== undefined ||
      capability === undefined ? null : (
        <AgentCapabilitySummary facts={capability} compact />
      )}

      {props.activeConversationId !== undefined &&
      props.activeConversationId !== conversation.conversationId ? (
        <div className="ns-agent-conversation-active-banner" role="status">
          <span>会话“{props.activeConversationTitle ?? "其他会话"}”正在运行。</span>
          <button
            aria-label="返回活动会话"
            className="ns-icon-text-button"
            onClick={props.onReturnToActive}
            type="button"
          >
            <CornerUpLeft aria-hidden="true" size={13} />
            返回活动会话
          </button>
        </div>
      ) : null}

      {contextSummary === undefined ? null : (
        <p className="ns-agent-conversation-summary">{contextSummary}</p>
      )}

      {props.mainReview === undefined ? null : (
        <AgentConversationReviewSummary onOpen={props.onOpenMainReview} review={props.mainReview} />
      )}

      <ConversationTurns conversation={conversation} />

      {props.agentRun?.userRequest === undefined ||
      props.agentRun.userRequest.trim().length === 0 ? null : (
        <ConversationUserMessage request={props.agentRun.userRequest} live />
      )}

      {props.agentRun === undefined ? null : (
        <div className="ns-agent-conversation-run-panel">
          <AgentRunPanel {...props.agentRun} />
        </div>
      )}

      <div aria-hidden="true" className="ns-agent-conversation-end" ref={conversationEndRef} />

      {composer === undefined ? null : (
        <AgentComposer
          {...composer}
          disabled={disabledReason !== undefined}
          {...(disabledReason === undefined ? {} : { disabledReason })}
        />
      )}
      {historyDrawer}
    </section>
  );
}

function withoutComposerCapability(
  composer: NonNullable<AgentConversationViewProps["composer"]>
): Omit<NonNullable<AgentConversationViewProps["composer"]>, "capability"> {
  const withoutCapability = { ...composer };
  delete withoutCapability.capability;
  return withoutCapability;
}

function visibleContextSummary(summary: string | undefined): string | undefined {
  if (summary === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(summary);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>)["kind"] === "agent_conversation_context"
    ) {
      return undefined;
    }
  } catch {
    // Human-readable summaries are not JSON and should continue to render.
  }
  return summary;
}

function AgentConversationReviewSummary({
  review,
  onOpen
}: {
  readonly review: AgentConversationMainReview;
  readonly onOpen: ((review: AgentConversationMainReview) => void) | undefined;
}) {
  return (
    <section className="ns-agent-review-summary" aria-label="中央审阅摘要">
      <div>
        <strong>{mainReviewLabel(review.kind)}</strong>
        <span>{review.kind === "recovery" ? "需要处理后再继续" : "审阅已在中央区域打开"}</span>
      </div>
      <button
        aria-label="在中央查看"
        className="ns-icon-text-button"
        disabled={onOpen === undefined}
        onClick={() => onOpen?.(review)}
        type="button"
      >
        在中央查看
      </button>
    </section>
  );
}

function mainReviewLabel(kind: AgentConversationMainReview["kind"]): string {
  switch (kind) {
    case "recovery":
      return "恢复审阅";
    case "rollback":
      return "撤销审阅";
    case "change_set":
      return "Change Set";
    case "selection":
      return "选区审阅";
    case "plan":
      return "计划审阅";
  }
}

function ConversationTurns({
  conversation
}: {
  readonly conversation: AgentConversationDetailProps;
}) {
  if (conversation.turns.length === 0) {
    return <p className="ns-agent-conversation-turns-empty">这个会话还没有运行记录。</p>;
  }

  return (
    <ol className="ns-agent-conversation-turns" aria-label="会话运行历史">
      {[...conversation.turns].reverse().map((turn) => (
        <li data-run-id={turn.runId} key={turn.runId}>
          <ConversationUserMessage request={turn.userRequest} />
          {(turn.assistantText === undefined || turn.assistantText.length === 0) &&
          (turn.events === undefined || turn.events.length === 0) ? null : (
            <div className="ns-agent-conversation-message" data-speaker="assistant">
              <div className="ns-agent-conversation-message-header">
                <span className="ns-agent-conversation-avatar" data-speaker="assistant">
                  <Bot aria-hidden="true" size={11} />
                </span>
                <span className="ns-agent-conversation-speaker-name">Agent</span>
              </div>
              {turn.assistantText === undefined || turn.assistantText.length === 0 ? null : (
                <p>{turn.assistantText}</p>
              )}
              <AgentActivitySummary events={turn.events ?? []} />
            </div>
          )}
          <div className="ns-agent-conversation-turn-meta">
            <span>{turn.statusLabel}</span>
            <time>{formatConversationTimestamp(turn.updatedAtLabel)}</time>
          </div>
        </li>
      ))}
    </ol>
  );
}

function ConversationUserMessage({
  request,
  live = false
}: {
  readonly request: string;
  readonly live?: boolean;
}) {
  return (
    <div
      className="ns-agent-conversation-message ns-agent-conversation-user-message"
      data-speaker="user"
      {...(live ? { "data-live": "true" } : {})}
    >
      <p>{request}</p>
    </div>
  );
}

function conversationComposerDisabledReason(
  props: AgentConversationViewProps,
  conversation: AgentConversationDetailProps
): string | undefined {
  if (props.composer?.disabledReason !== undefined) return props.composer.disabledReason;
  if (props.loading) return "正在加载会话。";
  if (conversation.virtual) return "历史 Agent 运行为只读会话。";
  if (conversation.status === "archived") return "已归档会话不能启动新运行。";
  if (
    props.activeConversationId !== undefined &&
    props.activeConversationId !== conversation.conversationId
  ) {
    return "当前项目已有活动运行。";
  }
  if (props.composer?.disabled === true) return "当前会话暂时不能启动新运行。";
  return undefined;
}
