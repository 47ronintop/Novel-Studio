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
    }
  };
}
