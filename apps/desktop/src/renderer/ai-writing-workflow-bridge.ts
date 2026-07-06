import type {
  AiWritingWorkflowObservability,
  AiWritingSelectionPreview,
  AiWritingSuggestion,
  ChapterEditorSnapshot,
  NovelStudioApi,
  WorkflowRunRecord,
  WorkflowRunRecordStatus,
  WorkflowRunSummary
} from "@novel-studio/application";
import type {
  ChapterVersionSummary,
  Result,
  SnapshotReason,
  UnifiedError
} from "@novel-studio/shared";
import type {
  AiWorkflowObservabilityProps,
  AiWorkflowRunHistoryProps,
  AiWritingWorkflowProps,
  ChapterEditorProps,
  ChapterEditorVersionEntry
} from "@novel-studio/ui";
import type { EditorSelectionCommand } from "./editor-runtime.js";

export interface AiWritingWorkflowBridge {
  getProps(): AiWritingWorkflowProps;
  setInstruction(instruction: string): AiWritingWorkflowProps;
  beginGenerate(instruction: string): AiWritingWorkflowProps;
  beginStreamingGenerate(instruction: string): AiWritingWorkflowProps;
  appendStreamDelta(delta: string): AiWritingWorkflowProps;
  cancelStreaming(): AiWritingWorkflowProps;
  generateSuggestion(instruction: string): Promise<AiWritingWorkflowProps>;
  generateSelectionPreview(input: AiSelectionPreviewBridgeInput): Promise<AiWritingWorkflowProps>;
  applySelectionPreview(): Promise<ChapterEditorProps>;
  applySuggestion(): Promise<ChapterEditorProps>;
}

export interface AiSelectionPreviewBridgeInput {
  readonly instruction: string;
  readonly command: EditorSelectionCommand;
  readonly selectedText: string;
}

export function createAiWritingWorkflowBridge(api: NovelStudioApi): AiWritingWorkflowBridge {
  let currentSuggestionId: string | undefined;
  let currentSelectionPreviewId: string | undefined;
  let props: AiWritingWorkflowProps = createProps({
    status: "idle",
    instruction: ""
  });

  return {
    getProps: () => props,
    setInstruction(instruction) {
      props = createProps({
        ...props,
        instruction
      });
      return props;
    },
    beginGenerate(instruction) {
      props = createProps({
        ...props,
        status: "generating",
        instruction
      });
      return props;
    },
    beginStreamingGenerate(instruction) {
      props = createProps({
        ...props,
        status: "streaming",
        instruction,
        streamPreview: ""
      });
      return props;
    },
    appendStreamDelta(delta) {
      props = createProps({
        ...props,
        status: "streaming",
        streamPreview: `${props.streamPreview ?? ""}${delta}`
      });
      return props;
    },
    cancelStreaming() {
      props = createProps({
        ...props,
        status: "cancelled"
      });
      return props;
    },
    async generateSuggestion(instruction) {
      const generated = await api.ai.generateChapterSuggestion({ instruction });
      if (!generated.ok) {
        currentSuggestionId = undefined;
        currentSelectionPreviewId = undefined;
        const history = await loadLatestHistory(api);
        props = createProps({
          ...props,
          status: "failed",
          instruction,
          failure: toFailureProps(generated.error),
          retryPolicy: toRetryPolicyProps(undefined),
          ...(history === undefined ? {} : { history })
        });
        return props;
      }

      const suggestion = generated.value;
      currentSuggestionId = suggestion.suggestionId;
      currentSelectionPreviewId = undefined;
      const history = await loadHistory(api, suggestion.workflowRunId);
      props = toProps(suggestion, instruction, history);
      return props;
    },
    async generateSelectionPreview(input) {
      const generated = await api.ai.generateSelectionPreview({
        instruction: input.instruction,
        selection: {
          startOffset: input.command.selection.startOffset,
          endOffset: input.command.selection.endOffset,
          selectedText: input.selectedText
        }
      });
      if (!generated.ok) {
        currentSuggestionId = undefined;
        currentSelectionPreviewId = undefined;
        const history = await loadLatestHistory(api);
        props = createProps({
          ...props,
          status: "failed",
          instruction: input.instruction,
          failure: toFailureProps(generated.error),
          retryPolicy: toRetryPolicyProps(undefined),
          ...(history === undefined ? {} : { history })
        });
        return props;
      }

      currentSuggestionId = undefined;
      currentSelectionPreviewId = generated.value.previewId;
      const preview = generated.value;
      const history = await loadHistory(api, preview.workflowRunId);
      props = toSelectionPreviewProps(preview, input.instruction, history);
      return props;
    },
    async applySelectionPreview() {
      if (currentSelectionPreviewId === undefined) {
        throw new Error("No AI selection preview is available to apply.");
      }

      const snapshot = await unwrap(api.ai.applySelectionPreview(currentSelectionPreviewId));
      props = createProps({
        ...props,
        status: "applied"
      });
      currentSelectionPreviewId = undefined;
      return toChapterEditorProps(snapshot);
    },
    async applySuggestion() {
      if (currentSuggestionId === undefined) {
        if (currentSelectionPreviewId !== undefined) {
          const snapshot = await unwrap(api.ai.applySelectionPreview(currentSelectionPreviewId));
          props = createProps({
            ...props,
            status: "applied"
          });
          currentSelectionPreviewId = undefined;
          return toChapterEditorProps(snapshot);
        }

        throw new Error("No AI writing suggestion is available to apply.");
      }

      const snapshot = await unwrap(api.ai.applyChapterSuggestion(currentSuggestionId));
      props = createProps({
        ...props,
        status: "applied"
      });
      currentSuggestionId = undefined;
      return toChapterEditorProps(snapshot);
    }
  };
}

