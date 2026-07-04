import type { ApplicationCommand } from "@novel-studio/application";
import { Search } from "lucide-react";

export interface CommandPaletteShortcutEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export interface CommandPaletteProps {
  readonly commands: readonly ApplicationCommand[];
  readonly open: boolean;
}

export function isCommandPaletteShortcut(event: CommandPaletteShortcutEvent): boolean {
  return event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey);
}

export function CommandPalette({ commands, open }: CommandPaletteProps) {
  if (!open) {
    return null;
  }

  const safeCommands = commands.filter((command) => command.riskLevel === "safe");

  return (
    <div
      className="ns-command-palette"
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
    >
      <div className="ns-command-search">
        <Search aria-hidden="true" size={16} />
        <input aria-label="Search commands" placeholder="Search commands" />
      </div>
      <ul className="ns-command-list" aria-label="Available commands">
        {safeCommands.map((command) => (
          <li className="ns-command-item" key={command.id}>
            <span className="ns-command-title">{command.title}</span>
            <span className="ns-command-meta">
              <span>{command.defaultShortcut}</span>
              <span className="ns-risk-level">{command.riskLevel}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
