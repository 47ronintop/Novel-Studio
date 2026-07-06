import type { ApplicationCommand } from "@novel-studio/application";
import { Search } from "lucide-react";

export interface CommandPaletteShortcutEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export interface CommandPaletteProps {
  readonly commands: readonly ApplicationCommand[];
  readonly executionFeedback?: CommandPaletteFeedback | undefined;
  readonly onCommandExecute?: ((commandId: ApplicationCommand["id"]) => void) | undefined;
  readonly onActiveCommandChange?: ((commandId: ApplicationCommand["id"]) => void) | undefined;
  readonly onQueryChange?: ((query: string) => void) | undefined;
  readonly open: boolean;
  readonly query?: string | undefined;
  readonly selectedCommandId?: ApplicationCommand["id"] | undefined;
}

export interface CommandPaletteFeedback {
  readonly kind: "info" | "error";
  readonly message: string;
}

export function isCommandPaletteShortcut(event: CommandPaletteShortcutEvent): boolean {
  return event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey);
}

export function CommandPalette({
  commands,
  executionFeedback,
  onActiveCommandChange,
  onCommandExecute,
  onQueryChange,
  open,
  query,
  selectedCommandId
}: CommandPaletteProps) {
  if (!open) {
    return null;
  }

  const currentQuery = query ?? "";
  const safeCommands = commands.filter((command) => command.riskLevel === "safe");
  const filteredCommands = filterCommands(safeCommands, currentQuery);
  const activeCommandId = selectedCommandId ?? filteredCommands[0]?.id;
  const groupedCommands = groupCommands(filteredCommands);

  return (
    <div className="ns-command-palette" role="dialog" aria-modal="true" aria-label="命令面板">
      <div className="ns-command-search">
        <Search aria-hidden="true" size={16} />
        <input
          aria-label="Search commands"
          onChange={(event) => {
            onQueryChange?.(event.currentTarget.value);
          }}
          onKeyDown={(event) =>
            handleCommandKeyDown({
              activeCommandId,
              commands: filteredCommands,
              event,
              onActiveCommandChange,
              onCommandExecute
            })
          }
          placeholder="搜索命令"
          value={currentQuery}
        />
      </div>
      {executionFeedback === undefined ? null : (
        <p className="ns-command-feedback" data-kind={executionFeedback.kind} role="status">
          {executionFeedback.message}
        </p>
      )}
      {groupedCommands.length === 0 ? (
        <div className="ns-command-empty">没有匹配命令</div>
      ) : (
        <div className="ns-command-groups" aria-label="可用命令">
          {groupedCommands.map((group) => (
            <section
              className="ns-command-group"
              data-command-group={group.scope}
              key={group.scope}
            >
              <h2>{scopeLabel(group.scope)}</h2>
              <ul className="ns-command-list">
                {group.commands.map((command) => (
                  <li className="ns-command-item" key={command.id}>
                    <button
                      aria-label={`Execute command: ${command.title}`}
                      className="ns-command-action"
                      data-active={command.id === activeCommandId}
                      disabled={command.disabledReason !== undefined}
                      onClick={() => {
                        if (command.disabledReason === undefined) {
                          onCommandExecute?.(command.id);
                        }
                      }}
                      type="button"
                    >
                      <span className="ns-command-title">{command.title}</span>
                      <span className="ns-command-meta">
                        <span>{command.defaultShortcut}</span>
                        <span className="ns-risk-level">{riskLevelLabel(command.riskLevel)}</span>
                      </span>
                      {command.disabledReason === undefined ? null : (
                        <span className="ns-command-disabled-reason">{command.disabledReason}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

interface CommandGroup {
  readonly scope: ApplicationCommand["scope"];
  readonly commands: readonly ApplicationCommand[];
}

function filterCommands(
  commands: readonly ApplicationCommand[],
  query: string
): readonly ApplicationCommand[] {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length === 0) {
    return commands;
  }

  return commands.filter((command) =>
    [
      command.id,
      command.title,
      command.scope,
      command.defaultShortcut,
      command.disabledReason ?? ""
    ].some((value) => normalize(value).includes(normalizedQuery))
  );
}

function groupCommands(commands: readonly ApplicationCommand[]): readonly CommandGroup[] {
  const scopes = [...new Set(commands.map((command) => command.scope))];
  return scopes.map((scope) => ({
    scope,
    commands: commands.filter((command) => command.scope === scope)
  }));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function handleCommandKeyDown({
  activeCommandId,
  commands,
  event,
  onActiveCommandChange,
  onCommandExecute
}: {
  readonly activeCommandId: ApplicationCommand["id"] | undefined;
  readonly commands: readonly ApplicationCommand[];
  readonly event: {
    readonly key: string;
    preventDefault(): void;
  };
  readonly onActiveCommandChange: CommandPaletteProps["onActiveCommandChange"];
  readonly onCommandExecute: CommandPaletteProps["onCommandExecute"];
}): void {
  if (commands.length === 0) {
    return;
  }

  const currentIndex = Math.max(
    0,
    commands.findIndex((command) => command.id === activeCommandId)
  );

  if (event.key === "ArrowDown") {
    event.preventDefault();
    const nextCommand = commands[(currentIndex + 1) % commands.length];
    if (nextCommand !== undefined) {
      onActiveCommandChange?.(nextCommand.id);
    }
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    const previousCommand = commands[(currentIndex - 1 + commands.length) % commands.length];
    if (previousCommand !== undefined) {
      onActiveCommandChange?.(previousCommand.id);
    }
    return;
  }

  if (event.key === "Enter" && activeCommandId !== undefined) {
    event.preventDefault();
    const activeCommand = commands.find((command) => command.id === activeCommandId);
    if (activeCommand?.disabledReason === undefined) {
      onCommandExecute?.(activeCommandId);
    }
  }
}

function scopeLabel(scope: ApplicationCommand["scope"]): string {
  switch (scope) {
    case "workspace":
      return "Workspace";
    case "plugin":
      return "Plugin";
  }
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
