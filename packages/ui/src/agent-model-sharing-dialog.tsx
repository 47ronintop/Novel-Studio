import type { WorkspaceModelSharingDefaults } from "@novel-studio/application";
import { useEffect, useRef, useState, type Ref } from "react";

export const DEFAULT_WORKSPACE_MODEL_SHARING_SELECTION: WorkspaceModelSharingDefaults =
  Object.freeze({
    outlineMetadata: "automatic",
    activeResource: "automatic",
    conversationSummary: "ask",
    toolReadResults: "ask"
  });

export interface AgentModelSharingDialogProps {
  readonly open: boolean;
  readonly initialDefaults?: WorkspaceModelSharingDefaults | null;
  readonly loading?: boolean;
  readonly loadError?: string;
  readonly blockedSend?: boolean;
  readonly onClose: () => void;
  /** Returns a Chinese error message, or undefined after Main has persisted and refreshed. */
  readonly onSave: (defaults: WorkspaceModelSharingDefaults) => Promise<string | undefined>;
}

export function AgentModelSharingDialog(props: AgentModelSharingDialogProps) {
  const [defaults, setDefaults] = useState<WorkspaceModelSharingDefaults>(
    DEFAULT_WORKSPACE_MODEL_SHARING_SELECTION
  );
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const firstSelectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (!props.open) return;
    setDefaults(props.initialDefaults ?? DEFAULT_WORKSPACE_MODEL_SHARING_SELECTION);
    setBusy(false);
    setSaved(false);
    setErrorMessage(undefined);
    if (props.loading !== true) firstSelectRef.current?.focus();
  }, [props.initialDefaults, props.loading, props.open]);

  if (!props.open) return null;

  const save = async () => {
    if (busy || saved || props.loading === true || props.loadError !== undefined) return;
    setBusy(true);
    setErrorMessage(undefined);
    const error = await props.onSave(defaults);
    setBusy(false);
    if (error !== undefined) {
      setErrorMessage(error);
      return;
    }
    setSaved(true);
  };

  return (
    <div
      aria-label="设置模型共享范围"
      aria-modal="true"
      className="ns-agent-sharing-dialog"
      role="dialog"
    >
      <div className="ns-agent-sharing-dialog-backdrop" />
      <section className="ns-agent-sharing-dialog-content">
        <header>
          <strong>设置模型共享范围</strong>
          <p>
            {props.blockedSend === true
              ? "Agent 已停止本次发送。请先为当前项目选择可共享的内容。"
              : "控制当前项目的哪些内容可以发送给模型。"}
          </p>
        </header>

        <div className="ns-agent-sharing-meaning" aria-label="共享选项说明">
          <p>
            <strong>自动</strong>：可直接加入发送预览，仍受预览与输入预算限制。
          </p>
          <p>
            <strong>询问</strong>：读取或发送前会再向你确认。
          </p>
          <p>
            <strong>拒绝</strong>：不读取，也不发送该类内容。
          </p>
        </div>

        <div className="ns-agent-sharing-fields">
          <SharingSelect
            inputRef={firstSelectRef}
            label="项目结构摘要"
            value={defaults.outlineMetadata}
            disabled={busy || saved || props.loading === true}
            options={[
              ["automatic", "自动加入发送预览"],
              ["off", "不发送"]
            ]}
            onChange={(outlineMetadata) => setDefaults({ ...defaults, outlineMetadata })}
          />
          <SharingSelect
            label="当前打开内容"
            value={defaults.activeResource}
            disabled={busy || saved || props.loading === true}
            options={[
              ["automatic", "自动加入发送预览"],
              ["off", "不发送"]
            ]}
            onChange={(activeResource) => setDefaults({ ...defaults, activeResource })}
          />
          <SharingSelect
            label="会话摘要"
            value={defaults.conversationSummary}
            disabled={busy || saved || props.loading === true}
            options={READ_SHARING_OPTIONS}
            onChange={(conversationSummary) => setDefaults({ ...defaults, conversationSummary })}
          />
          <SharingSelect
            label="工具读取结果"
            value={defaults.toolReadResults}
            disabled={busy || saved || props.loading === true}
            options={READ_SHARING_OPTIONS}
            onChange={(toolReadResults) => setDefaults({ ...defaults, toolReadResults })}
          />
        </div>

        <p className="ns-agent-sharing-boundary">
          这些设置只作用于当前项目，与项目是否可信无关。项目文本和模型都不能替你更改。
        </p>
        {props.loading === true ? (
          <p className="ns-project-feedback" data-kind="info" role="status">
            正在读取当前项目的共享范围…
          </p>
        ) : null}
        {props.loadError === undefined ? null : (
          <p className="ns-project-feedback" data-kind="error" role="alert">
            {props.loadError}
          </p>
        )}
        {errorMessage === undefined ? null : (
          <p className="ns-project-feedback" data-kind="error" role="alert">
            {errorMessage}
          </p>
        )}
        {saved ? (
          <p className="ns-project-feedback" data-kind="info" role="status">
            已保存当前项目的共享范围并刷新 Agent 运行环境。请返回后重新发送。
          </p>
        ) : null}

        <div className="ns-agent-sharing-actions">
          {saved ? null : (
            <button
              className="ns-icon-text-button"
              disabled={busy}
              onClick={props.onClose}
              type="button"
            >
              稍后设置
            </button>
          )}
          <button
            className="ns-ai-send-button"
            disabled={busy || props.loading === true || props.loadError !== undefined}
            onClick={saved ? props.onClose : () => void save()}
            type="button"
          >
            {saved
              ? "返回 Agent 重试"
              : props.loading === true
                ? "正在读取…"
                : busy
                  ? "正在保存…"
                  : "保存并刷新 Agent"}
          </button>
        </div>
      </section>
    </div>
  );
}

const READ_SHARING_OPTIONS = [
  ["allow", "自动允许"],
  ["ask", "每次询问"],
  ["deny", "拒绝"]
] as const;

function SharingSelect<T extends string>(props: {
  readonly label: string;
  readonly value: T;
  readonly disabled: boolean;
  readonly options: readonly (readonly [T, string])[];
  readonly inputRef?: Ref<HTMLSelectElement>;
  readonly onChange: (value: T) => void;
}) {
  return (
    <label>
      <span>{props.label}</span>
      <select
        aria-label={props.label}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.value as T)}
        ref={props.inputRef}
        value={props.value}
      >
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
