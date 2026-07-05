import type { ApplicationCommand } from "@novel-studio/application";
import { Search } from "lucide-react";

export interface CommandPaletteShortcutEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export interface CommandPaletteProps {
  readonly commands: readonly ApplicationCommand[];
  readonly onCommandExecute?: ((commandId: ApplicationCommand["id"]) => void) | undefined;
  readonly open: boolean;
}

export function isCommandPaletteShortcut(event: CommandPaletteShortcutEvent): boolean {
  return event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey);
}

export function CommandPalette({ commands, onCommandExecute, open }: CommandPaletteProps) {
  if (!open) {
    return null;
  }

  const safeCommands = commands.filter((command) => command.riskLevel === "safe");

  return (
    <div className="ns-command-palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <div className="ns-command-search">
        <Search aria-hidden="true" size={16} />
        <input aria-label="搜索命令" placeholder="搜索命令" />
      </div>
      <ul className="ns-command-list" aria-label="可用命令">
        {safeCommands.map((command) => (
          <li className="ns-command-item" key={command.id}>
            <button
              aria-label={`执行命令：${command.title}`}
              className="ns-command-action"
              onClick={() => onCommandExecute?.(command.id)}
              type="button"
            >
              <span className="ns-command-title">{command.title}</span>
              <span className="ns-command-meta">
                <span>{command.defaultShortcut}</span>
                <span className="ns-risk-level">{riskLevelLabel(command.riskLevel)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function riskLevelLabel(riskLevel: ApplicationCommand["riskLevel"]): string {
  switch (riskLevel) {
    case "safe":
      return "安全";
    case "confirmation-required":
      return "需要确认";
    case "destructive":
      return "高风险";
  }
}
