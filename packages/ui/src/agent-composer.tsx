import {
  ArrowLeft,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  Plus,
  Send,
  Square,
  X
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { AgentPermissionMenu } from "./agent-permission-menu.js";
import { AgentPopover, rovePopoverOptions } from "./agent-popover.js";
import { AgentContextMenu } from "./agent-context-menu.js";
import type { AgentComposerProps } from "./workspace-shell-types.js";

const REASONING_LABELS: Record<string, string> = {
  none: "关闭",
  minimal: "极简",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最大",
  ultra: "超高"
};

function reasoningLabel(value: string): string {
  return REASONING_LABELS[value] ?? value;
}

type ModelControl = NonNullable<AgentComposerProps["model"]>;
type ReasoningControl = NonNullable<AgentComposerProps["reasoning"]>;
type ModelSubmenu = "model" | "reasoning";
type ModelMenuView = "root" | ModelSubmenu;

interface ModelReasoningMenuProps {
  readonly close: () => void;
  readonly disabled: boolean;
  readonly model: ModelControl;
  readonly reasoning?: ReasoningControl | undefined;
  readonly selectedModelLabel: string;
}

function ModelReasoningMenu(props: ModelReasoningMenuProps): ReactNode {
  const [view, setView] = useState<ModelMenuView>("root");
  const panelRef = useRef<HTMLDivElement>(null);
  const modelRowRef = useRef<HTMLButtonElement>(null);
  const reasoningRowRef = useRef<HTMLButtonElement>(null);
  const focusOptionsRef = useRef(false);
  const returnFocusRef = useRef<ModelSubmenu | null>(null);

  useEffect(() => {
    if (view === "root") {
      const returnTo = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnTo !== null) {
        (returnTo === "model" ? modelRowRef.current : reasoningRowRef.current)?.focus();
      }
      return;
    }
    if (!focusOptionsRef.current) return;
    focusOptionsRef.current = false;
    const selected = panelRef.current?.querySelector<HTMLButtonElement>(
      'button[aria-selected="true"]'
    );
    const first = panelRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])");
    (selected ?? first)?.focus();
  }, [view]);

  function openView(next: ModelSubmenu, focusOptions: boolean): void {
    focusOptionsRef.current = focusOptions;
    setView(next);
  }

  function returnToRoot(kind: ModelSubmenu): void {
    returnFocusRef.current = kind;
    setView("root");
  }

  function handleRootKeyDown(event: KeyboardEvent<HTMLButtonElement>, next: ModelSubmenu): void {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      rovePopoverOptions(event);
      return;
    }
    if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openView(next, true);
    }
  }

  function handleOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, kind: ModelSubmenu): void {
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      returnToRoot(kind);
      return;
    }
    if (
      event.key !== "ArrowUp" &&
      event.key !== "ArrowDown" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    const options = Array.from(
      event.currentTarget
        .closest('[role="listbox"]')
        ?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []
    );
    if (options.length === 0) return;
    const currentIndex = options.indexOf(event.currentTarget);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (currentIndex + (event.key === "ArrowUp" ? -1 : 1) + options.length) % options.length;
    options[nextIndex]?.focus();
  }

  if (view === "root") {
    return (
      <div className="ns-agent-composer-model-panel" ref={panelRef} data-view="root">
        <div aria-label="模型与推理选项" className="ns-agent-composer-model-menu" role="menu">
          <button
            aria-expanded={false}
            aria-haspopup="listbox"
            aria-label={`模型：${props.selectedModelLabel}`}
            className="ns-agent-composer-model-menu-row"
            data-model-menu="model"
            onClick={() => openView("model", true)}
            onKeyDown={(event) => handleRootKeyDown(event, "model")}
            ref={modelRowRef}
            role="menuitem"
            type="button"
          >
            <span className="ns-agent-composer-model-menu-copy">
              <span className="ns-agent-composer-model-menu-label">
                <Cpu aria-hidden="true" size={13} />
                <span>模型</span>
              </span>
              <span className="ns-agent-composer-model-menu-value">{props.selectedModelLabel}</span>
            </span>
            <ChevronRight aria-hidden="true" size={13} />
          </button>
          {props.reasoning === undefined ? null : (
            <button
              aria-expanded={false}
              aria-haspopup="listbox"
              aria-label={`推理强度：${reasoningLabel(props.reasoning.current)}`}
              className="ns-agent-composer-model-menu-row"
              data-model-menu="reasoning"
              onClick={() => openView("reasoning", true)}
              onKeyDown={(event) => handleRootKeyDown(event, "reasoning")}
              ref={reasoningRowRef}
              role="menuitem"
              type="button"
            >
              <span className="ns-agent-composer-model-menu-copy">
                <span className="ns-agent-composer-model-menu-label">
                  <BrainCircuit aria-hidden="true" size={13} />
                  <span>推理强度</span>
                </span>
                <span className="ns-agent-composer-model-menu-value">
                  {reasoningLabel(props.reasoning.current)}
                </span>
              </span>
              <ChevronRight aria-hidden="true" size={13} />
            </button>
          )}
        </div>
      </div>
    );
  }

  const optionsLabel = view === "model" ? "模型选项" : "推理强度选项";
  return (
    <div
      aria-label={optionsLabel}
      className="ns-agent-composer-model-panel"
      data-submenu={view}
      data-view={view}
      ref={panelRef}
    >
      <button
        aria-label="返回模型与推理选项"
        className="ns-agent-composer-model-menu-back"
        onClick={() => {
          returnToRoot(view);
        }}
        type="button"
      >
        <ArrowLeft aria-hidden="true" size={13} />
        <span>{view === "model" ? "选择模型" : "选择推理强度"}</span>
      </button>
      {view === "model" ? (
        <ul aria-label="模型" className="ns-agent-composer-option-list" role="listbox">
          {props.model.profiles.length === 0 ? (
            <li className="ns-agent-context-empty">尚未配置可用模型</li>
          ) : (
            props.model.profiles.map((profile) => {
              const selected = profile.id === props.model.selectedProfileId;
              return (
                <li key={profile.id}>
                  <button
                    aria-selected={selected}
                    data-model-option={profile.id}
                    disabled={props.disabled}
                    onClick={() => {
                      props.model.onSelect(profile.id);
                      props.close();
                    }}
                    onKeyDown={(event) => handleOptionKeyDown(event, "model")}
                    type="button"
                  >
                    <span className="ns-agent-composer-option-copy">
                      <span>{profile.label}</span>
                      <span className="ns-agent-composer-option-hint">{profile.provider}</span>
                    </span>
                    {selected ? <Check aria-hidden="true" size={13} /> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : props.reasoning === undefined ? null : (
        <ul aria-label="推理强度" className="ns-agent-composer-option-list" role="listbox">
          {props.reasoning.values.map((value) => {
            const selected = value === props.reasoning?.current;
            return (
              <li key={value}>
                <button
                  aria-selected={selected}
                  data-reasoning-option={value}
                  disabled={props.disabled}
                  onClick={() => {
                    props.reasoning?.onSelect(value);
                    props.close();
                  }}
                  onKeyDown={(event) => handleOptionKeyDown(event, "reasoning")}
                  type="button"
                >
                  <span>{reasoningLabel(value)}</span>
                  {selected ? <Check aria-hidden="true" size={13} /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type ComposerRunMode = "planning" | "readonly" | "automatic";

function selectedRunMode(props: AgentComposerProps): ComposerRunMode {
  if (props.operationMode === "planning") return "planning";
  return props.writePolicy === "user_preapproved_run" ? "automatic" : "readonly";
}

function runModeLabel(mode: ComposerRunMode): string {
  switch (mode) {
    case "planning":
      return "规划";
    case "automatic":
      return "自动";
    default:
      return "只读";
  }
}

export function AgentComposer(props: AgentComposerProps) {
  const planningOptionRef = useRef<HTMLButtonElement>(null);
  const readonlyOptionRef = useRef<HTMLButtonElement>(null);
  const automaticOptionRef = useRef<HTMLButtonElement>(null);
  const draftDisabled = props.disabled === true || props.active;
  const canSend = !draftDisabled && props.request.trim().length > 0;
  const runMode = selectedRunMode(props);

  function applyRunMode(mode: ComposerRunMode): void {
    if (mode === "planning") {
      props.onOperationModeChange("planning");
      props.onWritePolicyChange("write_before_confirmation");
      props.onWritePolicyAcknowledgedChange(false);
      return;
    }

    props.onOperationModeChange("execution");
    if (mode === "automatic") {
      props.onWritePolicyChange("user_preapproved_run");
      // Selecting automatic mode is the explicit approval for this run.
      props.onWritePolicyAcknowledgedChange(true);
      return;
    }
    props.onWritePolicyChange("write_before_confirmation");
    props.onWritePolicyAcknowledgedChange(false);
  }

  function sendRequest(): void {
    if (!canSend) return;
    if (runMode === "automatic") props.onWritePolicyAcknowledgedChange(true);
    props.onSend(props.request.trim());
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    sendRequest();
  }

  const model = props.model;
  const reasoning = props.reasoning;
  const references = props.references;
  const selectedModel = model?.profiles.find((profile) => profile.id === model.selectedProfileId);
  const selectedModelLabel =
    selectedModel?.label ??
    (model === undefined || model.profiles.length === 0 ? "未配置模型" : model.selectedProfileId);
  const modelTriggerLabel =
    reasoning === undefined || !reasoning.visible
      ? selectedModelLabel
      : `${selectedModelLabel} · ${reasoningLabel(reasoning.current)}`;

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
          <div className="ns-agent-composer-footer">
            <div aria-label="会话配置" className="ns-agent-composer-footer-leading" role="group">
              {references !== undefined ? (
                <AgentPopover
                  disabled={draftDisabled || references.available.length === 0}
                  panelClassName="ns-agent-composer-reference-popover"
                  panelLabel="添加上下文引用"
                  triggerClassName="ns-agent-composer-ref-add-trigger"
                  triggerContent={<Plus aria-hidden="true" size={14} />}
                  triggerLabel="添加上下文引用"
                  triggerTitle="添加上下文引用"
                >
                  {({ close }) => (
                    <ul
                      aria-label="可添加的引用"
                      className="ns-agent-composer-option-list"
                      role="listbox"
                    >
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
              {model === undefined ? null : (
                <AgentPopover
                  disabled={draftDisabled}
                  panelClassName="ns-agent-composer-model-popover"
                  panelLabel="选择模型与推理强度"
                  rootClassName="ns-agent-composer-model-popover-root"
                  triggerClassName="ns-agent-composer-model-trigger"
                  triggerContent={<span>{selectedModelLabel}</span>}
                  triggerLabel={`模型与推理：${modelTriggerLabel}`}
                  triggerTitle={`模型：${selectedModelLabel}${
                    reasoning === undefined || !reasoning.visible
                      ? ""
                      : `；推理强度：${reasoningLabel(reasoning.current)}`
                  }`}
                >
                  {({ close }) => (
                    <ModelReasoningMenu
                      close={close}
                      disabled={draftDisabled}
                      model={model}
                      reasoning={reasoning?.visible === true ? reasoning : undefined}
                      selectedModelLabel={selectedModelLabel}
                    />
                  )}
                </AgentPopover>
              )}
              {props.contextStatus === undefined ? null : (
                <AgentContextMenu control={props.contextStatus} disabled={draftDisabled} />
              )}
              {props.operationMode === "planning" ? null : (
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
            <div aria-label="会话操作" className="ns-agent-composer-footer-trailing" role="group">
              <AgentPopover
                disabled={draftDisabled}
                initialFocus={
                  runMode === "planning"
                    ? planningOptionRef
                    : runMode === "automatic"
                      ? automaticOptionRef
                      : readonlyOptionRef
                }
                panelClassName="ns-agent-composer-mode-popover"
                panelLabel="运行方式"
                triggerClassName="ns-agent-composer-mode-trigger"
                triggerContent={
                  <>
                    <span>{runModeLabel(runMode)}</span>
                    <ChevronDown aria-hidden="true" size={12} />
                  </>
                }
                triggerLabel={runModeLabel(runMode)}
                triggerTitle="选择运行方式"
              >
                {({ close }) => (
                  <div aria-label="运行方式" role="group">
                    <button
                      aria-label="规划"
                      aria-pressed={runMode === "planning"}
                      data-mode-option="planning"
                      data-run-mode="planning"
                      disabled={draftDisabled}
                      onClick={() => {
                        applyRunMode("planning");
                        close();
                      }}
                      onKeyDown={rovePopoverOptions}
                      ref={planningOptionRef}
                      type="button"
                    >
                      <span>规划</span>
                      <small>只读</small>
                    </button>
                    <button
                      aria-label="只读"
                      aria-pressed={runMode === "readonly"}
                      data-mode-option="execution"
                      data-run-mode="readonly"
                      disabled={draftDisabled}
                      onClick={() => {
                        applyRunMode("readonly");
                        close();
                      }}
                      onKeyDown={rovePopoverOptions}
                      ref={readonlyOptionRef}
                      type="button"
                    >
                      <span>只读</span>
                      <small>每次修改前确认</small>
                    </button>
                    <button
                      aria-label="自动"
                      aria-pressed={runMode === "automatic"}
                      data-mode-option="automatic"
                      data-run-mode="automatic"
                      disabled={draftDisabled}
                      onClick={() => {
                        applyRunMode("automatic");
                        close();
                      }}
                      onKeyDown={rovePopoverOptions}
                      ref={automaticOptionRef}
                      type="button"
                    >
                      <span>自动</span>
                      <small>本次运行自动修改</small>
                    </button>
                  </div>
                )}
              </AgentPopover>
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
                    onClick={sendRequest}
                    type="button"
                  >
                    <Send aria-hidden="true" size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
