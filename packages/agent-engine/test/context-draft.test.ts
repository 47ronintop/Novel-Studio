import { describe, expect, test } from "vitest";

import {
  applyContextDraftMutation,
  createContextDraft,
  normalizeContextDraft,
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

function baseDraft(
  overrides: Partial<Parameters<typeof createContextDraft>[0]> = {}
): ContextDraft {
  return createContextDraft({
    contextDraftId: "context_draft_01",
    conversationId: "conv_01",
    scope: { kind: "workspace", workspaceKind: "creativeProject", workspaceId: "project_01" },
    contextMode: "writing",
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...overrides
  });
}

describe("Context Draft value object", () => {
  test("creates revision 1 with a checksum and no refs by default", () => {
    const draft = baseDraft();
    expect(draft.schemaVersion).toBe("1.2");
    expect(draft.revision).toBe(1);
    expect(draft.refs).toEqual([]);
    expect(draft.activeResourceRef).toBeNull();
    expect(draft.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(draft)).toBe(true);
  });

  test("add_ref produces one next revision with a changed checksum", () => {
    const draft = baseDraft();
    const result = applyContextDraftMutation(
      draft,
      { kind: "add_ref", ref: chapterRef },
      "2026-07-16T00:01:00.000Z"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.revision).toBe(2);
    expect(result.value.refs).toEqual([chapterRef]);
    expect(result.value.checksum).not.toBe(draft.checksum);
  });

  test("rejects a duplicate ref", () => {
    const draft = baseDraft({ refs: [chapterRef] });
    const result = applyContextDraftMutation(
      draft,
      { kind: "add_ref", ref: chapterRef },
      "2026-07-16T00:01:00.000Z"
    );
    expect(result).toMatchObject({ ok: false, error: { code: "CONTEXT_DRAFT_REF_DUPLICATE" } });
  });

  test("rejects chapter and Story Bible refs in general-file mode", () => {
    const draft = baseDraft({ contextMode: "general_file" });
    expect(
      applyContextDraftMutation(
        draft,
        { kind: "add_ref", ref: chapterRef },
        "2026-07-16T00:01:00.000Z"
      )
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
        ref: {
          kind: "project_file",
          refId: "pf:escape",
          relativePath: "../secrets.md",
          label: "外部"
        }
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
        ref: {
          kind: "project_file",
          refId: "pf:notes",
          relativePath: "notes/outline.md",
          label: "大纲"
        }
      },
      "2026-07-16T00:01:00.000Z"
    );
    expect(result.ok).toBe(true);
  });

  test("tracks an active project-file checksum without requiring it for manual refs", () => {
    const manualRef: ContextDraftRef = {
      kind: "project_file",
      refId: "pf:research",
      relativePath: "notes/research.md",
      label: "研究笔记"
    };
    const draft = baseDraft({ contextMode: "general_file", refs: [manualRef] });
    const active = {
      kind: "project_file" as const,
      refId: "pf:current",
      relativePath: "notes/current.md",
      label: "当前文件",
      expectedChecksum: "a".repeat(64)
    };
    const first = applyContextDraftMutation(
      draft,
      { kind: "set_active_resource", ref: active },
      "2026-07-16T00:01:00.000Z"
    );
    expect(first).toMatchObject({
      ok: true,
      value: { refs: [manualRef], activeResourceRef: active }
    });
    if (!first.ok) return;

    const updated = applyContextDraftMutation(
      first.value,
      {
        kind: "set_active_resource",
        ref: { ...active, expectedChecksum: "b".repeat(64) }
      },
      "2026-07-16T00:02:00.000Z"
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.checksum).not.toBe(first.value.checksum);
    expect(updated.value.activeResourceRef).toMatchObject({
      kind: "project_file",
      expectedChecksum: "b".repeat(64)
    });
  });

  test("binds one active Story Bible resource in writing mode", () => {
    const active = {
      kind: "story_bible" as const,
      refId: "story_bible:chr_hero",
      assetId: "chr_hero",
      label: "主角"
    };
    const result = applyContextDraftMutation(
      baseDraft({ refs: [chapterRef] }),
      { kind: "set_active_resource", ref: active },
      "2026-07-16T00:01:00.000Z"
    );

    expect(result).toMatchObject({
      ok: true,
      value: { refs: [chapterRef], activeResourceRef: active }
    });
  });

  test("rejects active resources that do not match the context mode", () => {
    expect(
      applyContextDraftMutation(
        baseDraft(),
        {
          kind: "set_active_resource",
          ref: {
            kind: "project_file",
            refId: "file:notes/current.md",
            relativePath: "notes/current.md",
            label: "当前文件"
          }
        },
        "2026-07-16T00:01:00.000Z"
      )
    ).toMatchObject({ ok: false, error: { code: "CONTEXT_DRAFT_ACTIVE_RESOURCE_MODE_INVALID" } });
    expect(
      applyContextDraftMutation(
        baseDraft({ contextMode: "general_file" }),
        {
          kind: "set_active_resource",
          ref: {
            kind: "story_bible",
            refId: "story_bible:chr_hero",
            assetId: "chr_hero",
            label: "主角"
          }
        },
        "2026-07-16T00:01:00.000Z"
      )
    ).toMatchObject({ ok: false, error: { code: "CONTEXT_DRAFT_REF_MODE_INVALID" } });
  });

  test("rejects a malformed expected checksum on a project-file ref", () => {
    const draft = baseDraft({ contextMode: "general_file" });
    const result = applyContextDraftMutation(
      draft,
      {
        kind: "set_active_resource",
        ref: {
          kind: "project_file",
          refId: "pf:current",
          relativePath: "notes/current.md",
          label: "当前文件",
          expectedChecksum: "not-a-sha256"
        }
      },
      "2026-07-16T00:01:00.000Z"
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "CONTEXT_DRAFT_REF_CHECKSUM_INVALID" }
    });
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
    const withFirst = applyContextDraftMutation(
      baseDraft(),
      { kind: "set_selection", ref: first },
      "t1"
    );
    expect(withFirst.ok).toBe(true);
    if (!withFirst.ok) return;
    const withSecond = applyContextDraftMutation(
      withFirst.value,
      { kind: "set_selection", ref: second },
      "t2"
    );
    expect(withSecond.ok).toBe(true);
    if (!withSecond.ok) return;
    expect(withSecond.value.refs.filter((ref) => ref.kind === "editor_selection")).toEqual([
      second
    ]);
    const cleared = applyContextDraftMutation(
      withSecond.value,
      { kind: "set_selection", ref: null },
      "t3"
    );
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.value.refs.some((ref) => ref.kind === "editor_selection")).toBe(false);
  });

  test("remove_ref drops the ref and refresh bumps the revision without changing refs", () => {
    const draft = baseDraft({ refs: [chapterRef] });
    const removed = applyContextDraftMutation(
      draft,
      { kind: "remove_ref", refId: "chapter:ch_01" },
      "t1"
    );
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.refs).toEqual([]);

    const refreshed = refreshContextDraft(draft, "t2");
    expect(refreshed.revision).toBe(draft.revision + 1);
    expect(refreshed.refs).toEqual(draft.refs);
    expect(structuredClone(refreshed)).toEqual(refreshed);
  });

  test("pins, excludes, reprioritizes, and restores one source with checksum-bound revisions", () => {
    const draft = baseDraft({ refs: [chapterRef] });
    const pinned = applyContextDraftMutation(
      draft,
      {
        kind: "set_source_override",
        refId: chapterRef.refId,
        decision: "pinned",
        priority: 90
      },
      "t1"
    );
    expect(pinned).toMatchObject({
      ok: true,
      value: {
        revision: draft.revision + 1,
        sourceOverrides: [{ refId: chapterRef.refId, decision: "pinned", priority: 90 }]
      }
    });
    if (!pinned.ok) return;
    expect(pinned.value.checksum).not.toBe(draft.checksum);

    const excluded = applyContextDraftMutation(
      pinned.value,
      {
        kind: "set_source_override",
        refId: chapterRef.refId,
        decision: "excluded",
        priority: 30
      },
      "t2"
    );
    expect(excluded).toMatchObject({
      ok: true,
      value: {
        sourceOverrides: [{ refId: chapterRef.refId, decision: "excluded", priority: 30 }]
      }
    });
    if (!excluded.ok) return;

    const automatic = applyContextDraftMutation(
      excluded.value,
      { kind: "set_source_override", refId: chapterRef.refId, decision: "automatic" },
      "t3"
    );
    expect(automatic).toMatchObject({
      ok: true,
      value: {
        sourceOverrides: [{ refId: chapterRef.refId, decision: "automatic" }]
      }
    });
    if (!automatic.ok) return;

    const restored = applyContextDraftMutation(
      automatic.value,
      { kind: "set_source_override", refId: chapterRef.refId, decision: null },
      "t4"
    );
    expect(restored).toMatchObject({ ok: true, value: { sourceOverrides: [] } });
  });

  test("rejects malformed source overrides and upgrades legacy drafts with no overrides", () => {
    expect(
      applyContextDraftMutation(
        baseDraft(),
        JSON.parse('{"kind":"set_source_override","refId":"chapter:ch_01","decision":"pinned"}'),
        "t1"
      )
    ).toMatchObject({ ok: false, error: { code: "CONTEXT_DRAFT_SOURCE_PRIORITY_INVALID" } });
    expect(
      applyContextDraftMutation(
        baseDraft(),
        {
          kind: "set_source_override",
          refId: "chapter:ch_01",
          decision: "pinned",
          priority: 101
        },
        "t1"
      )
    ).toMatchObject({ ok: false, error: { code: "CONTEXT_DRAFT_SOURCE_PRIORITY_INVALID" } });
    expect(
      applyContextDraftMutation(
        baseDraft(),
        JSON.parse(
          '{"kind":"set_source_override","refId":"chapter:ch_01","decision":"automatic","priority":50}'
        ),
        "t1"
      )
    ).toMatchObject({ ok: false, error: { code: "CONTEXT_DRAFT_SOURCE_PRIORITY_INVALID" } });

    expect(() =>
      normalizeContextDraft({
        ...baseDraft(),
        sourceOverrides: [{ refId: "chapter:ch_01", decision: "automatic", priority: 50 }]
      })
    ).toThrow("CONTEXT_DRAFT_SOURCE_OVERRIDE_INVALID");
    expect(
      normalizeContextDraft({
        ...baseDraft(),
        sourceOverrides: [{ refId: "chapter:ch_01", decision: "automatic" }]
      }).sourceOverrides
    ).toEqual([{ refId: "chapter:ch_01", decision: "automatic" }]);

    const v11 = baseDraft() as unknown as Record<string, unknown>;
    const normalized = normalizeContextDraft({
      ...v11,
      schemaVersion: "1.1",
      activeResourceRef: null,
      sourceOverrides: undefined
    });
    expect(normalized).toMatchObject({ schemaVersion: "1.2", sourceOverrides: [] });
  });
});
