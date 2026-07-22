import type { NovelStudioApi, ProjectWorkspaceSnapshotDto } from "@novel-studio/application";
import type { ChapterEditorProps, ProjectWorkflowProps } from "@novel-studio/ui";

import { toChapterEditorProps } from "./chapter-editor-bridge.js";

export interface ProjectWorkflowBridgeOptions {
  readonly createProjectId?: () => string;
  readonly createChapterId?: () => string;
}

export interface ProjectWorkflowBridge {
  getProps(): ProjectWorkflowProps;
  loadActiveProject(projectId: string): Promise<ProjectWorkflowProps>;
  setProjectTitleInput(title: string): ProjectWorkflowProps;
  setProjectFolderNameInput(folderName: string): ProjectWorkflowProps;
  chooseCreateParentDirectory(): Promise<ProjectWorkflowProps>;
  openProject(): Promise<ProjectWorkflowProps>;
  createProject(): Promise<ProjectWorkflowProps>;
  createExampleProject(): Promise<ProjectWorkflowProps>;
  createChapter(): Promise<ProjectWorkflowProps>;
  renameChapter(chapterId: string, title: string): Promise<ProjectWorkflowProps>;
  duplicateChapter(chapterId: string): Promise<ProjectWorkflowProps>;
  deleteChapter(chapterId: string): Promise<ProjectWorkflowProps>;
  selectChapter(chapterId: string): Promise<ProjectWorkflowProps>;
  selectChapterAndLoad(chapterId: string): Promise<ProjectChapterSelectionBridgeResult>;
  closeChapterTab(chapterId: string): Promise<ProjectWorkflowCloseTabBridgeResult>;
  previewRecoveryDraft(sessionId: string): Promise<ProjectWorkflowProps>;
  applyRecoveryDraft(sessionId: string): Promise<ProjectWorkflowRecoveryApplyBridgeResult>;
  discardRecoveryDraft(sessionId: string): Promise<ProjectWorkflowProps>;
}

export interface ProjectWorkflowRecoveryApplyBridgeResult {
  readonly projectWorkflow: ProjectWorkflowProps;
  readonly chapterEditor?: ChapterEditorProps;
}

export interface ProjectWorkflowCloseTabBridgeResult {
  readonly projectWorkflow: ProjectWorkflowProps;
  readonly chapterEditor?: ChapterEditorProps;
}

export interface ProjectChapterSelectionBridgeResult {
  readonly projectWorkflow: ProjectWorkflowProps;
  readonly chapterEditor: ChapterEditorProps;
}

