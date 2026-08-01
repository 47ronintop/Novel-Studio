import {
  AlertTriangle,
  Ban,
  Eye,
  FileMinus2,
  FilePlus2,
  Info,
  Layers,
  ListTree,
  Pin,
  RefreshCw,
  RotateCcw,
  Scissors,
  ShieldOff
} from "lucide-react";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

import { AgentPopover } from "./agent-popover.js";
import type {
  AgentComposerContextSourcePreferenceScope,
  AgentComposerContextSourceRow,
  AgentComposerContextState,
  AgentComposerContextStatusControl,
  AgentContextPrecision
} from "./workspace-shell-types.js";

export interface AgentContextMenuProps {
  readonly control: AgentComposerContextStatusControl;
  readonly disabled?: boolean;
}

type ContextInspectorTab = "sources" | "preview";

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

const SELECTION_POLICY_LABEL = {
  automatic: "自动选择",
  explicit: "显式引用",
  pinned: "已固定"
} as const;

const PREFERENCE_SCOPE_LABEL: Record<AgentComposerContextSourcePreferenceScope, string> = {
  automatic: "自动",
  run: "仅本次",
  project: "项目默认"
};

const SOURCE_STATE_LABEL = {
  active: "有效",
  stale: "已过期",
  excluded: "已排除"
} as const;

const CONVENTIONS_STATUS_LABEL = {
  available: "已载入",
  created: "已创建",
  existing: "已存在"
} as const;

