export const APPLICATION_IPC_CHANNELS = [
  "application:get-shell-state",
  "application:list-commands",
  "application:execute-command"
] as const;

export type ApplicationIpcChannel = (typeof APPLICATION_IPC_CHANNELS)[number];

export function isApplicationIpcChannel(channel: string): channel is ApplicationIpcChannel {
  return APPLICATION_IPC_CHANNELS.includes(channel as ApplicationIpcChannel);
}
