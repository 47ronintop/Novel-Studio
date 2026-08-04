import { contextBridge, ipcRenderer } from "electron";

import { TRUSTED_APPROVAL_IPC_CHANNELS } from "@novel-studio/application";

/** This preload is used only by the Main-created approval modal, never by workbench windows. */
contextBridge.exposeInMainWorld("novelStudioApproval", {
  getPreview: (previewId: string) =>
    ipcRenderer.invoke(TRUSTED_APPROVAL_IPC_CHANNELS.getPreview, previewId),
  decide: (decision: unknown) => ipcRenderer.invoke(TRUSTED_APPROVAL_IPC_CHANNELS.decide, decision)
});
