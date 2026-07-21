export type WorkspaceApplicationCommandId =
  | "workspace.open-command-palette"
  | "workspace.toggle-navigator"
  | "workspace.toggle-inspector"
  | "workspace.toggle-bottom-panel"
  | "workspace.toggle-split-view"
  | "workspace.toggle-focus-mode"
  | "workspace.narrow-navigator"
  | "workspace.widen-navigator"
  | "workspace.narrow-inspector"
  | "workspace.widen-inspector";

export type ApplicationCommandId = string;

export type NativeMenuCommandId =
  | "createCreativeProject"
  | "openCreativeProject"
  | "openEngineeringFolder";

export type ApplicationCommandScope = "workspace" | "plugin";

export type CommandRiskLevel = "safe" | "confirmation-required" | "destructive";

export interface ApplicationCommand {
  readonly id: ApplicationCommandId;
  readonly title: string;
  readonly scope: ApplicationCommandScope;
  readonly riskLevel: CommandRiskLevel;
  readonly defaultShortcut: string;
  readonly disabledReason?: string;
  readonly source?: {
    readonly kind: "plugin";
    readonly pluginId: string;
    readonly contributionId: string;
  };
}

export const DEFAULT_APPLICATION_COMMANDS: readonly (ApplicationCommand & {
  readonly id: WorkspaceApplicationCommandId;
})[] = [
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
  },
  {
    id: "workspace.toggle-split-view",
    title: "切换拆分视图",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+\\"
  },
  {
    id: "workspace.toggle-focus-mode",
    title: "切换专注模式",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Shift+F"
  },
  {
    id: "workspace.narrow-navigator",
    title: "收窄项目导航",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Alt+["
  },
  {
    id: "workspace.widen-navigator",
    title: "加宽项目导航",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Alt+]"
  },
  {
    id: "workspace.narrow-inspector",
    title: "收窄检查器",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Alt+Shift+["
  },
  {
    id: "workspace.widen-inspector",
    title: "加宽检查器",
    scope: "workspace",
    riskLevel: "safe",
    defaultShortcut: "Ctrl/Cmd+Alt+Shift+]"
  }
];

export function isSafeCommand(command: ApplicationCommand): boolean {
  return command.riskLevel === "safe";
}

export function findApplicationCommand(commandId: string): ApplicationCommand | undefined {
  return DEFAULT_APPLICATION_COMMANDS.find((command) => command.id === commandId);
}
