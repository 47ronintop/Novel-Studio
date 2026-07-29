import type { StoryBibleEditorProps } from "@novel-studio/ui";

import type { StoryBibleBridge } from "./story-bible-bridge.js";

export type StoryBibleEditorUpdate = (
  bridge: StoryBibleBridge,
  editor: StoryBibleEditorProps
) => void;

export type ConfirmDirtyStoryBibleDraft = (message: string) => boolean;

export async function guardDirtyStoryBibleDraft(
  bridge: StoryBibleBridge | undefined,
  update: StoryBibleEditorUpdate,
  confirm: ConfirmDirtyStoryBibleDraft = confirmDirtyStoryBibleDraft
): Promise<boolean> {
  if (bridge === undefined || !bridge.getEditorProps().dirty) return true;

  if (confirm("当前故事资料尚未保存。是否先保存？")) {
    update(bridge, bridge.beginSave());
    try {
      const saved = await bridge.saveDraft();
      update(bridge, saved);
      return !saved.dirty;
    } catch {
      update(bridge, bridge.getEditorProps());
      return false;
    }
  }

  if (confirm("是否放弃当前故事资料的未保存修改？")) {
    update(bridge, bridge.cancelDraft());
    return true;
  }

  return false;
}

function confirmDirtyStoryBibleDraft(message: string): boolean {
  return globalThis.window?.confirm(message) === true;
}
