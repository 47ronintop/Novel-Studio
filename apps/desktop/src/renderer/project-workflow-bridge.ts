import type { ProjectWorkflowProps } from "@novel-studio/ui";
import type { NovelStudioApi, ProjectWorkspaceSnapshot } from "@novel-studio/application";
import type { Result, UnifiedError } from "@novel-studio/shared";

export interface ProjectWorkflowBridgeOptions {
  readonly createProjectId?: () => string;
  readonly createChapterId?: () => string;
}

export interface ProjectWorkflowBridge {
  getProps(): ProjectWorkflowProps;
  setProjectRootInput(projectRoot: string): ProjectWorkflowProps;
  openProject(): Promise<ProjectWorkflowProps>;
  createProject(): Promise<ProjectWorkflowProps>;
  createChapter(): Promise<ProjectWorkflowProps>;
  selectChapter(chapterId: string): Promise<ProjectWorkflowProps>;
}

export function createProjectWorkflowBridge(
  api: NovelStudioApi,
  options: ProjectWorkflowBridgeOptions = {}
): ProjectWorkflowBridge {
  const createProjectId = options.createProjectId ?? (() => `prj_${Date.now().toString(36)}`);
  const createChapterId = options.createChapterId ?? (() => `ch_${Date.now().toString(36)}`);
  let projectRootInput = "";
  let snapshot: ProjectWorkspaceSnapshot | undefined;

  return {
    getProps: () => toProps(),
    setProjectRootInput(projectRoot) {
      projectRootInput = projectRoot;
      return toProps();
    },
    async openProject() {
      snapshot = await unwrap(api.project.open(projectRootInput));
      projectRootInput = snapshot.projectRoot;
      return toProps();
    },
    async createProject() {
      snapshot = await unwrap(
        api.project.create({
          projectRoot: projectRootInput,
          projectId: createProjectId(),
          title: projectTitleFromRoot(projectRootInput),
          language: "zh-CN"
        })
      );
      projectRootInput = snapshot.projectRoot;
      return toProps();
    },
    async createChapter() {
      const nextOrder = (snapshot?.chapters.length ?? 0) + 1;
      snapshot = await unwrap(
        api.project.createChapter({
          chapterId: createChapterId(),
          title: `Untitled Chapter ${nextOrder}`,
          order: nextOrder,
          body: ""
        })
      );
      projectRootInput = snapshot.projectRoot;
      return toProps();
    },
    async selectChapter(chapterId) {
      snapshot = await unwrap(api.project.selectChapter(chapterId));
      projectRootInput = snapshot.projectRoot;
      return toProps();
    }
  };

  function toProps(): ProjectWorkflowProps {
    return {
      projectRootInput,
      chapters: snapshot?.chapters ?? [],
      ...(snapshot?.activeChapterId === undefined
        ? {}
        : { activeChapterId: snapshot.activeChapterId }),
      onProjectRootChange: () => undefined,
      onOpenProject: () => undefined,
      onCreateProject: () => undefined,
      onCreateChapter: () => undefined,
      onSelectChapter: () => undefined
    };
  }
}

async function unwrap<T>(promise: Promise<Result<T, UnifiedError>>): Promise<T> {
  const result = await promise;
  if (result.ok) {
    return result.value;
  }

  throw new Error(result.error.message);
}

function projectTitleFromRoot(projectRoot: string): string {
  const normalized = projectRoot.replace(/\\/g, "/").replace(/\/$/, "");
  const title = normalized.split("/").filter(Boolean).at(-1);
  return title === undefined || title.length === 0 ? "Untitled Project" : title;
}
