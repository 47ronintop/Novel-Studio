import type {
  ChapterEditorProps,
  ProjectWorkflowProps,
  StoryBibleEditorProps,
  StoryBibleSummaryProps
} from "@novel-studio/ui";
import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { AgentRunBridge } from "./agent-run-bridge.js";
import { handleChapterAgentExternalUpdate } from "./chapter-agent-external-update.js";
import type { ChapterEditorBridge } from "./chapter-editor-bridge.js";
import type { ProjectWorkflowBridge } from "./project-workflow-bridge.js";
import type { StoryBibleBridge } from "./story-bible-bridge.js";
import type { WritingEditorRendererSession } from "./writing-editor-state-reporter.js";

let nextWritingEditorInstanceId = 0;

interface UseWritingEditorIntegrationOptions {
  readonly activeCreativeWorkspaceId: string | undefined;
  readonly agentRunBridge: AgentRunBridge | undefined;
  readonly chapterBridge: ChapterEditorBridge | undefined;
  readonly chapterEditor: ChapterEditorProps | undefined;
  readonly projectWorkflowBridge: ProjectWorkflowBridge | undefined;
  readonly setChapterEditor: Dispatch<SetStateAction<ChapterEditorProps | undefined>>;
  readonly setProjectWorkflow: Dispatch<SetStateAction<ProjectWorkflowProps | undefined>>;
  readonly setStoryBible: Dispatch<SetStateAction<StoryBibleSummaryProps | undefined>>;
  readonly setStoryBibleEditor: Dispatch<SetStateAction<StoryBibleEditorProps | undefined>>;
  readonly storyBibleBridge: StoryBibleBridge | undefined;
  readonly storyBibleEditor: StoryBibleEditorProps | undefined;
}

