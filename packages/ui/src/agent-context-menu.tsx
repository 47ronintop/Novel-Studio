import { AlertTriangle, Layers, RefreshCw, Scissors } from "lucide-react";
import type { ReactNode } from "react";

import { AgentPopover } from "./agent-popover.js";
import type {
  AgentComposerContextState,
  AgentComposerContextStatusControl,
  AgentContextPrecision
} from "./workspace-shell-types.js";

export interface AgentContextMenuProps {
  readonly control: AgentComposerContextStatusControl;
  readonly disabled?: boolean;
}

const STATE_LABEL: Record<AgentComposerContextState, string> = {
  normal: "上下文",
  heavy: "上下文较多",
  needs_refresh: "上下文需刷新",
  compaction_failed: "上下文压缩失败"
};

const PRECISION_LABEL: Record<AgentContextPrecision, string> = {
  reported: "精确",
  estimated: "估算",
  unknown: "未知"
};

/**
 * The composer's context-status control: a button that stays quiet in the normal state and only
 * announces `上下文较多` / `上下文需刷新` / `上下文压缩失败` proactively. Its popover shows exact usage,
 * precision, per-source detail, and the manual compact/refresh commands.
 */
export function AgentContextMenu(props: AgentContextMenuProps): ReactNode {
  const { control } = props;
  const attention = control.state !== "normal";
  const stateLabel = STATE_LABEL[control.state];

  return (
    <AgentPopover
      disabled={props.disabled ?? false}
      panelClassName="ns-agent-context-popover"
      panelLabel="上下文用量"
      rootClassName="ns-agent-context-popover-root"
      triggerClassName={
        attention ? "ns-agent-context-trigger ns-agent-context-trigger-attention" : "ns-agent-context-trigger"
      }
      triggerContent={
        <>
          {attention ? (
            <AlertTriangle aria-hidden="true" size={13} />
          ) : (
            <Layers aria-hidden="true" size={13} />
          )}
        </>
      }
      triggerLabel={`${stateLabel} · ${control.usageLabel}`}
      triggerTitle="查看上下文用量"
    >
      {({ close }) => (
        <div className="ns-agent-context-panel">
          <p className="ns-agent-context-usage">
            <span>{control.usageLabel}</span>
            <span className="ns-agent-context-precision">{PRECISION_LABEL[control.precision]}</span>
          </p>
          {control.state === "compaction_failed" ? (
            <p className="ns-agent-context-warning" role="alert">
              上次压缩失败，原有上下文保持不变。
            </p>
          ) : null}
          <ul aria-label="上下文来源" className="ns-agent-context-sources">
            {control.sources.length === 0 ? (
              <li className="ns-agent-context-empty">暂无上下文来源</li>
            ) : (
              control.sources.map((source) => (
                <li key={source.refId}>
                  <span className="ns-agent-context-source-label">{source.label}</span>
                  <span className="ns-agent-context-source-detail">{source.detail}</span>
                </li>
              ))
            )}
          </ul>
          <div className="ns-agent-context-actions">
            {control.onRefresh === undefined ? null : (
              <button
                disabled={control.busy === true}
                onClick={() => {
                  control.onRefresh?.();
                  close();
                }}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={13} />
                刷新上下文
              </button>
            )}
            {control.onCompact === undefined ? null : (
              <button
                disabled={control.busy === true}
                onClick={() => {
                  control.onCompact?.();
                  close();
                }}
                type="button"
              >
                <Scissors aria-hidden="true" size={13} />
                压缩上下文
              </button>
            )}
          </div>
        </div>
      )}
    </AgentPopover>
  );
}
