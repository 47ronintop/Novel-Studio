import { join } from "node:path";

import {
  createChapterEditorSession,
  createDesktopApplication,
  createProjectWorkspaceSession
} from "@novel-studio/application";
import type { DesktopApplication } from "@novel-studio/application";
import {
  ChapterFileRepository,
  HistoryRepository,
  ProjectFileRepository
} from "@novel-studio/repository";

export const DEFAULT_FIXTURE_CHAPTER_ID = "ch_01JZ7P9QK2R6D4W8K3A1B5C9D0";

export interface ProjectDesktopApplicationOptions {
  readonly projectRoot: string;
  readonly chapterId: string;
  readonly projectTitle: string;
  readonly now?: () => string;
  readonly createVersionId?: () => string;
}

export function createProjectDesktopApplication(
  options: ProjectDesktopApplicationOptions
): DesktopApplication {
  const chapterRepository = new ChapterFileRepository({
    projectRoot: options.projectRoot,
    traceId: "trace_desktop_chapter_repository"
  });
  const historyRepository = new HistoryRepository({
    projectRoot: options.projectRoot,
    traceId: "trace_desktop_history_repository",
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.createVersionId === undefined ? {} : { createVersionId: options.createVersionId })
  });
  const chapterEditorSession = createChapterEditorSession({
    chapterId: options.chapterId,
    repository: chapterRepository,
    historyRepository,
    ...(options.now === undefined ? {} : { now: options.now })
  });

  return createDesktopApplication({
    chapterEditorSession,
    projectWorkspaceSession: createProjectWorkspaceSession({
      ...(options.now === undefined ? {} : { now: options.now }),
      createProjectRepository: (projectRoot) =>
        new ProjectFileRepository({
          projectRoot,
          traceId: "trace_desktop_project_repository",
          ...(options.now === undefined ? {} : { now: options.now })
        }),
      createChapterRepository: (projectRoot) =>
        new ChapterFileRepository({
          projectRoot,
          traceId: "trace_desktop_project_chapter_repository",
          ...(options.now === undefined ? {} : { now: options.now })
        }),
      createHistoryRepository: (projectRoot) =>
        new HistoryRepository({
          projectRoot,
          traceId: "trace_desktop_project_history_repository",
          ...(options.now === undefined ? {} : { now: options.now }),
          ...(options.createVersionId === undefined
            ? {}
            : { createVersionId: options.createVersionId })
        })
    }),
    projectTitle: options.projectTitle,
    navigatorSections: [
      { id: "chapters", title: "Chapters", itemCount: 1 },
      { id: "characters", title: "Characters", itemCount: 0 },
      { id: "world", title: "World", itemCount: 0 },
      { id: "outline", title: "Outline", itemCount: 0 },
      { id: "timeline", title: "Timeline", itemCount: 0 },
      { id: "memories", title: "Memories", itemCount: 0 },
      { id: "prompts", title: "Prompts", itemCount: 0 },
      { id: "agents", title: "Agents", itemCount: 0 },
      { id: "workflows", title: "Workflows", itemCount: 0 }
    ]
  });
}

export function createDefaultDesktopApplication(): DesktopApplication {
  const projectRoot =
    process.env["NOVEL_STUDIO_PROJECT_ROOT"] ??
    join(process.cwd(), "fixtures", "projects", "minimal-chapter");

  return createProjectDesktopApplication({
    projectRoot,
    chapterId: DEFAULT_FIXTURE_CHAPTER_ID,
    projectTitle: "Minimal Chapter Project"
  });
}
