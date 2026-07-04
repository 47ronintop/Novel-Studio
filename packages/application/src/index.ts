export type {
  ApplicationCommand,
  ApplicationCommandId,
  ApplicationCommandScope,
  CommandRiskLevel
} from "./command-registry.js";
export {
  DEFAULT_APPLICATION_COMMANDS,
  findApplicationCommand,
  isSafeCommand
} from "./command-registry.js";
export type { ApplicationIpcChannel } from "./ipc-contract.js";
export { APPLICATION_IPC_CHANNELS, isApplicationIpcChannel } from "./ipc-contract.js";
export type {
  ActivityId,
  DesktopApplication,
  DesktopShellState,
  NavigatorSection,
  SaveStatus
} from "./desktop-application.js";
export { createDesktopApplication } from "./desktop-application.js";
