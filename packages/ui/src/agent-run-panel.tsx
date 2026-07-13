import { Play, RefreshCw, RotateCcw, Send, Square } from "lucide-react";
import { useEffect, useState } from "react";

import { AgentRunTimeline } from "./agent-run-timeline.js";
import { PlanArtifactReview } from "./plan-artifact-review.js";
import type { AgentRunPanelProps } from "./workspace-shell-types.js";

export function AgentRunPanel(props: AgentRunPanelProps) {
  const [request, setRequest] = useState(props.userRequest);
  const [answer, setAnswer] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  const active = isActiveStatus(props.status);
  const lastEvent = props.events.at(-1);

  useEffect(() => setRequest(props.userRequest), [props.userRequest]);
  useEffect(() => {
    setAnswer("");
    setSelectedOption("");
  }, [props.pendingUserInput?.questionId]);

  return (
    <section className="ns-agent-run" aria-label="Agentic Writing Loop">
      <header className="ns-agent-run-header">
        <div className="ns-agent-mode-controls">
          <SegmentedControl
            ariaLabel="运行模式"
            disabled={active}
            onChange={props.onOperationModeChange}
            options={[
              { label: "规划", value: "planning" },
              { label: "执行", value: "execution" }
            ]}
            value={props.operationMode}
          />
          <SegmentedControl
            ariaLabel="上下文模式"
            disabled={active}
            onChange={props.onContextModeChange}
            options={[
              { label: "写作", value: "writing" },
              { label: "通用文件", value: "general_file" }
            ]}
            value={props.contextMode}
          />
        </div>
        <span className="ns-agent-status">{statusLabel(props.status)}</span>
      </header>

      {props.providerLabel === undefined ? null : (
        <p className="ns-agent-runtime-label">{props.providerLabel}</p>
      )}
      {props.contextSourceNotice === undefined ? null : (
        <p className="ns-agent-context-notice">{props.contextSourceNotice}</p>
      )}

      {props.assistantText.length === 0 ? null : (
        <p className="ns-agent-assistant-text">{props.assistantText}</p>
      )}
      {props.events.length === 0 ? null : <AgentRunTimeline events={props.events} />}

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
              aria-label="停止 Agent 运行"
              className="ns-ai-secondary-button"
              onClick={props.onStop}
              type="button"
            >
              <Square aria-hidden="true" size={13} />
              停止
            </button>
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

      {props.planArtifact === undefined ? null : (
        <PlanArtifactReview plan={props.planArtifact} onDecision={props.onDecidePlan} />
      )}

      {props.errorMessage === undefined ? null : (
        <p className="ns-project-feedback" data-kind="error" role="alert">
          {props.errorMessage}
        </p>
      )}

      <div className="ns-agent-run-actions">
        {active ? (
          <button
            aria-label="停止 Agent 运行"
            className="ns-ai-secondary-button"
            onClick={props.onStop}
            type="button"
          >
            <Square aria-hidden="true" size={13} />
            停止
          </button>
        ) : null}
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
      </div>

      <div className="ns-agent-composer">
        <textarea
          aria-label="Agent 请求"
          disabled={active || props.status === "plan_ready"}
          onChange={(event) => setRequest(event.currentTarget.value)}
          placeholder="说明本次规划或执行目标"
          value={request}
        />
        <button
          aria-label="启动 Agent 运行"
          className="ns-ai-send-button"
          disabled={active || request.trim().length === 0 || props.status === "plan_ready"}
          onClick={() => props.onSend(request.trim())}
          type="button"
        >
          <Send aria-hidden="true" size={14} />
        </button>
      </div>
    </section>
  );
}

function SegmentedControl<T extends string>({
  ariaLabel,
  disabled,
  onChange,
  options,
  value
}: {
  readonly ariaLabel: string;
  readonly disabled: boolean;
  readonly onChange: (value: T) => void;
  readonly options: readonly { readonly label: string; readonly value: T }[];
  readonly value: T;
}) {
  return (
    <div className="ns-agent-segmented" aria-label={ariaLabel} role="group">
      {options.map((option) => (
        <button
          aria-pressed={option.value === value}
          disabled={disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function isActiveStatus(status: AgentRunPanelProps["status"]): boolean {
  return !["idle", "completed", "cancelled", "failed", "limit_reached", "plan_ready"].includes(
    status
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
