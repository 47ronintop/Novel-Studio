import { ClipboardCopy, RotateCcw } from "lucide-react";

import type { AgentRunErrorRecord, AgentRunRetryTarget } from "@novel-studio/application";

export interface AgentErrorCardProps {
  readonly diagnostic: AgentRunErrorRecord;
  readonly onRetryTarget?: (target: AgentRunRetryTarget) => void;
}

export function AgentErrorCard({ diagnostic, onRetryTarget }: AgentErrorCardProps) {
  return (
    <section aria-label="Agent 错误" className="ns-agent-error" role="alert">
      <strong>{diagnostic.message}</strong>
      <p>{impactLabel(diagnostic)}</p>
      {diagnostic.suggestedActions.length === 0 ? null : (
        <ul>
          {diagnostic.suggestedActions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      )}
      {onRetryTarget === undefined || diagnostic.retryTargets.length === 0 ? null : (
        <div className="ns-agent-inline-actions">
          {diagnostic.retryTargets.map((target) => (
            <button
              aria-label={retryTargetLabel(target.kind)}
              className="ns-ai-secondary-button"
              key={`${target.kind}:${target.id}`}
              onClick={() => onRetryTarget(target)}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={13} />
              {retryTargetLabel(target.kind)}
            </button>
          ))}
        </div>
      )}
      <details>
        <summary>技术详情</summary>
        <dl>
          <DiagnosticField label="错误 ID" value={diagnostic.errorId} />
          <DiagnosticField label="运行 ID" value={diagnostic.runId ?? diagnostic.runDraftId} />
          <DiagnosticField label="Provider" value={diagnostic.provider} />
          <DiagnosticField label="模型" value={diagnostic.model} />
          <DiagnosticField
            label="序列"
            value={diagnostic.sequence === undefined ? undefined : String(diagnostic.sequence)}
          />
        </dl>
        <pre>{JSON.stringify(diagnostic.redactedDetail, null, 2)}</pre>
        <button
          aria-label="复制错误 ID"
          className="ns-ai-secondary-button"
          onClick={() => copyErrorId(diagnostic.errorId)}
          type="button"
        >
          <ClipboardCopy aria-hidden="true" size={13} />
          复制错误 ID
        </button>
      </details>
    </section>
  );
}

function DiagnosticField({
  label,
  value
}: {
  readonly label: string;
  readonly value: string | undefined;
}) {
  if (value === undefined) return null;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function impactLabel(diagnostic: AgentRunErrorRecord): string {
  switch (diagnostic.recoveryState) {
    case "retryable":
      return "此步骤可以重试或从安全检查点恢复。";
    case "awaiting_context_refresh":
      return "上下文已变化，需要刷新后才能继续。";
    case "recovery_review":
      return "部分写入需要先完成恢复审阅。";
    case "terminal":
      return "此运行已停止，请根据建议操作后重新开始。";
    case "none":
      return "此运行已记录错误。";
  }
}

function retryTargetLabel(kind: AgentRunRetryTarget["kind"]): string {
  switch (kind) {
    case "model_round":
      return "重试模型轮次";
    case "tool_call":
      return "重试工具调用";
    case "checkpoint":
      return "从检查点恢复";
    case "plan_step":
      return "重试计划步骤";
  }
}

function copyErrorId(errorId: string): void {
  void navigator.clipboard?.writeText(errorId).catch(() => undefined);
}