export function useWritingEditorIntegration({
  activeCreativeWorkspaceId,
  agentRunBridge,
  chapterBridge,
  chapterEditor,
  projectWorkflowBridge,
  setChapterEditor,
  setProjectWorkflow,
  setStoryBible,
  setStoryBibleEditor,
  storyBibleBridge,
  storyBibleEditor
}: UseWritingEditorIntegrationOptions) {
  const chapterEditorRef = useRef(chapterEditor);
  const chapterWritingEditorSessionRef = useRef<
    { readonly key: string; readonly session: WritingEditorRendererSession } | undefined
  >(undefined);
  const storyBibleWritingEditorSessionRef = useRef<
    { readonly key: string; readonly session: WritingEditorRendererSession } | undefined
  >(undefined);

  useEffect(() => {
    chapterEditorRef.current = chapterEditor;
  }, [chapterEditor]);

  const chapterWritingEditorId = chapterEditor?.chapter.frontmatter.id;
  const storyBibleWritingEditorId =
    storyBibleEditor?.viewMode === "detail" ? storyBibleEditor.draft.id : undefined;

  useEffect(() => {
    if (
      chapterBridge === undefined ||
      activeCreativeWorkspaceId === undefined ||
      chapterWritingEditorId === undefined
    ) {
      return;
    }
    const key = `${activeCreativeWorkspaceId}:chapter:${chapterWritingEditorId}`;
    const session: WritingEditorRendererSession = {
      workspaceId: activeCreativeWorkspaceId,
      editorInstanceId: createWritingEditorInstanceId("chapter")
    };
    chapterWritingEditorSessionRef.current = { key, session };
    void ignoreWritingEditorReportFailure(chapterBridge.openWritingEditor(session));

    return () => {
      if (chapterWritingEditorSessionRef.current?.key !== key) return;
      chapterWritingEditorSessionRef.current = undefined;
      void ignoreWritingEditorReportFailure(chapterBridge.disconnectWritingEditor());
    };
  }, [activeCreativeWorkspaceId, chapterBridge, chapterWritingEditorId]);

  useEffect(() => {
    if (
      chapterBridge === undefined ||
      activeCreativeWorkspaceId === undefined ||
      chapterWritingEditorId === undefined
    ) {
      return;
    }
    const key = `${activeCreativeWorkspaceId}:chapter:${chapterWritingEditorId}`;
    const current = chapterWritingEditorSessionRef.current;
    if (current?.key !== key) return;
    void ignoreWritingEditorReportFailure(chapterBridge.reportWritingEditorState(current.session));
  }, [
    activeCreativeWorkspaceId,
    chapterBridge,
    chapterEditor?.chapter.body,
    chapterEditor?.dirty,
    chapterWritingEditorId
  ]);

  useEffect(() => {
    if (
      storyBibleBridge === undefined ||
      activeCreativeWorkspaceId === undefined ||
      storyBibleWritingEditorId === undefined
    ) {
      return;
    }
    const key = `${activeCreativeWorkspaceId}:story_bible:${storyBibleWritingEditorId}`;
    const session: WritingEditorRendererSession = {
      workspaceId: activeCreativeWorkspaceId,
      editorInstanceId: createWritingEditorInstanceId("story_bible")
    };
    storyBibleWritingEditorSessionRef.current = { key, session };
    void ignoreWritingEditorReportFailure(storyBibleBridge.openWritingEditor(session));

    return () => {
      if (storyBibleWritingEditorSessionRef.current?.key !== key) return;
      storyBibleWritingEditorSessionRef.current = undefined;
      void ignoreWritingEditorReportFailure(storyBibleBridge.disconnectWritingEditor());
    };
  }, [activeCreativeWorkspaceId, storyBibleBridge, storyBibleWritingEditorId]);

  useEffect(() => {
    if (
      storyBibleBridge === undefined ||
      activeCreativeWorkspaceId === undefined ||
      storyBibleWritingEditorId === undefined
    ) {
      return;
    }
    const key = `${activeCreativeWorkspaceId}:story_bible:${storyBibleWritingEditorId}`;
    const current = storyBibleWritingEditorSessionRef.current;
    if (current?.key !== key) return;
    void ignoreWritingEditorReportFailure(
      storyBibleBridge.reportWritingEditorState(current.session)
    );
  }, [
    activeCreativeWorkspaceId,
    storyBibleBridge,
    storyBibleEditor?.dirty,
    storyBibleEditor?.draft,
    storyBibleWritingEditorId
  ]);

  const publishStoryBibleEditor = useCallback(
    (editor: StoryBibleEditorProps) => {
      setStoryBibleEditor(editor);
      if (storyBibleBridge !== undefined) setStoryBible(storyBibleBridge.getProps());
    },
    [setStoryBible, setStoryBibleEditor, storyBibleBridge]
  );
  const handleStoryBibleExternalUpdateReload = useCallback(() => {
    if (storyBibleBridge === undefined) return;
    void storyBibleBridge.reloadExternalUpdate().then(publishStoryBibleEditor);
  }, [publishStoryBibleEditor, storyBibleBridge]);
  const handleStoryBibleExternalUpdateContinue = useCallback(() => {
    if (storyBibleBridge === undefined) return;
    publishStoryBibleEditor(storyBibleBridge.continueExternalUpdate());
  }, [publishStoryBibleEditor, storyBibleBridge]);

  useEffect(() => {
    if (
      agentRunBridge === undefined ||
      storyBibleBridge === undefined ||
      projectWorkflowBridge === undefined
    ) {
      return;
    }
    let active = true;
    const unsubscribe = agentRunBridge.subscribeProjectFilesChanged((event) => {
      void handleChapterAgentExternalUpdate({
        event,
        projectWorkflowBridge,
        ...(chapterBridge === undefined ? {} : { chapterBridge }),
        readChapterEditor: () => chapterEditorRef.current,
        publishProjectWorkflow: (workflow) => {
          if (active) setProjectWorkflow(workflow);
        },
        publishChapterEditor: (editor) => {
          if (active) setChapterEditor(editor);
        }
      });
      void storyBibleBridge.handleExternalUpdate(event).then((editor) => {
        if (active) publishStoryBibleEditor(editor);
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [
    agentRunBridge,
    chapterBridge,
    projectWorkflowBridge,
    publishStoryBibleEditor,
    storyBibleBridge,
    setChapterEditor,
    setProjectWorkflow
  ]);

  return { handleStoryBibleExternalUpdateReload, handleStoryBibleExternalUpdateContinue };
}

function createWritingEditorInstanceId(kind: "chapter" | "story_bible"): string {
  nextWritingEditorInstanceId += 1;
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${kind}_editor_${randomId ?? `${Date.now()}_${nextWritingEditorInstanceId}`}`;
}

async function ignoreWritingEditorReportFailure(report: Promise<unknown>): Promise<void> {
  try {
    await report;
  } catch {
    // The bridge has already retained an unknown state; a renderer retry must not treat it clean.
  }
}
