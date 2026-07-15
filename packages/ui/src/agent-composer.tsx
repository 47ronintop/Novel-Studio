import { ChevronDown, Send, Square } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { AgentComposerProps } from "./workspace-shell-types.js";

export function AgentComposer(props: AgentComposerProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const executionOptionRef = useRef<HTMLButtonElement>(null);
  const planningOptionRef = useRef<HTMLButtonElement>(null);
  const draftDisabled = props.disabled === true || props.active;
  const canSend =
    !draftDisabled &&
    props.request.trim().length > 0 &&
    (props.operationMode !== "execution" ||
      props.writePolicy !== "user_preapproved_run" ||
      props.writePolicyAcknowledged);

  useEffect(() => {
    if (!popoverOpen) return;
    (props.operationMode === "execution" ? executionOptionRef : planningOptionRef).current?.focus();
  }, [popoverOpen, props.operationMode]);

  useEffect(() => {
    if (draftDisabled && popoverOpen) setPopoverOpen(false);
  }, [draftDisabled, popoverOpen]);

  function openPopover(): void {
    if (draftDisabled) return;
    setPopoverOpen(true);
  }

  function closePopover(): void {
    setPopoverOpen(false);
    triggerRef.current?.focus();
  }

  function selectOperation(mode: AgentComposerProps["operationMode"]): void {
    props.onOperationModeChange(mode);
    if (mode === "planning") {
      props.onWritePolicyChange("write_before_confirmation");
      props.onWritePolicyAcknowledgedChange(false);
    }
    closePopover();
  }

  function selectContext(mode: AgentComposerProps["contextMode"]): void {
    props.onContextModeChange(mode);
    closePopover();
  }

  function moveOptionFocus(event: KeyboardEvent<HTMLButtonElement>): void {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown"
    )
      return;
    event.preventDefault();
    const options = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button") ?? []
    );
    const index = options.indexOf(event.currentTarget);
    const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    options[(index + delta + options.length) % options.length]?.focus();
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (canSend) props.onSend(props.request.trim());
  }

  const operationLabel = props.operationMode === "execution" ? "执行" : "规划";
  const contextLabel = props.contextMode === "writing" ? "写作" : "通用文件";

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
            <button
              aria-expanded={popoverOpen}
              aria-haspopup="dialog"
              aria-label={`${operationLabel} · ${contextLabel}`}
              disabled={draftDisabled}
              onClick={() => (popoverOpen ? closePopover() : openPopover())}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openPopover();
                }
              }}
              ref={triggerRef}
              title="选择运行方式和上下文"
              type="button"
            >
              {operationLabel} · {contextLabel}
              <ChevronDown aria-hidden="true" size={13} />
            </button>
            {popoverOpen ? (
              <div
                aria-label="运行方式与上下文"
                className="ns-agent-composer-mode-popover"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    closePopover();
                  }
                }}
                role="dialog"
              >
                <div aria-label="运行方式" role="group">
                  <button
                    aria-pressed={props.operationMode === "execution"}
                    data-mode-option="execution"
                    disabled={draftDisabled}
                    onClick={() => selectOperation("execution")}
                    onKeyDown={(event) => {
                      moveOptionFocus(event);
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectOperation("execution");
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
                    onClick={() => selectOperation("planning")}
                    onKeyDown={(event) => {
                      moveOptionFocus(event);
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectOperation("planning");
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
                    onClick={() => selectContext("writing")}
                    onKeyDown={(event) => {
                      moveOptionFocus(event);
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectContext("writing");
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
                    onClick={() => selectContext("general_file")}
                    onKeyDown={(event) => {
                      moveOptionFocus(event);
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectContext("general_file");
                      }
                    }}
                    type="button"
                  >
                    通用文件
                  </button>
                </div>
              </div>
            ) : null}
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
          </div>
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
    </section>
  );
}