async function unwrap<T>(promise: Promise<Result<T, UnifiedError>>): Promise<T> {
  const result = await promise;
  if (result.ok) {
    return result.value;
  }

  throw new Error(result.error.message);
}

function toProps(
  suggestion: AiWritingSuggestion,
  instruction: string,
  history: AiWorkflowRunHistoryProps | undefined
): AiWritingWorkflowProps {
  return createProps({
    status: "suggestion-ready",
    instruction,
    summary: suggestion.summary,
    contextTraceLabel: traceLabel(suggestion),
    observability: toObservabilityProps(suggestion.observability),
    ...(history === undefined ? {} : { history }),
    diffPreview: suggestion.diffPreview
  });
}

function toSelectionPreviewProps(
  preview: AiWritingSelectionPreview,
  instruction: string,
  history: AiWorkflowRunHistoryProps | undefined
): AiWritingWorkflowProps {
  return createProps({
    status: "suggestion-ready",
    instruction,
    summary: preview.summary,
    contextTraceLabel: traceLabel(preview),
    observability: toObservabilityProps(preview.observability),
    ...(history === undefined ? {} : { history }),
    diffPreview: preview.diffPreview
  });
}

function createProps(
  input: Omit<
    AiWritingWorkflowProps,
    | "onInstructionChange"
    | "onGenerateSuggestion"
    | "onApplySuggestion"
    | "onRetrySuggestion"
    | "onCancelStreaming"
  >
): AiWritingWorkflowProps {
  return {
    ...input,
    onInstructionChange: () => undefined,
    onGenerateSuggestion: () => undefined,
    onApplySuggestion: () => undefined,
    onRetrySuggestion: () => undefined,
    onCancelStreaming: () => undefined
  };
}

function traceLabel(input: Pick<AiWritingSuggestion, "contextTrace">): string {
  const sourceCount = input.contextTrace.includedRefs.length;
  const tokenCount = input.contextTrace.includedRefs.reduce(
    (total, ref) => total + ref.tokenEstimate,
    0
  );
  const sourceLabel = sourceCount === 1 ? "source" : "sources";

  return `${sourceCount} ${sourceLabel} / ${tokenCount} tokens`;
}

function toObservabilityProps(
  observability: AiWritingWorkflowObservability
): AiWorkflowObservabilityProps {
  return {
    workflowRunId: observability.workflowRunId,
    workflowTitle: observability.workflowTitle,
    contextLabel: `${observability.context.sourceCount} ${sourceLabel(
      observability.context.sourceCount
    )} / ${observability.context.tokenEstimate} tokens`,
    modelLabel: `${observability.model.displayName} / ${observability.model.modelName}`,
    usageLabel: `${observability.usage.totalTokens} tokens · ${observability.usage.usageStatus}`,
    costLabel: `${observability.usage.cost.currency} ${observability.usage.cost.amount.toFixed(
      6
    )} · ${observability.usage.cost.status}`,
    generatedAtLabel: formatDateTime(observability.generatedAt),
    steps: observability.steps
  };
}

async function loadHistory(
  api: NovelStudioApi,
  workflowRunId: string
): Promise<AiWorkflowRunHistoryProps | undefined> {
  return loadHistoryWithSelection(api, workflowRunId);
}

async function loadLatestHistory(
  api: NovelStudioApi
): Promise<AiWorkflowRunHistoryProps | undefined> {
  return loadHistoryWithSelection(api, undefined);
}

async function loadHistoryWithSelection(
  api: NovelStudioApi,
  workflowRunId: string | undefined
): Promise<AiWorkflowRunHistoryProps | undefined> {
  const list = await api.ai.listWorkflowRuns();
  if (!list.ok) {
    return undefined;
  }

  const selectedWorkflowRunId = workflowRunId ?? list.value[0]?.workflowRunId;
  if (selectedWorkflowRunId === undefined) {
    return toHistoryProps(list.value, undefined);
  }

  const detail = await api.ai.readWorkflowRun(selectedWorkflowRunId);
  return toHistoryProps(list.value, detail.ok ? detail.value : undefined);
}

