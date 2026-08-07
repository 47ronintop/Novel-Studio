import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";

import {
  createEngineeringEditorStateRegistry,
  ENGINEERING_EDITOR_STATE_UNKNOWN,
  ENGINEERING_EDITOR_TARGET_DIRTY,
  MAX_ENGINEERING_EDITOR_BUFFER_BYTES,
  type EngineeringEditorResourceIdentity,
  type EngineeringEditorStateReport
} from "../src/main/engineering-editor-state-registry.js";

describe("engineering editor state registry", () => {
  test("keys state by native root binding, canonical relative identity, and editor instance", () => {
    const registry = createEngineeringEditorStateRegistry();
    const first = report();
    const samePathAtAnotherRoot = report({ rootBindingId: "root_2", editorInstanceId: "editor_2" });

    expect(registry.report(first)).toEqual({ ok: true, state: first });
    expect(registry.report(samePathAtAnotherRoot)).toEqual({
      ok: true,
      state: samePathAtAnotherRoot
    });
    expect(registry.readInstance(first)).toEqual(first);
    expect(registry.readInstance(samePathAtAnotherRoot)).toEqual(samePathAtAnotherRoot);
    expect(Object.isFrozen(registry.readInstance(first))).toBe(true);
  });

  test("requires an acknowledged live renderer for mutation and blocks dirty targets", () => {
    const registry = createEngineeringEditorStateRegistry();
    const identity = target();

    expect(registry.decideMutation([identity])).toEqual({
      ok: false,
      code: ENGINEERING_EDITOR_STATE_UNKNOWN,
      targets: [identity]
    });
    registry.report(
      report({ rendererRevision: 2, acknowledgedRevision: 1, dirty: true, buffer: "draft" })
    );
    expect(registry.readForMutation(identity)).toEqual({ status: "unknown", dirty: false });

    registry.report(
      report({ rendererRevision: 2, acknowledgedRevision: 2, dirty: true, buffer: "draft" })
    );
    expect(registry.decideMutation([identity])).toMatchObject({
      ok: false,
      code: ENGINEERING_EDITOR_TARGET_DIRTY,
      targets: [identity],
      states: [{ rendererRevision: 2, acknowledgedRevision: 2, dirty: true }]
    });
    expect(registry.readForMutation(identity)).toEqual({
      status: "known",
      dirty: true,
      rendererRevision: 2
    });

    registry.report(report({ rendererRevision: 3, acknowledgedRevision: 3, buffer: "saved" }));
    expect(registry.decideMutation([identity])).toMatchObject({
      ok: true,
      code: "READY",
      states: [{ dirty: false, rendererRevision: 3 }]
    });
  });

  test("fails closed for disconnect, unknown, and multiple live instances", () => {
    const disconnected = createEngineeringEditorStateRegistry();
    expect(
      disconnected.report(
        report({
          connection: "disconnected",
          dirty: true,
          buffer: "",
          bufferChecksum: checksum("")
        })
      )
    ).toMatchObject({ ok: true });
    expect(disconnected.decideMutation([target()])).toMatchObject({
      ok: false,
      code: ENGINEERING_EDITOR_STATE_UNKNOWN
    });

    const unknown = createEngineeringEditorStateRegistry();
    unknown.report(report({ connection: "unknown", buffer: "", bufferChecksum: checksum("") }));
    expect(unknown.observe(target())).toMatchObject({
      status: "unknown",
      reason: "reported_unknown"
    });
    expect(unknown.readForMutation(target())).toEqual({ status: "unknown", dirty: false });

    const multiple = createEngineeringEditorStateRegistry();
    multiple.report(report());
    multiple.report(report({ editorInstanceId: "editor_2" }));
    expect(multiple.observe(target())).toMatchObject({
      status: "unknown",
      reason: "multiple_connected"
    });
  });

  test("returns dirty text only through the explicit sharing read, never mutation state", () => {
    const registry = createEngineeringEditorStateRegistry();
    registry.report(report({ dirty: true, buffer: "do not use as a write base" }));

    expect(registry.readForMutation(target())).toEqual({
      status: "known",
      dirty: true,
      rendererRevision: 1
    });
    expect(registry.readForExplicitShare(target())).toEqual({
      status: "available",
      target: target(),
      rendererRevision: 1,
      bufferChecksum: checksum("do not use as a write base"),
      bufferContent: "do not use as a write base"
    });

    registry.report(report({ rendererRevision: 2, acknowledgedRevision: 2, buffer: "saved" }));
    expect(registry.readForExplicitShare(target())).toEqual({
      status: "unavailable",
      target: target(),
      reason: "clean"
    });
  });

  test("rejects stale or malformed reports without changing the prior snapshot", () => {
    const registry = createEngineeringEditorStateRegistry();
    const current = report({ rendererRevision: 5, acknowledgedRevision: 4, buffer: "current" });
    registry.report(current);

    expect(
      registry.report(report({ rendererRevision: 4, acknowledgedRevision: 4, buffer: "old" }))
    ).toMatchObject({ ok: false, error: { code: "EDITOR_STATE_STALE_UPDATE" } });
    expect(
      registry.report(report({ rendererRevision: 6, acknowledgedRevision: 3, buffer: "bad ack" }))
    ).toMatchObject({ ok: false, error: { code: "EDITOR_STATE_STALE_UPDATE" } });
    expect(
      registry.report(
        report({ rendererRevision: 5, acknowledgedRevision: 5, buffer: "revision reuse" })
      )
    ).toMatchObject({ ok: false, error: { code: "EDITOR_STATE_STALE_UPDATE" } });
    expect(
      registry.report(report({ relativePath: "../outside.md", buffer: "bad path" }))
    ).toMatchObject({ ok: false, error: { code: "EDITOR_STATE_UPDATE_INVALID" } });
    expect(
      registry.report(report({ rootBindingId: "root\u0000", buffer: "bad binding" }))
    ).toMatchObject({ ok: false, error: { code: "EDITOR_STATE_UPDATE_INVALID" } });
    expect(registry.readInstance(current)).toEqual(current);
  });

  test("validates checksums and bounded buffers, and clears exactly one root binding", () => {
    const registry = createEngineeringEditorStateRegistry();
    const first = report({ rootBindingId: "root_1" });
    const second = report({ rootBindingId: "root_2", editorInstanceId: "editor_2" });
    registry.report(first);
    registry.report(second);

    expect(
      registry.report({
        ...first,
        editorInstanceId: "oversized",
        bufferContent: "x".repeat(MAX_ENGINEERING_EDITOR_BUFFER_BYTES + 1),
        bufferChecksum: checksum("x".repeat(MAX_ENGINEERING_EDITOR_BUFFER_BYTES + 1))
      })
    ).toMatchObject({ ok: false, error: { code: "EDITOR_STATE_UPDATE_INVALID" } });
    expect(
      registry.report({ ...first, editorInstanceId: "tampered", bufferContent: "tampered" })
    ).toMatchObject({ ok: false, error: { code: "EDITOR_STATE_UPDATE_INVALID" } });

    registry.clearRootBinding("root_1");
    expect(registry.readInstance(first)).toBeUndefined();
    expect(registry.readInstance(second)).toEqual(second);
  });
});

function target(
  overrides: Partial<EngineeringEditorResourceIdentity> = {}
): EngineeringEditorResourceIdentity {
  return {
    rootBindingId: overrides.rootBindingId ?? "root_1",
    relativePath: overrides.relativePath ?? "src/scene.md"
  };
}

function report(
  overrides: Partial<EngineeringEditorStateReport> & { readonly buffer?: string } = {}
): EngineeringEditorStateReport {
  const { buffer = "saved buffer", ...reportOverrides } = overrides;
  return {
    ...target(),
    editorInstanceId: "editor_1",
    connection: "connected",
    rendererRevision: 1,
    acknowledgedRevision: 1,
    dirty: false,
    bufferChecksum: checksum(buffer),
    bufferContent: buffer,
    ...reportOverrides
  };
}

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
