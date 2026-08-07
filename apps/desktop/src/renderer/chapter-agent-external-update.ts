import type { ChapterEditorProps, ProjectWorkflowProps } from "@novel-studio/ui";

import type { AgentProjectFilesChangedEvent } from "./agent-run-bridge.js";
import type { ChapterEditorBridge } from "./chapter-editor-bridge.js";
import type { ProjectWorkflowBridge } from "./project-workflow-bridge.js";

export interface ChapterAgentExternalUpdateOptions {
  readonly event: AgentProjectFilesChangedEvent;
  readonly projectWorkflowBridge: Pick<ProjectWorkflowBridge, "refreshActiveProject">;
  readonly chapterBridge?: Pick<ChapterEditorBridge, "load">;
  readonly readChapterEditor: () => ChapterEditorProps | undefined;
  readonly publishProjectWorkflow: (props: ProjectWorkflowProps) => void;
  readonly publishChapterEditor: (props: ChapterEditorProps) => void;
}

/**
 * Refreshes the chapter workbench after a durable Agent apply or undo without allowing an
 * external disk update to replace an unsaved chapter buffer.
 */
export async function handleChapterAgentExternalUpdate(
  input: ChapterAgentExternalUpdateOptions
): Promise<void> {
  if (!hasWritingDomainChange(input.event.relativePaths)) return;

  const workflow = await input.projectWorkflowBridge.refreshActiveProject();
  input.publishProjectWorkflow(workflow);

  const current = input.readChapterEditor();
  if (current === undefined || input.chapterBridge === undefined) return;
  if (current.dirty) {
    input.publishChapterEditor({
      ...current,
      saveStatus: "Recovery available",
      completionFeedback: {
        kind: "error",
        message: "章节已在 Agent 操作后发生外部更新；未保存内容已保留，请先处理冲突。"
      }
    });
    return;
  }

  input.publishChapterEditor(await input.chapterBridge.load());
}

function hasWritingDomainChange(relativePaths: readonly string[]): boolean {
  return relativePaths.some(
    (relativePath) =>
      relativePath.startsWith("chapters/") || relativePath === "outline/outline.json"
  );
}
