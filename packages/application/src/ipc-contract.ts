export const APPLICATION_IPC_CHANNELS = [
  "application:get-shell-state",
  "application:list-commands",
  "application:execute-command",
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
  "application:studio:load-config-asset",
  "application:studio:save-config-asset",
  "application:studio:restore-config-version"
] as const;

export type ApplicationIpcChannel = (typeof APPLICATION_IPC_CHANNELS)[number];

export function isApplicationIpcChannel(channel: string): channel is ApplicationIpcChannel {
  return APPLICATION_IPC_CHANNELS.includes(channel as ApplicationIpcChannel);
}
