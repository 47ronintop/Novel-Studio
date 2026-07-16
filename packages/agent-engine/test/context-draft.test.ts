import { describe, expect, test } from "vitest";

import {
  applyContextDraftMutation,
  createContextDraft,
  refreshContextDraft,
  type ContextDraft,
  type ContextDraftRef
} from "../src/index.js";

const chapterRef: ContextDraftRef = {
  kind: "chapter",
  refId: "chapter:ch_01",
  chapterId: "ch_01",
  label: "第 1 章"
};

function baseDraft(overrides: Partial<Parameters<typeof createContextDraft>[0]> = {}): ContextDraft {
  return createContextDraft({
    contextDraftId: "context_draft_01",
    conversationId: "conv_01",
    projectId: "project_01",
    contextMode: "writing",
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...overrides
  });
}

describe("Context Draft value object", () => {
  test("creates revision 1 with a checksum and no refs by default", () => {
    const draft = baseDraft();
    expect(draft.schemaVersion).toBe("1.0");
    expect(draft.revision).toBe(1);
    expect(draft.refs).toEqual([]);
    expect(draft.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(draft)).toBe(true);
  });

  test("add_ref produces one next revision with a changed checksum", () => {
    const draft = baseDraft();
    const result = applyContextDraftMutation(draft, { kind: "add_ref", ref: chapterRef }, "2026-07-16T00:01:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.revision).toBe(2);
    expect(result.value.refs).toEqual([chapterRef]);
    expect(result.value.checksum).not.toBe(draft.checksum);
  });

  test("rejects a duplicate ref", () => {
    const draft = baseDraft({ refs: [chapterRef] });
    const result = applyContextDraftMutation(draft, { kind: "add_ref", ref: chapterRef }, "2026-07-16T00:01:00.000Z");
    expect(result).toMatchObject({ ok: false, error: { code: "CONTEXT_DRAFT_REF_DUPLICATE" } });
  });

  test("rejects chapter and Story Bible refs in general-file mode", () => {
    const draft = baseDraft({ contextMode: "general_file" });
    expect(
      applyContextDraftMutation(draft, { kind: "add_ref", ref: chapterRef }, "2026-07-16T00:01:00.000Z")
    ).toMatchObject({ ok: false, error: { code: "CONTEXT_DRAFT_REF_MODE_INVALID" } });
    expect(
      applyContextDraftMutation(
        draft,
        {
          kind: "add_ref",
          ref: { kind: "story_bible", refId: "sb:hero", assetId: "hero", label: "主角" }
        },
        "2026-07-16T00:01:00.000Z"
      )
    ).toMatchObject({ ok: false, error: { code: "CONTEXT_DRAFT_REF_MODE_INVALID" } });
  });

  test("rejects a project_file ref that fails the path guard", () => {
    const draft = baseDraft({ contextMode: "general_file" });
    const result = applyContextDraftMutation(
      draft,
      {
        kind: "add_ref",
        ref: { kind: "project_file", refId: "pf:escape", relativePath: "../secrets.md", label: "外部" }
      },
      "2026-07-16T00:01:00.000Z"
    );
    expect(result).toMatchObject({ ok: false, error: { code: "AGENT_PATH_REJECTED" } });
  });

  test("accepts a valid project_file ref in general-file mode", () => {
    const draft = baseDraft({ contextMode: "general_file" });
    const result = applyContextDraftMutation(
      draft,
      {
        kind: "add_ref",
        ref: { kind: "project_file", refId: "pf:notes", relativePath: "notes/outline.md", label: "大纲" }
      },
      "2026-07-16T00:01:00.000Z"
    );
    expect(result.ok).toBe(true);
  });

  test("set_selection replaces the prior editor selection and clears it with null", () => {
    const first = {
      kind: "editor_selection" as const,
      refId: "sel:1",
      editorRevision: 4,
      label: "选区",
      range: { start: 0, end: 10 }
    };
    const second = { ...first, refId: "sel:2", editorRevision: 5, range: { start: 5, end: 20 } };
    const withFirst = applyContextDraftMutation(baseDraft(), { kind: "set_selection", ref: first }, "t1");
    expect(withFirst.ok).toBe(true);
    if (!withFirst.ok) return;
    const withSecond = applyContextDraftMutation(withFirst.value, { kind: "set_selection", ref: second }, "t2");
    expect(withSecond.ok).toBe(true);
    if (!withSecond.ok) return;
    expect(withSecond.value.refs.filter((ref) => ref.kind === "editor_selection")).toEqual([second]);
    const cleared = applyContextDraftMutation(withSecond.value, { kind: "set_selection", ref: null }, "t3");
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.value.refs.some((ref) => ref.kind === "editor_selection")).toBe(false);
  });

  test("remove_ref drops the ref and refresh bumps the revision without changing refs", () => {
    const draft = baseDraft({ refs: [chapterRef] });
    const removed = applyContextDraftMutation(draft, { kind: "remove_ref", refId: "chapter:ch_01" }, "t1");
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.refs).toEqual([]);

    const refreshed = refreshContextDraft(draft, "t2");
    expect(refreshed.revision).toBe(draft.revision + 1);
    expect(refreshed.refs).toEqual(draft.refs);
    expect(structuredClone(refreshed)).toEqual(refreshed);
  });
});