/** Compact, on-demand inspection and author control for the context sent with the next run. */
export function AgentContextMenu(props: AgentContextMenuProps): ReactNode {
  const { control } = props;
  const [activeTab, setActiveTab] = useState<ContextInspectorTab>("sources");
  const tabId = useId();
  const fixedBudgetExceeded =
    control.fixedBudgetExceeded === true ||
    (control.tokenStats !== undefined &&
      control.tokenStats.pinnedTokens > control.tokenStats.safeInputBudget);
  const attention = control.state !== "normal" || fixedBudgetExceeded;
  const stateLabel = fixedBudgetExceeded ? "上下文超出预算" : STATE_LABEL[control.state];

  return (
    <AgentPopover
      disabled={props.disabled ?? false}
      panelClassName="ns-agent-context-popover"
      panelLabel="上下文用量"
      rootClassName="ns-agent-context-popover-root"
      triggerClassName={
        attention
          ? "ns-agent-context-trigger ns-agent-context-trigger-attention"
          : "ns-agent-context-trigger"
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
      triggerTitle="查看上下文"
    >
      {({ close }) => (
        <div className="ns-agent-context-panel">
          <div className="ns-agent-context-heading">
            <p className="ns-agent-context-usage">
              <span>{control.usageLabel}</span>
              <span className="ns-agent-context-precision">
                {PRECISION_LABEL[control.precision]}
              </span>
            </p>
            {control.tokenStats === undefined ? null : (
              <span className="ns-agent-context-budget-facts">
                固定 {control.tokenStats.pinnedTokens} · 剩余 {control.tokenStats.remainingTokens}
              </span>
            )}
          </div>
          {control.state === "compaction_failed" ? (
            <p className="ns-agent-context-warning" role="alert">
              上次压缩失败，原有上下文保持不变。
            </p>
          ) : null}
          {fixedBudgetExceeded ? (
            <p className="ns-agent-context-budget-block" role="alert">
              <AlertTriangle aria-hidden="true" size={14} />
              <span>
                {control.fixedBudgetMessage ??
                  "固定项超过安全输入预算，发送已阻止。请取消固定或缩减来源。"}
              </span>
            </p>
          ) : null}

          <div aria-label="上下文检查视图" className="ns-agent-context-tabs" role="tablist">
            <button
              aria-controls={`${tabId}-sources-panel`}
              aria-selected={activeTab === "sources"}
              data-context-tab="sources"
              id={`${tabId}-sources-tab`}
              onClick={() => setActiveTab("sources")}
              onKeyDown={(event) => switchInspectorTab(event, setActiveTab)}
              role="tab"
              tabIndex={activeTab === "sources" ? 0 : -1}
              type="button"
            >
              <ListTree aria-hidden="true" size={13} />
              来源
            </button>
            <button
              aria-controls={`${tabId}-preview-panel`}
              aria-selected={activeTab === "preview"}
              data-context-tab="preview"
              id={`${tabId}-preview-tab`}
              onClick={() => setActiveTab("preview")}
              onKeyDown={(event) => switchInspectorTab(event, setActiveTab)}
              role="tab"
              tabIndex={activeTab === "preview" ? 0 : -1}
              type="button"
            >
              <Eye aria-hidden="true" size={13} />
              实际发送预览
            </button>
          </div>

          {activeTab === "sources" ? (
            <div
              aria-labelledby={`${tabId}-sources-tab`}
              className="ns-agent-context-tab-panel"
              id={`${tabId}-sources-panel`}
              role="tabpanel"
            >
              <ContextScopeControl control={control} />
              <ContextSourceList control={control} />
              <ConventionsControl control={control} />
              <p className="ns-agent-context-tool-note" role="note">
                <Info aria-hidden="true" size={13} />
                <span>排除上下文不等于禁止工具读取；工具读取仍受权限与审计约束。</span>
              </p>
            </div>
          ) : (
            <ContextPreview control={control} panelId={`${tabId}-preview-panel`} />
          )}

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

function ContextScopeControl({
  control
}: {
  readonly control: AgentComposerContextStatusControl;
}): ReactNode {
  if (control.preferenceScope === undefined) return null;
  const disabled = control.busy === true || control.onPreferenceScopeChange === undefined;
  return (
    <div className="ns-agent-context-scope">
      <span>修改范围</span>
      <div aria-label="上下文偏好作用域" role="group">
        {(["run", "project"] as const).map((scope) => (
          <button
            aria-pressed={control.preferenceScope === scope}
            disabled={disabled}
            key={scope}
            onClick={() => control.onPreferenceScopeChange?.(scope)}
            type="button"
          >
            {PREFERENCE_SCOPE_LABEL[scope]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ContextSourceList({
  control
}: {
  readonly control: AgentComposerContextStatusControl;
}): ReactNode {
  return (
    <ul aria-label="上下文来源" className="ns-agent-context-sources">
      {control.sources.length === 0 ? (
        <li className="ns-agent-context-empty">暂无上下文来源</li>
      ) : (
        control.sources.map((source) => <ContextSourceItem key={source.refId} source={source} />)
      )}
    </ul>
  );
}

function ContextSourceItem({
  source
}: {
  readonly source: AgentComposerContextSourceRow;
}): ReactNode {
  const disabled = source.busy === true;
  const hasActions =
    source.onPin !== undefined ||
    source.onExclude !== undefined ||
    source.onRestore !== undefined ||
    source.onPriorityChange !== undefined;
  return (
    <li data-state={source.state ?? "active"}>
      <div className="ns-agent-context-source-heading">
        <div className="ns-agent-context-source-main">
          <span className="ns-agent-context-source-label">{source.label}</span>
          {source.layerLabel === undefined ? null : (
            <span className="ns-agent-context-source-layer">{source.layerLabel}</span>
          )}
        </div>
        <div className="ns-agent-context-source-policy">
          {source.state === undefined ? null : (
            <span data-source-state={source.state}>{SOURCE_STATE_LABEL[source.state]}</span>
          )}
          {source.selectionPolicy === undefined ? null : (
            <span>{SELECTION_POLICY_LABEL[source.selectionPolicy]}</span>
          )}
          {source.preferenceScope === undefined ? null : (
            <span>{PREFERENCE_SCOPE_LABEL[source.preferenceScope]}</span>
          )}
        </div>
      </div>
      {source.selectionReason === undefined ? null : (
        <p className="ns-agent-context-source-reason">{source.selectionReason}</p>
      )}
      <div className="ns-agent-context-source-facts">
        {source.detail === undefined ? null : <span>{source.detail}</span>}
        {source.tokenCount === undefined ? null : (
          <span>
            {source.tokenCount === null ? "token 未知" : `${String(source.tokenCount)} tokens`}
            {source.precision === undefined ? "" : ` · ${PRECISION_LABEL[source.precision]}`}
          </span>
        )}
        {source.tokenCount !== undefined || source.precision === undefined ? null : (
          <span>{PRECISION_LABEL[source.precision]}</span>
        )}
        {source.priority === undefined ? null : <span>优先级 {source.priority}</span>}
        {source.sourceRevision === undefined ? null : <span>修订 {source.sourceRevision}</span>}
        {source.materializationOrder === undefined ? null : (
          <span>顺序 {source.materializationOrder}</span>
        )}
        {source.truncationRange === undefined ? null : (
          <span>{formatTruncation(source.truncationRange)}</span>
        )}
        {source.sourceChecksum === undefined ? null : (
          <code aria-label={`来源校验和 ${source.sourceChecksum}`} title={source.sourceChecksum}>
            校验 {compactChecksum(source.sourceChecksum)}
          </code>
        )}
        {source.metadata === undefined || source.metadata.length === 0 ? null : (
          <span>{source.metadata.join(" · ")}</span>
        )}
      </div>
      {!hasActions ? null : (
        <div className="ns-agent-context-source-controls">
          {source.onPriorityChange === undefined ? null : (
            <label className="ns-agent-context-priority">
              <span>优先级</span>
              <input
                aria-label={`调整 ${source.label} 优先级`}
                disabled={disabled}
                max={100}
                min={0}
                onChange={(event) => {
                  if (!Number.isFinite(event.currentTarget.valueAsNumber)) return;
                  source.onPriorityChange?.(
                    Math.min(100, Math.max(0, event.currentTarget.valueAsNumber))
                  );
                }}
                step={1}
                type="number"
                value={source.priority ?? 0}
              />
            </label>
          )}
          <div className="ns-agent-context-source-actions">
            {source.onPin === undefined ? null : (
              <button
                aria-label={`固定来源 ${source.label}`}
                aria-pressed={source.selectionPolicy === "pinned"}
                disabled={disabled}
                onClick={() => source.onPin?.()}
                title="固定来源"
                type="button"
              >
                <Pin aria-hidden="true" size={13} />
              </button>
            )}
            {source.onExclude === undefined ? null : (
              <button
                aria-label={`排除来源 ${source.label}`}
                aria-pressed={source.state === "excluded"}
                disabled={disabled}
                onClick={() => source.onExclude?.()}
                title="排除来源"
                type="button"
              >
                <Ban aria-hidden="true" size={13} />
              </button>
            )}
            {source.onRestore === undefined ? null : (
              <button
                aria-label={`恢复来源 ${source.label}`}
                disabled={disabled}
                onClick={() => source.onRestore?.()}
                title="恢复自动选择"
                type="button"
              >
                <RotateCcw aria-hidden="true" size={13} />
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function ConventionsControl({
  control
}: {
  readonly control: AgentComposerContextStatusControl;
}): ReactNode {
  if (control.conventions === undefined) return null;
  return (
    <div className="ns-agent-context-conventions">
      <p>
        <span>项目约定</span>
        <code>{control.conventions.relativePath}</code>
        {control.conventions.status === "unknown" ? null : (
          <span>{CONVENTIONS_STATUS_LABEL[control.conventions.status]}</span>
        )}
      </p>
      {control.conventions.errorMessage === undefined ? null : (
        <p className="ns-agent-context-warning" role="alert">
          {control.conventions.errorMessage}
        </p>
      )}
      {control.conventions.onCreate === undefined ? null : (
        <button
          disabled={control.conventions.busy === true}
          onClick={() => control.conventions?.onCreate?.()}
          type="button"
        >
          <FilePlus2 aria-hidden="true" size={13} />
          创建约定文件
        </button>
      )}
      {control.conventions.onDisable === undefined ? null : (
        <button
          disabled={control.conventions.busy === true}
          onClick={() => control.conventions?.onDisable?.()}
          type="button"
        >
          <FileMinus2 aria-hidden="true" size={13} />
          停止使用约定
        </button>
      )}
      {control.conventions.onRevokeTrust === undefined ? null : (
        <button
          disabled={control.conventions.busy === true}
          onClick={() => control.conventions?.onRevokeTrust?.()}
          type="button"
        >
          <ShieldOff aria-hidden="true" size={13} />
          撤销工作区信任
        </button>
      )}
    </div>
  );
}

function ContextPreview({
  control,
  panelId
}: {
  readonly control: AgentComposerContextStatusControl;
  readonly panelId: string;
}): ReactNode {
  const blocks = control.previewBlocks ?? [];
  return (
    <div
      aria-label="实际发送预览"
      aria-labelledby={`${panelId.replace("-panel", "-tab")}`}
      className="ns-agent-context-preview"
      id={panelId}
      role="tabpanel"
    >
      <div className="ns-agent-context-preview-heading">
        <strong>作者项目上下文</strong>
        {control.previewPayloadChecksum === undefined ? null : (
          <code
            aria-label={`实际发送校验和 ${control.previewPayloadChecksum}`}
            title={control.previewPayloadChecksum}
          >
            校验 {compactChecksum(control.previewPayloadChecksum)}
          </code>
        )}
      </div>
      {control.previewUnavailableReason === undefined ? null : (
        <p className="ns-agent-context-preview-unavailable" role="status">
          {control.previewUnavailableReason}
        </p>
      )}
      {control.previewUnavailableReason !== undefined ? null : blocks.length === 0 ? (
        <p className="ns-agent-context-empty">暂无可预览的作者项目上下文</p>
      ) : (
        <ol className="ns-agent-context-preview-blocks">
          {blocks.map((block) => (
            <li key={block.blockId}>
              <div className="ns-agent-context-preview-block-heading">
                <span>{block.label}</span>
                <small>#{block.order}</small>
              </div>
              <div className="ns-agent-context-preview-block-facts">
                <span>
                  {block.tokenCount} tokens · {PRECISION_LABEL[block.precision]}
                </span>
                {block.truncationRange === undefined ? null : (
                  <span>{formatTruncation(block.truncationRange)}</span>
                )}
                <code aria-label={`区块校验和 ${block.checksum}`} title={block.checksum}>
                  校验 {compactChecksum(block.checksum)}
                </code>
              </div>
              <pre>{block.content}</pre>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function switchInspectorTab(
  event: KeyboardEvent<HTMLButtonElement>,
  setActiveTab: (tab: ContextInspectorTab) => void
): void {
  let tab: ContextInspectorTab | undefined;
  if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "Home") {
    tab = "sources";
  } else if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "End") {
    tab = "preview";
  }
  if (tab === undefined) return;
  event.preventDefault();
  setActiveTab(tab);
  event.currentTarget.parentElement
    ?.querySelector<HTMLButtonElement>(`[data-context-tab="${tab}"]`)
    ?.focus();
}

function formatTruncation(range: AgentComposerContextSourceRow["truncationRange"]): string {
  if (range === null) return "完整";
  if (range === undefined) return "";
  return `截断 ${range.start}-${range.end}/${range.originalEnd}`;
}

function compactChecksum(checksum: string): string {
  if (checksum.length <= 20) return checksum;
  return `${checksum.slice(0, 12)}…${checksum.slice(-4)}`;
}
