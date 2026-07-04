import type { ApplicationIpcChannel } from "@novel-studio/application";

export interface IpcInvoker {
  invoke(channel: ApplicationIpcChannel, ...args: readonly unknown[]): Promise<unknown>;
}

export interface NovelStudioApi {
  getShellState(): Promise<unknown>;
  commands: {
    list(): Promise<unknown>;
    execute(commandId: string): Promise<unknown>;
  };
}

export function createNovelStudioApi(ipc: IpcInvoker): NovelStudioApi {
  return {
    getShellState: () => ipc.invoke("application:get-shell-state"),
    commands: {
      list: () => ipc.invoke("application:list-commands"),
      execute: (commandId: string) => ipc.invoke("application:execute-command", commandId)
    }
  };
}
