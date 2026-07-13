import { contextBridge, ipcRenderer } from "electron";

import { createNovelStudioApi } from "./api.js";

contextBridge.exposeInMainWorld(
  "novelStudio",
  createNovelStudioApi({
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on(channel, wrapped);
      return () => ipcRenderer.removeListener(channel, wrapped);
    }
  })
);
