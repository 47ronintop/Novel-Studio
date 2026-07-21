import { Archive, ArchiveRestore, CornerUpLeft, History, Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { AgentComposer } from "./agent-composer.js";
import { AgentActivitySummary } from "./agent-activity-summary.js";
import { AgentConversationHistoryDrawer } from "./agent-conversation-history-drawer.js";
import { AgentRunPanel } from "./agent-run-panel.js";
import type {
  AgentConversationMainReview,
  AgentConversationDetailProps,
  AgentConversationViewProps
} from "./workspace-shell-types.js";

export function AgentConversationView(props: AgentConversationViewProps) {
  const conversation = props.conversation;
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
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

  if (conversation === undefined) {
    return (
      <section className="ns-agent-conversation-view" aria-label="Agent 会话主视图">
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
        <div className="ns-agent-conversation-view-empty">
          <strong>{props.loading ? "正在加载会话…" : "开始一次写作会话"}</strong>
          <p>新建会话后开始规划或执行写作任务。</p>
          <button
            aria-label="新建会话"
            className="ns-icon-text-button"
            disabled={props.loading || props.createDisabled === true}
            onClick={props.onCreate}
            type="button"
          >
            <Plus aria-hidden="true" size={14} />
            新建会话
          </button>
        </div>
        {historyDrawer}
        {props.composer === undefined ? null : (
          <AgentComposer
            {...props.composer}
            disabled={true}
            disabledReason={props.composer.disabledReason ?? "打开工作区后即可开始对话。"}
          />
        )}
      </section>
    );
  }

  const disabledReason = conversationComposerDisabledReason(props, conversation);

  return (
    <section className="ns-agent-conversation-view" aria-label="Agent 会话主视图">
      <header className="ns-agent-conversation-view-header">
        <div>
          <h1>{conversation.title}</h1>
          <span>
            {conversation.runCount} 次运行 · {conversation.updatedAtLabel}
            {conversation.virtual ? " · 只读" : ""}
          </span>
        </div>
        <div className="ns-agent-conversation-header-actions">
          {historyButton}
          {conversation.virtual ? null : conversation.status === "archived" ? (
            <button
              aria-label={`恢复会话：${conversation.title}`}
              className="ns-icon-button"
              onClick={() => props.onRestore(conversation.conversationId)}
              title="恢复会话"
              type="button"
            >
              <ArchiveRestore aria-hidden="true" size={15} />
            </button>
          ) : (
            <button
              aria-label={`归档会话：${conversation.title}`}
              className="ns-icon-button"
              disabled={conversation.canArchive === false}
              onClick={() => props.onArchive(conversation.conversationId)}
              title={conversation.archiveDisabledReason ?? "归档会话"}
              type="button"
            >
              <Archive aria-hidden="true" size={15} />
            </button>
          )}
        </div>
      </header>

      {props.errorMessage === undefined ? null : (
        <p className="ns-project-feedback" data-kind="error" role="alert">
          {props.errorMessage}
        </p>
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

      {conversation.contextSummary === undefined ? null : (
        <p className="ns-agent-conversation-summary">{conversation.contextSummary}</p>
      )}

      {props.mainReview === undefined ? null : (
        <AgentConversationReviewSummary
          onOpen={props.onOpenMainReview}
          review={props.mainReview}
        />
      )}

      <ConversationTurns conversation={conversation} />

      {props.agentRun === undefined ? null : (
        <div className="ns-agent-conversation-run-panel">
          <AgentRunPanel {...props.agentRun} />
        </div>
      )}

      {props.composer === undefined ? null : (
        <AgentComposer
          {...props.composer}
          disabled={disabledReason !== undefined}
          {...(disabledReason === undefined ? {} : { disabledReason })}
        />
      )}
      {historyDrawer}
    </section>
  );
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
      {conversation.turns.map((turn) => (
        <li data-run-id={turn.runId} key={turn.runId}>
          <div className="ns-agent-conversation-message" data-speaker="user">
            <p>{turn.userRequest}</p>
          </div>
          {(turn.assistantText === undefined || turn.assistantText.length === 0) &&
          (turn.events === undefined || turn.events.length === 0) ? null : (
            <div className="ns-agent-conversation-message" data-speaker="assistant">
              <span className="ns-agent-conversation-speaker-label">Agent</span>
              {turn.assistantText === undefined || turn.assistantText.length === 0 ? null : (
                <p>{turn.assistantText}</p>
              )}
              <AgentActivitySummary events={turn.events ?? []} />
            </div>
          )}
          <div className="ns-agent-conversation-turn-meta">
            <span>{turn.statusLabel}</span>
            <time>{turn.updatedAtLabel}</time>
          </div>
        </li>
      ))}
    </ol>
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
