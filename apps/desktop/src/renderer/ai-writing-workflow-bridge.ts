import type {
  AiWritingWorkflowObservability,
  AiWritingSuggestion,
  ChapterEditorSnapshot,
  NovelStudioApi
} from "@novel-studio/application";
import type {
  ChapterVersionSummary,
  Result,
  SnapshotReason,
  UnifiedError
} from "@novel-studio/shared";
import type {
  AiWorkflowObservabilityProps,
  AiWritingWorkflowProps,
  ChapterEditorProps,
  ChapterEditorVersionEntry
} from "@novel-studio/ui";

export interface AiWritingWorkflowBridge {
  getProps(): AiWritingWorkflowProps;
  setInstruction(instruction: string): AiWritingWorkflowProps;
  beginGenerate(instruction: string): AiWritingWorkflowProps;
  generateSuggestion(instruction: string): Promise<AiWritingWorkflowProps>;
  applySuggestion(): Promise<ChapterEditorProps>;
}

export function createAiWritingWorkflowBridge(api: NovelStudioApi): AiWritingWorkflowBridge {
  let currentSuggestionId: string | undefined;
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
    async generateSuggestion(instruction) {
      const suggestion = await unwrap(api.ai.generateChapterSuggestion({ instruction }));
      currentSuggestionId = suggestion.suggestionId;
      props = toProps(suggestion, instruction);
      return props;
    },
    async applySuggestion() {
      if (currentSuggestionId === undefined) {
        throw new Error("No AI writing suggestion is available to apply.");
      }

      const snapshot = await unwrap(api.ai.applyChapterSuggestion(currentSuggestionId));
      props = createProps({
        ...props,
        status: "applied"
      });
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

function toProps(suggestion: AiWritingSuggestion, instruction: string): AiWritingWorkflowProps {
  return createProps({
    status: "suggestion-ready",
    instruction,
    summary: suggestion.summary,
    contextTraceLabel: traceLabel(suggestion),
    observability: toObservabilityProps(suggestion.observability),
    diffPreview: suggestion.diffPreview
  });
}

function createProps(
  input: Omit<
    AiWritingWorkflowProps,
    "onInstructionChange" | "onGenerateSuggestion" | "onApplySuggestion"
  >
): AiWritingWorkflowProps {
  return {
    ...input,
    onInstructionChange: () => undefined,
    onGenerateSuggestion: () => undefined,
    onApplySuggestion: () => undefined
  };
}

function traceLabel(suggestion: AiWritingSuggestion): string {
  const sourceCount = suggestion.contextTrace.includedRefs.length;
  const tokenCount = suggestion.contextTrace.includedRefs.reduce(
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
