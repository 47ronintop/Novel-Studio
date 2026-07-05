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
  closeChapterTab(chapterId: string): Promise<ProjectWorkflowProps>;
}

export function createProjectWorkflowBridge(
  api: NovelStudioApi,
  options: ProjectWorkflowBridgeOptions = {}
): ProjectWorkflowBridge {
  const createProjectId = options.createProjectId ?? (() => `prj_${Date.now().toString(36)}`);
  const createChapterId = options.createChapterId ?? (() => `ch_${Date.now().toString(36)}`);
  let projectRootInput = "";
  let snapshot: ProjectWorkspaceSnapshot | undefined;
  let status: ProjectWorkflowProps["status"] = "idle";
  let feedback: ProjectWorkflowProps["feedback"] | undefined;
  let openChapterTabIds: string[] = [];

  return {
    getProps: () => toProps(),
    setProjectRootInput(projectRoot) {
      projectRootInput = projectRoot;
      feedback = undefined;
      return toProps();
    },
    async openProject() {
      return runProjectOperation("opening", async () => {
        const selectedProjectRoot = await resolveProjectRoot(
          () => api.project.chooseOpenDirectory(),
          "已取消打开项目。",
          true
        );
        if (selectedProjectRoot === undefined) {
          return;
        }

        const opened = await api.project.open(selectedProjectRoot);
        if (!opened.ok) {
          feedback = { kind: "error", message: opened.error.message };
          return;
        }

        snapshot = opened.value;
        projectRootInput = snapshot.projectRoot;
        openChapterTabIds =
          snapshot.activeChapterId === undefined ? [] : [snapshot.activeChapterId];
      });
    },
    async createProject() {
      return runProjectOperation("creating", async () => {
        const selectedProjectRoot = await resolveProjectRoot(
          () => api.project.chooseCreateDirectory(),
          "已取消创建项目。",
          shouldUseTypedCreateRoot()
        );
        if (selectedProjectRoot === undefined) {
          return;
        }

        const created = await api.project.create({
          projectRoot: selectedProjectRoot,
          projectId: createProjectId(),
          title: projectTitleFromRoot(selectedProjectRoot),
          language: "zh-CN"
        });
        if (!created.ok) {
          feedback = { kind: "error", message: created.error.message };
          return;
        }

        snapshot = created.value;
        projectRootInput = snapshot.projectRoot;
        openChapterTabIds =
          snapshot.activeChapterId === undefined ? [] : [snapshot.activeChapterId];
      });
    },
    async createChapter() {
      const nextOrder = (snapshot?.chapters.length ?? 0) + 1;
      snapshot = await unwrap(
        api.project.createChapter({
          chapterId: createChapterId(),
          title: `未命名章节 ${nextOrder}`,
          order: nextOrder,
          body: ""
        })
      );
      projectRootInput = snapshot.projectRoot;
      addOpenChapterTab(snapshot.activeChapterId);
      return toProps();
    },
    async selectChapter(chapterId) {
      snapshot = await unwrap(api.project.selectChapter(chapterId));
      projectRootInput = snapshot.projectRoot;
      addOpenChapterTab(chapterId);
      return toProps();
    },
    async closeChapterTab(chapterId) {
      if (!openChapterTabIds.includes(chapterId) || openChapterTabIds.length <= 1) {
        return toProps();
      }

      const closingIndex = openChapterTabIds.indexOf(chapterId);
      const nextOpenChapterTabIds = openChapterTabIds.filter(
        (openChapterId) => openChapterId !== chapterId
      );
      openChapterTabIds = nextOpenChapterTabIds;

      if (snapshot?.activeChapterId === chapterId) {
        const nextActiveChapterId =
          nextOpenChapterTabIds[Math.min(closingIndex, nextOpenChapterTabIds.length - 1)];
        if (nextActiveChapterId !== undefined) {
          snapshot = await unwrap(api.project.selectChapter(nextActiveChapterId));
          projectRootInput = snapshot.projectRoot;
          openChapterTabIds = nextOpenChapterTabIds;
        }
      }

      return toProps();
    }
  };

  async function runProjectOperation(
    nextStatus: NonNullable<ProjectWorkflowProps["status"]>,
    operation: () => Promise<void>
  ): Promise<ProjectWorkflowProps> {
    status = nextStatus;
    feedback = undefined;
    try {
      await operation();
    } finally {
      status = "idle";
    }
    return toProps();
  }

  async function resolveProjectRoot(
    chooseDirectory: () => Promise<
      Result<{ readonly canceled: boolean; readonly projectRoot?: string }, UnifiedError>
    >,
    canceledMessage: string,
    useTypedProjectRoot: boolean
  ): Promise<string | undefined> {
    const typedProjectRoot = projectRootInput.trim();
    if (useTypedProjectRoot && typedProjectRoot.length > 0) {
      return typedProjectRoot;
    }

    const selection = await chooseDirectory();
    if (!selection.ok) {
      feedback = { kind: "error", message: selection.error.message };
      return undefined;
    }
    if (selection.value.canceled || selection.value.projectRoot === undefined) {
      feedback = { kind: "info", message: canceledMessage };
      return undefined;
    }

    projectRootInput = selection.value.projectRoot;
    return selection.value.projectRoot;
  }

  function shouldUseTypedCreateRoot(): boolean {
    const typedProjectRoot = projectRootInput.trim();
    return typedProjectRoot.length > 0 && typedProjectRoot !== snapshot?.projectRoot;
  }

  function toProps(): ProjectWorkflowProps {
    return {
      projectRootInput,
      ...(status === undefined ? {} : { status }),
      ...(feedback === undefined ? {} : { feedback }),
      chapters: snapshot?.chapters ?? [],
      openChapterTabIds,
      dirtyChapterIds: snapshot?.recovery.availableItems.map((item) => item.chapterId) ?? [],
      ...(snapshot?.recovery === undefined ? {} : { recovery: snapshot.recovery }),
      ...(snapshot?.health === undefined ? {} : { health: snapshot.health }),
      ...(snapshot?.activeChapterId === undefined
        ? {}
        : { activeChapterId: snapshot.activeChapterId }),
      onProjectRootChange: () => undefined,
      onOpenProject: () => undefined,
      onCreateProject: () => undefined,
      onCreateChapter: () => undefined,
      onSelectChapter: () => undefined,
      onCloseChapterTab: () => undefined
    };
  }

  function addOpenChapterTab(chapterId: string | undefined): void {
    if (chapterId === undefined || openChapterTabIds.includes(chapterId)) {
      return;
    }

    openChapterTabIds = [...openChapterTabIds, chapterId];
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
  return title === undefined || title.length === 0 ? "未命名项目" : title;
}
