import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { AiWritingWorkflowProps, ChapterEditorProps } from "@novel-studio/ui";

import type { SettingsBridge } from "./settings-bridge.js";
import type {
  AiWritingWorkflowBridge,
  AiSelectionPreviewBridgeInput
} from "./ai-writing-workflow-bridge.js";
import type { ChapterEditorSelection } from "@novel-studio/ui";
import { createChapterEditorSelectionCommand } from "./app-shell-support.js";

export interface AiWritingWorkflowActionInputs {
  readonly aiWritingWorkflow: AiWritingWorkflowProps | undefined;
  readonly aiWritingWorkflowBridge: AiWritingWorkflowBridge | undefined;
  readonly chapterEditor: ChapterEditorProps | undefined;
  readonly chapterSelection: ChapterEditorSelection | undefined;
  readonly settingsBridge: SettingsBridge | undefined;
  readonly setAiWritingWorkflow: Dispatch<SetStateAction<AiWritingWorkflowProps | undefined>>;
  readonly setChapterEditor: Dispatch<SetStateAction<ChapterEditorProps | undefined>>;
  readonly setSettings: Dispatch<
    SetStateAction<ReturnType<SettingsBridge["getProps"]> | undefined>
  >;
}

export function useAiWritingWorkflowActions({
  aiWritingWorkflow,
  aiWritingWorkflowBridge,
  chapterEditor,
  chapterSelection,
  settingsBridge,
  setAiWritingWorkflow,
  setChapterEditor,
  setSettings
}: AiWritingWorkflowActionInputs) {
  const handleAiInstructionChange = useCallback(
    (instruction: string) => {
      if (aiWritingWorkflowBridge === undefined) return;
      setAiWritingWorkflow(aiWritingWorkflowBridge.setInstruction(instruction));
    },
    [aiWritingWorkflowBridge, setAiWritingWorkflow]
  );

  const handleGenerateAiSuggestion = useCallback(() => {
    if (aiWritingWorkflowBridge === undefined || aiWritingWorkflow === undefined) return;
    const instruction =
      aiWritingWorkflow.instruction.trim().length === 0
        ? "Continue the active chapter."
        : aiWritingWorkflow.instruction;
    setAiWritingWorkflow(aiWritingWorkflowBridge.beginStreamingGenerate(instruction));
    void aiWritingWorkflowBridge
      .generateStreamingSuggestion(instruction, setAiWritingWorkflow)
      .then((nextAiWritingWorkflow) => {
        setAiWritingWorkflow(nextAiWritingWorkflow);
        applyDiffPreview(nextAiWritingWorkflow, setChapterEditor);
      });
  }, [aiWritingWorkflow, aiWritingWorkflowBridge, setAiWritingWorkflow, setChapterEditor]);

  const handleSelectionAiPreview = useCallback(
    (commandId: string, instructionOverride?: string) => {
      const input = createSelectionPreviewInput({
        aiWritingWorkflow,
        chapterEditor,
        chapterSelection,
        commandId,
        ...(instructionOverride === undefined ? {} : { instructionOverride })
      });
      if (aiWritingWorkflowBridge === undefined || input === undefined) return;
      setAiWritingWorkflow(aiWritingWorkflowBridge.beginGenerate(input.instruction));
      void aiWritingWorkflowBridge.generateSelectionPreview(input).then((nextAiWritingWorkflow) => {
        setAiWritingWorkflow(nextAiWritingWorkflow);
        applyDiffPreview(nextAiWritingWorkflow, setChapterEditor);
      });
    },
    [
      aiWritingWorkflow,
      aiWritingWorkflowBridge,
      chapterEditor,
      chapterSelection,
      setAiWritingWorkflow,
      setChapterEditor
    ]
  );

  const handleRewriteSelection = useCallback(
    () =>
      handleSelectionAiPreview(
        "agent.rewrite-selection",
        "Rewrite the selected text while preserving meaning and continuity."
      ),
    [handleSelectionAiPreview]
  );

  const handleReviewSelectionStyle = useCallback(
    () =>
      handleSelectionAiPreview(
        "agent.review-selection-style",
        "Review the selected text for style, consistency, and templated phrasing."
      ),
    [handleSelectionAiPreview]
  );

  const handleApplyAiSuggestion = useCallback(() => {
    if (aiWritingWorkflowBridge === undefined) return;
    void aiWritingWorkflowBridge.applySuggestion().then((nextChapterEditor) => {
      setChapterEditor(nextChapterEditor);
      setAiWritingWorkflow(aiWritingWorkflowBridge.getProps());
    });
  }, [aiWritingWorkflowBridge, setAiWritingWorkflow, setChapterEditor]);

  const handleRejectSelectionReview = useCallback(() => {
    if (aiWritingWorkflowBridge === undefined) return;
    syncSelectionReview(
      aiWritingWorkflowBridge.rejectSelectionPreview(),
      setAiWritingWorkflow,
      setChapterEditor
    );
  }, [aiWritingWorkflowBridge, setAiWritingWorkflow, setChapterEditor]);

  const handleUndoSelectionReview = useCallback(() => {
    if (aiWritingWorkflowBridge === undefined) return;
    syncSelectionReview(
      aiWritingWorkflowBridge.undoSelectionPreviewRejection(),
      setAiWritingWorkflow,
      setChapterEditor
    );
  }, [aiWritingWorkflowBridge, setAiWritingWorkflow, setChapterEditor]);

  const handleCancelAiStreaming = useCallback(() => {
    if (aiWritingWorkflowBridge === undefined) return;
    setAiWritingWorkflow(aiWritingWorkflowBridge.cancelStreaming());
  }, [aiWritingWorkflowBridge, setAiWritingWorkflow]);

  const handleAiModelSelect = useCallback(
    (modelName: string) => {
      if (aiWritingWorkflowBridge === undefined) return;
      void aiWritingWorkflowBridge
        .selectDiscoveredModel(modelName)
        .then((nextAiWritingWorkflow) => {
          setAiWritingWorkflow(nextAiWritingWorkflow);
          if (settingsBridge !== undefined) void settingsBridge.load().then(setSettings);
        });
    },
    [aiWritingWorkflowBridge, settingsBridge, setAiWritingWorkflow, setSettings]
  );

  const handleAiReasoningEffortSelect = useCallback(
    (reasoningEffort: NonNullable<AiWritingWorkflowProps["selectedReasoningEffort"]>) => {
      if (aiWritingWorkflowBridge === undefined) return;
      setAiWritingWorkflow(aiWritingWorkflowBridge.selectReasoningEffort(reasoningEffort));
    },
    [aiWritingWorkflowBridge, setAiWritingWorkflow]
  );

  return {
    handleAiInstructionChange,
    handleGenerateAiSuggestion,
    handleSelectionAiPreview,
    handleRewriteSelection,
    handleReviewSelectionStyle,
    handleApplyAiSuggestion,
    handleRejectSelectionReview,
    handleUndoSelectionReview,
    handleCancelAiStreaming,
    handleAiModelSelect,
    handleAiReasoningEffortSelect
  };
}

