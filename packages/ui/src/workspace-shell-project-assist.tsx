import { Check, Eye, FilePlus, FolderOpen, FolderPlus, Sparkles, Trash2, X } from "lucide-react";

import type {
  OnboardingProps,
  ProjectWorkflowProps,
  ProjectWorkflowRecoveryItemProps
} from "./workspace-shell.js";

export function OnboardingQuickStart({
  onboarding
}: {
  readonly onboarding: OnboardingProps | undefined;
}) {
  if (onboarding === undefined || onboarding.visible !== true || onboarding.dismissed === true) {
    return null;
  }

  return (
    <section className="ns-onboarding" aria-label="快速开始">
      <div className="ns-onboarding-header">
        <div>
          <h1>快速开始</h1>
          <p>连接你的第一个长篇项目，或创建一个本地示例项目熟悉工作台。</p>
        </div>
        <button
          aria-label="隐藏快速开始"
          className="ns-icon-button"
          onClick={onboarding.onDismiss}
          title="隐藏快速开始"
          type="button"
        >
          <X aria-hidden="true" size={14} />
        </button>
      </div>
      <ol className="ns-onboarding-steps" aria-label="入门步骤">
        {onboarding.steps.map((step) => (
          <li data-completed={step.completed} key={step.id}>
            <span>{step.completed ? "✓" : "•"}</span>
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
      <div className="ns-onboarding-actions">
        <button
          aria-label="创建示例项目"
          className="ns-icon-text-button"
          onClick={onboarding.onCreateExampleProject}
          type="button"
        >
          <Sparkles aria-hidden="true" size={14} />
          创建示例项目
        </button>
        <button
          aria-label="创建新项目"
          className="ns-icon-text-button"
          onClick={onboarding.onCreateProject}
          type="button"
        >
          <FolderPlus aria-hidden="true" size={14} />
          创建新项目
        </button>
        <button
          aria-label="打开已有项目"
          className="ns-icon-text-button"
          onClick={onboarding.onOpenProject}
          type="button"
        >
          <FolderOpen aria-hidden="true" size={14} />
          打开已有项目
        </button>
        <button
          aria-label="新建第一章"
          className="ns-icon-text-button"
          onClick={onboarding.onCreateFirstChapter}
          type="button"
        >
          <FilePlus aria-hidden="true" size={14} />
          新建第一章
        </button>
      </div>
    </section>
  );
}

export function AutosaveRecoveryNotice({
  projectWorkflow
}: {
  readonly projectWorkflow: ProjectWorkflowProps | undefined;
}) {
  const recoveryItems = projectWorkflow?.recovery?.availableItems ?? [];
  if (recoveryItems.length === 0) {
    return null;
  }

  const recoveredTitles = recoveryItems
    .map((item) => recoveryItemTitle(projectWorkflow, item))
    .filter((title) => title.length > 0);
  const selectedDraft = projectWorkflow?.recovery?.review?.selectedDraft;

  return (
    <section className="ns-recovery-notice" aria-label="Autosave recovery">
      <div className="ns-recovery-notice-main">
        <div>
          <strong>Recoverable drafts {recoveryItems.length}</strong>
          <span>{recoveredTitles.join(", ")}</span>
        </div>
        <div className="ns-recovery-actions">
          {recoveryItems.map((item) => {
            const title = recoveryItemTitle(projectWorkflow, item);
            return (
              <div className="ns-recovery-action-row" key={item.sessionId}>
                <span>{item.updatedAt}</span>
                <button
                  aria-label={`预览恢复草稿：${title}`}
                  className="ns-icon-text-button"
                  onClick={() => projectWorkflow?.onPreviewRecoveryDraft?.(item.sessionId)}
                  type="button"
                >
                  <Eye aria-hidden="true" size={13} />
                  预览恢复草稿
                </button>
                <button
                  aria-label={`应用恢复草稿：${title}`}
                  className="ns-icon-text-button"
                  onClick={() => projectWorkflow?.onApplyRecoveryDraft?.(item.sessionId)}
                  type="button"
                >
                  <Check aria-hidden="true" size={13} />
                  应用恢复草稿
                </button>
                <button
                  aria-label={`丢弃恢复草稿：${title}`}
                  className="ns-icon-text-button"
                  onClick={() => projectWorkflow?.onDiscardRecoveryDraft?.(item.sessionId)}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={13} />
                  丢弃恢复草稿
                </button>
              </div>
            );
          })}
        </div>
        {selectedDraft === undefined ? null : (
          <article className="ns-recovery-preview" aria-label="恢复草稿预览">
            <div>
              <strong>{selectedDraft.chapterTitle}</strong>
              <span>{selectedDraft.updatedAt}</span>
            </div>
            <pre>{selectedDraft.body}</pre>
          </article>
        )}
      </div>
    </section>
  );
}

function recoveryItemTitle(
  projectWorkflow: ProjectWorkflowProps | undefined,
  item: ProjectWorkflowRecoveryItemProps
): string {
  return (
    projectWorkflow?.chapters.find((chapter) => chapter.id === item.chapterId)?.title ??
    item.chapterId
  );
}