function toHistoryProps(
  runs: readonly WorkflowRunSummary[],
  selectedRun: WorkflowRunRecord | undefined
): AiWorkflowRunHistoryProps {
  return {
    runs: runs.map((run) => ({
      workflowRunId: run.workflowRunId,
      workflowTitle: run.workflowTitle,
      statusLabel: workflowRunStatusLabel(run.status),
      updatedAtLabel: formatDateTime(run.updatedAt),
      modelLabel: run.modelLabel,
      usageLabel: run.usageLabel,
      costLabel: run.costLabel
    })),
    ...(selectedRun === undefined
      ? {}
      : {
          selectedRun: {
            workflowRunId: selectedRun.workflowRunId,
            workflowTitle: selectedRun.workflowTitle,
            statusLabel: workflowRunStatusLabel(selectedRun.status),
            updatedAtLabel: formatDateTime(selectedRun.updatedAt),
            contextLabel: `${selectedRun.context.sourceCount} ${sourceLabel(
              selectedRun.context.sourceCount
            )} / ${selectedRun.context.tokenEstimate} tokens`,
            modelLabel: `${selectedRun.model.displayName} / ${selectedRun.model.modelName}`,
            usageLabel: `${selectedRun.usage.totalTokens} tokens · ${selectedRun.usage.usageStatus}`,
            costLabel: `${selectedRun.usage.cost.currency} ${selectedRun.usage.cost.amount.toFixed(
              6
            )} · ${selectedRun.usage.cost.status}`,
            steps: selectedRun.steps,
            ...(selectedRun.error === undefined
              ? {}
              : {
                  errorLabel: `${selectedRun.error.code} · ${selectedRun.error.message}`
                })
          }
        })
  };
}

function toFailureProps(error: UnifiedError): NonNullable<AiWritingWorkflowProps["failure"]> {
  return {
    title: "工作流失败",
    code: error.code,
    message: error.message,
    recoverabilityLabel: recoverabilityLabel(error.recoverability),
    suggestedAction: error.suggestedAction
  };
}

function toRetryPolicyProps(
  retryPolicy: WorkflowRunRecord["retryPolicy"] | undefined
): NonNullable<AiWritingWorkflowProps["retryPolicy"]> {
  const policy = retryPolicy ?? {
    mode: "manual",
    maxAttempts: 1,
    backoffLabel: "用户手动重试",
    retryableCodes: ["LLM_TIMEOUT", "LLM_RATE_LIMITED", "LLM_PROVIDER_ERROR"]
  };

  return {
    modeLabel: policy.mode === "manual" ? "手动重试" : policy.mode,
    maxAttemptsLabel: `最多 ${policy.maxAttempts} 次`,
    backoffLabel: policy.backoffLabel,
    retryableCodesLabel: policy.retryableCodes.join(" / ")
  };
}

function workflowRunStatusLabel(status: WorkflowRunRecordStatus): string {
  switch (status) {
    case "pending-confirmation":
      return "待确认";
    case "applied":
      return "已应用";
    case "failed":
      return "失败";
  }
}

function recoverabilityLabel(recoverability: UnifiedError["recoverability"]): string {
  switch (recoverability) {
    case "retryable":
      return "可重试";
    case "user-action":
      return "需要处理";
    case "fatal":
      return "不可恢复";
    case "unknown":
      return "未知";
  }
}

function sourceLabel(count: number): string {
  return count === 1 ? "source" : "sources";
}

function formatDateTime(value: string): string {
  return `${value.slice(0, 10)} ${value.slice(11, 16)}`;
}

function toChapterEditorProps(snapshot: ChapterEditorSnapshot): ChapterEditorProps {
  return {
    chapter: snapshot.state.chapter,
    dirty: snapshot.state.dirty,
    saveStatus: snapshot.state.saveStatus,
    versionHistory: mapVersionSummaries(snapshot.versions)
  };
}

function mapVersionSummaries(
  versions: readonly ChapterVersionSummary[]
): readonly ChapterEditorVersionEntry[] {
  return versions.map((version) => ({
    versionId: version.versionId,
    label: versionReasonLabel(version.reason),
    createdAt: version.createdAt
  }));
}

function versionReasonLabel(reason: SnapshotReason): string {
  switch (reason) {
    case "manual-save":
      return "Manual save";
    case "autosave-snapshot":
      return "Autosave";
    case "interval-snapshot":
      return "Interval snapshot";
    case "before-ai-apply":
      return "Before AI apply";
    case "before-rollback":
      return "Before rollback";
    case "migration":
      return "Migration";
  }
}
