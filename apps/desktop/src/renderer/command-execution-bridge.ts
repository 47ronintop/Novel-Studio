import type {
  ApplicationCommandId,
  DesktopShellState,
  NovelStudioApi
} from "@novel-studio/application";
import type { Result, UnifiedError } from "@novel-studio/shared";

export interface CommandExecutionApi {
  readonly commands: Pick<NovelStudioApi["commands"], "execute">;
}

export interface CommandExecutionBridge {
  execute(commandId: ApplicationCommandId): Promise<Result<DesktopShellState, UnifiedError>>;
}

export function createCommandExecutionBridge(api: CommandExecutionApi): CommandExecutionBridge {
  return {
    execute(commandId) {
      return api.commands.execute(commandId);
    }
  };
}
