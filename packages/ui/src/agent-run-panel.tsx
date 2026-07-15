import { Play, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { AgentActivitySummary } from "./agent-activity-summary.js";
import { AgentRunTimeline } from "./agent-run-timeline.js";
import { ChangeSetReview } from "./change-set-review.js";
import type { AgentRunPanelProps } from "./workspace-shell-types.js";

export function AgentRunPanel(props: AgentRunPanelProps) {
  const [answer, setAnswer] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  const lastEvent = props.events.at(-1);
  const nonToolEvents = props.events.filter(
    (event) =>
      event.type !== "tool_started" &&
      event.type !== "tool_completed" &&
      event.type !== "tool_failed"
  );

  useEffect(() => {
    setAnswer("");
    setSelectedOption("");
  }, [props.pendingUserInput?.questionId]);

  return (
    <section
      className="ns-agent-run"
      aria-label="Agentic Writing Loop"
      {...(props.runId === undefined ? {} : { "data-run-id": props.runId })}
    >
      <header className="ns-agent-run-header">
        <span className="ns-agent-status">{statusLabel(props.status)}</span>
      </header>

      {props.contextSourceNotice === undefined ? null : (
        <p className="ns-agent-context-notice">{props.contextSourceNotice}</p>
      )}

      {props.assistantText.length === 0 ? null : (
        <p className="ns-agent-assistant-text">{props.assistantText}</p>
      )}
      <AgentActivitySummary events={props.events} />
      <AgentRunTimeline ariaLabel="Agent 运行状态" events={nonToolEvents} />

      {props.pendingUserInput === undefined ? null : (
        <section className="ns-agent-question" aria-label="Agent 阻塞问题">
          <strong>{props.pendingUserInput.prompt}</strong>
          <p>{props.pendingUserInput.reason}</p>
          <fieldset>
            <legend>选择</legend>
            {props.pendingUserInput.options.map((option) => (
              <label key={option.id}>
                <input
                  checked={selectedOption === option.id}
                  name={props.pendingUserInput?.questionId}
                  onChange={() => setSelectedOption(option.id)}
                  type="radio"
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
          {props.pendingUserInput.allowFreeText ? (
            <input
              aria-label="补充回答"
              onChange={(event) => setAnswer(event.currentTarget.value)}
              value={answer}
            />
          ) : null}
          <div className="ns-agent-inline-actions">
            <button
              aria-label="回答并继续"
              className="ns-ai-send-button ns-agent-answer"
              disabled={selectedOption.length === 0 && answer.trim().length === 0}
              onClick={() => props.onAnswerUserInput(answer.trim() || selectedOption)}
              type="button"
            >
              <Play aria-hidden="true" size={13} />
              回答并继续
            </button>
          </div>
        </section>
      )}

      {props.status !== "awaiting_context_refresh" ? null : (
        <section className="ns-agent-context-refresh" aria-label="上下文刷新">
          <strong>上下文已变化</strong>
          <div className="ns-agent-inline-actions">
            <button onClick={() => props.onRefreshContext("refresh")} type="button">
              <RefreshCw aria-hidden="true" size={13} />
              使用当前内容刷新
            </button>
            <button onClick={() => props.onRefreshContext("exclude")} type="button">
              从目标排除
            </button>
            <button onClick={() => props.onRefreshContext("cancel")} type="button">
              取消运行
            </button>
          </div>
        </section>
      )}

      {props.changeSetReview === undefined || props.changeSetReview.open !== false ? null : (
        <ChangeSetReview review={props.changeSetReview} />
      )}

      {props.rollbackReview === undefined ||
      props.rollbackReview.open !== false ||
      props.rollbackReview.review.status === "completed" ||
      props.rollbackReview.onOpen === undefined ? null : (
        <button
          aria-label="重新打开撤销审阅"
          className="ns-ai-secondary-button"
          onClick={props.rollbackReview.onOpen}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={13} />
          继续撤销审阅
        </button>
      )}

      {props.errorMessage === undefined ? null : (
        <p className="ns-project-feedback" data-kind="error" role="alert">
          {props.errorMessage}
        </p>
      )}

      <div className="ns-agent-run-actions">
        {lastEvent?.type === "tool_failed" ? (
          <button
            aria-label="重试失败步骤"
            className="ns-ai-secondary-button"
            onClick={props.onRetryStep}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={13} />
            重试步骤
          </button>
        ) : null}
        {props.operationMode === "execution" &&
        props.canUndoRun &&
        props.onUndoRun !== undefined ? (
          <button
            aria-label="撤销本次运行"
            className="ns-ai-secondary-button"
            onClick={props.onUndoRun}
            type="button"
          >
            <RotateCcw aria-hidden="true" size={13} />
            撤销本次运行
          </button>
        ) : null}
      </div>
    </section>
  );
}

function statusLabel(status: AgentRunPanelProps["status"]): string {
  switch (status) {
    case "idle":
      return "空闲";
    case "planning_model":
      return "规划中";
    case "executing_model":
      return "执行中";
    case "executing_read_tool":
      return "读取中";
    case "staging_changes":
      return "正在准备更改";
    case "awaiting_write_approval":
      return "更改待确认";
    case "applying_changes":
      return "正在应用更改";
    case "stopping_after_transaction":
      return "写入完成后停止";
    case "awaiting_user_input":
      return "等待回答";
    case "awaiting_context_refresh":
      return "上下文已过期";
    case "plan_ready":
      return "计划待审阅";
    case "completed":
      return "已完成";
    case "cancelled":
      return "已停止";
    case "failed":
      return "失败";
    case "limit_reached":
      return "达到上限";
    case "created":
    case "awaiting_plan_decision":
      return "准备中";
  }
}
