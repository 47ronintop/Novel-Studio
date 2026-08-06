import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";

import {
  createWritingEditorStateRegistry,
  EDITOR_STATE_UNKNOWN,
  TARGET_DIRTY,
  type WritingEditorResourceIdentity,
  type WritingEditorStateReport
} from "../src/main/writing-editor-state-registry.js";

describe("writing editor state registry", () => {
  test("keeps chapter and Story Bible editor identity and acknowledged state separate", () => {
    const registry = createWritingEditorStateRegistry();
    const chapter = report({ resourceKind: "chapter", resourceId: "ch_1" });
    const storyBible = report({ resourceKind: "story_bible", resourceId: "character:hero" });

    expect(registry.report(chapter)).toEqual({ ok: true, state: chapter });
    expect(registry.report(storyBible)).toEqual({ ok: true, state: storyBible });
    expect(registry.readInstance(chapter)).toEqual(chapter);
    expect(registry.readInstance(storyBible)).toEqual(storyBible);
    expect(registry.observe(chapter)).toEqual({
      status: "connected",
      target: target(chapter),
      state: chapter
    });
  });

  test("requires acknowledgement to catch up before returning a stable dirty decision", () => {
    const registry = createWritingEditorStateRegistry();
    const identity = target();

    expect(registry.report(report({ rendererRevision: 1, acknowledgedRevision: 1 }))).toMatchObject(
      {
        ok: true
      }
    );
    expect(
      registry.report(
        report({
          rendererRevision: 2,
          acknowledgedRevision: 1,
          dirty: true,
          buffer: "dirty buffer"
        })
      )
    ).toMatchObject({ ok: true });
    expect(registry.observe(identity)).toMatchObject({ status: "unknown", reason: "ack_pending" });
    expect(registry.decideMutation([identity])).toEqual({
      ok: false,
      code: EDITOR_STATE_UNKNOWN,
      targets: [identity]
    });

    expect(
      registry.report(
        report({
          rendererRevision: 2,
          acknowledgedRevision: 2,
          dirty: true,
          buffer: "dirty buffer"
        })
      )
    ).toMatchObject({ ok: true });
    expect(registry.decideMutation([identity])).toMatchObject({
      ok: false,
      code: TARGET_DIRTY,
      targets: [identity],
      states: [{ rendererRevision: 2, acknowledgedRevision: 2, dirty: true }]
    });

    expect(
      registry.report(
        report({ rendererRevision: 3, acknowledgedRevision: 3, buffer: "saved buffer" })
      )
    ).toMatchObject({ ok: true });
    expect(registry.decideMutation([identity])).toMatchObject({
      ok: true,
      code: "READY",
      states: [{ rendererRevision: 3, acknowledgedRevision: 3, dirty: false }]
    });
  });

  test("rejects stale revisions, regressing acknowledgements, and revision reuse", () => {
    const registry = createWritingEditorStateRegistry();
    const current = report({ rendererRevision: 5, acknowledgedRevision: 4, buffer: "current" });
    expect(registry.report(current)).toMatchObject({ ok: true });

    expect(
      registry.report(report({ rendererRevision: 4, acknowledgedRevision: 4, buffer: "old" }))
    ).toMatchObject({ ok: false, error: { code: "EDITOR_STATE_STALE_UPDATE" } });
    expect(
      registry.report(report({ rendererRevision: 6, acknowledgedRevision: 3, buffer: "next" }))
    ).toMatchObject({ ok: false, error: { code: "EDITOR_STATE_STALE_UPDATE" } });
    expect(
      registry.report(report({ rendererRevision: 5, acknowledgedRevision: 5, buffer: "rewritten" }))
    ).toMatchObject({ ok: false, error: { code: "EDITOR_STATE_STALE_UPDATE" } });
    expect(registry.readInstance(current)).toEqual(current);
  });

  test("rejects malformed reports without recording them", () => {
    const registry = createWritingEditorStateRegistry();

    expect(
      registry.report(
        report({ rendererRevision: 1, acknowledgedRevision: 2, bufferChecksum: "not-a-checksum" })
      )
    ).toMatchObject({ ok: false, error: { code: "EDITOR_STATE_UPDATE_INVALID" } });
    expect(registry.readInstance(report())).toBeUndefined();
  });

  test("treats missing, disconnected, explicitly unknown, and ambiguous instances as unknown", () => {
    const cases = [
      { report: undefined, reason: "missing" },
      { report: report({ connection: "disconnected" }), reason: undefined },
      { report: report({ connection: "unknown" }), reason: "reported_unknown" }
    ] as const;

    for (const candidate of cases) {
      const registry = createWritingEditorStateRegistry();
      if (candidate.report !== undefined) registry.report(candidate.report);
      const observation = registry.observe(target());
      expect(observation.status).toBe(candidate.report?.connection ?? "unknown");
      if (candidate.reason !== undefined)
        expect(observation).toMatchObject({ reason: candidate.reason });
      expect(registry.decideMutation([target()])).toMatchObject({
        ok: false,
        code: EDITOR_STATE_UNKNOWN
      });
    }

    const registry = createWritingEditorStateRegistry();
    registry.report(report({ editorInstanceId: "editor_a" }));
    registry.report(report({ editorInstanceId: "editor_b" }));
    expect(registry.observe(target())).toMatchObject({
      status: "unknown",
      reason: "multiple_connected"
    });
  });

  test("uses a new editor instance after disconnect and rejects reconnecting the old instance", () => {
    const registry = createWritingEditorStateRegistry();
    registry.report(report());
    registry.report(
      report({ connection: "disconnected", rendererRevision: 2, acknowledgedRevision: 2 })
    );

    expect(
      registry.report(report({ rendererRevision: 3, acknowledgedRevision: 3, buffer: "reopened" }))
    ).toMatchObject({ ok: false, error: { code: "EDITOR_STATE_STALE_UPDATE" } });

    const replacement = report({
      editorInstanceId: "editor_2",
      rendererRevision: 1,
      acknowledgedRevision: 1,
      buffer: "reopened"
    });
    expect(registry.report(replacement)).toMatchObject({ ok: true });
    expect(registry.observe(target())).toEqual({
      status: "connected",
      target: target(),
      state: replacement
    });
  });

  test("prioritizes unknown dependencies over known dirty targets", () => {
    const registry = createWritingEditorStateRegistry();
    const dirtyChapter = target({ resourceId: "ch_dirty" });
    const unknownStoryBible = target({
      resourceKind: "story_bible",
      resourceId: "outline:main"
    });
    registry.report(report({ resourceId: "ch_dirty", dirty: true, buffer: "unsaved chapter" }));

    expect(registry.decideMutation([dirtyChapter, unknownStoryBible])).toEqual({
      ok: false,
      code: EDITOR_STATE_UNKNOWN,
      targets: [unknownStoryBible]
    });
  });

  test("clears workspace-owned state without affecting another workspace", () => {
    const registry = createWritingEditorStateRegistry();
    const first = report({ workspaceId: "ws_1" });
    const second = report({ workspaceId: "ws_2" });
    registry.report(first);
    registry.report(second);

    registry.clearWorkspace("ws_1");

    expect(registry.readInstance(first)).toBeUndefined();
    expect(registry.readInstance(second)).toEqual(second);
  });
});

function target(
  overrides: Partial<WritingEditorResourceIdentity> = {}
): WritingEditorResourceIdentity {
  return {
    workspaceId: overrides.workspaceId ?? "ws_1",
    resourceKind: overrides.resourceKind ?? "chapter",
    resourceId: overrides.resourceId ?? "ch_1"
  };
}

function report(
  overrides: Partial<WritingEditorStateReport> & { readonly buffer?: string } = {}
): WritingEditorStateReport {
  const { buffer = "saved buffer", ...reportOverrides } = overrides;
  return {
    ...target(),
    editorInstanceId: "editor_1",
    connection: "connected",
    rendererRevision: 1,
    acknowledgedRevision: 1,
    dirty: false,
    bufferChecksum: checksum(buffer),
    ...reportOverrides
  };
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
