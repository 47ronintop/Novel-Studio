import { ChevronDown, Cpu, Plus, Send, Square, X, Zap } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

import { AgentContextMenu } from "./agent-context-menu.js";
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
  const contextLabel = props.contextMode === "writing" ? "写作" : "通用文件";
  const model = props.model;
  const reasoning = props.reasoning;
  const references = props.references;
  const selectedModelLabel =
    model === undefined
      ? ""
      : model.profiles.find((profile) => profile.id === model.selectedProfileId)?.label ??
        model.selectedProfileId;

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
          placeholder="说明本次规划或执行目标"
          value={props.request}
        />
        <div className="ns-agent-composer-toolbar">
          <div className="ns-agent-composer-toolbar-left">
            <AgentPopover
              disabled={draftDisabled}
              initialFocus={
                props.operationMode === "execution" ? executionOptionRef : planningOptionRef
              }
              panelClassName="ns-agent-composer-mode-popover"
              panelLabel="运行方式与上下文"
              triggerContent={
                <>
                  {operationLabel} · {contextLabel}
                  <ChevronDown aria-hidden="true" size={13} />
                </>
              }
              triggerLabel={`${operationLabel} · ${contextLabel}`}
              triggerTitle="选择运行方式和上下文"
            >
              {({ close }) => (
                <>
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
                  <div aria-label="上下文" role="group">
                    <button
                      aria-pressed={props.contextMode === "writing"}
                      data-context-option="writing"
                      disabled={draftDisabled}
                      onClick={() => {
                        props.onContextModeChange("writing");
                        close();
                      }}
                      onKeyDown={(event) => {
                        rovePopoverOptions(event);
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          props.onContextModeChange("writing");
                          close();
                        }
                      }}
                      type="button"
                    >
                      写作
                    </button>
                    <button
                      aria-pressed={props.contextMode === "general_file"}
                      data-context-option="general_file"
                      disabled={draftDisabled}
                      onClick={() => {
                        props.onContextModeChange("general_file");
                        close();
                      }}
                      onKeyDown={(event) => {
                        rovePopoverOptions(event);
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          props.onContextModeChange("general_file");
                          close();
                        }
                      }}
                      type="button"
                    >
                      通用文件
                    </button>
                  </div>
                </>
              )}
            </AgentPopover>
            {props.operationMode === "planning" ? (
              <span>只读规划</span>
            ) : (
              <label>
                <span className="ns-visually-hidden">修改权限</span>
                <select
                  aria-label="写入策略"
                  disabled={draftDisabled}
                  onChange={(event) =>
                    props.onWritePolicyChange(
                      event.currentTarget.value as AgentComposerProps["writePolicy"]
                    )
                  }
                  value={props.writePolicy}
                >
                  <option value="write_before_confirmation">每次修改前确认</option>
                  <option value="user_preapproved_run">本次运行自动修改</option>
                </select>
              </label>
            )}
            {props.operationMode === "execution" && props.writePolicy === "user_preapproved_run" ? (
              <label className="ns-agent-write-acknowledgement">
                <input
                  checked={props.writePolicyAcknowledged}
                  disabled={draftDisabled}
                  onChange={(event) =>
                    props.onWritePolicyAcknowledgedChange(event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                <span>确认本次运行自动修改</span>
              </label>
            ) : null}
            {references === undefined ? null : (
              <ReferenceControls draftDisabled={draftDisabled} references={references} />
            )}
            {props.contextStatus === undefined ? null : (
              <AgentContextMenu control={props.contextStatus} disabled={draftDisabled} />
            )}
          </div>
          <div className="ns-agent-composer-toolbar-right">
            {model === undefined ? null : (
              <AgentPopover
                disabled={draftDisabled}
                panelClassName="ns-agent-composer-model-popover"
                panelLabel="模型"
                triggerClassName="ns-agent-composer-model-trigger"
                triggerContent={
                  <>
                    <Cpu aria-hidden="true" size={13} />
                    <span>{selectedModelLabel}</span>
                  </>
                }
                triggerLabel={`模型：${selectedModelLabel}`}
                triggerTitle="选择模型"
              >
                {({ close }) => (
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
                )}
              </AgentPopover>
            )}
            {reasoning === undefined || !reasoning.visible ? null : (
              <AgentPopover
                disabled={draftDisabled}
                panelClassName="ns-agent-composer-reasoning-popover"
                panelLabel="推理强度"
                triggerClassName="ns-agent-composer-reasoning-trigger"
                triggerContent={
                  <>
                    <Zap aria-hidden="true" size={13} />
                    <span>{reasoningLabel(reasoning.current)}</span>
                  </>
                }
                triggerLabel={`推理强度：${reasoningLabel(reasoning.current)}`}
                triggerTitle="选择推理强度"
              >
                {({ close }) => (
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

function ReferenceControls(props: {
  readonly references: NonNullable<AgentComposerProps["references"]>;
  readonly draftDisabled: boolean;
}) {
  const { references, draftDisabled } = props;
  return (
    <div className="ns-agent-composer-references">
      <AgentPopover
        disabled={draftDisabled || references.available.length === 0}
        panelClassName="ns-agent-composer-reference-popover"
        panelLabel="添加上下文引用"
        triggerClassName="ns-agent-composer-reference-add"
        triggerContent={
          <>
            <Plus aria-hidden="true" size={13} />
            <span>引用</span>
          </>
        }
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
      <ul aria-label="已选引用" className="ns-agent-composer-reference-chips">
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
    </div>
  );
}
