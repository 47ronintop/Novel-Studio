import { describe, expect, test, vi } from "vitest";

import type { StoryBibleEditorProps } from "@novel-studio/ui";

import { guardDirtyStoryBibleDraft } from "../src/renderer/story-bible-draft-guard.js";
import type { StoryBibleBridge } from "../src/renderer/story-bible-bridge.js";

describe("Story Bible draft guard", () => {
  test("allows navigation without prompting when the draft is clean", async () => {
    const confirm = vi.fn();
    const update = vi.fn();
    const bridge = createBridge({ current: editor(false, "idle") });

    await expect(guardDirtyStoryBibleDraft(bridge, update, confirm)).resolves.toBe(true);

    expect(confirm).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("saves before navigation when the author chooses save", async () => {
    const saving = editor(true, "saving");
    const saved = editor(false, "saved");
    const bridge = createBridge({ current: editor(true, "idle"), saving, saved });
    const updates: StoryBibleEditorProps[] = [];

    await expect(
      guardDirtyStoryBibleDraft(
        bridge,
        (_bridge, next) => updates.push(next),
        vi.fn(() => true)
      )
    ).resolves.toBe(true);

    expect(updates).toEqual([saving, saved]);
    expect(bridge.beginSave).toHaveBeenCalledOnce();
    expect(bridge.saveDraft).toHaveBeenCalledOnce();
  });

  test("stays in detail when saving fails and preserves the dirty draft", async () => {
    const saving = editor(true, "saving");
    const failed = editor(true, "error");
    const bridge = createBridge({ current: editor(true, "idle"), saving, saved: failed });
    const updates: StoryBibleEditorProps[] = [];

    await expect(
      guardDirtyStoryBibleDraft(
        bridge,
        (_bridge, next) => updates.push(next),
        vi.fn(() => true)
      )
    ).resolves.toBe(false);

    expect(updates).toEqual([saving, failed]);
  });

  test("discards only after the explicit second confirmation", async () => {
    const canceled = editor(false, "idle");
    const bridge = createBridge({ current: editor(true, "idle"), canceled });
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    const updates: StoryBibleEditorProps[] = [];

    await expect(
      guardDirtyStoryBibleDraft(bridge, (_bridge, next) => updates.push(next), confirm)
    ).resolves.toBe(true);

    expect(confirm.mock.calls.map(([message]) => message)).toEqual([
      "当前故事资料尚未保存。是否先保存？",
      "是否放弃当前故事资料的未保存修改？"
    ]);
    expect(updates).toEqual([canceled]);
    expect(bridge.cancelDraft).toHaveBeenCalledOnce();
  });

  test("cancels navigation when save and discard are both declined", async () => {
    const bridge = createBridge({ current: editor(true, "idle") });
    const update = vi.fn();

    await expect(
      guardDirtyStoryBibleDraft(
        bridge,
        update,
        vi.fn(() => false)
      )
    ).resolves.toBe(false);

    expect(update).not.toHaveBeenCalled();
    expect(bridge.cancelDraft).not.toHaveBeenCalled();
  });
});

function editor(dirty: boolean, status: StoryBibleEditorProps["status"]): StoryBibleEditorProps {
  return { dirty, status } as StoryBibleEditorProps;
}

function createBridge({
  current,
  saving = current,
  saved = current,
  canceled = current
}: {
  readonly current: StoryBibleEditorProps;
  readonly saving?: StoryBibleEditorProps;
  readonly saved?: StoryBibleEditorProps;
  readonly canceled?: StoryBibleEditorProps;
}): StoryBibleBridge {
  return {
    getEditorProps: vi.fn(() => current),
    beginSave: vi.fn(() => saving),
    saveDraft: vi.fn(async () => saved),
    cancelDraft: vi.fn(() => canceled)
  } as unknown as StoryBibleBridge;
}