export function createProjectWorkflowBridge(
  api: NovelStudioApi,
  options: ProjectWorkflowBridgeOptions = {}
): ProjectWorkflowBridge {
  const createProjectId = options.createProjectId ?? (() => `prj_${Date.now().toString(36)}`);
  const createChapterId = options.createChapterId ?? (() => `ch_${Date.now().toString(36)}`);
  let snapshot: ProjectWorkspaceSnapshotDto | undefined;
  let projectTitleInput = "";
  let projectFolderNameInput = "";
  let folderNameEdited = false;
  let selectedParentSelectionId: string | undefined;
  let selectedParentDisplayName: string | undefined;
  let creationPreview: ProjectWorkflowProps["creationPreview"] | undefined;
  let previewRevision = 0;
  let status: ProjectWorkflowProps["status"] = "idle";
  let feedback: ProjectWorkflowProps["feedback"] | undefined;
  let openChapterTabIds: string[] = [];
  let recoveryReview: NonNullable<ProjectWorkflowProps["recovery"]>["review"] | undefined;

  const bridge: ProjectWorkflowBridge = {
    getProps: toProps,
    async loadActiveProject(projectId) {
      const previousStatus = snapshot === undefined ? "idle" : "ready";
      status = "opening";
      feedback = undefined;
      try {
        const loaded = await api.project.getActiveWorkspace();
        if (!loaded.ok) {
          return fail(loaded.error.message, previousStatus);
        }
        if (loaded.value.project.projectId !== projectId) {
          return fail("The active project changed before it could be loaded.", previousStatus);
        }
        adoptSnapshot(loaded.value);
        status = "ready";
        feedback = undefined;
        return toProps();
      } catch (error) {
        return fail(toErrorMessage(error), previousStatus);
      }
    },
    setProjectTitleInput(title) {
      projectTitleInput = title;
      if (!folderNameEdited) projectFolderNameInput = title;
      feedback = undefined;
      schedulePreview();
      return toProps();
    },
    setProjectFolderNameInput(folderName) {
      projectFolderNameInput = folderName;
      folderNameEdited = true;
      feedback = undefined;
      schedulePreview();
      return toProps();
    },
    async chooseCreateParentDirectory() {
      const selected = await api.project.chooseCreateParentDirectory();
      if (!selected.ok) return fail(selected.error.message);
      if (selected.value.canceled || selected.value.selectionId === undefined) {
        feedback = { kind: "info", message: "Project creation was canceled." };
        return toProps();
      }
      selectedParentSelectionId = selected.value.selectionId;
      selectedParentDisplayName = selected.value.displayName;
      feedback = undefined;
      await updateCreationPreview();
      return toProps();
    },
    async openProject() {
      const previousStatus = snapshot === undefined ? "idle" : "ready";
      status = "opening";
      feedback = undefined;
      try {
        const selected = await api.project.chooseOpenCreativeDirectory();
        if (!selected.ok) {
          return fail(selected.error.message, previousStatus);
        }
        if (selected.value.canceled || selected.value.selectionId === undefined) {
          status = previousStatus;
          feedback = { kind: "info", message: "Project opening was canceled." };
          return toProps();
        }
        const opened = await api.project.openCreativeProject(selected.value.selectionId);
        if (!opened.ok) {
          return fail(opened.error.message, previousStatus);
        }
        if (!("creativeProject" in opened.value)) {
          return fail("The selected directory is not a creative project.", previousStatus);
        }
        adoptSnapshot(opened.value.creativeProject);
        status = "ready";
        feedback = undefined;
        return toProps();
      } catch (error) {
        return fail(toErrorMessage(error), previousStatus);
      }
    },
    async createProject() {
      const previousStatus = snapshot === undefined ? "idle" : "ready";
      status = "creating";
      feedback = undefined;
      try {
        if (selectedParentSelectionId === undefined) {
          await bridge.chooseCreateParentDirectory();
        }
        if (selectedParentSelectionId === undefined) {
          status = previousStatus;
          return toProps();
        }
        const folderName = projectFolderNameInput;
        const title = projectTitleInput.trim();
        if (folderName.trim().length === 0 || title.length === 0) {
          return fail("Project title and folder name are required.", previousStatus);
        }
        const created = await api.project.createCreativeProject({
          parentSelectionId: selectedParentSelectionId,
          folderName,
          projectId: createProjectId(),
          title,
          language: "zh-CN"
        });
        if (!created.ok) {
          return fail(created.error.message, previousStatus);
        }
        if (!("creativeProject" in created.value)) {
          return fail("The project could not be activated as a creative project.", previousStatus);
        }
        adoptSnapshot(created.value.creativeProject);
        status = "ready";
        feedback = undefined;
        return toProps();
      } catch (error) {
        return fail(toErrorMessage(error), previousStatus);
      }
    },
    async createExampleProject() {
      projectTitleInput = "Example Project";
      if (!folderNameEdited) projectFolderNameInput = "Example Project";
      return bridge.createProject();
    },
    async createChapter() {
      const nextOrder = (snapshot?.chapters.length ?? 0) + 1;
      await applySnapshot(
        api.project.createChapter({
          chapterId: createChapterId(),
          title: `Untitled Chapter ${nextOrder}`,
          order: nextOrder,
          body: ""
        })
      );
      addOpenChapterTab(snapshot?.activeChapterId);
      return toProps();
    },
    async renameChapter(chapterId, title) {
      await applySnapshot(api.project.renameChapter({ chapterId, title }));
      return toProps();
    },
    async duplicateChapter(chapterId) {
      const source = snapshot?.chapters.find((chapter) => chapter.id === chapterId);
      await applySnapshot(
        api.project.duplicateChapter({
          sourceChapterId: chapterId,
          chapterId: createChapterId(),
          title: `${source?.title ?? "Untitled Chapter"} Copy`
        })
      );
      addOpenChapterTab(snapshot?.activeChapterId);
      return toProps();
    },
    async deleteChapter(chapterId) {
      await applySnapshot(api.project.deleteChapter({ chapterId }));
      openChapterTabIds = openChapterTabIds.filter((id) => id !== chapterId);
      addOpenChapterTab(snapshot?.activeChapterId);
      return toProps();
    },
    async selectChapter(chapterId) {
      await applySnapshot(api.project.selectChapter(chapterId));
      addOpenChapterTab(chapterId);
      return toProps();
    },
    async selectChapterAndLoad(chapterId) {
      const selected = await api.project.selectChapterAndLoad(chapterId);
      if (!selected.ok) {
        throw new Error(selected.error.message);
      }

      adoptSnapshot(selected.value.workspace);
      feedback = undefined;
      return {
        projectWorkflow: toProps(),
        chapterEditor: toChapterEditorProps(selected.value.chapterEditor)
      };
    },
    async closeChapterTab(chapterId) {
      if (!openChapterTabIds.includes(chapterId) || openChapterTabIds.length <= 1) {
        return { projectWorkflow: toProps() };
      }
      const closingIndex = openChapterTabIds.indexOf(chapterId);
      const remaining = openChapterTabIds.filter((id) => id !== chapterId);
      if (snapshot?.activeChapterId === chapterId) {
        const next = remaining[Math.min(closingIndex, remaining.length - 1)];
        if (next !== undefined) {
          const selected = await api.project.selectChapterAndLoad(next);
          if (!selected.ok) {
            throw new Error(selected.error.message);
          }

          adoptSnapshot(selected.value.workspace);
          openChapterTabIds = remaining;
          feedback = undefined;
          return {
            projectWorkflow: toProps(),
            chapterEditor: toChapterEditorProps(selected.value.chapterEditor)
          };
        }
      }
      openChapterTabIds = remaining;
      return { projectWorkflow: toProps() };
    },
    async previewRecoveryDraft(sessionId) {
      recoveryReview = { status: "previewing" };
      const preview = await api.project.previewRecoveryDraft(sessionId);
      if (!preview.ok) {
        recoveryReview = { status: "idle" };
        return fail(preview.error.message);
      }
      recoveryReview = { status: "idle", selectedDraft: preview.value };
      feedback = undefined;
      return toProps();
    },
    async applyRecoveryDraft(sessionId) {
      recoveryReview = { ...recoveryReview, status: "applying" };
      const applied = await api.project.applyRecoveryDraft(sessionId);
      if (!applied.ok) {
        recoveryReview = { ...recoveryReview, status: "idle" };
        return { projectWorkflow: fail(applied.error.message) };
      }
      adoptSnapshot(applied.value.workspace);
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
        recoveryReview = { ...recoveryReview, status: "idle" };
        return fail(discarded.error.message);
      }
      adoptSnapshot(discarded.value);
      recoveryReview = undefined;
      feedback = undefined;
      return toProps();
    }
  };

  return bridge;

  async function applySnapshot(
    resultPromise: Promise<
      | { readonly ok: true; readonly value: ProjectWorkspaceSnapshotDto }
      | { readonly ok: false; readonly error: { readonly message: string } }
    >
  ): Promise<void> {
    const result = await resultPromise;
    if (!result.ok) {
      feedback = { kind: "error", message: result.error.message };
      return;
    }
    adoptSnapshot(result.value);
    feedback = undefined;
  }

  function adoptSnapshot(next: ProjectWorkspaceSnapshotDto): void {
    snapshot = next;
    addOpenChapterTab(next.activeChapterId);
  }

  function schedulePreview(): void {
    void updateCreationPreview();
  }

  async function updateCreationPreview(): Promise<void> {
    const revision = ++previewRevision;
    creationPreview = undefined;
    const folderName = projectFolderNameInput;
    const parentSelectionId = selectedParentSelectionId;
    if (parentSelectionId === undefined || folderName.trim().length === 0) return;
    const preview = await api.project.previewCreativeProject({
      parentSelectionId,
      folderName
    });
    if (revision !== previewRevision) return;
    if (!preview.ok) {
      feedback = { kind: "error", message: preview.error.message };
      return;
    }
    creationPreview = preview.value;
    feedback = undefined;
  }

  function fail(
    message: string,
    nextStatus: ProjectWorkflowProps["status"] = status
  ): ProjectWorkflowProps {
    status = nextStatus;
    feedback = { kind: "error", message };
    return toProps();
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
      ...(snapshot === undefined ? {} : { projectId: snapshot.project.projectId }),
      projectTitleInput,
      projectFolderNameInput,
      ...(selectedParentSelectionId === undefined ? {} : { selectedParentSelectionId }),
      ...(selectedParentDisplayName === undefined ? {} : { selectedParentDisplayName }),
      ...(creationPreview === undefined ? {} : { creationPreview }),
      status: status ?? "idle",
      ...(feedback === undefined ? {} : { feedback }),
      chapters: snapshot?.chapters ?? [],
      openChapterTabIds,
      dirtyChapterIds: snapshot?.recovery.availableItems.map((item) => item.chapterId) ?? [],
      ...(recovery === undefined ? {} : { recovery }),
      ...(snapshot?.health === undefined ? {} : { health: snapshot.health }),
      ...(snapshot?.activeChapterId === undefined
        ? {}
        : { activeChapterId: snapshot.activeChapterId }),
      onProjectTitleChange: (title) => bridge.setProjectTitleInput(title),
      onProjectFolderNameChange: (folderName) => bridge.setProjectFolderNameInput(folderName),
      onChooseCreateParentDirectory: () => {
        void bridge.chooseCreateParentDirectory();
      },
      onOpenProject: () => {
        void bridge.openProject();
      },
      onCreateProject: () => {
        void bridge.createProject();
      },
      onCreateChapter: () => {
        void bridge.createChapter();
      },
      onSelectChapter: (chapterId) => {
        void bridge.selectChapter(chapterId);
      }
    };
  }

  function addOpenChapterTab(chapterId: string | undefined): void {
    if (chapterId === undefined || openChapterTabIds.includes(chapterId)) return;
    openChapterTabIds = [...openChapterTabIds, chapterId];
  }

  function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
