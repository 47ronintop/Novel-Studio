export const APPLICATION_IPC_CHANNELS = [
  "application:get-shell-state",
  "application:list-commands",
  "application:execute-command",
  "application:project:choose-open-directory",
  "application:project:choose-create-directory",
  "application:project:open",
  "application:project:create",
  "application:project:list-chapters",
  "application:project:create-chapter",
  "application:project:select-chapter",
  "application:project:preview-recovery-draft",
  "application:project:apply-recovery-draft",
  "application:project:discard-recovery-draft",
  "application:search:rebuild-index",
  "application:search:query",
  "application:ai:generate-chapter-suggestion",
  "application:ai:generate-selection-preview",
  "application:ai:apply-chapter-suggestion",
  "application:ai:list-workflow-runs",
  "application:ai:read-workflow-run",
  "application:chapter:load",
  "application:chapter:edit",
  "application:chapter:save",
  "application:chapter:list-versions",
  "application:chapter:preview-version",
  "application:chapter:restore-version",
  "application:chapter:preview-suggestion-diff",
  "application:settings:list-model-profiles",
  "application:settings:save-model-profile",
  "application:settings:test-model-profile",
  "application:plugins:load-registry",
  "application:plugins:set-enabled",
  "application:story-bible:load",
  "application:story-bible:save-asset",
  "application:story-bible:save-memory",
  "application:story-bible:build-context-candidates",
  "application:studio:load-config-asset",
  "application:studio:save-config-asset",
  "application:studio:restore-config-version",
  "application:preferences:load",
  "application:preferences:save"
] as const;

export type ApplicationIpcChannel = (typeof APPLICATION_IPC_CHANNELS)[number];

export function isApplicationIpcChannel(channel: string): channel is ApplicationIpcChannel {
  return APPLICATION_IPC_CHANNELS.includes(channel as ApplicationIpcChannel);
}
