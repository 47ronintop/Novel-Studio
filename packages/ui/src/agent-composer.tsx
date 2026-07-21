import { ChevronDown, Cpu, Plus, Send, Square, X } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

import { AgentPermissionMenu } from "./agent-permission-menu.js";
import { AgentPopover, rovePopoverOptions } from "./agent-popover.js";
import type { AgentComposerProps } from "./workspace-shell-types.js";

const REASONING_LABELS: Record<string, string> = {
  none: "关闭",
  minimal: "极简",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高"
};

function reasoningLabel(value: string): string {
  return REASONING_LABELS[value] ?? value;
}

export function AgentComposer(props: AgentComposerProps) {
  const executionOptionRef = useRef<HTMLButtonElement>(null);
  const planningOptionRef = useRef<HTMLButtonElement>(null);
  const draftDisabled = props.disabled === true || props.active;
  const canSend =
    !draftDisabled &&
    props.request.trim().length > 0 &&
    (props.operationMode !== "execution" ||
      props.writePolicy !== "user_preapproved_run" ||
      props.writePolicyAcknowledged);

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) props.onSend(props.request.trim());
  }

  const operationLabel = props.operationMode === "execution" ? "执行" : "规划";
  const model = props.model;
  const reasoning = props.reasoning;
  const references = props.references;

  // Combined model+reasoning label for the trigger
  const selectedModelLabel =
    model === undefined
      ? ""
      : model.profiles.find((profile) => profile.id === model.selectedProfileId)?.label ??
        model.selectedProfileId;
  const showReasoningInTrigger = reasoning !== undefined && reasoning.visible;
  const combinedModelLabel = showReasoningInTrigger
    ? `${selectedModelLabel} · ${reasoningLabel(reasoning.current)}`
    : selectedModelLabel;

  return (
    <section className="ns-agent-conversation-composer ns-agent-composer" aria-label="会话输入区">
      {props.disabledReason === undefined ? null : (
        <p className="ns-agent-conversation-composer-note">{props.disabledReason}</p>
      )}
      <div className="ns-agent-composer-surface">
        <textarea
          aria-label="Agent 请求"
          disabled={draftDisabled}
          onChange={(event) => props.onRequestChange(event.currentTarget.value)}
          onKeyDown={handleDraftKeyDown}
          placeholder="说明你想续写、修改、分析或规划的内容…"
          value={props.request}
        />
        {references !== undefined && references.chips.length > 0 ? (
          <ul aria-label="已选引用" className="ns-agent-composer-reference-chips-inset">
            {references.chips.map((chip) => (
              <li key={chip.refId}>
                <span className="ns-agent-composer-reference-chip-label">{chip.label}</span>
                <button
                  aria-label={`移除引用 ${chip.label}`}
                  disabled={draftDisabled}
                  onClick={() => references.onRemove(chip.refId)}
                  type="button"
                >
                  <X aria-hidden="true" size={11} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="ns-agent-composer-toolbar">
          <div className="ns-agent-composer-toolbar-left">
            {references !== undefined ? (
              <AgentPopover
                disabled={draftDisabled || references.available.length === 0}
                panelClassName="ns-agent-composer-reference-popover"
                panelLabel="添加上下文引用"
                triggerClassName="ns-agent-composer-ref-add-trigger"
                triggerContent={<Plus aria-hidden="true" size={13} />}
                triggerLabel="添加上下文引用"
                triggerTitle="添加上下文引用"
              >
                {({ close }) => (
                  <ul aria-label="可添加的引用" className="ns-agent-composer-option-list" role="listbox">
                    {references.available.length === 0 ? (
                      <li className="ns-agent-context-empty">暂无可添加的引用</li>
                    ) : (
                      references.available.map((ref) => (
                        <li key={ref.refId}>
                          <button
                            data-reference-option={ref.refId}
                            disabled={draftDisabled}
                            onClick={() => {
                              references.onAdd(ref.refId);
                              close();
                            }}
                            type="button"
                          >
                            {ref.label}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </AgentPopover>
            ) : null}
            <AgentPopover
              disabled={draftDisabled}
              initialFocus={
                props.operationMode === "execution" ? executionOptionRef : planningOptionRef
              }
              panelClassName="ns-agent-composer-mode-popover"
              panelLabel="运行方式"
              triggerClassName="ns-agent-composer-mode-trigger"
              triggerContent={
                <>
                  {operationLabel}
                  <ChevronDown aria-hidden="true" size={12} />
                </>
              }
              triggerLabel={operationLabel}
              triggerTitle="选择运行方式"
            >
              {({ close }) => (
                <div aria-label="运行方式" role="group">
                  <button
                    aria-pressed={props.operationMode === "execution"}
                    data-mode-option="execution"
                    disabled={draftDisabled}
                    onClick={() => {
                      props.onOperationModeChange("execution");
                      close();
                    }}
                    onKeyDown={(event) => {
                      rovePopoverOptions(event);
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        props.onOperationModeChange("execution");
                        close();
                      }
                    }}
                    ref={executionOptionRef}
                    type="button"
                  >
                    执行
                  </button>
                  <button
                    aria-pressed={props.operationMode === "planning"}
                    data-mode-option="planning"
                    disabled={draftDisabled}
                    onClick={() => {
                      props.onOperationModeChange("planning");
                      props.onWritePolicyChange("write_before_confirmation");
                      props.onWritePolicyAcknowledgedChange(false);
                      close();
                    }}
                    onKeyDown={(event) => {
                      rovePopoverOptions(event);
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        props.onOperationModeChange("planning");
                        props.onWritePolicyChange("write_before_confirmation");
                        props.onWritePolicyAcknowledgedChange(false);
                        close();
                      }
                    }}
                    ref={planningOptionRef}
                    type="button"
                  >
                    规划（只读）
                  </button>
                </div>
              )}
            </AgentPopover>
            {props.operationMode === "planning" ? (
              <span className="ns-agent-composer-mode-badge">只读</span>
            ) : (
              <AgentPermissionMenu
                {...(props.permission === undefined ? {} : { control: props.permission })}
                onWritePolicyAcknowledgedChange={props.onWritePolicyAcknowledgedChange}
                onWritePolicyChange={props.onWritePolicyChange}
                policyDisabled={draftDisabled}
                writePolicy={props.writePolicy}
                writePolicyAcknowledged={props.writePolicyAcknowledged}
              />
            )}
          </div>
          <div className="ns-agent-composer-toolbar-right">
            {model === undefined ? null : (
              <AgentPopover
                disabled={draftDisabled}
                panelClassName="ns-agent-composer-model-popover"
                panelLabel="模型与推理"
                triggerClassName="ns-agent-composer-model-trigger"
                triggerContent={
                  <>
                    <Cpu aria-hidden="true" size={13} />
                    <span>{combinedModelLabel}</span>
                    <ChevronDown aria-hidden="true" size={12} />
                  </>
                }
                triggerLabel={`模型与推理：${combinedModelLabel}`}
                triggerTitle="选择模型与推理强度"
              >
                {({ close }) => (
                  <div className="ns-agent-composer-model-panel">
                    <ul aria-label="模型" className="ns-agent-composer-option-list" role="listbox">
                      {model.profiles.map((profile) => (
                        <li key={profile.id}>
                          <button
                            aria-selected={profile.id === model.selectedProfileId}
                            data-model-option={profile.id}
                            disabled={draftDisabled}
                            onClick={() => {
                              model.onSelect(profile.id);
                              close();
                            }}
                            type="button"
                          >
                            <span>{profile.label}</span>
                            <span className="ns-agent-composer-option-hint">{profile.provider}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {reasoning !== undefined && reasoning.visible ? (
                      <>
                        <div aria-hidden="true" className="ns-agent-composer-model-divider" />
                        <ul
                          aria-label="推理强度"
                          className="ns-agent-composer-option-list"
                          role="listbox"
                        >
                          {reasoning.values.map((value) => (
                            <li key={value}>
                              <button
                                aria-selected={value === reasoning.current}
                                data-reasoning-option={value}
                                disabled={draftDisabled}
                                onClick={() => {
                                  reasoning.onSelect(value);
                                  close();
                                }}
                                type="button"
                              >
                                {reasoningLabel(value)}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </div>
                )}
              </AgentPopover>
            )}
            <div className="ns-agent-composer-command-slot">
              {props.active ? (
                <button
                  aria-label="停止 Agent 运行"
                  className="ns-ai-secondary-button"
                  disabled={props.disabled === true}
                  onClick={props.onStop}
                  type="button"
                >
                  <Square aria-hidden="true" size={14} />
                </button>
              ) : (
                <button
                  aria-label="启动 Agent 运行"
                  className="ns-ai-send-button"
                  disabled={!canSend}
                  onClick={() => props.onSend(props.request.trim())}
                  type="button"
                >
                  <Send aria-hidden="true" size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
