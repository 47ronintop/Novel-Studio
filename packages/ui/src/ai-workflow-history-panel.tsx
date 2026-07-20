import type {
  AiWorkflowObservedStepKind,
  AiWorkflowObservedStepProps,
  AiWorkflowObservedStepStatus,
  AiWorkflowRunHistoryProps
} from "./workspace-shell-types.js";

export function AiWorkflowHistoryPanel({
  history
}: {
  readonly history: AiWorkflowRunHistoryProps;
}) {
  return (
    <section className="ns-ai-run-history" aria-label="工作流运行历史">
      <div className="ns-ai-observability-header">
        <span>工作流运行历史</span>
        <span>{history.runs.length}</span>
      </div>
      {history.runs.length === 0 ? (
        <p className="ns-ai-history-empty">暂无工作流运行记录</p>
      ) : (
        <ol className="ns-ai-history-list" aria-label="最近工作流运行">
          {history.runs.map((run) => (
            <li className="ns-ai-history-row" key={run.workflowRunId}>
              <div>
                <span>{run.workflowTitle}</span>
                <span>{run.updatedAtLabel}</span>
              </div>
              <div>
                <span>{run.statusLabel}</span>
                <span>{run.modelLabel}</span>
              </div>
              <div>
                <span>{run.usageLabel}</span>
                <span>{run.costLabel}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      {history.selectedRun === undefined ? null : (
        <div className="ns-ai-history-detail" aria-label="工作流运行详情">
          <dl className="ns-ai-observability-metrics">
            <div>
              <dt>上下文</dt>
              <dd>{history.selectedRun.contextLabel}</dd>
            </div>
            <div>
              <dt>模型</dt>
              <dd>{history.selectedRun.modelLabel}</dd>
            </div>
            <div>
              <dt>Token</dt>
              <dd>{history.selectedRun.usageLabel}</dd>
            </div>
          </dl>
          <AiWorkflowRail
            ariaLabel="History workflow rail"
            listLabel="历史工作流步骤"
            steps={history.selectedRun.steps}
          />
          {history.selectedRun.errorLabel === undefined ? null : (
            <p className="ns-ai-history-error">{history.selectedRun.errorLabel}</p>
          )}
        </div>
      )}
    </section>
  );
}

function AiWorkflowRail({
  ariaLabel,
  listLabel,
  steps
}: {
  readonly ariaLabel: string;
  readonly listLabel: string;
  readonly steps: readonly AiWorkflowObservedStepProps[];
}) {
  return (
    <section className="ns-ai-workflow-rail" aria-label={ariaLabel}>
      <ol className="ns-ai-step-list" aria-label={listLabel}>
        {steps.map((step) => (
          <li
            className="ns-ai-step"
            data-kind={step.kind}
            data-status={step.status}
            key={step.stepId}
          >
            <div className="ns-ai-step-main">
              <span>{step.label}</span>
              <span>{aiStepKindLabel(step.kind)}</span>
              <span>{aiStepStatusLabel(step.status)}</span>
            </div>
            {step.description === undefined ? null : (
              <p className="ns-ai-step-description">{step.description}</p>
            )}
            {step.branchChoices === undefined || step.branchChoices.length === 0 ? null : (
              <ul className="ns-ai-branch-choice-list" aria-label={`${step.label} branch choices`}>
                {step.branchChoices.map((choice) => (
                  <li
                    className="ns-ai-branch-choice"
                    data-selected-branch={choice.branchId === step.selectedBranchId}
                    key={choice.branchId}
                  >
                    <span>{choice.label}</span>
                    <span>{choice.conditionLabel ?? choice.branchId}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function aiStepStatusLabel(status: AiWorkflowObservedStepStatus): string {
  switch (status) {
    case "pending":
      return "待执行";
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "waiting-confirmation":
      return "待确认";
    case "failed":
      return "失败";
  }
}

function aiStepKindLabel(kind: AiWorkflowObservedStepKind): string {
  switch (kind) {
    case "context":
      return "Context";
    case "agent":
      return "Agent";
    case "confirmation":
      return "Confirm";
    case "branch":
      return "Branch";
  }
}
