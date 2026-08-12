import { FilePlus, Sparkles } from "lucide-react";
import type { ProjectWorkflowProps } from "./workspace-shell-types.js";

export function WorkspaceEmptyEditor({
  creativeEditorSurface,
  hasActiveProject,
  projectWorkflow
}: {
  readonly creativeEditorSurface: boolean;
  readonly hasActiveProject: boolean;
  readonly projectWorkflow: ProjectWorkflowProps | undefined;
}) {
  if (!creativeEditorSurface) {
    return (
      <section className="ns-empty-editor" aria-label="空工程工作区">
        <div>
          <div className="ns-document-title">未打开工程文件</div>
          <p>从工程资源管理器选择文件后在此查看或编辑。</p>
        </div>
        <div className="ns-editor-line" />
        <div className="ns-editor-line ns-editor-line-short" />
      </section>
    );
  }

  const emptyActiveProject = hasActiveProject && projectWorkflow?.chapters.length === 0;
  const brainstorming = emptyActiveProject ? projectWorkflow?.brainstorming : undefined;

  return (
    <section className="ns-empty-editor" aria-label="空章节工作区">
      <div>
        <div className="ns-document-title">
          {hasActiveProject ? "未命名章节" : "未打开创作项目"}
        </div>
        <p>
          {hasActiveProject
            ? emptyActiveProject
              ? "先构思故事方向，或直接创建第一章开始写正文。"
              : "从章节列表选择要继续编辑的章节。"
            : "新建一个创作项目，或打开已有项目继续编辑。"}
        </p>
      </div>
      {emptyActiveProject ? (
        <div className="ns-empty-editor-actions">
          {brainstorming === undefined ? null : (
            <button
              aria-label="开始构思"
              className="ns-icon-text-button"
              disabled={brainstorming.disabledReason !== undefined}
              onClick={brainstorming.onStart}
              title={brainstorming.disabledReason}
              type="button"
            >
              <Sparkles aria-hidden="true" size={14} />
              开始构思
            </button>
          )}
          <button
            aria-label="新建第一章"
            className="ns-icon-text-button"
            disabled={projectWorkflow === undefined || isProjectWorkflowBusy(projectWorkflow)}
            onClick={projectWorkflow?.onCreateChapter}
            type="button"
          >
            <FilePlus aria-hidden="true" size={14} />
            新建第一章
          </button>
          {brainstorming?.disabledReason === undefined ? null : (
            <p className="ns-empty-editor-action-status" role="status">
              {brainstorming.disabledReason}
            </p>
          )}
        </div>
      ) : hasActiveProject ? null : (
        <div className="ns-empty-editor-actions">
          <button
            aria-label="新建创作项目"
            className="ns-icon-text-button"
            onClick={projectWorkflow?.onCreateProject}
            type="button"
          >
            新建创作项目
          </button>
          <button
            aria-label="打开创作项目"
            className="ns-icon-text-button"
            onClick={projectWorkflow?.onOpenProject}
            type="button"
          >
            打开创作项目
          </button>
        </div>
      )}
      <div className="ns-editor-line" />
      <div className="ns-editor-line ns-editor-line-short" />
    </section>
  );
}

function isProjectWorkflowBusy(projectWorkflow: ProjectWorkflowProps): boolean {
  return projectWorkflow.status === "opening" || projectWorkflow.status === "creating";
}
