import { createDesktopApplication } from "@novel-studio/application";
import type { ApplicationIpcChannel, DesktopApplication } from "@novel-studio/application";

export type ApplicationIpcHandlers = {
  readonly [Channel in ApplicationIpcChannel]: (...args: readonly unknown[]) => Promise<unknown>;
};

export function createApplicationIpcHandlers(
  application: DesktopApplication = createDesktopApplication()
): ApplicationIpcHandlers {
  return {
    "application:get-shell-state": () => Promise.resolve(application.getShellState()),
    "application:list-commands": () => Promise.resolve(application.listCommands()),
    "application:execute-command": (commandId: unknown) => {
      if (typeof commandId !== "string") {
        return Promise.resolve(application.executeCommand(""));
      }

      return Promise.resolve(application.executeCommand(commandId));
    },
    "application:chapter:load": () => application.loadActiveChapter(),
    "application:chapter:edit": (nextBody: unknown) => {
      if (typeof nextBody !== "string") {
        return application.editActiveChapter("");
      }

      return application.editActiveChapter(nextBody);
    },
    "application:chapter:save": () => application.saveActiveChapter(),
    "application:chapter:list-versions": () => application.listActiveChapterVersions(),
    "application:chapter:preview-version": (versionId: unknown) => {
      if (typeof versionId !== "string") {
        return application.previewActiveChapterVersion("");
      }

      return application.previewActiveChapterVersion(versionId);
    },
    "application:chapter:restore-version": (versionId: unknown) => {
      if (typeof versionId !== "string") {
        return application.restoreActiveChapterVersion("");
      }

      return application.restoreActiveChapterVersion(versionId);
    },
    "application:chapter:preview-suggestion-diff": (nextBody: unknown) => {
      if (typeof nextBody !== "string") {
        return Promise.resolve(application.previewActiveChapterSuggestionDiff(""));
      }

      return Promise.resolve(application.previewActiveChapterSuggestionDiff(nextBody));
    }
  };
}
