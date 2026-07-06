import type { ChapterEditorProps, ProjectWorkflowProps } from "@novel-studio/ui";
import type { NovelStudioApi, ProjectWorkspaceSnapshot } from "@novel-studio/application";
import type { Result, UnifiedError } from "@novel-studio/shared";
import { toChapterEditorProps } from "./chapter-editor-bridge.js";

export interface ProjectWorkflowBridgeOptions {
  readonly createProjectId?: () => string;
  readonly createChapterId?: () => string;
}

export interface ProjectWorkflowBridge {
  getProps(): ProjectWorkflowProps;
  setProjectRootInput(projectRoot: string): ProjectWorkflowProps;
  openProject(): Promise<ProjectWorkflowProps>;
  createProject(): Promise<ProjectWorkflowProps>;
  createExampleProject(): Promise<ProjectWorkflowProps>;
  createChapter(): Promise<ProjectWorkflowProps>;
  selectChapter(chapterId: string): Promise<ProjectWorkflowProps>;
  closeChapterTab(chapterId: string): Promise<ProjectWorkflowProps>;
  previewRecoveryDraft(sessionId: string): Promise<ProjectWorkflowProps>;
  applyRecoveryDraft(sessionId: string): Promise<ProjectWorkflowRecoveryApplyBridgeResult>;
  discardRecoveryDraft(sessionId: string): Promise<ProjectWorkflowProps>;
}

export interface ProjectWorkflowRecoveryApplyBridgeResult {
  readonly projectWorkflow: ProjectWorkflowProps;
  readonly chapterEditor?: ChapterEditorProps;
}

const EXAMPLE_PROJECT_TITLE = "示例小说项目";
const EXAMPLE_CHAPTER_TITLE = "示例章节";
const EXAMPLE_CHAPTER_BODY =
  "这是一个本地示例章节。\n\n你可以直接改写这一段，也可以打开 AI 工作流生成建议。所有内容默认保存在本地项目文件夹中。\n";

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
  let recoveryReview: NonNullable<ProjectWorkflowProps["recovery"]>["review"] | undefined;

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
    async createExampleProject() {
      return runProjectOperation("creating", async () => {
        const selectedProjectRoot = await resolveProjectRoot(
          () => api.project.chooseCreateDirectory(),
          "已取消创建示例项目。",
          shouldUseTypedCreateRoot()
        );
        if (selectedProjectRoot === undefined) {
          return;
        }

        const created = await api.project.create({
          projectRoot: selectedProjectRoot,
          projectId: createProjectId(),
          title: EXAMPLE_PROJECT_TITLE,
          language: "zh-CN"
        });
        if (!created.ok) {
          feedback = { kind: "error", message: created.error.message };
          return;
        }

        const createdChapter = await api.project.createChapter({
          chapterId: createChapterId(),
          title: EXAMPLE_CHAPTER_TITLE,
          order: 1,
          body: EXAMPLE_CHAPTER_BODY
        });
        if (!createdChapter.ok) {
          feedback = { kind: "error", message: createdChapter.error.message };
          snapshot = created.value;
          projectRootInput = snapshot.projectRoot;
          openChapterTabIds =
            snapshot.activeChapterId === undefined ? [] : [snapshot.activeChapterId];
          return;
        }

        snapshot = createdChapter.value;
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
    },
    async previewRecoveryDraft(sessionId) {
      recoveryReview = { status: "previewing" };
      const preview = await api.project.previewRecoveryDraft(sessionId);
      if (!preview.ok) {
        feedback = { kind: "error", message: preview.error.message };
        recoveryReview = { status: "idle" };
        return toProps();
      }

      recoveryReview = {
        status: "idle",
        selectedDraft: preview.value
      };
      feedback = undefined;
      return toProps();
    },
    async applyRecoveryDraft(sessionId) {
      recoveryReview = { ...recoveryReview, status: "applying" };
      const applied = await api.project.applyRecoveryDraft(sessionId);
      if (!applied.ok) {
        feedback = { kind: "error", message: applied.error.message };
        recoveryReview = { ...recoveryReview, status: "idle" };
        return { projectWorkflow: toProps() };
      }

      snapshot = applied.value.workspace;
      projectRootInput = snapshot.projectRoot;
      addOpenChapterTab(snapshot.activeChapterId);
      recoveryReview = undefined;
      feedback = undefined;
      return {
        projectWorkflow: toProps(),
        chapterEditor: toChapterEditorProps(applied.value.chapterEditor)
      };
    },
    async discardRecoveryDraft(sessionId) {
      recoveryReview = { ...recoveryReview, status: "discarding" };
      const discarded = await api.project.discardRecoveryDraft(sessionId);
      if (!discarded.ok) {
        feedback = { kind: "error", message: discarded.error.message };
        recoveryReview = { ...recoveryReview, status: "idle" };
        return toProps();
      }

      snapshot = discarded.value;
      projectRootInput = snapshot.projectRoot;
      recoveryReview = undefined;
      feedback = undefined;
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
    const recovery =
      snapshot?.recovery === undefined && recoveryReview === undefined
        ? undefined
        : {
            ...(snapshot?.recovery ?? { availableItems: [] }),
            ...(recoveryReview === undefined ? {} : { review: recoveryReview })
          };

    return {
      projectRootInput,
      ...(status === undefined ? {} : { status }),
      ...(feedback === undefined ? {} : { feedback }),
      chapters: snapshot?.chapters ?? [],
      openChapterTabIds,
      dirtyChapterIds: snapshot?.recovery.availableItems.map((item) => item.chapterId) ?? [],
      ...(recovery === undefined ? {} : { recovery }),
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
