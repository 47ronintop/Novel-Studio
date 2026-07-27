import type { PlainFileEditorProps } from "@novel-studio/ui";

import type { PlainFileEditorBridge } from "./plain-file-editor-bridge.js";

export type PlainFileEditorUpdate = (
  bridge: PlainFileEditorBridge,
  editor: PlainFileEditorProps | undefined
) => void;

export interface DirtyPlainFileEditor {
  readonly bridge: PlainFileEditorBridge | undefined;
  readonly update: PlainFileEditorUpdate;
}

export type ConfirmDirtyPlainFile = (message: string) => boolean;

export async function guardDirtyPlainFile(
  bridge: PlainFileEditorBridge | undefined,
  update: PlainFileEditorUpdate,
  confirm: ConfirmDirtyPlainFile = confirmDirtyPlainFile
): Promise<boolean> {
  if (bridge === undefined || !bridge.isDirty()) return true;

  if (confirm("当前项目文件尚未保存。是否先保存？")) {
    update(bridge, bridge.beginSave());
    try {
      update(bridge, await bridge.save());
    } catch {
      update(bridge, bridge.getProps());
    }
    return !bridge.isDirty();
  }

  if (confirm("是否放弃当前项目文件的未保存修改？")) {
    update(bridge, bridge.discard());
    return !bridge.isDirty();
  }

  return false;
}

export async function guardDirtyPlainFileEditors(
  editors: readonly DirtyPlainFileEditor[],
  confirm?: ConfirmDirtyPlainFile
): Promise<boolean> {
  const guarded = new Set<PlainFileEditorBridge>();
  for (const { bridge, update } of editors) {
    if (bridge === undefined || guarded.has(bridge)) continue;
    guarded.add(bridge);
    if (!(await guardDirtyPlainFile(bridge, update, confirm))) return false;
  }
  return true;
}

function confirmDirtyPlainFile(message: string): boolean {
  return globalThis.window?.confirm(message) === true;
}
