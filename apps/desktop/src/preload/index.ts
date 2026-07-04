import { contextBridge, ipcRenderer } from "electron";

import { createNovelStudioApi } from "./api.js";

contextBridge.exposeInMainWorld("novelStudio", createNovelStudioApi(ipcRenderer));