function createSelectionPreviewInput(input: {
  readonly aiWritingWorkflow: AiWritingWorkflowProps | undefined;
  readonly chapterEditor: ChapterEditorProps | undefined;
  readonly chapterSelection: ChapterEditorSelection | undefined;
  readonly commandId: string;
  readonly instructionOverride?: string;
}): AiSelectionPreviewBridgeInput | undefined {
  if (
    input.aiWritingWorkflow === undefined ||
    input.chapterEditor === undefined ||
    input.chapterSelection === undefined
  )
    return undefined;
  const command = createChapterEditorSelectionCommand(input.chapterEditor, {
    commandId: input.commandId,
    selection: input.chapterSelection
  });
  if (command === undefined || command.selection.collapsed) return undefined;
  const instruction =
    input.instructionOverride ??
    (input.aiWritingWorkflow.instruction.trim().length === 0
      ? "Rewrite the selected text."
      : input.aiWritingWorkflow.instruction);
  return {
    instruction,
    command,
    selectedText: input.chapterEditor.chapter.body.slice(
      command.selection.startOffset,
      command.selection.endOffset
    )
  };
}

function applyDiffPreview(
  workflow: AiWritingWorkflowProps,
  setChapterEditor: Dispatch<SetStateAction<ChapterEditorProps | undefined>>
): void {
  const { diffPreview, selectionReview } = workflow;
  if (diffPreview === undefined) return;
  setChapterEditor((current) =>
    current === undefined
      ? current
      : {
          ...current,
          diffPreview,
          ...(selectionReview === undefined ? {} : { selectionReview })
        }
  );
}

function syncSelectionReview(
  workflow: AiWritingWorkflowProps,
  setAiWritingWorkflow: Dispatch<SetStateAction<AiWritingWorkflowProps | undefined>>,
  setChapterEditor: Dispatch<SetStateAction<ChapterEditorProps | undefined>>
): void {
  setAiWritingWorkflow(workflow);
  setChapterEditor((current) => {
    if (current === undefined) return current;
    const { selectionReview, ...withoutSelectionReview } = current;
    void selectionReview;
    return workflow.selectionReview === undefined
      ? withoutSelectionReview
      : { ...withoutSelectionReview, selectionReview: workflow.selectionReview };
  });
}
