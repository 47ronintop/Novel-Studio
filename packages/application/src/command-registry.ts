export type ApplicationCommandId =
  | "workspace.open-command-palette"
  | "workspace.toggle-navigator"
  | "workspace.toggle-inspector"
  | "workspace.toggle-bottom-panel";

export type ApplicationCommandScope = "workspace";

export type CommandRiskLevel = "safe" | "confirmation-required" | "destructive";

export interface ApplicationCommand {
  readonly id: ApplicationCommandId;
  readonly title: string;
  readonly scope: ApplicationCommandScope;
  readonly riskLevel: CommandRiskLevel;
  readonly defaultShortcut: string;
}

export const DEFAULT_APPLICATION_COMMANDS: readonly ApplicationCommand[] = [
  {
    id: "workspace.open-command-palette",
    title: "打开命令面板",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+K"
  },
  {
    id: "workspace.toggle-navigator",
    title: "切换项目导航",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+B"
  },
  {
    id: "workspace.toggle-inspector",
    title: "切换检查器",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Shift+I"
  },
  {
    id: "workspace.toggle-bottom-panel",
    title: "切换底部面板",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+J"
  }
];

export function isSafeCommand(command: ApplicationCommand): boolean {
  return command.riskLevel === "safe";
}

export function findApplicationCommand(commandId: string): ApplicationCommand | undefined {
  return DEFAULT_APPLICATION_COMMANDS.find((command) => command.id === commandId);
}
