import { Check, ChevronDown, RotateCcw, Sparkles, X } from "lucide-react";

import type {
  AiWorkflowFailureDiagnosticProps,
  AiWorkflowObservabilityProps,
  AiWorkflowObservedStepKind,
  AiWorkflowObservedStepProps,
  AiWorkflowObservedStepStatus,
  AiWorkflowRetryPolicyProps,
  AiWorkflowRunHistoryProps,
  AiWritingStyleReviewProps,
  AiWritingWorkflowProps,
  AiWritingWorkflowStatus
} from "./workspace-shell-types.js";

export function AiWritingAssistantPanel({
  workflow,
  compact = false
}: {
  readonly workflow: AiWritingWorkflowProps;
  readonly compact?: boolean;
}) {
  const instruction = workflow.instruction.trim();
  const assistantReply = aiAssistantReply(workflow);
  const conversationMessages = workflow.conversationMessages ?? [];
  const showSummary =
    workflow.summary !== undefined && (compact || workflow.summary !== assistantReply);
  const reasoningControl = selectedReasoningControl(workflow);
  const modelPicker = aiModelPickerState(workflow);

  return (
    <section className="ns-ai-workflow" aria-label="AI 写作工作流" data-compact={compact}>
      <div className="ns-editor-panel-header">
        <span>{compact ? "AI 助手" : "对话式写作助手"}</span>
        <span className="ns-muted">{statusLabel(workflow.status)}</span>
      </div>
      {compact ? null : (
        <p className="ns-ai-context">
          输入你想让 AI 做的事，例如“续写当前场景”“让对白更自然”或“检查人物动机”。AI
          结果会先进入建议区，不会直接覆盖正文。
        </p>
      )}
      {workflow.runtimeNotice === undefined ? null : (
        <p className="ns-project-feedback" data-kind="error" role="status">
          {workflow.runtimeNotice}
        </p>
      )}
      {compact ? null : (
        <div className="ns-ai-chat-log" aria-label="AI 对话记录">
          <article className="ns-ai-message" data-speaker="assistant">
            <span>AI 写作助手</span>
            <p>告诉我你想续写、改写或检查哪里。我会结合当前章节生成建议。</p>
          </article>
          {conversationMessages.length > 0
            ? conversationMessages.map((message) => (
                <article
                  className="ns-ai-message"
                  data-speaker={message.role}
                  key={message.messageId}
                >
                  <span>{message.role === "user" ? "你" : "AI 写作助手"}</span>
                  <p>{message.content}</p>
                  <small>{message.createdAtLabel}</small>
                </article>
              ))
            : null}
          {conversationMessages.length === 0 && instruction.length > 0 ? (
            <article className="ns-ai-message" data-speaker="user">
              <span>你</span>
              <p>{instruction}</p>
            </article>
          ) : null}
          {conversationMessages.length === 0 && assistantReply !== undefined ? (
            <article className="ns-ai-message" data-speaker="assistant">
              <span>AI 写作助手</span>
              <p>{assistantReply}</p>
            </article>
          ) : null}
          {showSummary ? <p className="ns-ai-summary">{workflow.summary}</p> : null}
          {workflow.streamPreview === undefined ? null : (
            <pre className="ns-ai-stream-preview" aria-label="AI 流式输出预览">
              {workflow.streamPreview}
            </pre>
          )}
          {workflow.diffPreview === undefined ? null : (
            <AiSuggestionDiffPreview diffPreview={workflow.diffPreview} />
          )}
          {workflow.styleReview === undefined ? null : (
            <AiWritingStyleReviewView review={workflow.styleReview} />
          )}
          {workflow.contextTraceLabel === undefined || compact ? null : (
            <p className="ns-ai-context">{workflow.contextTraceLabel}</p>
          )}
          {workflow.selectionReview === undefined ? null : (
            <AiSelectionReviewView workflow={workflow} />
          )}
          {workflow.observability === undefined || compact ? null : (
            <AiWorkflowObservabilityView observability={workflow.observability} />
          )}
          {workflow.failure === undefined ? null : (
            <AiWorkflowFailureDiagnosticView failure={workflow.failure} />
          )}
          {workflow.retryPolicy === undefined || compact ? null : (
            <AiWorkflowRetryPolicyView retryPolicy={workflow.retryPolicy} />
          )}
          {workflow.history === undefined || compact ? null : (
            <AiWorkflowRunHistoryView history={workflow.history} />
          )}
        </div>
      )}
      <section className="ns-ai-composer ns-ai-vscode-composer" aria-label="AI 输入区">
        <div className="ns-ai-composer-input">
          <textarea
            aria-label="AI 写作指令"
            className="ns-ai-instruction"
            onChange={(event) => workflow.onInstructionChange(event.currentTarget.value)}
            placeholder="和 AI 说明你想怎么改写或续写当前章节"
            value={workflow.instruction}
          />
        </div>
        <div className="ns-ai-composer-toolbar">
          <div className="ns-ai-composer-tools" aria-label="AI composer context">
            <button aria-label="引用当前章节上下文" className="ns-ai-tool-button" type="button">
              <Sparkles aria-hidden="true" size={14} />
            </button>
            <span>当前章节</span>
          </div>
          <div className="ns-ai-composer-actions">
            {modelPicker === undefined ? null : (
              <AiModelControls
                fallbackReason={workflow.modelDiscovery?.fallbackReason}
                modelPicker={modelPicker}
                onModelSelect={workflow.onModelSelect}
                reasoningControl={reasoningControl}
              />
            )}
            {workflow.status === "suggestion-ready" ? (
              <button
                aria-label="应用 AI 建议"
                className="ns-ai-secondary-button"
                onClick={workflow.onApplySuggestion}
                title="应用 AI 建议"
                type="button"
              >
                <Check aria-hidden="true" size={14} />
                应用
              </button>
            ) : null}
            {workflow.status === "streaming" ? (
              <button
                aria-label="取消 AI 流式输出"
                className="ns-ai-secondary-button"
                onClick={workflow.onCancelStreaming}
                title="取消 AI 流式输出"
                type="button"
              >
                <X aria-hidden="true" size={14} />
                取消
              </button>
            ) : null}
            {workflow.status === "failed" ? (
              <button
                aria-label="重试 AI 工作流"
                className="ns-ai-secondary-button"
                onClick={workflow.onRetrySuggestion}
                title="重试 AI 工作流"
                type="button"
              >
                <Sparkles aria-hidden="true" size={14} />
                重试
              </button>
            ) : null}
            <button
              aria-label="生成 AI 建议"
              className="ns-ai-send-button"
              disabled={workflow.status === "generating" || workflow.status === "streaming"}
              onClick={workflow.onGenerateSuggestion}
              title="生成 AI 建议"
              type="button"
            >
              <Sparkles aria-hidden="true" size={14} />
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}

function AiModelControls({
  fallbackReason,
  modelPicker,
  onModelSelect,
  reasoningControl
}: {
  readonly fallbackReason: string | undefined;
  readonly modelPicker: AiModelPickerState;
  readonly onModelSelect: ((modelName: string) => void) | undefined;
  readonly reasoningControl: ReturnType<typeof selectedReasoningControl>;
}) {
  const currentDescription =
    fallbackReason ??
    (modelPicker.current.provider === undefined
      ? "当前配置的手动模型。"
      : `${modelPicker.current.provider} endpoint model.`);
  const otherModels = modelPicker.models.filter((model) => model.id !== modelPicker.current.id);

  return (
    <div className="ns-ai-model-controls" aria-label="AI model controls">
      <details className="ns-ai-model-picker">
        <summary aria-label="Open AI model picker" className="ns-ai-model-trigger">
          <span>{modelPicker.current.displayName}</span>
          <ChevronDown aria-hidden="true" size={13} />
        </summary>
        <div className="ns-ai-model-popover" role="group" aria-label="AI model picker">
          <div className="ns-ai-current-model">
            <Check aria-hidden="true" size={14} />
            <div>
              <strong>{modelPicker.current.displayName}</strong>
              <span>{currentDescription}</span>
            </div>
          </div>
          {reasoningControl?.status === "available" ? (
            <details className="ns-ai-effort-picker">
              <summary aria-label="Reasoning effort">
                <span>
                  推理强度
                  <small>{reasoningControl.providerParamName}</small>
                </span>
                <strong>{reasoningControl.defaultValue}</strong>
              </summary>
              <div className="ns-ai-effort-options">
                {reasoningControl.allowedValues.map((value) => (
                  <button
                    aria-pressed={value === reasoningControl.defaultValue}
                    className="ns-ai-menu-option"
                    key={value}
                    type="button"
                  >
                    {value === reasoningControl.defaultValue ? (
                      <Check aria-hidden="true" size={13} />
                    ) : (
                      <span aria-hidden="true" className="ns-ai-menu-option-spacer" />
                    )}
                    {value}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
          <details className="ns-ai-more-models" open={otherModels.length > 0}>
            <summary>
              <span>更多模型</span>
              <strong>{otherModels.length}</strong>
            </summary>
            {otherModels.length > 0 ? (
              <div className="ns-ai-model-list">
                {otherModels.map((model) => (
                  <button
                    className="ns-ai-menu-option"
                    key={model.id}
                    onClick={() => onModelSelect?.(model.id)}
                    type="button"
                  >
                    <span aria-hidden="true" className="ns-ai-menu-option-spacer" />
                    <span>{model.displayName}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="ns-ai-model-empty">当前端点没有返回可选模型。</p>
            )}
          </details>
        </div>
      </details>
    </div>
  );
}

interface AiModelPickerState {
  readonly current: {
    readonly id: string;
    readonly displayName: string;
    readonly provider: string | undefined;
  };
  readonly models: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly provider: string | undefined;
  }[];
}

function aiModelPickerState(workflow: AiWritingWorkflowProps): AiModelPickerState | undefined {
  const discoveredModels = workflow.modelDiscovery?.models ?? [];
  const selectedModelId = workflow.selectedModelName ?? discoveredModels[0]?.id;
  if (selectedModelId === undefined || selectedModelId.trim().length === 0) {
    return undefined;
  }

  const selectedModel = discoveredModels.find((model) => model.id === selectedModelId);
  const current: AiModelPickerState["current"] =
    selectedModel === undefined
      ? {
          id: selectedModelId,
          displayName: selectedModelId,
          provider: workflow.modelDiscovery?.provider
        }
      : {
          id: selectedModel.id,
          displayName: selectedModel.displayName,
          provider: selectedModel.provider
        };
  const models =
    selectedModel === undefined
      ? [
          current,
          ...discoveredModels.map((model) => ({
            id: model.id,
            displayName: model.displayName,
            provider: model.provider
          }))
        ]
      : discoveredModels.map((model) => ({
          id: model.id,
          displayName: model.displayName,
          provider: model.provider
        }));

  return { current, models };
}

function selectedReasoningControl(workflow: AiWritingWorkflowProps) {
  const selectedModel = workflow.modelDiscovery?.models.find(
    (model) => model.id === workflow.selectedModelName
  );
  return selectedModel?.reasoningStrength ?? workflow.modelDiscovery?.reasoningStrength;
}

function AiSuggestionDiffPreview({
  diffPreview
}: {
  readonly diffPreview: NonNullable<AiWritingWorkflowProps["diffPreview"]>;
}) {
  return (
    <section className="ns-editor-panel" aria-label="AI 对话建议差异">
      <div className="ns-editor-panel-header">
        <span>{diffPreview.title}</span>
        <span className="ns-preview-only">仅预览</span>
      </div>
      <ul className="ns-diff-list">
        {diffPreview.changes.map((change, index) => (
          <li className={`ns-diff-item ns-diff-${change.kind}`} key={`${change.kind}-${index}`}>
            <span>{change.kind}</span>
            <pre>{change.value}</pre>
          </li>
        ))}
      </ul>
    </section>
  );
}

function aiAssistantReply(workflow: AiWritingWorkflowProps): string | undefined {
  switch (workflow.status) {
    case "idle":
      return workflow.summary;
    case "generating":
      return "正在整理当前章节、选中内容和项目设定。";
    case "streaming":
      return workflow.streamPreview ?? "正在生成建议，你可以随时取消。";
    case "suggestion-ready":
      return workflow.summary ?? workflow.streamPreview ?? "建议已生成，确认后可以写入正文。";
    case "applied":
      return workflow.summary ?? "建议已应用到正文。";
    case "failed":
      return workflow.failure?.message ?? "生成失败，可以调整指令后重试。";
    case "cancelled":
      return "本次生成已取消，正文没有被修改。";
  }
}

function AiWritingStyleReviewView({ review }: { readonly review: AiWritingStyleReviewProps }) {
  const summary =
    review.status === "clean" ? "未发现明显模板表达" : `文风规则命中 ${review.hitCount} 处`;

  return (
    <section className="ns-ai-style-review" aria-label="AI 文风规则检查">
      <div className="ns-ai-observability-header">
        <span>文风规则</span>
        <span>{summary}</span>
      </div>
      {review.hits.length === 0 ? (
        <p className="ns-ai-context">未发现明显模板表达</p>
      ) : (
        <ul className="ns-ai-style-hit-list">
          {review.hits.map((hit, index) => (
            <li className="ns-ai-style-hit" key={`${hit.ruleId}-${hit.positionLabel}-${index}`}>
              <div>
                <span>{hit.title}</span>
                <span>{hit.positionLabel}</span>
              </div>
              <p>
                <strong>{hit.matchedText}</strong>
                <span>{hit.suggestion}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AiWorkflowRunHistoryView({
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

export function AiWorkflowFailureDiagnosticView({
  failure
}: {
  readonly failure: AiWorkflowFailureDiagnosticProps;
}) {
  return (
    <section className="ns-ai-failure" aria-label="失败诊断">
      <div className="ns-ai-observability-header">
        <span>{failure.title}</span>
        <span>{failure.recoverabilityLabel}</span>
      </div>
      <dl className="ns-ai-observability-metrics">
        <div>
          <dt>错误</dt>
          <dd>{failure.code}</dd>
        </div>
        <div>
          <dt>说明</dt>
          <dd>{failure.message}</dd>
        </div>
        <div>
          <dt>建议</dt>
          <dd>{failure.suggestedAction}</dd>
        </div>
      </dl>
    </section>
  );
}

export function AiWorkflowRetryPolicyView({
  retryPolicy
}: {
  readonly retryPolicy: AiWorkflowRetryPolicyProps;
}) {
  return (
    <section className="ns-ai-retry-policy" aria-label="重试策略">
      <div className="ns-ai-observability-header">
        <span>重试策略</span>
        <span>{retryPolicy.modeLabel}</span>
      </div>
      <dl className="ns-ai-observability-metrics">
        <div>
          <dt>次数</dt>
          <dd>{retryPolicy.maxAttemptsLabel}</dd>
        </div>
        <div>
          <dt>退避</dt>
          <dd>{retryPolicy.backoffLabel}</dd>
        </div>
        <div>
          <dt>错误</dt>
          <dd>{retryPolicy.retryableCodesLabel}</dd>
        </div>
      </dl>
    </section>
  );
}

export function AiSelectionReviewView({ workflow }: { readonly workflow: AiWritingWorkflowProps }) {
  const review = workflow.selectionReview;
  if (review === undefined) {
    return null;
  }

  return (
    <section className="ns-ai-observability" aria-label="Selection AI review">
      <div className="ns-ai-observability-header">
        <span>Selection review</span>
        <span>{review.status}</span>
      </div>
      <p className="ns-ai-context">
        Range {review.rangeLabel}: {review.compareLabel}
      </p>
      <div className="ns-ai-actions">
        <button
          aria-label="Accept selection AI preview"
          className="ns-icon-text-button"
          disabled={workflow.status !== "suggestion-ready" || review.status !== "pending"}
          onClick={workflow.onApplySuggestion}
          type="button"
        >
          <Check aria-hidden="true" size={14} />
          Accept
        </button>
        <button
          aria-label="Reject selection AI preview"
          className="ns-icon-text-button"
          disabled={review.status !== "pending" || workflow.onRejectSelectionReview === undefined}
          onClick={workflow.onRejectSelectionReview}
          type="button"
        >
          <X aria-hidden="true" size={14} />
          Reject
        </button>
        <button
          aria-label="Undo selection AI rejection"
          className="ns-icon-text-button"
          disabled={!review.canUndo || workflow.onUndoSelectionReview === undefined}
          onClick={workflow.onUndoSelectionReview}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={14} />
          Undo
        </button>
      </div>
    </section>
  );
}

export function AiWorkflowObservabilityView({
  observability
}: {
  readonly observability: AiWorkflowObservabilityProps;
}) {
  return (
    <section className="ns-ai-observability" aria-label="AI 工作流运行观测">
      <div className="ns-ai-observability-header">
        <span>{observability.workflowTitle}</span>
        <span>{observability.generatedAtLabel}</span>
      </div>
      <dl className="ns-ai-observability-metrics">
        <div>
          <dt>上下文</dt>
          <dd>{observability.contextLabel}</dd>
        </div>
        <div>
          <dt>模型</dt>
          <dd>{observability.modelLabel}</dd>
        </div>
        <div>
          <dt>Token</dt>
          <dd>{observability.usageLabel}</dd>
        </div>
        <div>
          <dt>成本</dt>
          <dd>{observability.costLabel}</dd>
        </div>
      </dl>
      <AiWorkflowRail
        ariaLabel="Workflow rail"
        listLabel="AI 工作流步骤"
        steps={observability.steps}
      />
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

export function statusLabel(status: AiWritingWorkflowStatus): string {
  switch (status) {
    case "idle":
      return "空闲";
    case "generating":
      return "生成中";
    case "streaming":
      return "流式输出中";
    case "suggestion-ready":
      return "待确认";
    case "applied":
      return "已应用";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
  }
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
